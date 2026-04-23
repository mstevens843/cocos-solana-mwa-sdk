//! `initialize_user_stats` — per-player, rent-payer = player. Creates the
//! player's UserStats PDA zero-filled (bot_games_remaining starts at
//! BOT_HANDICAP_GAMES). Safe to call once per wallet; `init` will reject
//! re-init so callers must check existence client-side first.

use anchor_lang::prelude::*;

use crate::state::{UserStats, BOT_HANDICAP_GAMES, USER_STATS_SEED};

pub fn handler(ctx: Context<InitializeUserStats>) -> Result<()> {
    let s = &mut ctx.accounts.stats;
    s.player = ctx.accounts.player.key();
    s.games_played = 0;
    s.wins = 0;
    s.losses = 0;
    s.profit_lamports = 0;
    s.xp = 0;
    s.level = 0;
    s.last_played_at = 0;
    s.bot_games_remaining = BOT_HANDICAP_GAMES;
    s.bump = ctx.bumps.stats;
    // Part 10 Bundle 3 — v2 retention fields. Explicitly zero'd for clarity
    // even though fresh-allocated accounts on Solana are zero by default.
    s.current_streak = 0;
    s.best_streak = 0;
    s.last_daily_claim_at = 0;
    s.daily_challenges_bitmask = 0;
    s.season_wins = 0;
    s.season_id = 0;
    s._reserved = [0u8; 14];
    msg!(
        "UserStats initialized (v2): player={} pda={} size={} bot_games_remaining={}",
        ctx.accounts.player.key(),
        ctx.accounts.stats.key(),
        8 + crate::state::UserStats::SPACE,
        BOT_HANDICAP_GAMES
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeUserStats<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        init,
        payer = player,
        space = 8 + UserStats::SPACE,
        seeds = [USER_STATS_SEED, player.key().as_ref()],
        bump,
    )]
    pub stats: Account<'info, UserStats>,

    pub system_program: Program<'info, System>,
}
