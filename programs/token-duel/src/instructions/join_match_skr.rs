//! `join_match_skr` — $SKR (SPL-token) twin of `join_match.rs`.
//!
//! Mirrors the two-path create / join shape of the SOL flow, but wagers
//! flow through an SPL TokenAccount escrow instead of a SystemAccount.
//!
//! Differences from the SOL path:
//!   - Wager amount is read from `WAGER_TIERS_SKR_ATOMS` (6-decimal SKR
//!     atoms) rather than `WAGER_TIERS` (lamports).
//!   - Escrow is a per-match SPL `TokenAccount` PDA derived from
//!     `[MATCH_ESCROW_TOKEN_SEED, match_pda]`, with the SystemAccount escrow
//!     PDA as the on-chain authority. Authority signing for payouts uses
//!     the same seeds as the SOL flow (`[MATCH_ESCROW_SEED, match_pda]`),
//!     so SOL and SKR matches share the same escrow-PDA derivation.
//!   - Deposit transfer is `spl_token::transfer_checked` (mint + decimals
//!     pinned for replay safety) instead of `system_program::transfer`.
//!   - The mint is validated against the whitelisted `SKR_MINT_DEVNET` /
//!     `SKR_MINT_MAINNET` consts so the v1 release can't accept arbitrary
//!     SPL deposits — the program is intentionally locked to $SKR until
//!     a future release expands the whitelist.
//!
//! `match_account.wager_mint` is set to the mint pubkey on create (and
//! verified on join) so settle / cancel can dispatch on currency without
//! re-reading the escrow account.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::error::GameError;
use crate::state::{
    GameMode, MatchAccount, MatchCounter, MatchStatus, TimeWindow, MATCH_COUNTER_SEED,
    MATCH_ESCROW_SEED, MATCH_ESCROW_TOKEN_SEED, MATCH_MAX_PLAYERS, MATCH_SEED, SKR_DECIMALS,
    SKR_MINT_DEVNET, SKR_MINT_MAINNET, WAGER_TIERS_SKR_ATOMS,
};

/// Reject any mint that isn't on the v1 whitelist (devnet test-SKR or
/// mainnet $SKR). Devnet const is `Pubkey::default()` until provisioned;
/// the all-zeros check below blocks deposits in that pre-provisioning
/// window so users can't accidentally lock SOL into a broken escrow.
fn require_whitelisted_mint(mint: &Pubkey) -> Result<()> {
    let devnet_set = SKR_MINT_DEVNET != Pubkey::default();
    let ok = *mint == SKR_MINT_MAINNET || (devnet_set && *mint == SKR_MINT_DEVNET);
    require!(ok, GameError::InvalidWagerMint);
    Ok(())
}

pub fn handler_create_skr(
    ctx: Context<JoinMatchCreateSkr>,
    mode: u8,
    wager_tier: u8,
    xp_bucket: u16,
    time_window: u8,
    seq: u64,
) -> Result<()> {
    let game_mode = GameMode::from_u8(mode).ok_or(GameError::InvalidMode)?;
    require!(
        (wager_tier as usize) < WAGER_TIERS_SKR_ATOMS.len(),
        GameError::InvalidWagerTier
    );
    let _window = TimeWindow::from_u8(time_window).ok_or(GameError::InvalidTimeWindow)?;
    let mint_key = ctx.accounts.mint.key();
    require_whitelisted_mint(&mint_key)?;
    require_eq!(ctx.accounts.mint.decimals, SKR_DECIMALS);

    let expected_wager = WAGER_TIERS_SKR_ATOMS[wager_tier as usize];
    require_eq!(ctx.accounts.counter.seq, seq);

    let m = &mut ctx.accounts.match_account;
    let clock = Clock::get()?;
    let required = game_mode.required_players();
    m.mode = mode;
    m.wager_tier = wager_tier;
    // For SKR matches `wager_lamports` stores the per-player tier in atoms.
    // The field name is historical; settle/cancel multiply it by player_count
    // exactly the same way as the SOL path.
    m.wager_lamports = expected_wager;
    m.xp_bucket = xp_bucket;
    m.required_players = required;
    m.player_count = 1;
    m.players = [Pubkey::default(); MATCH_MAX_PLAYERS];
    m.players[0] = ctx.accounts.player.key();
    m.heights = [u32::MAX; MATCH_MAX_PLAYERS];
    m.settled_count = 0;
    m.created_at = clock.unix_timestamp;
    m.started_at = 0;
    m.closed_at = 0;
    m.status = MatchStatus::Waiting as u8;
    m.seq = seq;
    m.bump = ctx.bumps.match_account;
    m.escrow_bump = ctx.bumps.match_escrow;
    m.time_window = time_window;
    m.wager_mint = mint_key;

    // Transfer wager: player ATA → match escrow token account.
    let cpi = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.player_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.match_escrow_token.to_account_info(),
            authority: ctx.accounts.player.to_account_info(),
        },
    );
    token::transfer_checked(cpi, expected_wager, SKR_DECIMALS)?;

    ctx.accounts.counter.seq = ctx
        .accounts
        .counter
        .seq
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    msg!(
        "JoinMatchSkr.CREATE: pda={} player={} mode={} mint={} wager_atoms={} seq={} window={}",
        ctx.accounts.match_account.key(),
        ctx.accounts.player.key(),
        mode,
        mint_key,
        expected_wager,
        seq,
        time_window
    );

    emit!(crate::instructions::join_match::MatchJoined {
        match_pda: ctx.accounts.match_account.key(),
        player: ctx.accounts.player.key(),
        slot: 0,
        player_count: 1,
        required_players: required,
        status: MatchStatus::Waiting as u8,
        at: clock.unix_timestamp,
    });
    Ok(())
}

pub fn handler_join_skr(ctx: Context<JoinMatchJoinSkr>) -> Result<()> {
    let m = &mut ctx.accounts.match_account;
    require!(m.status == MatchStatus::Waiting as u8, GameError::MatchBadStatus);
    require!((m.player_count as usize) < MATCH_MAX_PLAYERS, GameError::MatchFull);
    require!(m.wager_mint != Pubkey::default(), GameError::NotSplMatch);
    require_keys_eq!(m.wager_mint, ctx.accounts.mint.key(), GameError::InvalidWagerMint);
    require_eq!(ctx.accounts.mint.decimals, SKR_DECIMALS);

    if m.slot_of(&ctx.accounts.player.key()).is_some() {
        return err!(GameError::MatchBadStatus);
    }

    let slot = m.player_count as usize;
    m.players[slot] = ctx.accounts.player.key();
    m.player_count = m.player_count.saturating_add(1);

    let cpi = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.player_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.match_escrow_token.to_account_info(),
            authority: ctx.accounts.player.to_account_info(),
        },
    );
    token::transfer_checked(cpi, m.wager_lamports, SKR_DECIMALS)?;

    let clock = Clock::get()?;
    let became_active = m.player_count >= m.required_players;
    if became_active {
        m.status = MatchStatus::Active as u8;
        m.started_at = clock.unix_timestamp;
    }

    msg!(
        "JoinMatchSkr.JOIN: pda={} player={} slot={} player_count={}/{} now_status={}",
        m.key(),
        ctx.accounts.player.key(),
        slot,
        m.player_count,
        m.required_players,
        m.status
    );

    emit!(crate::instructions::join_match::MatchJoined {
        match_pda: m.key(),
        player: ctx.accounts.player.key(),
        slot: slot as u8,
        player_count: m.player_count,
        required_players: m.required_players,
        status: m.status,
        at: clock.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(mode: u8, wager_tier: u8, xp_bucket: u16, time_window: u8, seq: u64)]
pub struct JoinMatchCreateSkr<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [MATCH_COUNTER_SEED],
        bump = counter.bump,
    )]
    pub counter: Account<'info, MatchCounter>,

    #[account(
        init,
        payer = player,
        space = 8 + MatchAccount::SPACE,
        seeds = [MATCH_SEED, &[mode], &[wager_tier], &seq.to_le_bytes()],
        bump,
    )]
    pub match_account: Box<Account<'info, MatchAccount>>,

    /// SystemAccount escrow PDA — kept around purely as the AUTHORITY of
    /// the SPL token escrow below. Same seed scheme as the SOL flow so
    /// signer-seed derivation is identical between settle paths.
    /// CHECK: validated by the seeds + bump constraint.
    #[account(
        mut,
        seeds = [MATCH_ESCROW_SEED, match_account.key().as_ref()],
        bump,
    )]
    pub match_escrow: SystemAccount<'info>,

    pub mint: Box<Account<'info, Mint>>,

    /// Per-match SPL escrow TokenAccount. Initialized on first create_skr
    /// for this match PDA; its authority is the SystemAccount escrow PDA
    /// above so the same `[MATCH_ESCROW_SEED, match_pda]` signer seeds
    /// authorize payouts on settle.
    #[account(
        init,
        payer = player,
        seeds = [MATCH_ESCROW_TOKEN_SEED, match_account.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = match_escrow,
    )]
    pub match_escrow_token: Box<Account<'info, TokenAccount>>,

    /// Player's ATA for `mint`. Anchor's `associated_token::*` constraints
    /// validate the derivation; the player must have funded it before the
    /// tx runs (use `createAssociatedTokenAccountIdempotent` preflight).
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct JoinMatchJoinSkr<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [MATCH_SEED, &[match_account.mode], &[match_account.wager_tier], &match_account.seq.to_le_bytes()],
        bump = match_account.bump,
    )]
    pub match_account: Box<Account<'info, MatchAccount>>,

    /// CHECK: authority for the token escrow; validated via seeds.
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

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
