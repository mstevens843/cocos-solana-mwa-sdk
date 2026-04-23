//! Part 10 Bundle 3 — admin-gated init for the per-week Season PDA.
//!
//! Ran at Sunday 00:00 UTC by the backend cron or on deploy day via
//! `scripts/init-season.ts`. Seeds include `season_id = floor(ts / WEEK_SECONDS)`
//! so each week gets its own Season account, preserving history indefinitely.

use anchor_lang::prelude::*;

use crate::error::GameError;
use crate::state::{Season, SeasonEntry, ADMIN_PUBKEY, SEASON_SEED, SEASON_SIZE, WEEK_SECONDS};

pub fn handler(ctx: Context<InitializeSeason>, season_id: u64) -> Result<()> {
    require_keys_eq!(ctx.accounts.admin.key(), ADMIN_PUBKEY, GameError::Unauthorized);
    let clock = Clock::get()?;
    let now_week = (clock.unix_timestamp / WEEK_SECONDS) as u64;
    // Allow initializing this week or next.
    require!(
        season_id == now_week || season_id == now_week + 1,
        GameError::BadSeasonId
    );

    let s = &mut ctx.accounts.season;
    s.season_id = season_id;
    s.entries = [SeasonEntry::default(); SEASON_SIZE];
    s.total_rake_accumulated = 0;
    s.started_at = clock.unix_timestamp;
    s.paid_out = false;
    s.bump = ctx.bumps.season;

    msg!(
        "InitializeSeason: season_id={} started_at={}",
        season_id,
        clock.unix_timestamp
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(season_id: u64)]
pub struct InitializeSeason<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Season::SPACE,
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump,
    )]
    pub season: Account<'info, Season>,

    pub system_program: Program<'info, System>,
}
