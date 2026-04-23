//! Part 10 Bundle 3 — UserStats v1 → v2 migration.
//!
//! v1 was 72 bytes. v2 adds 40 bytes of retention fields (streak, daily
//! challenges bitmask, season tracking). Anchor's `realloc::zero = true`
//! pre-runs before the handler, expanding the account and zero-filling
//! the new bytes. Our additive field design means those zeros are
//! semantically correct for all new fields (streak=0, bitmask=0, etc.).
//!
//! The migration is idempotent-ish: running it on an already-v2 account
//! is a no-op (realloc sees the size already matches). Running on a v1
//! account grows it. No-op on a not-yet-initialized account because the
//! seeds constraint would fail.

use anchor_lang::prelude::*;

use crate::state::{UserStats, USER_STATS_SEED};

pub fn handler(ctx: Context<MigrateUserStats>) -> Result<()> {
    let info = ctx.accounts.stats.to_account_info();
    // By the time the handler runs, Anchor's realloc has already adjusted
    // the account data to 8 + UserStats::SPACE. So this log confirms
    // success rather than gating it.
    msg!(
        "MigrateUserStats: player={} size_now={} (8 + v2={} bytes)",
        ctx.accounts.stats.player,
        info.data_len(),
        UserStats::SPACE,
    );
    Ok(())
}

#[derive(Accounts)]
pub struct MigrateUserStats<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_STATS_SEED, player.key().as_ref()],
        bump = stats.bump,
        realloc = 8 + UserStats::SPACE,
        realloc::payer = player,
        realloc::zero = true,
    )]
    pub stats: Account<'info, UserStats>,

    pub system_program: Program<'info, System>,
}
