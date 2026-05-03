//! `settle_match_verified_skr` — SKR / SPL-token twin of
//! `settle_match_verified.rs`.
//!
//! The Ed25519 receipt-verification block is **byte-identical** to the SOL
//! path — the receipt message format `[match_pda||player||height||signed_at]`
//! doesn't depend on the wager currency.
//!
//! Differences from the SOL path:
//!   - Payouts come out of `match_escrow_token` (an SPL TokenAccount) via
//!     `token::transfer_checked`, not `system_program::transfer`.
//!   - Rake flows to a `treasury_token` ATA owned by the Treasury PDA.
//!     The first SKR settle for a given mint creates that ATA via
//!     `init_if_needed`; subsequent settles reuse it.
//!   - Recipient accounts in `remaining_accounts[N..N+K]` are the winners'
//!     **SKR ATAs** — clients are responsible for preflighting
//!     `createAssociatedTokenAccountIdempotent` for any winner whose ATA
//!     doesn't yet exist (cheaper than init_if_needed inside the settle ix
//!     because settle has a tight tx-size budget already).
//!   - `UserStats.profit_lamports` is NOT touched — that field is the
//!     SOL P/L ledger by definition. Wins/losses/games_played/xp/level
//!     still update so SKR matches contribute to leveling and streak
//!     progression. A future migration can introduce `profit_skr_atoms`.
//!   - Retention hooks (daily challenges + season prize pool) are skipped
//!     for SKR settles in v1. The hooks key off `wager_lamports` for prize
//!     accrual which only makes sense for the SOL path. Leaderboard
//!     inserts still run since the leaderboard is height-keyed.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    ed25519_program,
    sysvar::instructions::{load_instruction_at_checked, ID as IX_SYSVAR_ID},
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::error::GameError;
use crate::state::{
    compute_mode_payout, level_from_xp, xp_for_placement, GameMode, Leaderboard,
    MatchAccount, MatchStatus, Treasury, UserStats, BPS_DENOM, LEADERBOARD_SEED,
    MATCH_ESCROW_SEED, MATCH_ESCROW_TOKEN_SEED, MATCH_SEED, RECEIPT_MAX_AGE_SECS,
    RECEIPT_SIGNER_PUBKEY, SKR_DECIMALS, TREASURY_SEED, USER_STATS_SEED,
};

pub const RECEIPT_MSG_LEN: usize = 76;
const ED25519_HEADER_LEN: usize = 16;

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, SettleMatchVerifiedSkr<'info>>,
    height: u32,
    signed_at: i64,
) -> Result<()> {
    let clock = Clock::get()?;
    let caller_key = ctx.accounts.player.key();
    let match_key = ctx.accounts.match_account.key();
    let program_id = *ctx.program_id;

    // ─── Scope 0: Ed25519 precompile verification (mirrors verified SOL path).

    let ed_ix = load_instruction_at_checked(0, &ctx.accounts.ix_sysvar)
        .map_err(|_| GameError::Ed25519IxMissing)?;
    require_keys_eq!(ed_ix.program_id, ed25519_program::ID, GameError::Ed25519IxMissing);

    let data = &ed_ix.data;
    require!(data.len() >= ED25519_HEADER_LEN, GameError::Ed25519IxMalformed);
    require!(data[0] == 1, GameError::Ed25519IxMalformed);

    let sig_off = u16::from_le_bytes([data[2], data[3]]) as usize;
    let pk_off = u16::from_le_bytes([data[6], data[7]]) as usize;
    let msg_off = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;

    require!(sig_off + 64 <= data.len(), GameError::Ed25519IxMalformed);
    require!(pk_off + 32 <= data.len(), GameError::Ed25519IxMalformed);
    require!(msg_off + msg_size <= data.len(), GameError::Ed25519IxMalformed);
    require!(msg_size == RECEIPT_MSG_LEN, GameError::Ed25519IxMalformed);
    require!(sig_off >= ED25519_HEADER_LEN, GameError::Ed25519IxMalformed);
    require!(pk_off >= ED25519_HEADER_LEN, GameError::Ed25519IxMalformed);
    require!(msg_off >= ED25519_HEADER_LEN, GameError::Ed25519IxMalformed);
    let regions = [(pk_off, 32), (sig_off, 64), (msg_off, msg_size)];
    for i in 0..regions.len() {
        for j in (i + 1)..regions.len() {
            let (a_start, a_len) = regions[i];
            let (b_start, b_len) = regions[j];
            let a_end = a_start + a_len;
            let b_end = b_start + b_len;
            require!(a_end <= b_start || b_end <= a_start, GameError::Ed25519IxMalformed);
        }
    }

    let pk_bytes: [u8; 32] = data[pk_off..pk_off + 32]
        .try_into()
        .map_err(|_| GameError::Ed25519IxMalformed)?;
    let signer = Pubkey::new_from_array(pk_bytes);
    require_keys_eq!(signer, RECEIPT_SIGNER_PUBKEY, GameError::InvalidReceiptSigner);

    let msg = &data[msg_off..msg_off + RECEIPT_MSG_LEN];
    let msg_match: [u8; 32] = msg[0..32].try_into().map_err(|_| GameError::Ed25519IxMalformed)?;
    let msg_player: [u8; 32] = msg[32..64].try_into().map_err(|_| GameError::Ed25519IxMalformed)?;
    let msg_height = u32::from_le_bytes([msg[64], msg[65], msg[66], msg[67]]);
    let msg_signed_at = i64::from_le_bytes([
        msg[68], msg[69], msg[70], msg[71], msg[72], msg[73], msg[74], msg[75],
    ]);

    require!(Pubkey::new_from_array(msg_match) == match_key, GameError::ReceiptMessageMismatch);
    require!(Pubkey::new_from_array(msg_player) == caller_key, GameError::ReceiptMessageMismatch);
    require!(msg_height == height, GameError::ReceiptMessageMismatch);
    require!(msg_signed_at == signed_at, GameError::ReceiptMessageMismatch);

    let drift = (clock.unix_timestamp - signed_at).abs();
    require!(drift <= RECEIPT_MAX_AGE_SECS, GameError::ReceiptExpired);

    msg!(
        "SettleMatchVerifiedSkr: OK match={} player={} height={} drift_s={}",
        match_key, caller_key, height, drift
    );

    // ─── Scope 1: write caller's height, bump settled_count.

    let (all_settled, pot, players, heights, mode_u8, wager_atoms, required_players) = {
        let m = &mut ctx.accounts.match_account;
        require!(m.status == MatchStatus::Active as u8, GameError::MatchBadStatus);
        // Reject SOL matches at the program level — wrong settle path.
        require!(m.wager_mint != Pubkey::default(), GameError::NotSplMatch);
        require_keys_eq!(m.wager_mint, ctx.accounts.mint.key(), GameError::InvalidWagerMint);

        let slot = m.slot_of(&caller_key).ok_or(GameError::NotInMatch)?;
        require!(m.heights[slot] == u32::MAX, GameError::AlreadySettledMatch);
        m.heights[slot] = height;
        m.settled_count = m.settled_count.saturating_add(1);

        let all = m.settled_count >= m.required_players;
        let pot = m.wager_lamports.saturating_mul(m.required_players as u64);
        (all, pot, m.players, m.heights, m.mode, m.wager_lamports, m.required_players)
    };

    if !all_settled {
        msg!(
            "SettleMatchVerifiedSkr.PARTIAL: match={} player={} settled={}/{}",
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

    // ─── Scope 2: collect per-player levels for rake scaling.

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

    // ─── Scope 3: escrow signer seeds (same scheme as SOL path).

    let escrow_bump = ctx.accounts.match_account.escrow_bump;
    let escrow_seeds: &[&[u8]] = &[
        MATCH_ESCROW_SEED,
        match_key.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let escrow_signer: &[&[&[u8]]] = &[escrow_seeds];

    // ─── Scope 4: SPL token payouts (top-K winners).
    //
    // Recipient ATAs live at `remaining_accounts[N..N+K]`. We verify each ATA
    // is the canonical associated-token-account for `(players[sorted_slot], mint)`
    // before transferring — clients can't substitute a different recipient ATA.

    for (rank, (sorted_slot, amount)) in payouts.iter().enumerate() {
        let expected_owner = players[*sorted_slot];
        let recipient_ata_info = &ctx.remaining_accounts[n + rank];

        // Anchor's `Account<TokenAccount>` deserializes + validates owner/mint.
        // We do it manually here because remaining_accounts are AccountInfos.
        let ata_data = recipient_ata_info.try_borrow_data()?;
        let ata = TokenAccount::try_deserialize(&mut &ata_data[..])
            .map_err(|_| GameError::NotInMatch)?;
        require_keys_eq!(ata.owner, expected_owner, GameError::NotInMatch);
        require_keys_eq!(ata.mint, ctx.accounts.mint.key(), GameError::NotInMatch);
        drop(ata_data); // release the borrow before the CPI

        if *amount > 0 {
            let cpi = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.match_escrow_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: recipient_ata_info.clone(),
                    authority: ctx.accounts.match_escrow.to_account_info(),
                },
                escrow_signer,
            );
            token::transfer_checked(cpi, *amount, SKR_DECIMALS)?;
        }
    }

    // ─── Scope 5: rake → treasury token account.

    if rake > 0 {
        let cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.match_escrow_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.treasury_token.to_account_info(),
                authority: ctx.accounts.match_escrow.to_account_info(),
            },
            escrow_signer,
        );
        token::transfer_checked(cpi, rake, SKR_DECIMALS)?;
        // SOL Treasury.total_received tracks lamports — we do NOT update it
        // for SKR rake; the on-chain TokenAccount balance is the source of
        // truth for SKR rake instead. A future admin_withdraw_skr ix reads
        // that balance directly.
    }

    // ─── Scope 6: stats updates (wins / losses / games / xp / level only).
    //
    // `profit_lamports` is intentionally NOT touched — it's the SOL P/L
    // ledger. SKR P/L tracking is deferred to a future migration.

    let mut indexed: Vec<(usize, u32)> = (0..n).map(|i| (i, heights[i])).collect();
    indexed.sort_by(|a, b| b.1.cmp(&a.1));
    let mut placement_of = [0usize; crate::state::MATCH_MAX_PLAYERS];
    for (rank, (slot, _)) in indexed.iter().enumerate() {
        placement_of[*slot] = rank;
    }

    for slot_idx in 0..n {
        let stats_info = &ctx.remaining_accounts[slot_idx];
        let (expected_pda, _) = Pubkey::find_program_address(
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
        let xp_gained = xp_for_placement(game_mode, rank);

        stats.games_played = stats.games_played.saturating_add(1);
        stats.last_played_at = clock.unix_timestamp;
        if won {
            stats.wins = stats.wins.saturating_add(1);
        } else {
            stats.losses = stats.losses.saturating_add(1);
        }
        stats.xp = stats.xp.saturating_add(xp_gained);
        stats.level = level_from_xp(stats.xp);

        let mut writer = &mut data[..];
        stats.try_serialize(&mut writer)?;
    }

    // ─── Scope 7: leaderboard insert for rank-0 (currency-agnostic).

    let winner_slot = indexed[0].0;
    let winner_pubkey = players[winner_slot];
    let winner_height = heights[winner_slot];
    let winner_height_u8: u8 = winner_height.min(u8::MAX as u32) as u8;
    let evicted_before =
        ctx.accounts.leaderboard.entries[crate::state::LEADERBOARD_SIZE - 1].player;
    if let Some(idx) = ctx
        .accounts
        .leaderboard
        .try_insert(winner_pubkey, winner_height_u8, clock.unix_timestamp)
    {
        msg!(
            "Leaderboard (skr): insert player={} height={} at_rank={}",
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

    // ─── Scope 8: finalize match.

    let m = &mut ctx.accounts.match_account;
    m.status = MatchStatus::Settled as u8;
    m.closed_at = clock.unix_timestamp;

    let _ = wager_atoms;

    msg!(
        "SettleMatchVerifiedSkr.FINAL: match={} winner={} height={} rake={} pot={}",
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
    let _ = BPS_DENOM;
    Ok(())
}

#[derive(Accounts)]
pub struct SettleMatchVerifiedSkr<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [MATCH_SEED, &[match_account.mode], &[match_account.wager_tier], &match_account.seq.to_le_bytes()],
        bump = match_account.bump,
    )]
    pub match_account: Box<Account<'info, MatchAccount>>,

    /// CHECK: validated via seeds; signs the SPL transfer-checked CPIs out
    /// of `match_escrow_token`.
    #[account(
        mut,
        seeds = [MATCH_ESCROW_SEED, match_account.key().as_ref()],
        bump = match_account.escrow_bump,
    )]
    pub match_escrow: SystemAccount<'info>,

    #[account(address = match_account.wager_mint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        seeds = [MATCH_ESCROW_TOKEN_SEED, match_account.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = match_escrow,
    )]
    pub match_escrow_token: Box<Account<'info, TokenAccount>>,

    /// Treasury PDA — same one the SOL flow uses; here it's just the
    /// authority of the per-mint `treasury_token` ATA.
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,

    /// Per-mint treasury token account. `init_if_needed` so the very first
    /// SKR settle for a given mint creates it; subsequent settles reuse.
    /// Authority = Treasury PDA so a future `admin_withdraw_skr` ix can
    /// drain it via the existing admin gate.
    #[account(
        init_if_needed,
        payer = player,
        associated_token::mint = mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token: Box<Account<'info, TokenAccount>>,

    #[account(mut, seeds = [LEADERBOARD_SEED, &[match_account.mode]], bump)]
    pub leaderboard: Box<Account<'info, Leaderboard>>,

    /// CHECK: address-validated.
    #[account(address = IX_SYSVAR_ID)]
    pub ix_sysvar: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    // remaining_accounts:
    //   [stats_p0..stats_pN-1]   (mutable, owned by this program)
    //   [recipient_ata_1..K]     (mutable, owned by SPL Token program)
}
