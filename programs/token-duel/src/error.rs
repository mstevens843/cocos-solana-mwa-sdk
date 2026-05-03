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
    // Session D — match / stats
    #[msg("Match is already full")]
    MatchFull,
    #[msg("Match is not in the expected status")]
    MatchBadStatus,
    #[msg("Caller is not a player in this match")]
    NotInMatch,
    #[msg("Player has already settled this match")]
    AlreadySettledMatch,
    #[msg("Match cannot be cancelled yet (timeout not elapsed)")]
    MatchNotTimedOut,
    #[msg("Invalid wager tier index")]
    InvalidWagerTier,
    #[msg("Invalid game mode")]
    InvalidMode,
    #[msg("Wager lamports do not match expected tier value")]
    WagerMismatch,
    #[msg("Nothing available to withdraw (balance at or below rent-exempt floor)")]
    WithdrawUnavailable,
    #[msg("Invalid time window index")]
    InvalidTimeWindow,
    #[msg("Match cannot be force-settled yet (Active timeout not elapsed)")]
    MatchNotForcedYet,
    // Part 10 Bundle 1 — server-signed receipt verification
    #[msg("Ed25519 verification instruction missing at index 0")]
    Ed25519IxMissing,
    #[msg("Ed25519 verification instruction is malformed or unparseable")]
    Ed25519IxMalformed,
    #[msg("Receipt signer does not match expected server pubkey")]
    InvalidReceiptSigner,
    #[msg("Receipt is outside the freshness window")]
    ReceiptExpired,
    #[msg("Receipt message does not match tx arguments")]
    ReceiptMessageMismatch,
    // Part 10 Bundle 3 — retention
    #[msg("UserStats account already at current layout")]
    AlreadyMigrated,
    #[msg("day_id mismatch with current Clock")]
    BadDayId,
    #[msg("season_id mismatch with current Clock")]
    BadSeasonId,
    #[msg("Challenge definition is invalid (kind/target/reward out of range)")]
    InvalidChallenge,
    #[msg("Season already paid out")]
    SeasonAlreadyPaid,
    #[msg("DailyChallenge is stale — cron did not initialize today's challenge yet")]
    DailyChallengeStale,
    #[msg("Season PDA is stale — cron did not initialize this week's season yet")]
    SeasonStale,
    // Phase F — Critical safety gates
    #[msg("Real-track matches must use the verified settle path; the unverified settle is rejected for paid matches")]
    VerifiedSettleRequired,
    #[msg("Match is already settled — force-settle cannot run twice")]
    MatchAlreadyClosed,
    // betting-duel — SPL token wagers (SKR)
    #[msg("Wager mint is not whitelisted (must be SKR_MINT_DEVNET or SKR_MINT_MAINNET)")]
    InvalidWagerMint,
    #[msg("Match is SOL-only — call the native-SOL ix path instead")]
    NotSplMatch,
    #[msg("Match is SPL-token only — call the SKR ix path instead")]
    NotSolMatch,
}
