//! Part 10 Bundle 3 — admin-gated init for the per-day DailyChallenge PDA.
//!
//! Called by the backend cron at 00:00 UTC each day. Also runnable from
//! `scripts/init-daily-challenge.ts` as a manual override. The PDA seeds
//! include `day_id` so each day gets its own fresh account — no mutation
//! of yesterday's challenges.

use anchor_lang::prelude::*;

use crate::error::GameError;
use crate::state::{
    Challenge, ChallengeKind, DailyChallenge, ADMIN_PUBKEY, DAILY_CHALLENGE_SEED,
    DAILY_CHALLENGE_REWARD_CAP, DAY_SECONDS,
};

pub fn handler(
    ctx: Context<InitializeDailyChallenge>,
    day_id: u64,
    challenges: [Challenge; 3],
) -> Result<()> {
    require_keys_eq!(ctx.accounts.admin.key(), ADMIN_PUBKEY, GameError::Unauthorized);
    let clock = Clock::get()?;
    let now_day = (clock.unix_timestamp / DAY_SECONDS) as u64;
    // Allow initializing today or tomorrow (lets cron run late + still pre-fill
    // the next day if desired).
    require!(
        day_id == now_day || day_id == now_day + 1,
        GameError::BadDayId
    );

    for c in challenges.iter() {
        let kind = ChallengeKind::from_u8(c.kind).ok_or(GameError::InvalidChallenge)?;
        let _ = kind; // variant is valid
        require!(c.target > 0, GameError::InvalidChallenge);
        require!(c.reward_xp <= DAILY_CHALLENGE_REWARD_CAP, GameError::InvalidChallenge);
    }

    let dc = &mut ctx.accounts.challenge;
    dc.day_id = day_id;
    dc.challenges = challenges;
    dc.created_at = clock.unix_timestamp;
    dc.bump = ctx.bumps.challenge;

    msg!(
        "InitializeDailyChallenge: day_id={} c0=(k{},t{},xp{}) c1=(k{},t{},xp{}) c2=(k{},t{},xp{})",
        day_id,
        challenges[0].kind, challenges[0].target, challenges[0].reward_xp,
        challenges[1].kind, challenges[1].target, challenges[1].reward_xp,
        challenges[2].kind, challenges[2].target, challenges[2].reward_xp,
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(day_id: u64)]
pub struct InitializeDailyChallenge<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + DailyChallenge::SPACE,
        seeds = [DAILY_CHALLENGE_SEED, &day_id.to_le_bytes()],
        bump,
    )]
    pub challenge: Account<'info, DailyChallenge>,

    pub system_program: Program<'info, System>,
}
