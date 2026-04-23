//! Session D Part 6: generalized settle_match for 1v1 / 4p / 8p / BR10.
//!
//! First settler (partial): just writes their height into their slot and
//! returns. No remaining_accounts needed.
//!
//! Final settler: the player whose `settled_count + 1 == required_players`.
//! They must supply remaining_accounts in exact order:
//!   [stats_p0, stats_p1, ..., stats_pN-1, payout_1, payout_2, ..., payout_K]
//! where N = required_players, K = payout_table().len(). stats ordering
//! mirrors match.players slot order; payouts mirror rank order (1st, 2nd…).
//!
//! Program:
//!   1. Writes height into caller's slot, bumps settled_count.
//!   2. If partial: return.
//!   3. Sort players by height desc.
//!   4. For each top-K rank: verify remaining_account == players[sorted_slot],
//!      transfer (distributable * bps / 10000) lamports to them.
//!   5. Transfer rake to treasury.
//!   6. For each of the N stats accounts: verify it's the right PDA, deserialize,
//!      update wins/losses/xp/level/profit, serialize back.
//!   7. Insert winner (rank 0) into leaderboard.
//!   8. Mark status=Settled.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::error::GameError;
use crate::instructions::retention_hooks::apply_retention_updates;
use crate::state::{
    compute_mode_payout, level_from_xp, xp_for_placement, DailyChallenge, GameMode, Leaderboard,
    MatchAccount, MatchStatus, Season, Treasury, UserStats, BPS_DENOM, DAILY_CHALLENGE_SEED,
    DAY_SECONDS, LEADERBOARD_SEED, MATCH_ESCROW_SEED, MATCH_SEED, SEASON_SEED, TREASURY_SEED,
    USER_STATS_SEED, WEEK_SECONDS,
};

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, SettleMatch<'info>>,
    height: u32,
) -> Result<()> {
    let clock = Clock::get()?;
    let caller_key = ctx.accounts.player.key();
    let match_key = ctx.accounts.match_account.key();
    let program_id = *ctx.program_id;

    // Part 10 Bundle 3: verify retention PDAs are for the current day/week.
    // Anchor's seeds constraint already validated each PDA's address
    // matches `daily_challenge.day_id` / `season.season_id` — here we
    // additionally require those ids to be the current UTC day/week so
    // stale accounts can't be replayed.
    let current_day = (clock.unix_timestamp / DAY_SECONDS) as u64;
    let current_week = (clock.unix_timestamp / WEEK_SECONDS) as u64;
    require!(
        ctx.accounts.daily_challenge.day_id == current_day,
        GameError::DailyChallengeStale
    );
    require!(
        ctx.accounts.season.season_id == current_week,
        GameError::SeasonStale
    );

    // Scope 1: write caller's height, bump settled_count, return early if partial.
    let (all_settled, pot, players, heights, mode_u8, match_time_window, wager_lamports, required_players) = {
        let m = &mut ctx.accounts.match_account;
        require!(
            m.status == MatchStatus::Active as u8,
            GameError::MatchBadStatus
        );
        let slot = m.slot_of(&caller_key).ok_or(GameError::NotInMatch)?;
        require!(m.heights[slot] == u32::MAX, GameError::AlreadySettledMatch);
        m.heights[slot] = height;
        m.settled_count = m.settled_count.saturating_add(1);

        let all = m.settled_count >= m.required_players;
        let pot = m.wager_lamports.saturating_mul(m.required_players as u64);
        (all, pot, m.players, m.heights, m.mode, m.time_window, m.wager_lamports, m.required_players)
    };

    if !all_settled {
        msg!(
            "SettleMatch.PARTIAL: match={} player={} slot_height={} settled={}/{}",
            match_key, caller_key, height, ctx.accounts.match_account.settled_count, required_players
        );
        emit!(MatchSettlePartial {
            match_pda: match_key,
            player: caller_key,
            height,
            at: clock.unix_timestamp,
        });
        return Ok(());
    }

    // Scope 2: verify remaining_accounts layout + collect per-player levels.
    // Stats accounts at remaining_accounts[0..N]; payout recipients at [N..N+K].
    // Part 13: read each UserStats.level before payout compute so rake can
    // scale per-player. Scope 7 re-deserializes for its mutation pass.
    let game_mode = GameMode::from_u8(mode_u8).ok_or(GameError::InvalidMode)?;
    let n = required_players as usize;
    let payout_table = game_mode.payout_table();
    let k = payout_table.len();
    let expected_len = n + k;
    require!(
        ctx.remaining_accounts.len() == expected_len,
        GameError::NotInMatch
    );

    let mut levels = [1u16; crate::state::MATCH_MAX_PLAYERS];
    for slot_idx in 0..n {
        let stats_info = &ctx.remaining_accounts[slot_idx];
        let (expected_pda, _) = Pubkey::find_program_address(
            &[USER_STATS_SEED, players[slot_idx].as_ref()],
            &program_id,
        );
        require_keys_eq!(stats_info.key(), expected_pda, GameError::NotInMatch);
        require_keys_eq!(*stats_info.owner, program_id, GameError::NotInMatch);
        let data = stats_info.try_borrow_data()?;
        let stats = UserStats::try_deserialize(&mut &data[..])?;
        levels[slot_idx] = stats.level.max(1);
    }

    // Scope 3: compute payouts + rake.
    let height_slice = &heights[..n];
    let (rake, payouts) = compute_mode_payout(game_mode, pot, height_slice, &levels[..n]);
    debug_assert_eq!(payouts.len(), k);

    // Scope 4: escrow signer — needed for transfers out of match_escrow.
    let escrow_bump = ctx.accounts.match_account.escrow_bump;
    let escrow_seeds: &[&[u8]] = &[
        MATCH_ESCROW_SEED,
        match_key.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let escrow_signer: &[&[&[u8]]] = &[escrow_seeds];

    // Scope 5: payout transfers (top-K). Verify each recipient matches
    // players[sorted_slot] before transferring.
    //
    // payouts is in rank order (1st, 2nd, ...); remaining_accounts[N + rank]
    // is the corresponding payout recipient.
    for (rank, (sorted_slot, amount)) in payouts.iter().enumerate() {
        let expected_key = players[*sorted_slot];
        let recipient_info = &ctx.remaining_accounts[n + rank];
        require_keys_eq!(recipient_info.key(), expected_key, GameError::NotInMatch);
        if *amount > 0 {
            let cpi = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.match_escrow.to_account_info(),
                    to: recipient_info.clone(),
                },
                escrow_signer,
            );
            system_program::transfer(cpi, *amount)?;
        }
    }

    // Scope 6: rake transfer.
    if rake > 0 {
        let cpi = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.match_escrow.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
            escrow_signer,
        );
        system_program::transfer(cpi, rake)?;
        ctx.accounts.treasury.total_received =
            ctx.accounts.treasury.total_received.saturating_add(rake);
        // Part 10 Bundle 3: accrue to the season's prize pool. Settles off
        // the same rake amount so no double-counting vs treasury.total_received.
        ctx.accounts.season.total_rake_accumulated =
            ctx.accounts.season.total_rake_accumulated.saturating_add(rake);
    }

    // Scope 7: stats updates for every player. Stats accounts are at
    // remaining_accounts[0..N] in player-slot order.
    //
    // Build a placement map (slot → rank) by re-scanning the sorted order.
    // Then each slot gets XP per its placement + profit diff per payout.
    let mut indexed: Vec<(usize, u32)> = (0..n).map(|i| (i, heights[i])).collect();
    indexed.sort_by(|a, b| b.1.cmp(&a.1));
    let mut placement_of = [0usize; crate::state::MATCH_MAX_PLAYERS];
    for (rank, (slot, _)) in indexed.iter().enumerate() {
        placement_of[*slot] = rank;
    }
    let mut payout_of = [0u64; crate::state::MATCH_MAX_PLAYERS];
    for (rank, (sorted_slot, amount)) in payouts.iter().enumerate() {
        let _ = rank;
        payout_of[*sorted_slot] = *amount;
    }

    // Snapshot daily challenges into a local array once so the loop body
    // can split-borrow `&mut ctx.accounts.season` without aliasing issues.
    // `[Challenge; 3]` is Copy since Challenge derives it.
    let daily_challenges_snapshot = ctx.accounts.daily_challenge.challenges;
    for slot_idx in 0..n {
        let stats_info = &ctx.remaining_accounts[slot_idx];
        // Verify it's the correct UserStats PDA for players[slot_idx].
        let (expected_pda, _expected_bump) = Pubkey::find_program_address(
            &[USER_STATS_SEED, players[slot_idx].as_ref()],
            &program_id,
        );
        require_keys_eq!(stats_info.key(), expected_pda, GameError::NotInMatch);
        require_keys_eq!(*stats_info.owner, program_id, GameError::NotInMatch);
        require!(stats_info.is_writable, GameError::NotInMatch);

        // Manual deserialize + mutate + reserialize.
        let mut data = stats_info.try_borrow_mut_data()?;
        let mut stats = UserStats::try_deserialize(&mut &data[..])?;

        let rank = placement_of[slot_idx];
        let won = rank < k; // top-K ranks are "winners"
        let payout = payout_of[slot_idx];
        let xp_gained = xp_for_placement(game_mode, rank);

        stats.games_played = stats.games_played.saturating_add(1);
        stats.last_played_at = clock.unix_timestamp;
        if won {
            stats.wins = stats.wins.saturating_add(1);
            // Profit = payout − wager.
            let net = (payout as i64).saturating_sub(wager_lamports as i64);
            stats.profit_lamports = stats.profit_lamports.saturating_add(net);
        } else {
            stats.losses = stats.losses.saturating_add(1);
            stats.profit_lamports = stats.profit_lamports.saturating_sub(wager_lamports as i64);
        }
        stats.xp = stats.xp.saturating_add(xp_gained);

        // Part 10 Bundle 3: streak + daily challenges + season inserts.
        let bonus_xp = apply_retention_updates(
            &mut stats,
            won,
            mode_u8,
            match_time_window,
            required_players,
            &daily_challenges_snapshot,
            &mut ctx.accounts.season,
            players[slot_idx],
            clock.unix_timestamp,
        );
        stats.xp = stats.xp.saturating_add(bonus_xp);
        stats.level = level_from_xp(stats.xp);

        // Re-serialize into the account data.
        let mut writer = &mut data[..];
        stats.try_serialize(&mut writer)?;
    }

    // Scope 8: leaderboard insert for rank-0 (winner).
    let winner_slot = indexed[0].0;
    let winner_pubkey = players[winner_slot];
    let winner_height = heights[winner_slot];
    let winner_height_u8: u8 = winner_height.min(u8::MAX as u32) as u8;
    let evicted_before = ctx.accounts.leaderboard.entries[crate::state::LEADERBOARD_SIZE - 1].player;
    if let Some(idx) = ctx
        .accounts
        .leaderboard
        .try_insert(winner_pubkey, winner_height_u8, clock.unix_timestamp)
    {
        msg!(
            "Leaderboard: insert player={} height={} at_rank={}",
            winner_pubkey, winner_height_u8, idx + 1
        );
        emit!(crate::instructions::settle::LeaderboardInserted {
            player: winner_pubkey,
            height: winner_height_u8,
            rank: (idx + 1) as u8,
            evicted_player: evicted_before,
            settled_at: clock.unix_timestamp,
        });
    }

    // Scope 9: finalize match.
    let m = &mut ctx.accounts.match_account;
    m.status = MatchStatus::Settled as u8;
    m.closed_at = clock.unix_timestamp;

    msg!(
        "SettleMatch.FINAL: match={} mode={} winner={} winner_height={} rake={} pot={}",
        match_key, mode_u8, winner_pubkey, winner_height, rake, pot
    );
    emit!(MatchSettled {
        match_pda: match_key,
        winner: winner_pubkey,
        winner_slot: winner_slot as u8,
        pot,
        rake,
        settled_count: required_players,
        at: clock.unix_timestamp,
    });
    let _ = BPS_DENOM; // suppress unused warning in case future refactor drops direct use
    Ok(())
}

#[event]
pub struct MatchSettlePartial {
    pub match_pda: Pubkey,
    pub player: Pubkey,
    pub height: u32,
    pub at: i64,
}

#[event]
pub struct MatchSettled {
    pub match_pda: Pubkey,
    pub winner: Pubkey,
    pub winner_slot: u8,
    pub pot: u64,
    pub rake: u64,
    pub settled_count: u8,
    pub at: i64,
}

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    // SBF stack fix: each `Account<'info, T>` is boxed to move its deserialized
    // payload from stack to heap during `try_accounts`. Without boxing the four
    // large PDAs below, `SettleMatch::try_accounts` overflowed the 4KB SBF
    // frame by 40 bytes and crashed every Real settle at runtime.
    #[account(
        mut,
        seeds = [MATCH_SEED, &[match_account.mode], &[match_account.wager_tier], &match_account.seq.to_le_bytes()],
        bump = match_account.bump,
    )]
    pub match_account: Box<Account<'info, MatchAccount>>,

    #[account(
        mut,
        seeds = [MATCH_ESCROW_SEED, match_account.key().as_ref()],
        bump = match_account.escrow_bump,
    )]
    pub match_escrow: SystemAccount<'info>,

    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,

    #[account(mut, seeds = [LEADERBOARD_SEED, &[match_account.mode]], bump)]
    pub leaderboard: Box<Account<'info, Leaderboard>>,

    pub system_program: Program<'info, System>,

    // Part 10 Bundle 3 — retention PDAs. Seeds reference the day_id /
    // season_id stored ON the accounts themselves so Anchor validates
    // the PDA address; the handler then require!s that those ids match
    // the current UTC day / week (stale accounts reject).
    #[account(
        mut,
        seeds = [DAILY_CHALLENGE_SEED, &daily_challenge.day_id.to_le_bytes()],
        bump = daily_challenge.bump,
    )]
    pub daily_challenge: Box<Account<'info, DailyChallenge>>,

    #[account(
        mut,
        seeds = [SEASON_SEED, &season.season_id.to_le_bytes()],
        bump = season.bump,
    )]
    pub season: Box<Account<'info, Season>>,
    // remaining_accounts:
    //   [stats_p0..stats_pN-1]   (mutable, owned by this program)
    //   [payout_recipient_1..K]  (mutable, system-owned)
}
