//! Token Duel — Solana Anchor program.
//!
//! Hackathon v1 escrow + tiered-payout game. Three instructions:
//!   - `initialize_pool` — admin-only, one-time. Seeds the protocol pool.
//!   - `commit`          — player stakes SOL into a per-session escrow PDA.
//!   - `settle`          — player claims payout based on their tap-game height.
//!
//! Security model (v1): trust-client. Player passes their own height. User
//! can cheat the value but draws only from the stake they just posted + the
//! bounded protocol pool. v1.5 adds an admin co-signer; v2 swaps for
//! Ed25519 on-chain verification of a server-signed receipt.

use anchor_lang::prelude::*;

declare_id!("14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd");

pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

#[program]
pub mod token_duel {
    use super::*;

    /// One-time admin setup. Funds the singleton protocol pool.
    pub fn initialize_pool(ctx: Context<InitializePool>, fund_amount: u64) -> Result<()> {
        instructions::initialize_pool::handler(ctx, fund_amount)
    }

    /// Player stakes SOL into a per-session escrow.
    pub fn commit(ctx: Context<Commit>, amount: u64, session_seed: u64) -> Result<()> {
        instructions::commit::handler(ctx, amount, session_seed)
    }

    /// Player claims payout for a given tap-game height and closes the session.
    /// Session 3: accepts an optional leaderboard account via remaining_accounts
    /// (passed as the 5th named account in the Settle context — see Settle).
    pub fn settle(ctx: Context<Settle>, height: u8) -> Result<()> {
        instructions::settle::handler(ctx, height)
    }

    /// Admin-only, one-time. Allocates the singleton Leaderboard PDA.
    /// Session 3 Phase B. Used by the legacy solo `settle` ix.
    pub fn initialize_leaderboard(ctx: Context<InitializeLeaderboard>) -> Result<()> {
        instructions::initialize_leaderboard::handler(ctx)
    }

    /// Admin-only, one-time per mode. Allocates a Leaderboard PDA at
    /// `[b"leaderboard", &[mode]]`. Session D Part 7 — backs the mode-filter
    /// tabs in the demo UI. Must be called once per GameMode (0..=3) before
    /// any `settle_match` can insert into that mode's board.
    pub fn initialize_mode_leaderboard(
        ctx: Context<InitializeModeLeaderboard>,
        mode: u8,
    ) -> Result<()> {
        instructions::initialize_mode_leaderboard::handler(ctx, mode)
    }

    // ─── Session D: 1v1 match-making + UserStats + Treasury ────────

    /// One-time admin setup for rake sink.
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        instructions::initialize_treasury::handler(ctx)
    }

    /// One-time admin setup for monotonic match seq counter.
    pub fn initialize_match_counter(ctx: Context<InitializeMatchCounter>) -> Result<()> {
        instructions::initialize_match_counter::handler(ctx)
    }

    /// Per-player UserStats PDA. Rent-payer is the player themselves.
    pub fn initialize_user_stats(ctx: Context<InitializeUserStats>) -> Result<()> {
        instructions::initialize_user_stats::handler(ctx)
    }

    /// Create a new Match. Caller supplies `seq == counter.seq` (client reads
    /// the counter first); ix writes caller into slot 0 and bumps the counter.
    pub fn join_match_create(
        ctx: Context<JoinMatchCreate>,
        mode: u8,
        wager_tier: u8,
        xp_bucket: u16,
        time_window: u8,
        seq: u64,
    ) -> Result<()> {
        instructions::join_match::handler_create(ctx, mode, wager_tier, xp_bucket, time_window, seq)
    }

    /// Join an existing Match that's in Waiting status with free slot.
    pub fn join_match_join(ctx: Context<JoinMatchJoin>) -> Result<()> {
        instructions::join_match::handler_join(ctx)
    }

    /// Submit height for this match. Last submission triggers payout + writes
    /// all players' UserStats + leaderboard insert for the winner.
    /// Uses `remaining_accounts` for variable-N stats and variable-K payout
    /// recipients — see `instructions::settle_match::handler` for the layout.
    pub fn settle_match<'info>(
        ctx: Context<'_, '_, '_, 'info, SettleMatch<'info>>,
        height: u32,
    ) -> Result<()> {
        instructions::settle_match::handler(ctx, height)
    }

    /// Refund a Match that's been in Waiting longer than the timeout.
    pub fn cancel_match(ctx: Context<CancelMatch>) -> Result<()> {
        instructions::cancel_match::handler(ctx)
    }

    // ─── Session D Part 8 — Admin withdrawals (rake reclamation) ───

    /// Admin-gated: move lamports from Treasury PDA to an arbitrary recipient.
    /// Clamps to `balance - rent_exempt_floor`. Signer must equal
    /// `state::ADMIN_PUBKEY`. Used post-hackathon to reclaim accumulated rake.
    pub fn admin_withdraw(ctx: Context<AdminWithdraw>, amount: u64) -> Result<()> {
        instructions::admin_withdraw::handler(ctx, amount)
    }

    /// Admin-gated: move lamports from the legacy Pool PDA to an arbitrary
    /// recipient. Same admin gate as `admin_withdraw`. Pool is a Session 3
    /// relic; this ix exists to reclaim residual balance.
    pub fn admin_withdraw_pool(ctx: Context<AdminWithdrawPool>, amount: u64) -> Result<()> {
        instructions::admin_withdraw_pool::handler(ctx, amount)
    }

    // ─── Part 9 — AFK reclaim ────────────────────────────────────────

    /// Any signer can call once a match has been `Active` for
    /// `FORCE_SETTLE_TIMEOUT_SECS` without all players submitting.
    /// Fills unsubmitted height slots with 0 and runs the normal
    /// settle_match payout + rake + stats + leaderboard path.
    pub fn force_settle<'info>(
        ctx: Context<'_, '_, '_, 'info, ForceSettle<'info>>,
    ) -> Result<()> {
        instructions::force_settle::handler(ctx)
    }

    // ─── Part 10 Bundle 1 — server-signed receipts ───────────────────

    /// Cheat-resistant settle path. The client wraps this ix in a tx that
    /// also contains an Ed25519 precompile ix at index 0 with the backend
    /// server's signature over `(match_pda || player || height || signed_at)`.
    /// The handler validates that signature via load_instruction_at_checked.
    pub fn settle_match_verified<'info>(
        ctx: Context<'_, '_, '_, 'info, SettleMatchVerified<'info>>,
        height: u32,
        signed_at: i64,
    ) -> Result<()> {
        instructions::settle_match_verified::handler(ctx, height, signed_at)
    }

    // ─── Part 10 Bundle 3 — retention ─────────────────────────────────

    /// One-time migration from UserStats v1 (72 bytes) to v2 (112 bytes).
    /// Idempotent via realloc — running on an already-v2 account is a no-op.
    /// Client gates on current account size before calling.
    pub fn migrate_user_stats(ctx: Context<MigrateUserStats>) -> Result<()> {
        instructions::migrate_user_stats::handler(ctx)
    }

    /// Admin-gated: initialize today's DailyChallenge PDA. Cron calls this
    /// at 00:00 UTC each day.
    pub fn initialize_daily_challenge(
        ctx: Context<InitializeDailyChallenge>,
        day_id: u64,
        challenges: [state::Challenge; 3],
    ) -> Result<()> {
        instructions::initialize_daily_challenge::handler(ctx, day_id, challenges)
    }

    /// Admin-gated: initialize this week's Season PDA. Cron calls this
    /// at Sunday 00:00 UTC.
    pub fn initialize_season(ctx: Context<InitializeSeason>, season_id: u64) -> Result<()> {
        instructions::initialize_season::handler(ctx, season_id)
    }

    /// Admin-gated: pay 20% of accumulated rake to top-3 of a past season.
    /// Called Monday 00:00 UTC (24h grace) by cron.
    pub fn pay_season<'info>(
        ctx: Context<'_, '_, '_, 'info, PaySeason<'info>>,
        season_id: u64,
    ) -> Result<()> {
        instructions::pay_season::handler(ctx, season_id)
    }
}
