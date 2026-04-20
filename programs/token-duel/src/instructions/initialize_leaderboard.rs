//! `initialize_leaderboard` — admin-only, one-time. Allocates the singleton
//! Leaderboard PDA zero-filled so `settle` can insert into it.
//!
//! No hardcoded admin key in v1 — whoever funds the rent is the de-facto
//! admin, and since the PDA seed is constant there can only ever be one.

use anchor_lang::prelude::*;

use crate::state::{Leaderboard, LEADERBOARD_SEED};

pub fn handler(ctx: Context<InitializeLeaderboard>) -> Result<()> {
    // Explicit zero-fill — `#[account(init, zero-init)]` already does this
    // for us (Anchor zero-initializes account data on `init`), but logging
    // the side-effect is part of our deterministic-logging contract.
    let board = &mut ctx.accounts.leaderboard;
    for slot in board.entries.iter_mut() {
        *slot = Default::default();
    }
    msg!(
        "Leaderboard initialized: pda={} size={} entry_space={}",
        ctx.accounts.leaderboard.key(),
        crate::state::LEADERBOARD_SIZE,
        crate::state::LeaderboardEntry::SPACE
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeLeaderboard<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Leaderboard::SPACE,
        seeds = [LEADERBOARD_SEED],
        bump,
    )]
    pub leaderboard: Account<'info, Leaderboard>,

    pub system_program: Program<'info, System>,
}
