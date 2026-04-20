//! `initialize_pool` — admin-only, one-time. Deposits `fund_amount` lamports
//! from the admin keypair into the singleton protocol pool PDA.
//!
//! The pool funds tier-3 (2× payout) bonuses and accumulates forfeits from
//! tier-0 (forfeit) and half of tier-1 (half refund) settlements.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::state::POOL_SEED;

pub fn handler(ctx: Context<InitializePool>, fund_amount: u64) -> Result<()> {
    let cpi_accounts = system_program::Transfer {
        from: ctx.accounts.admin.to_account_info(),
        to: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        cpi_accounts,
    );
    system_program::transfer(cpi_ctx, fund_amount)?;

    msg!(
        "Pool funded: +{} lamports (pool balance now {})",
        fund_amount,
        ctx.accounts.pool.get_lamports()
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Singleton protocol pool PDA. Holds SOL; no on-chain data.
    /// Derived from `[POOL_SEED]`.
    #[account(mut, seeds = [POOL_SEED], bump)]
    pub pool: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}
