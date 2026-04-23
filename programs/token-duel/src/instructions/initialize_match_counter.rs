//! `initialize_match_counter` — one-shot admin. Creates the singleton
//! MatchCounter PDA at seq=0. Bumped atomically inside `join_match` whenever
//! a new Match PDA is created.

use anchor_lang::prelude::*;

use crate::state::{MatchCounter, MATCH_COUNTER_SEED};

pub fn handler(ctx: Context<InitializeMatchCounter>) -> Result<()> {
    let c = &mut ctx.accounts.counter;
    c.seq = 0;
    c.bump = ctx.bumps.counter;
    msg!(
        "MatchCounter initialized: pda={} seq=0 bump={}",
        ctx.accounts.counter.key(),
        ctx.bumps.counter
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeMatchCounter<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + MatchCounter::SPACE,
        seeds = [MATCH_COUNTER_SEED],
        bump,
    )]
    pub counter: Account<'info, MatchCounter>,

    pub system_program: Program<'info, System>,
}
