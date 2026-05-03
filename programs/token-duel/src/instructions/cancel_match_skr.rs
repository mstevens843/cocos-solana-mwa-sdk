//! `cancel_match_skr` — SPL twin of `cancel_match.rs`.
//!
//! Refunds the joined player(s) of a Waiting SKR match once the lobby
//! timeout elapses (or immediately if the lone creator self-cancels).
//! Tokens flow from the per-match escrow ATA back to each refundee's ATA
//! via `token::transfer_checked` signed by the escrow PDA — same signer
//! seeds as the SOL flow so authority derivation stays consistent.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::error::GameError;
use crate::state::{
    MatchAccount, MatchStatus, MATCH_ESCROW_SEED, MATCH_ESCROW_TOKEN_SEED, MATCH_SEED,
    MATCH_WAIT_TIMEOUT_SECS, SKR_DECIMALS,
};

pub fn handler(ctx: Context<CancelMatchSkr>) -> Result<()> {
    let clock = Clock::get()?;
    let match_key = ctx.accounts.match_account.key();
    let escrow_bump = ctx.accounts.match_account.escrow_bump;

    let (player0, player_count, wager_atoms, wager_mint) = {
        let m = &ctx.accounts.match_account;
        require!(m.status == MatchStatus::Waiting as u8, GameError::MatchBadStatus);
        require!(m.wager_mint != Pubkey::default(), GameError::NotSplMatch);
        let elapsed = clock.unix_timestamp.saturating_sub(m.created_at);
        let is_self_cancel = m.player_count == 1
            && ctx.accounts.canceller.key() == m.players[0];
        if !is_self_cancel {
            require!(elapsed >= MATCH_WAIT_TIMEOUT_SECS, GameError::MatchNotTimedOut);
        }
        (m.players[0], m.player_count, m.wager_lamports, m.wager_mint)
    };

    require_keys_eq!(ctx.accounts.mint.key(), wager_mint, GameError::InvalidWagerMint);
    require_keys_eq!(
        ctx.accounts.refund_recipient_ata.owner,
        player0,
        GameError::NotInMatch
    );
    require_keys_eq!(
        ctx.accounts.refund_recipient_ata.mint,
        wager_mint,
        GameError::InvalidWagerMint
    );

    let escrow_seeds: &[&[u8]] = &[
        MATCH_ESCROW_SEED,
        match_key.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let escrow_signer: &[&[&[u8]]] = &[escrow_seeds];

    let refund_total = wager_atoms.saturating_mul(player_count as u64);
    if refund_total > 0 {
        let cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.match_escrow_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.refund_recipient_ata.to_account_info(),
                authority: ctx.accounts.match_escrow.to_account_info(),
            },
            escrow_signer,
        );
        token::transfer_checked(cpi, refund_total, SKR_DECIMALS)?;
    }

    let m = &mut ctx.accounts.match_account;
    m.status = MatchStatus::Cancelled as u8;
    m.closed_at = clock.unix_timestamp;

    msg!(
        "CancelMatchSkr: match={} refunded={} atoms to={}",
        match_key, refund_total, player0
    );
    emit!(crate::instructions::cancel_match::MatchCancelled {
        match_pda: match_key,
        refunded_to: player0,
        refund_lamports: refund_total,
        at: clock.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelMatchSkr<'info> {
    pub canceller: Signer<'info>,

    #[account(
        mut,
        seeds = [MATCH_SEED, &[match_account.mode], &[match_account.wager_tier], &match_account.seq.to_le_bytes()],
        bump = match_account.bump,
    )]
    pub match_account: Box<Account<'info, MatchAccount>>,

    /// CHECK: signs the token transfer back; validated via seeds.
    #[account(
        mut,
        seeds = [MATCH_ESCROW_SEED, match_account.key().as_ref()],
        bump = match_account.escrow_bump,
    )]
    pub match_escrow: SystemAccount<'info>,

    #[account(address = match_account.wager_mint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        seeds = [MATCH_ESCROW_TOKEN_SEED, match_account.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = match_escrow,
    )]
    pub match_escrow_token: Box<Account<'info, TokenAccount>>,

    /// Refund destination ATA. Owner is verified in-handler against
    /// `match_account.players[0]` (slot-0 = creator).
    #[account(mut)]
    pub refund_recipient_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
