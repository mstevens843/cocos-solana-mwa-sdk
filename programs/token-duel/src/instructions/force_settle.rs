//! Part 9: `force_settle` — AFK reclaim.
//!
//! Once a match has been `Active` for `FORCE_SETTLE_TIMEOUT_SECS` (300s)
//! without all players submitting, any signer can call this instruction to
//! forcibly close the match. Non-submitters (heights still == u32::MAX) are
//! treated as having submitted height = 0, guaranteeing they rank below any
//! honest submitter. We then reuse the existing `settle_match` final-settler
//! payout + rake + stats + leaderboard path verbatim.
//!
//! The caller does NOT need to be one of the match players — this is meant
//! to unlock stranded escrow lamports regardless of who initiates.
//!
//! remaining_accounts layout is identical to `settle_match`'s final path:
//!   [stats_p0, ..., stats_pN-1, payout_1, payout_2, ..., payout_K]
//! where N = required_players, K = payout_table().len().

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::error::GameError;
use crate::instructions::retention_hooks::apply_retention_updates;
use crate::state::{
    compute_mode_payout, level_from_xp, xp_for_placement, DailyChallenge, GameMode, Leaderboard,
    MatchAccount, MatchStatus, Season, Treasury, UserStats, DAILY_CHALLENGE_SEED, DAY_SECONDS,
    FORCE_SETTLE_TIMEOUT_SECS, LEADERBOARD_SEED, MATCH_ESCROW_SEED, MATCH_SEED, SEASON_SEED,
    TREASURY_SEED, USER_STATS_SEED, WEEK_SECONDS,
};

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, ForceSettle<'info>>) -> Result<()> {
    let clock = Clock::get()?;
    let caller_key = ctx.accounts.caller.key();
    let match_key = ctx.accounts.match_account.key();
    let program_id = *ctx.program_id;

    // Part 10 Bundle 3: retention PDAs must be current. Anchor validates each
    // PDA's address matches daily_challenge.day_id / season.season_id; we
    // additionally require those ids to be the current UTC day / week so
    // stale accounts can't be replayed on an AFK-reclaimed match.
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

    // Scope 1: gate + fill forfeits, snapshot working state.
    let (pot, players, heights, mode_u8, match_time_window, wager_lamports, required_players, forfeits) = {
        let m = &mut ctx.accounts.match_account;
        require!(
            m.status == MatchStatus::Active as u8,
            GameError::MatchBadStatus
        );
        let elapsed = clock.unix_timestamp.saturating_sub(m.started_at);
        require!(elapsed >= FORCE_SETTLE_TIMEOUT_SECS, GameError::MatchNotForcedYet);

        let n = m.required_players as usize;
        let mut forfeits: u8 = 0;
        for i in 0..n {
            if m.heights[i] == u32::MAX {
                m.heights[i] = 0;
                forfeits = forfeits.saturating_add(1);
            }
        }
        // Jump settled_count to full so downstream matches the final-settler
        // state machine exactly.
        m.settled_count = m.required_players;

        let pot = m.wager_lamports.saturating_mul(m.required_players as u64);
        (
            pot,
            m.players,
            m.heights,
            m.mode,
            m.time_window,
            m.wager_lamports,
            m.required_players,
            forfeits,
        )
    };

    // Scope 2: verify remaining_accounts layout + collect per-player levels.
    // Stats accounts at remaining_accounts[0..N]; payout recipients at [N..N+K].
    // Part 13: read each UserStats.level before payout compute so rake can
    // scale per-player (AFK forfeiters still pay their tier rake on their stake).
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

    // Scope 4: escrow signer.
    let escrow_bump = ctx.accounts.match_account.escrow_bump;
    let escrow_seeds: &[&[u8]] = &[
        MATCH_ESCROW_SEED,
        match_key.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let escrow_signer: &[&[&[u8]]] = &[escrow_seeds];

    // Scope 5: payout transfers (top-K).
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
        // Part 10 Bundle 3: accrue to season prize pool (mirrors settle_match).
        ctx.accounts.season.total_rake_accumulated =
            ctx.accounts.season.total_rake_accumulated.saturating_add(rake);
    }

    // Scope 7: stats updates for every player.
    let mut indexed: Vec<(usize, u32)> = (0..n).map(|i| (i, heights[i])).collect();
    indexed.sort_by(|a, b| b.1.cmp(&a.1));
    let mut placement_of = [0usize; crate::state::MATCH_MAX_PLAYERS];
    for (rank, (slot, _)) in indexed.iter().enumerate() {
        placement_of[*slot] = rank;
    }
    let mut payout_of = [0u64; crate::state::MATCH_MAX_PLAYERS];
    for (_rank, (sorted_slot, amount)) in payouts.iter().enumerate() {
        payout_of[*sorted_slot] = *amount;
    }

    // Snapshot daily challenges once so the loop can split-borrow
    // `&mut ctx.accounts.season` without aliasing. `[Challenge; 3]` is Copy.
    let daily_challenges_snapshot = ctx.accounts.daily_challenge.challenges;
    for slot_idx in 0..n {
        let stats_info = &ctx.remaining_accounts[slot_idx];
        let (expected_pda, _expected_bump) = Pubkey::find_program_address(
            &[USER_STATS_SEED, players[slot_idx].as_ref()],
            &program_id,
        );
        require_keys_eq!(stats_info.key(), expected_pda, GameError::NotInMatch);
        require_keys_eq!(*stats_info.owner, program_id, GameError::NotInMatch);
        require!(stats_info.is_writable, GameError::NotInMatch);

        let mut data = stats_info.try_borrow_mut_data()?;
        let mut stats = UserStats::try_deserialize(&mut &data[..])?;

        let rank = placement_of[slot_idx];
        let won = rank < k;
        let payout = payout_of[slot_idx];
        let xp_gained = xp_for_placement(game_mode, rank);

        stats.games_played = stats.games_played.saturating_add(1);
        stats.last_played_at = clock.unix_timestamp;
        if won {
            stats.wins = stats.wins.saturating_add(1);
            let net = (payout as i64).saturating_sub(wager_lamports as i64);
            stats.profit_lamports = stats.profit_lamports.saturating_add(net);
        } else {
            stats.losses = stats.losses.saturating_add(1);
            stats.profit_lamports = stats.profit_lamports.saturating_sub(wager_lamports as i64);
        }
        stats.xp = stats.xp.saturating_add(xp_gained);

        // Part 10 Bundle 3: streak + daily challenges + season inserts so
        // winners on AFK-reclaimed matches get the same retention credit
        // as organic final-settles.
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

        let mut writer = &mut data[..];
        stats.try_serialize(&mut writer)?;
    }

    // Scope 8: leaderboard insert for rank-0 (winner). If all players forfeit
    // (rank-0 height == 0), `try_insert` no-ops by design.
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
            "Leaderboard: insert (force) player={} height={} at_rank={}",
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
        "ForceSettle.FINAL: match={} caller={} forfeits={} winner={} winner_height={} rake={} pot={}",
        match_key, caller_key, forfeits, winner_pubkey, winner_height, rake, pot
    );

    // Emit BOTH events so off-chain indexers that watch MatchSettled pick up
    // force-settled matches seamlessly, while history UIs that want to
    // highlight AFK reclaims can filter on MatchForceSettled.
    emit!(crate::instructions::settle_match::MatchSettled {
        match_pda: match_key,
        winner: winner_pubkey,
        winner_slot: winner_slot as u8,
        pot,
        rake,
        settled_count: required_players,
        at: clock.unix_timestamp,
    });
    emit!(MatchForceSettled {
        match_pda: match_key,
        caller: caller_key,
        forfeits,
        pot,
        rake,
        at: clock.unix_timestamp,
    });
    Ok(())
}

#[event]
pub struct MatchForceSettled {
    pub match_pda: Pubkey,
    pub caller: Pubkey,
    pub forfeits: u8,
    pub pot: u64,
    pub rake: u64,
    pub at: i64,
}

#[derive(Accounts)]
pub struct ForceSettle<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    // SBF stack fix: see settle_match.rs for rationale. Same four PDAs boxed.
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

    // Part 10 Bundle 3 — retention PDAs. Seeds reference day_id / season_id
    // stored on the accounts themselves; handler then require!s those ids
    // match the current UTC day / week (stale accounts reject).
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
