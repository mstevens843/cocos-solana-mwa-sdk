//! `admin_withdraw(amount)` — Session D Part 8.
//!
//! Admin-gated withdrawal from the Treasury PDA (rake sink) to an arbitrary
//! recipient (usually the admin's own wallet). Clamps the requested amount
//! to `balance - rent_exempt_floor` so the PDA stays rent-exempt and won't
//! get reaped by Solana's rent collector.
//!
//! Signer must equal `crate::state::ADMIN_PUBKEY`. The check is an explicit
//! `require_keys_eq!` — reviewers grepping for "admin gate" find it here.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::error::GameError;
use crate::state::{Treasury, ADMIN_PUBKEY, TREASURY_SEED};

pub fn handler(ctx: Context<AdminWithdraw>, amount: u64) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ADMIN_PUBKEY,
        GameError::Unauthorized
    );

    let treasury_lamports = ctx.accounts.treasury.get_lamports();
    let rent_floor = Rent::get()?.minimum_balance(8 + Treasury::SPACE);
    let available = treasury_lamports.saturating_sub(rent_floor);
    let to_send = amount.min(available);

    require!(to_send > 0, GameError::WithdrawUnavailable);

    let bump = ctx.accounts.treasury.bump;
    let seeds: &[&[u8]] = &[TREASURY_SEED, core::slice::from_ref(&bump)];
    let signer: &[&[&[u8]]] = &[seeds];

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.treasury.to_account_info(),
            to: ctx.accounts.recipient.to_account_info(),
        },
        signer,
    );
    system_program::transfer(cpi, to_send)?;

    msg!(
        "AdminWithdraw: from=treasury to={} amount={} requested={} floor={} balance_before={}",
        ctx.accounts.recipient.key(),
        to_send,
        amount,
        rent_floor,
        treasury_lamports
    );

    emit!(AdminWithdrew {
        source: ctx.accounts.treasury.key(),
        recipient: ctx.accounts.recipient.key(),
        amount: to_send,
        requested: amount,
        at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[event]
pub struct AdminWithdrew {
    pub source: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub requested: u64,
    pub at: i64,
}

#[derive(Accounts)]
pub struct AdminWithdraw<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,

    /// Lamport recipient. Can be `admin` or any SystemAccount — admin's choice.
    #[account(mut)]
    pub recipient: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}
