//! `commit` — player creates a new session + stakes SOL into the session's
//! escrow PDA. Bounds-checks stake amount; stores bumps for the settle step.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::error::GameError;
use crate::state::{Session, ESCROW_SEED, MAX_STAKE_LAMPORTS, MIN_STAKE_LAMPORTS, SESSION_SEED};

pub fn handler(ctx: Context<Commit>, amount: u64, session_seed: u64) -> Result<()> {
    require!(amount >= MIN_STAKE_LAMPORTS, GameError::StakeTooLow);
    require!(amount <= MAX_STAKE_LAMPORTS, GameError::StakeTooHigh);

    // Persist session state. `session_seed` and both bumps are needed for
    // settle() to re-derive the same PDAs and close the escrow.
    let session = &mut ctx.accounts.session;
    session.player = ctx.accounts.player.key();
    session.amount = amount;
    session.session_seed = session_seed;
    session.created_at = Clock::get()?.unix_timestamp;
    session.settled = false;
    session.bump = ctx.bumps.session;
    session.escrow_bump = ctx.bumps.escrow;

    // Transfer stake lamports from player → escrow PDA via System Program CPI.
    // Escrow is a SystemAccount (no data), so standard system_program::transfer works.
    let cpi_accounts = system_program::Transfer {
        from: ctx.accounts.player.to_account_info(),
        to: ctx.accounts.escrow.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        cpi_accounts,
    );
    system_program::transfer(cpi_ctx, amount)?;

    msg!(
        "Commit: player={} amount={} session_seed={}",
        session.player,
        amount,
        session_seed
    );

    // Session 4 D1 — Emit structured event for indexers + explorer visibility.
    // Anchor encodes this as base64 `Program data:` log; tools that know the
    // IDL (Solscan, Anchor's event parser) render it decoded.
    emit!(SessionCommitted {
        player: session.player,
        stake_lamports: amount,
        session_seed,
        escrow: ctx.accounts.escrow.key(),
        created_at: session.created_at,
    });
    Ok(())
}

#[event]
pub struct SessionCommitted {
    pub player: Pubkey,
    pub stake_lamports: u64,
    pub session_seed: u64,
    pub escrow: Pubkey,
    pub created_at: i64,
}

#[derive(Accounts)]
#[instruction(amount: u64, session_seed: u64)]
pub struct Commit<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    /// Newly-created per-session state account. `init` reserves space + pays
    /// rent from the player. Seed includes the `session_seed` so the same
    /// player can run concurrent sessions with different seeds.
    #[account(
        init,
        payer = player,
        space = 8 + Session::SPACE,
        seeds = [SESSION_SEED, player.key().as_ref(), &session_seed.to_le_bytes()],
        bump,
    )]
    pub session: Account<'info, Session>,

    /// Per-session SOL escrow PDA. Held as a SystemAccount so we can
    /// `system_program::transfer` into it here and manipulate its lamports
    /// directly on settle. No data; just a stake vault.
    #[account(
        mut,
        seeds = [ESCROW_SEED, session.key().as_ref()],
        bump,
    )]
    pub escrow: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}
