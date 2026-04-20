//! Error codes for Token Duel. Anchor's `#[error_code]` macro emits IDL entries
//! that the client sees as human-readable error names.

use anchor_lang::prelude::*;

#[error_code]
pub enum GameError {
    #[msg("Session already settled")]
    AlreadySettled,
    #[msg("Stake below minimum (0.001 SOL)")]
    StakeTooLow,
    #[msg("Stake above maximum (1 SOL)")]
    StakeTooHigh,
    #[msg("Height out of valid range (0-100)")]
    HeightOutOfRange,
    #[msg("Protocol pool underfunded for this payout tier")]
    PoolUnderfunded,
    #[msg("Caller is not the admin")]
    Unauthorized,
}
