//! Part 10 Bundle 3 — shared logic for streak / daily-challenge / season
//! updates. Called from both `settle_match` and `settle_match_verified`
//! so the rules stay in lock-step across paths.
//!
//! Pure function over `UserStats` + `DailyChallenge` + `Season`. Mutates
//! the stats + season refs; reads daily_challenge; returns bonus_xp to
//! be added to stats.xp by the caller (caller also controls the `level`
//! recompute since it depends on the final XP total including base + bonus).

use anchor_lang::prelude::*;

use crate::state::{
    Challenge, ChallengeKind, Season, UserStats, DAY_SECONDS, WEEK_SECONDS,
};

/// Apply Part 10 retention updates for a single player's stats row during
/// a settle. Returns `bonus_xp` awarded by daily challenges that flipped
/// from 0→1 during this call.
///
/// Caller responsibilities:
///   - Add the returned `bonus_xp` to `stats.xp` AFTER the base XP bump.
///   - Recompute `stats.level` after all XP is applied.
///   - Bump `season.total_rake_accumulated` at the rake-transfer site
///     (not here — we don't have the rake amount in this scope).
pub fn apply_retention_updates(
    stats: &mut UserStats,
    won: bool,
    match_mode: u8,
    match_time_window: u8,
    match_required_players: u8,
    daily_challenges: &[Challenge; 3],
    season: &mut Season,
    caller_pubkey: Pubkey,
    now: i64,
) -> u64 {
    // ─── Streak ──────────────────────────────────────────────────────
    let current_day = now / DAY_SECONDS;
    let last_day = stats.last_daily_claim_at / DAY_SECONDS;

    if stats.last_daily_claim_at == 0 {
        // First-ever game. Start the streak.
        stats.current_streak = 1;
        stats.daily_challenges_bitmask = 0;
    } else if current_day == last_day {
        // Same day — no streak change, bitmask carries over (multiple
        // matches today can complete multiple challenges).
    } else if current_day == last_day + 1 {
        // Consecutive day — bump streak, reset bitmask for fresh challenges.
        stats.current_streak = stats.current_streak.saturating_add(1);
        stats.daily_challenges_bitmask = 0;
    } else {
        // Gap of 2+ days — reset.
        stats.current_streak = 1;
        stats.daily_challenges_bitmask = 0;
    }

    if stats.current_streak > stats.best_streak {
        stats.best_streak = stats.current_streak;
    }
    stats.last_daily_claim_at = now;

    // ─── Daily challenges ────────────────────────────────────────────
    // Evaluate each of today's 3 challenges against this match. Flip the
    // corresponding bit 0..2 if newly completed; sum up the bonus XP.
    let mut bonus_xp: u64 = 0;
    for i in 0..3 {
        let already_done = (stats.daily_challenges_bitmask >> i) & 1 == 1;
        if already_done {
            continue;
        }
        let c = daily_challenges[i];
        let completed = evaluate_challenge(&c, won, stats, match_mode, match_time_window, match_required_players);
        if completed {
            stats.daily_challenges_bitmask |= 1u32 << i;
            bonus_xp = bonus_xp.saturating_add(c.reward_xp as u64);
        }
    }

    // ─── Season ──────────────────────────────────────────────────────
    let current_week = (now / WEEK_SECONDS) as u64;

    // If our stored season_id is stale, reset season_wins. This covers
    // the "Sunday rollover" case without needing an explicit zero-out ix.
    if stats.season_id != season.season_id {
        stats.season_wins = 0;
        stats.season_id = season.season_id;
    }
    // Season PDA itself might be stale (if cron didn't init this week's
    // yet). In that case we leave season.total_rake_accumulated alone and
    // don't insert. Handler layer can also require!() season.season_id == current_week.
    if won && season.season_id == current_week {
        stats.season_wins = stats.season_wins.saturating_add(1);
        season.try_insert(caller_pubkey, stats.season_wins, now);
    }

    bonus_xp
}

fn evaluate_challenge(
    c: &Challenge,
    won: bool,
    stats: &UserStats,
    match_mode: u8,
    match_time_window: u8,
    match_required_players: u8,
) -> bool {
    match ChallengeKind::from_u8(c.kind) {
        Some(ChallengeKind::WinNMatches) => {
            // Approximation: mark done when `target` total wins have
            // happened (won && stats.wins % target == 0). Refined
            // per-day counter deferred to Part 11.
            if !won { return false; }
            if c.target == 0 { return false; }
            stats.wins != 0 && (stats.wins as u64) % (c.target as u64) == 0
        }
        Some(ChallengeKind::WinOnTimeWindow) => won && match_time_window as u32 == c.target,
        Some(ChallengeKind::WinOnMode) => won && match_mode as u32 == c.target,
        Some(ChallengeKind::FirstPlaceInPot) => {
            won && match_required_players as u32 >= c.target && match_required_players >= 4
        }
        _ => false,
    }
}
