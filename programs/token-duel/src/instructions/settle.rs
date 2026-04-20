//! `settle` — player claims payout based on height tier. Moves lamports
//! from escrow (and optionally pool) via `system_program::transfer` CPIs
//! with `invoke_signed` authenticating the PDAs by their seeds. Then
//! `close = player` on the Session account refunds its rent to the player.
//!
//! Tier table (see `compute_payout`):
//!   - height ≤ 10 → Forfeit: escrow stake → pool
//!   - height ≤ 20 → Half:    escrow stake/2 → player, stake/2 → pool
//!   - height ≤ 35 → Full:    escrow stake → player
//!   - height > 35 → Double:  escrow stake → player + pool stake → player (2× total)

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::error::GameError;
use crate::state::{Leaderboard, Session, ESCROW_SEED, LEADERBOARD_SEED, MAX_HEIGHT, POOL_SEED, SESSION_SEED};

pub fn handler(ctx: Context<Settle>, height: u8) -> Result<()> {
    require!(height <= MAX_HEIGHT, GameError::HeightOutOfRange);
    require!(!ctx.accounts.session.settled, GameError::AlreadySettled);

    let stake = ctx.accounts.session.amount;
    let (player_from_escrow, pool_from_escrow, pool_bonus) = compute_payout(height, stake);

    // Upfront pool-funding check (audit T5): if the pool can't cover a tier-3
    // bonus, bail BEFORE any CPI so we don't waste compute + blockhash on a
    // tx that'll revert anyway. Atomic rollback would unwind state, but the
    // fee is still burned — this is a UX safeguard for the pitch video.
    if pool_bonus > 0 {
        require!(
            ctx.accounts.pool.get_lamports() >= pool_bonus,
            GameError::PoolUnderfunded
        );
    }

    // Escrow and pool are both SystemAccount PDAs (system-program-owned, no
    // data). SOL leaves them via CPI transfers authenticated by their seeds.
    // Direct-lamport math is only valid on accounts *owned by this program*
    // — it's not for SystemAccount PDAs.

    let session_key = ctx.accounts.session.key();
    let escrow_bump = ctx.accounts.session.escrow_bump;
    let escrow_seeds: &[&[u8]] = &[
        ESCROW_SEED,
        session_key.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let escrow_signer: &[&[&[u8]]] = &[escrow_seeds];

    // Leg 1: escrow → player (tiers 1, 2, 3).
    if player_from_escrow > 0 {
        let cpi = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.escrow.to_account_info(),
                to: ctx.accounts.player.to_account_info(),
            },
            escrow_signer,
        );
        system_program::transfer(cpi, player_from_escrow)?;
    }

    // Leg 2: escrow → pool (tiers 0, 1).
    if pool_from_escrow > 0 {
        let cpi = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.escrow.to_account_info(),
                to: ctx.accounts.pool.to_account_info(),
            },
            escrow_signer,
        );
        system_program::transfer(cpi, pool_from_escrow)?;
    }

    // Leg 3: pool → player (tier 3 bonus).
    if pool_bonus > 0 {
        let pool_bump = ctx.bumps.pool;
        let pool_seeds: &[&[u8]] = &[POOL_SEED, core::slice::from_ref(&pool_bump)];
        let pool_signer: &[&[&[u8]]] = &[pool_seeds];

        let cpi = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.pool.to_account_info(),
                to: ctx.accounts.player.to_account_info(),
            },
            pool_signer,
        );
        system_program::transfer(cpi, pool_bonus)?;
    }

    // Session is about to be zero-filled by `close = player` on return —
    // setting `settled=true` is technically redundant, but kept as defensive
    // coding in case a future refactor removes the close constraint.
    ctx.accounts.session.settled = true;

    // Leaderboard insert (Session 3 Phase B). Best-effort — if the insert
    // would no-op (height doesn't beat the tail, or height == 0) we log and
    // proceed. The constraint-guarded Leaderboard PDA guarantees the account
    // is the correct, initialized one; no silent fallback path.
    let player_key = ctx.accounts.player.key();
    let clock = Clock::get()?;
    // Capture who sat at the tail BEFORE insert — that's the evicted player
    // (if insert happens). Zero-pubkey means the leaderboard had a free slot
    // and nothing was actually evicted.
    let evicted_before = ctx.accounts.leaderboard.entries[crate::state::LEADERBOARD_SIZE - 1].player;
    let board = &mut ctx.accounts.leaderboard;
    let inserted_rank = match board.try_insert(player_key, height, clock.unix_timestamp) {
        Some(idx) => {
            msg!(
                "Leaderboard: insert player={} height={} settled_at={} at_rank={}",
                player_key,
                height,
                clock.unix_timestamp,
                idx + 1
            );
            // Session 4 D1 event: structured emission for indexers.
            // `evicted_player` is Pubkey::default() when the insert filled
            // a previously-empty slot (no eviction happened).
            emit!(LeaderboardInserted {
                player: player_key,
                height,
                rank: (idx + 1) as u8,
                evicted_player: evicted_before,
                settled_at: clock.unix_timestamp,
            });
            Some(idx + 1)
        }
        None => {
            msg!(
                "Leaderboard: skip player={} height={} — doesn't beat tail",
                player_key,
                height
            );
            None
        }
    };

    let tier: u8 = if height <= 10 { 0 } else if height <= 20 { 1 } else if height <= 35 { 2 } else { 3 };
    let payout: u64 = player_from_escrow.saturating_add(pool_bonus);
    // pool_delta is +stake for forfeit, +stake/2 for half, 0 for full, -stake for double.
    let pool_delta: i128 = (pool_from_escrow as i128) - (pool_bonus as i128);

    msg!(
        "Settle: height={} tier={} player_from_escrow={} pool_from_escrow={} pool_bonus={} payout={} pool_delta={}",
        height,
        tier,
        player_from_escrow,
        pool_from_escrow,
        pool_bonus,
        payout,
        pool_delta
    );

    // Session 4 D1 — Emit settled event after all CPIs succeed + leaderboard
    // mutation completes. Reviewers watching the explorer see commit + settle +
    // leaderboard_insert as three distinct structured events per round.
    emit!(SessionSettled {
        player: player_key,
        height,
        tier,
        payout,
        pool_delta_abs: pool_delta.unsigned_abs() as u64,
        pool_delta_positive: pool_delta >= 0,
        leaderboard_rank: inserted_rank.map(|r| r as u8).unwrap_or(0),
        settled_at: clock.unix_timestamp,
    });
    Ok(())
}

#[event]
pub struct SessionSettled {
    pub player: Pubkey,
    pub height: u8,
    pub tier: u8,
    pub payout: u64,
    /// Absolute value of the pool delta (add to pool if positive, subtract if negative).
    pub pool_delta_abs: u64,
    pub pool_delta_positive: bool,
    /// Rank 1..=10 if inserted into leaderboard, 0 if didn't qualify.
    pub leaderboard_rank: u8,
    pub settled_at: i64,
}

#[event]
pub struct LeaderboardInserted {
    pub player: Pubkey,
    pub height: u8,
    /// 1..=LEADERBOARD_SIZE (10).
    pub rank: u8,
    /// Player that was evicted at insert time. Pubkey::default() if the slot was empty.
    pub evicted_player: Pubkey,
    pub settled_at: i64,
}

/// Returns `(player_from_escrow, pool_from_escrow, pool_bonus_to_player)`.
/// Invariant: `player_from_escrow + pool_from_escrow == stake` — escrow
/// fully drains on every settle.
fn compute_payout(height: u8, stake: u64) -> (u64, u64, u64) {
    if height <= 10 {
        // Tier 0: Forfeit
        (0, stake, 0)
    } else if height <= 20 {
        // Tier 1: Half
        let half = stake / 2;
        (half, stake - half, 0)
    } else if height <= 35 {
        // Tier 2: Full
        (stake, 0, 0)
    } else {
        // Tier 3: Double — stake from escrow + stake bonus from pool
        (stake, 0, stake)
    }
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        close = player,
        has_one = player,
        seeds = [SESSION_SEED, player.key().as_ref(), &session.session_seed.to_le_bytes()],
        bump = session.bump,
        constraint = !session.settled @ GameError::AlreadySettled,
    )]
    pub session: Account<'info, Session>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, session.key().as_ref()],
        bump = session.escrow_bump,
    )]
    pub escrow: SystemAccount<'info>,

    #[account(mut, seeds = [POOL_SEED], bump)]
    pub pool: SystemAccount<'info>,

    /// Session 3: singleton leaderboard account. Must be pre-initialized via
    /// `initialize_leaderboard`; this is not optional because we want to
    /// guarantee a single authoritative on-chain ranking. Settling without a
    /// leaderboard means the pitch video can't show on-chain rankings.
    #[account(
        mut,
        seeds = [LEADERBOARD_SEED],
        bump,
    )]
    pub leaderboard: Account<'info, Leaderboard>,

    pub system_program: Program<'info, System>,
}
