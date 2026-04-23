//! Part 10 Bundle 1 — server-signed height receipt verification.
//!
//! `settle_match_verified` is the cheat-resistant settle path. The client
//! submits a TWO-instruction transaction:
//!
//!   ix[0] — Ed25519Program::new_ed25519_instruction(&receipt_signer, message)
//!           Native precompile verifies the signature before any Anchor
//!           code runs. Fails the whole tx if the signature is invalid.
//!   ix[1] — settle_match_verified(height: u32, signed_at: i64)
//!           Anchor ix: reads ix[0] via Instructions sysvar, parses the
//!           Ed25519 precompile's offsets header, extracts (signer, message).
//!           Asserts signer == RECEIPT_SIGNER_PUBKEY, asserts message
//!           matches (match_pda || player || height || signed_at) exactly,
//!           then runs the same final-settler payout flow as settle_match.
//!
//! Receipt message layout (76 bytes, borsh-packed, little-endian):
//!   [0..32]   match_pda: Pubkey
//!   [32..64]  player:    Pubkey
//!   [64..68]  height:    u32 LE
//!   [68..76]  signed_at: i64 LE
//!
//! Replay protection: the match PDA can only be settled once (status
//! transitions Active → Settled and the program rejects re-entry). A
//! cached receipt for an already-settled match is therefore dead weight.
//! Cross-match replay is impossible because match_pda is in the message.
//!
//! Fallback path: if the backend is down or returns an error, the client
//! falls back to `settle_match` (unverified). A Settings-panel toggle lets
//! the admin disable unverified settles entirely for mainnet launch.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    ed25519_program,
    sysvar::instructions::{load_instruction_at_checked, ID as IX_SYSVAR_ID},
};
use anchor_lang::system_program;

use crate::error::GameError;
use crate::instructions::retention_hooks::apply_retention_updates;
use crate::state::{
    compute_mode_payout, level_from_xp, xp_for_placement, DailyChallenge, GameMode, Leaderboard,
    MatchAccount, MatchStatus, Season, Treasury, UserStats, BPS_DENOM, DAILY_CHALLENGE_SEED,
    DAY_SECONDS, LEADERBOARD_SEED, MATCH_ESCROW_SEED, MATCH_SEED, RECEIPT_MAX_AGE_SECS,
    RECEIPT_SIGNER_PUBKEY, SEASON_SEED, TREASURY_SEED, USER_STATS_SEED, WEEK_SECONDS,
};

/// Length of the signed receipt payload. Must match client + backend.
pub const RECEIPT_MSG_LEN: usize = 76;

/// The Ed25519 precompile instruction starts with a 16-byte header that
/// declares the byte offsets of signature / pubkey / message within the
/// ix data. Different clients (our backend uses @solana/web3.js's
/// Ed25519Program helper, which lays out header|pubkey|sig|msg) arrange
/// those blocks differently, so we read the offsets from the header rather
/// than hard-coding them. The precompile itself already verified the
/// signature at those offsets before this ix ran, so we only need to
/// sanity-check that they point inside the data buffer.
const ED25519_HEADER_LEN: usize = 16;

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, SettleMatchVerified<'info>>,
    height: u32,
    signed_at: i64,
) -> Result<()> {
    let clock = Clock::get()?;
    let caller_key = ctx.accounts.player.key();
    let match_key = ctx.accounts.match_account.key();
    let program_id = *ctx.program_id;

    // ─── Scope 0: verify the preceding Ed25519 precompile ix. ────────────

    // load_instruction_at_checked returns the instruction at the given index
    // in the current transaction, or errors if index is out of bounds.
    let ed_ix = load_instruction_at_checked(0, &ctx.accounts.ix_sysvar)
        .map_err(|_| GameError::Ed25519IxMissing)?;
    require_keys_eq!(ed_ix.program_id, ed25519_program::ID, GameError::Ed25519IxMissing);

    // Parse the precompile data header. For a single signature:
    //   [0]    num_signatures (expect 1)
    //   [1]    padding
    //   [2..4] signature_offset (u16 LE) — where the 64-byte sig starts
    //   [4..6] signature_instruction_index (0xFFFF = this ix)
    //   [6..8] public_key_offset (u16 LE)
    //   [8..10] public_key_instruction_index
    //   [10..12] message_data_offset (u16 LE)
    //   [12..14] message_data_size (u16 LE)
    //   [14..16] message_instruction_index
    let data = &ed_ix.data;
    require!(data.len() >= ED25519_HEADER_LEN, GameError::Ed25519IxMalformed);
    require!(data[0] == 1, GameError::Ed25519IxMalformed); // exactly 1 signature

    let sig_off = u16::from_le_bytes([data[2], data[3]]) as usize;
    let pk_off = u16::from_le_bytes([data[6], data[7]]) as usize;
    let msg_off = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;

    // For a properly-formed single-sig ix built by Solana's
    // new_ed25519_instruction helper, sig_off=16, pk_off=80, msg_off=112.
    // We don't hard-code those to stay forward-compatible with any
    // library that arranges bytes differently — just require the
    // offsets point inside the ix data.
    require!(sig_off + 64 <= data.len(), GameError::Ed25519IxMalformed);
    require!(pk_off + 32 <= data.len(), GameError::Ed25519IxMalformed);
    require!(msg_off + msg_size <= data.len(), GameError::Ed25519IxMalformed);
    require!(msg_size == RECEIPT_MSG_LEN, GameError::Ed25519IxMalformed);
    require!(sig_off >= ED25519_HEADER_LEN, GameError::Ed25519IxMalformed);
    require!(pk_off >= ED25519_HEADER_LEN, GameError::Ed25519IxMalformed);
    require!(msg_off >= ED25519_HEADER_LEN, GameError::Ed25519IxMalformed);
    // Non-overlap: pubkey, sig, and message must be in disjoint regions.
    let regions = [
        (pk_off, 32),
        (sig_off, 64),
        (msg_off, msg_size),
    ];
    for i in 0..regions.len() {
        for j in (i + 1)..regions.len() {
            let (a_start, a_len) = regions[i];
            let (b_start, b_len) = regions[j];
            let a_end = a_start + a_len;
            let b_end = b_start + b_len;
            require!(a_end <= b_start || b_end <= a_start, GameError::Ed25519IxMalformed);
        }
    }

    // Verify signer == server pubkey.
    let pk_bytes: [u8; 32] = data[pk_off..pk_off + 32]
        .try_into()
        .map_err(|_| GameError::Ed25519IxMalformed)?;
    let signer = Pubkey::new_from_array(pk_bytes);
    require_keys_eq!(signer, RECEIPT_SIGNER_PUBKEY, GameError::InvalidReceiptSigner);

    // Parse message: [match_pda(32) || player(32) || height(4) || signed_at(8)].
    let msg = &data[msg_off..msg_off + RECEIPT_MSG_LEN];
    let msg_match: [u8; 32] = msg[0..32]
        .try_into()
        .map_err(|_| GameError::Ed25519IxMalformed)?;
    let msg_player: [u8; 32] = msg[32..64]
        .try_into()
        .map_err(|_| GameError::Ed25519IxMalformed)?;
    let msg_height = u32::from_le_bytes([msg[64], msg[65], msg[66], msg[67]]);
    let msg_signed_at = i64::from_le_bytes([
        msg[68], msg[69], msg[70], msg[71], msg[72], msg[73], msg[74], msg[75],
    ]);

    // Cross-check message against ix args + ctx accounts.
    require!(
        Pubkey::new_from_array(msg_match) == match_key,
        GameError::ReceiptMessageMismatch
    );
    require!(
        Pubkey::new_from_array(msg_player) == caller_key,
        GameError::ReceiptMessageMismatch
    );
    require!(msg_height == height, GameError::ReceiptMessageMismatch);
    require!(msg_signed_at == signed_at, GameError::ReceiptMessageMismatch);

    // Freshness — 5-min window.
    let drift = (clock.unix_timestamp - signed_at).abs();
    require!(drift <= RECEIPT_MAX_AGE_SECS, GameError::ReceiptExpired);

    msg!(
        "SettleMatchVerified: OK match={} player={} height={} drift_s={}",
        match_key, caller_key, height, drift
    );

    // ─── Scopes 1-9 mirror settle_match.rs verbatim. ─────────────────────

    // Part 10 Bundle 3: retention-PDA freshness check (mirrors settle_match.rs).
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
            "SettleMatchVerified.PARTIAL: match={} player={} settled={}/{}",
            match_key, caller_key, ctx.accounts.match_account.settled_count, required_players
        );
        emit!(crate::instructions::settle_match::MatchSettlePartial {
            match_pda: match_key,
            player: caller_key,
            height,
            at: clock.unix_timestamp,
        });
        return Ok(());
    }

    // Part 13: collect per-player levels before payout compute so rake scales
    // per-player. Stats accounts at remaining_accounts[0..N].
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

    let height_slice = &heights[..n];
    let (rake, payouts) = compute_mode_payout(game_mode, pot, height_slice, &levels[..n]);
    debug_assert_eq!(payouts.len(), k);

    let escrow_bump = ctx.accounts.match_account.escrow_bump;
    let escrow_seeds: &[&[u8]] = &[
        MATCH_ESCROW_SEED,
        match_key.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let escrow_signer: &[&[&[u8]]] = &[escrow_seeds];

    // Payouts.
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

    // Rake.
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
        // Part 10 Bundle 3: accrue to the current season's prize pool.
        ctx.accounts.season.total_rake_accumulated =
            ctx.accounts.season.total_rake_accumulated.saturating_add(rake);
    }

    // Stats updates.
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

        // Part 10 Bundle 3: retention hooks (streak + challenges + season).
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

    // Leaderboard insert for rank-0.
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
            "Leaderboard (verified): insert player={} height={} at_rank={}",
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

    // Finalize.
    let m = &mut ctx.accounts.match_account;
    m.status = MatchStatus::Settled as u8;
    m.closed_at = clock.unix_timestamp;

    msg!(
        "SettleMatchVerified.FINAL: match={} winner={} winner_height={} rake={} pot={}",
        match_key, winner_pubkey, winner_height, rake, pot
    );
    emit!(crate::instructions::settle_match::MatchSettled {
        match_pda: match_key,
        winner: winner_pubkey,
        winner_slot: winner_slot as u8,
        pot,
        rake,
        settled_count: required_players,
        at: clock.unix_timestamp,
    });
    // Additional event so indexers can distinguish verified-vs-legacy at a glance.
    emit!(MatchSettledVerified {
        match_pda: match_key,
        winner: winner_pubkey,
        pot,
        rake,
        at: clock.unix_timestamp,
    });
    let _ = BPS_DENOM;
    Ok(())
}

#[event]
pub struct MatchSettledVerified {
    pub match_pda: Pubkey,
    pub winner: Pubkey,
    pub pot: u64,
    pub rake: u64,
    pub at: i64,
}

#[derive(Accounts)]
pub struct SettleMatchVerified<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    // SBF stack fix: see settle_match.rs for rationale. This variant has the
    // extra `ix_sysvar` field so it overflowed by 152 bytes (the worst of the
    // three). Same four PDAs boxed.
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

    /// Solana sysvar exposing the current transaction's instruction list.
    /// CHECK: validated by Anchor's address constraint; read via
    /// `load_instruction_at_checked` in the handler.
    #[account(address = IX_SYSVAR_ID)]
    pub ix_sysvar: UncheckedAccount<'info>,

    // Part 10 Bundle 3 — retention PDAs (identical to SettleMatch).
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
