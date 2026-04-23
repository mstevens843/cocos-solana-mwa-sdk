//! `initialize_mode_leaderboard(mode)` — admin-only, one-time per mode.
//!
//! Session D Part 7. Allocates a zero-filled `Leaderboard` PDA at
//! `[b"leaderboard", &[mode]]` so `settle_match` can insert into the
//! mode-specific board. Must be called once per `GameMode` (0..=3).
//!
//! The legacy singleton leaderboard at `[b"leaderboard"]` is untouched —
//! the solo `settle` ix continues to use it. Per-mode PDAs are additive.

use anchor_lang::prelude::*;

use crate::error::GameError;
use crate::state::{GameMode, Leaderboard, LEADERBOARD_SEED};

pub fn handler(ctx: Context<InitializeModeLeaderboard>, mode: u8) -> Result<()> {
    // Validate mode byte is a known GameMode.
    let _ = GameMode::from_u8(mode).ok_or(GameError::InvalidMode)?;

    let board = &mut ctx.accounts.leaderboard;
    for slot in board.entries.iter_mut() {
        *slot = Default::default();
    }
    msg!(
        "ModeLeaderboard initialized: mode={} pda={} size={} entry_space={}",
        mode,
        ctx.accounts.leaderboard.key(),
        crate::state::LEADERBOARD_SIZE,
        crate::state::LeaderboardEntry::SPACE
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(mode: u8)]
pub struct InitializeModeLeaderboard<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Leaderboard::SPACE,
        seeds = [LEADERBOARD_SEED, &[mode]],
        bump,
    )]
    pub leaderboard: Account<'info, Leaderboard>,

    pub system_program: Program<'info, System>,
}
