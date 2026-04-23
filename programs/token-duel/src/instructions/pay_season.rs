//! Part 10 Bundle 3 — admin-gated season payout.
//!
//! Transfers 20% of the season's accumulated rake from Treasury to top-3
//! entries, split 60/30/10. Marks `paid_out = true` to prevent double-pay.
//! Run on Monday 00:00 UTC (24h after season end) to let any Sunday-evening
//! matches settle before snapshot.
//!
//! Recipients are passed as remaining_accounts in rank order. Program
//! verifies each matches `entries[i].player`.

use anchor_lang::prelude::*;

use crate::error::GameError;
use crate::state::{
    Season, Treasury, ADMIN_PUBKEY, SEASON_PRIZE_BPS, SEASON_PRIZE_SHARE_BPS, SEASON_SEED,
    TREASURY_SEED,
};

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, PaySeason<'info>>,
    season_id: u64,
) -> Result<()> {
    require_keys_eq!(ctx.accounts.admin.key(), ADMIN_PUBKEY, GameError::Unauthorized);
    require_eq!(ctx.accounts.season.season_id, season_id, GameError::BadSeasonId);
    require!(!ctx.accounts.season.paid_out, GameError::SeasonAlreadyPaid);

    let season = &ctx.accounts.season;
    let prize_pool = season
        .total_rake_accumulated
        .saturating_mul(SEASON_PRIZE_SHARE_BPS)
        / 10_000;

    if prize_pool == 0 {
        msg!(
            "PaySeason: season_id={} prize_pool=0 (no rake accumulated) — marking paid, no transfers",
            season_id
        );
        ctx.accounts.season.paid_out = true;
        return Ok(());
    }

    // Treasury PDA signs transfers out. It's a program-owned Account<Treasury>,
    // not a SystemAccount, so we move lamports manually rather than via CPI.
    // Direct lamport mutation is valid for program-owned accounts as long as
    // we stay above rent-exempt floor (Treasury has no rent-exempt reserve
    // concern beyond its base size; we log the pre/post balances).
    let n_recipients = ctx.remaining_accounts.len().min(3);
    require!(n_recipients > 0, GameError::Unauthorized);

    let treasury_info = ctx.accounts.treasury.to_account_info();
    let pre_treasury = treasury_info.lamports();

    for i in 0..n_recipients {
        let entry = season.entries[i];
        if entry.wins == 0 {
            // Empty slot — skip; don't expect a recipient here.
            continue;
        }
        let recipient_info = &ctx.remaining_accounts[i];
        require_keys_eq!(recipient_info.key(), entry.player, GameError::Unauthorized);

        let bps = SEASON_PRIZE_BPS[i] as u64;
        let amount = prize_pool.saturating_mul(bps) / 10_000;
        if amount == 0 {
            continue;
        }

        **treasury_info.try_borrow_mut_lamports()? = treasury_info
            .lamports()
            .saturating_sub(amount);
        **recipient_info.try_borrow_mut_lamports()? = recipient_info
            .lamports()
            .saturating_add(amount);

        msg!(
            "PaySeason: rank={} player={} wins={} amount={}",
            i + 1,
            entry.player,
            entry.wins,
            amount
        );
    }

    ctx.accounts.season.paid_out = true;
    let post_treasury = treasury_info.lamports();
    msg!(
        "PaySeason.FINAL: season_id={} prize_pool={} treasury_pre={} treasury_post={} transferred={}",
        season_id, prize_pool, pre_treasury, post_treasury, pre_treasury - post_treasury
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(season_id: u64)]
pub struct PaySeason<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,

    #[account(
        mut,
        seeds = [SEASON_SEED, &season_id.to_le_bytes()],
        bump = season.bump,
    )]
    pub season: Account<'info, Season>,

    pub system_program: Program<'info, System>,
    // remaining_accounts:
    //   [recipient_1, recipient_2, recipient_3] in season.entries[0..3] order.
    //   Empty slots (wins == 0) can still have a placeholder passed; the
    //   handler skips them.
}
