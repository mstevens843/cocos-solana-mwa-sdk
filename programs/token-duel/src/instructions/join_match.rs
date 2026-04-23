//! `join_match` — two code-paths via account constraints:
//!
//!  A) "Create new": caller supplies a fresh `match` PDA with `seq =
//!     counter.seq`. The ix `init`s the match account, increments the
//!     counter, and writes the caller into slot 0.
//!
//!  B) "Join existing": caller supplies an existing `match` PDA with
//!     `status=Waiting` and a free slot. The ix writes the caller into
//!     the next empty slot. When the slot fills, `status` → Active.
//!
//! Both paths CPI-transfer `wager_lamports` from the player into the
//! match's escrow system-account PDA.
//!
//! Mode + wager_tier + seq form the PDA seed; client picks seq by reading
//! the counter account OR discovering an open match via `getProgramAccounts`.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::error::GameError;
use crate::state::{
    GameMode, MatchAccount, MatchCounter, MatchStatus, TimeWindow, MATCH_COUNTER_SEED,
    MATCH_ESCROW_SEED, MATCH_MAX_PLAYERS, MATCH_SEED, WAGER_TIERS,
};

pub fn handler_create(
    ctx: Context<JoinMatchCreate>,
    mode: u8,
    wager_tier: u8,
    xp_bucket: u16,
    time_window: u8,
    seq: u64,
) -> Result<()> {
    let game_mode = GameMode::from_u8(mode).ok_or(GameError::InvalidMode)?;
    require!((wager_tier as usize) < WAGER_TIERS.len(), GameError::InvalidWagerTier);
    let _window = TimeWindow::from_u8(time_window).ok_or(GameError::InvalidTimeWindow)?;
    let expected_wager = WAGER_TIERS[wager_tier as usize];

    // Seq must match the counter exactly — guarantees PDA address match.
    require_eq!(ctx.accounts.counter.seq, seq);

    let m = &mut ctx.accounts.match_account;
    let clock = Clock::get()?;
    let required = game_mode.required_players();
    m.mode = mode;
    m.wager_tier = wager_tier;
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

    // Transfer wager from player → match escrow.
    let cpi = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.match_escrow.to_account_info(),
        },
    );
    system_program::transfer(cpi, expected_wager)?;

    // Bump the counter for the next Match.
    ctx.accounts.counter.seq = ctx
        .accounts
        .counter
        .seq
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    msg!(
        "JoinMatch.CREATE: pda={} player={} mode={} wager={} seq={} xp_bucket={} window={}",
        ctx.accounts.match_account.key(),
        ctx.accounts.player.key(),
        mode,
        expected_wager,
        seq,
        xp_bucket,
        time_window
    );

    emit!(MatchJoined {
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

pub fn handler_join(ctx: Context<JoinMatchJoin>) -> Result<()> {
    let m = &mut ctx.accounts.match_account;
    require!(m.status == MatchStatus::Waiting as u8, GameError::MatchBadStatus);
    require!((m.player_count as usize) < MATCH_MAX_PLAYERS, GameError::MatchFull);

    // Caller must not already be in the match.
    if m.slot_of(&ctx.accounts.player.key()).is_some() {
        return err!(GameError::MatchBadStatus);
    }

    let slot = m.player_count as usize;
    m.players[slot] = ctx.accounts.player.key();
    m.player_count = m.player_count.saturating_add(1);

    // Transfer wager.
    let cpi = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.match_escrow.to_account_info(),
        },
    );
    system_program::transfer(cpi, m.wager_lamports)?;

    let clock = Clock::get()?;
    let became_active = m.player_count >= m.required_players;
    if became_active {
        m.status = MatchStatus::Active as u8;
        m.started_at = clock.unix_timestamp;
    }

    msg!(
        "JoinMatch.JOIN: pda={} player={} slot={} player_count={}/{} now_status={}",
        m.key(),
        ctx.accounts.player.key(),
        slot,
        m.player_count,
        m.required_players,
        m.status
    );

    emit!(MatchJoined {
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

#[event]
pub struct MatchJoined {
    pub match_pda: Pubkey,
    pub player: Pubkey,
    pub slot: u8,
    pub player_count: u8,
    pub required_players: u8,
    pub status: u8,
    pub at: i64,
}

#[derive(Accounts)]
#[instruction(mode: u8, wager_tier: u8, xp_bucket: u16, time_window: u8, seq: u64)]
pub struct JoinMatchCreate<'info> {
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
    pub match_account: Account<'info, MatchAccount>,

    /// Escrow system-account PDA. Holds wagers until settle.
    #[account(
        mut,
        seeds = [MATCH_ESCROW_SEED, match_account.key().as_ref()],
        bump,
    )]
    pub match_escrow: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinMatchJoin<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [MATCH_SEED, &[match_account.mode], &[match_account.wager_tier], &match_account.seq.to_le_bytes()],
        bump = match_account.bump,
    )]
    pub match_account: Account<'info, MatchAccount>,

    #[account(
        mut,
        seeds = [MATCH_ESCROW_SEED, match_account.key().as_ref()],
        bump = match_account.escrow_bump,
    )]
    pub match_escrow: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}
