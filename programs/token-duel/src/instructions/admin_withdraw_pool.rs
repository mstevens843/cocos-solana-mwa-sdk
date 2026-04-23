//! `admin_withdraw_pool(amount)` — Session D Part 8.
//!
//! Admin-gated withdrawal from the Pool PDA (SystemAccount — no data) to an
//! arbitrary recipient. The Pool is a v1 concept that funded tier-3 bonuses
//! for the legacy solo `settle` flow; it still holds residual SOL which the
//! admin may reclaim post-hackathon.
//!
//! Rent floor: `Rent::get()?.minimum_balance(0)` — SystemAccounts have no
//! data, only the base account-header rent. We leave that much behind so the
//! PDA isn't garbage-collected.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::error::GameError;
use crate::state::{ADMIN_PUBKEY, POOL_SEED};

pub fn handler(ctx: Context<AdminWithdrawPool>, amount: u64) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ADMIN_PUBKEY,
        GameError::Unauthorized
    );

    let pool_lamports = ctx.accounts.pool.get_lamports();
    let rent_floor = Rent::get()?.minimum_balance(0);
    let available = pool_lamports.saturating_sub(rent_floor);
    let to_send = amount.min(available);

    require!(to_send > 0, GameError::WithdrawUnavailable);

    let pool_bump = ctx.bumps.pool;
    let seeds: &[&[u8]] = &[POOL_SEED, core::slice::from_ref(&pool_bump)];
    let signer: &[&[&[u8]]] = &[seeds];

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.pool.to_account_info(),
            to: ctx.accounts.recipient.to_account_info(),
        },
        signer,
    );
    system_program::transfer(cpi, to_send)?;

    msg!(
        "AdminWithdrawPool: from=pool to={} amount={} requested={} floor={} balance_before={}",
        ctx.accounts.recipient.key(),
        to_send,
        amount,
        rent_floor,
        pool_lamports
    );

    emit!(AdminPoolWithdrew {
        source: ctx.accounts.pool.key(),
        recipient: ctx.accounts.recipient.key(),
        amount: to_send,
        requested: amount,
        at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[event]
pub struct AdminPoolWithdrew {
    pub source: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub requested: u64,
    pub at: i64,
}

#[derive(Accounts)]
pub struct AdminWithdrawPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED], bump)]
    pub pool: SystemAccount<'info>,

    #[account(mut)]
    pub recipient: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}
