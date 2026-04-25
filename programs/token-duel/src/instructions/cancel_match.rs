//! `cancel_match` — if a Match has been in Waiting state longer than
//! `MATCH_WAIT_TIMEOUT_SECS` (120), anyone can call this to refund the
//! joined player(s). Safety net against stuck escrow when no opponent shows.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::error::GameError;
use crate::state::{
    MatchAccount, MatchStatus, MATCH_ESCROW_SEED, MATCH_SEED, MATCH_WAIT_TIMEOUT_SECS,
};

pub fn handler(ctx: Context<CancelMatch>) -> Result<()> {
    let clock = Clock::get()?;
    let match_key = ctx.accounts.match_account.key();
    let escrow_bump = ctx.accounts.match_account.escrow_bump;

    let (player0, player_count, wager) = {
        let m = &ctx.accounts.match_account;
        require!(
            m.status == MatchStatus::Waiting as u8,
            GameError::MatchBadStatus
        );
        let elapsed = clock.unix_timestamp.saturating_sub(m.created_at);
        // Phase D — Branch B: the lone creator can self-cancel at any time
        // (no timeout). Branch A: anyone can cancel after MATCH_WAIT_TIMEOUT_SECS.
        let is_self_cancel = m.player_count == 1
            && ctx.accounts.canceller.key() == m.players[0];
        if !is_self_cancel {
            require!(
                elapsed >= MATCH_WAIT_TIMEOUT_SECS,
                GameError::MatchNotTimedOut
            );
        }
        (m.players[0], m.player_count, m.wager_lamports)
    };

    // Verify the caller supplied the correct refund recipient (slot 0).
    require_keys_eq!(
        ctx.accounts.refund_recipient.key(),
        player0,
        GameError::NotInMatch
    );

    let escrow_seeds: &[&[u8]] = &[
        MATCH_ESCROW_SEED,
        match_key.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let escrow_signer: &[&[&[u8]]] = &[escrow_seeds];

    // Refund each joined player's wager. In 1v1 Waiting state we expect
    // exactly one joined player (slot 0). Loop anyway for future-proofing.
    let refund_total = wager.saturating_mul(player_count as u64);
    if refund_total > 0 {
        let cpi = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.match_escrow.to_account_info(),
                to: ctx.accounts.refund_recipient.to_account_info(),
            },
            escrow_signer,
        );
        system_program::transfer(cpi, refund_total)?;
    }

    let m = &mut ctx.accounts.match_account;
    m.status = MatchStatus::Cancelled as u8;
    m.closed_at = clock.unix_timestamp;

    msg!(
        "CancelMatch: match={} refunded={} lamports to={}",
        match_key,
        refund_total,
        player0
    );
    emit!(MatchCancelled {
        match_pda: match_key,
        refunded_to: player0,
        refund_lamports: refund_total,
        at: clock.unix_timestamp,
    });
    Ok(())
}

#[event]
pub struct MatchCancelled {
    pub match_pda: Pubkey,
    pub refunded_to: Pubkey,
    pub refund_lamports: u64,
    pub at: i64,
}

#[derive(Accounts)]
pub struct CancelMatch<'info> {
    /// Anyone can call this; no signer constraint beyond rent payment.
    pub canceller: Signer<'info>,

    #[account(
        mut,
        seeds = [MATCH_SEED, &[match_account.mode], &[match_account.wager_tier], &match_account.seq.to_le_bytes()],
        bump = match_account.bump,
    )]
    pub match_account: Account<'info, MatchAccount>,

    #[account(
        mut,
        seeds = [MATCH_ESCROW_SEED, match_account.key().as_ref()],
        bump = match_account.escrow_bump,
    )]
    pub match_escrow: SystemAccount<'info>,

    /// CHECK: verified in-ix against `match_account.players[0]`.
    #[account(mut)]
    pub refund_recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
