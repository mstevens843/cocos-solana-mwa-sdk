//! `initialize_treasury` — one-shot admin. Creates the singleton Treasury PDA
//! used as a rake sink for settled matches. No withdrawal ix this session;
//! funds accumulate until a future admin-governed payout path ships.

use anchor_lang::prelude::*;

use crate::state::{Treasury, TREASURY_SEED};

pub fn handler(ctx: Context<InitializeTreasury>) -> Result<()> {
    let t = &mut ctx.accounts.treasury;
    t.total_received = 0;
    t.bump = ctx.bumps.treasury;
    msg!(
        "Treasury initialized: pda={} bump={}",
        ctx.accounts.treasury.key(),
        ctx.bumps.treasury
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Treasury::SPACE,
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}
