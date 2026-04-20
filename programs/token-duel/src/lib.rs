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
    /// Session 3 Phase B.
    pub fn initialize_leaderboard(ctx: Context<InitializeLeaderboard>) -> Result<()> {
        instructions::initialize_leaderboard::handler(ctx)
    }
}
