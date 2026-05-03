/**
 * ScoreEncoding.ts - bidirectional map between portfolio delta % and the
 * u32 "height" field the on-chain `settle_match` expects.
 *
 * We reuse the existing Match PDA schema on betting-duel without any
 * Rust changes. `compute_mode_payout` ranks players by their submitted
 * u32, highest wins. We encode a player's portfolio % delta with a
 * bias so negatives fit inside u32:
 *
 *     score = clamp((deltaPct * 100) + 1_000_000, 0, u32::MAX)
 *
 *  +25% portfolio → score = 1_002_500
 *   0% portfolio → score = 1_000_000
 *  −25% portfolio → score =   997_500
 *
 * The inverse lets client code decode opponent heights back into a
 * displayable % (race HUD shows "vs Player2: −1.8% behind").
 */

const TAG = '[ScoreEncoding]';

/** Centered around SCORE_ZERO so positive = above zero, negative = below. */
export const SCORE_BIAS = 1_000_000;

/** (deltaPct * DELTA_SCALE) is the portion encoded as u32 offset. */
export const DELTA_SCALE = 100;

/** u32 max - `settle_match` accepts u32 so we clamp both ends. */
export const U32_MAX = 0xFFFF_FFFF;

/**
 * Encode a portfolio % change into the on-chain u32 score.
 *
 * Clamps: a delta below (−SCORE_BIAS / DELTA_SCALE) = −10_000% floors
 * at score=0; a delta above roughly +42_948_966% ceilings at u32 max.
 * Realistic deltas (±1000% in the window) use a tiny fraction of the
 * range, so precision loss is negligible.
 */
export function encodeDeltaPct(deltaPct: number): number {
    if (!Number.isFinite(deltaPct)) {
        console.log(`${TAG} encodeDeltaPct | NON_FINITE input=${deltaPct} - coercing to 0`);
        deltaPct = 0;
    }
    const raw = Math.round(deltaPct * DELTA_SCALE) + SCORE_BIAS;
    if (raw < 0) {
        console.log(`${TAG} encodeDeltaPct | CLAMP_LOW input=${deltaPct}% raw=${raw} → score=0 (floor hit; only plausible at < -10_000%)`);
        return 0;
    }
    if (raw > U32_MAX) {
        console.log(`${TAG} encodeDeltaPct | CLAMP_HIGH input=${deltaPct}% raw=${raw} → score=${U32_MAX} (ceiling hit; only plausible at > 42M%)`);
        return U32_MAX;
    }
    return raw;
}

/**
 * Inverse of encodeDeltaPct. A score of exactly SCORE_BIAS decodes to 0.
 * A score less than SCORE_BIAS decodes to a negative delta.
 */
export function decodeScore(score: number): number {
    if (!Number.isFinite(score)) {
        console.log(`${TAG} decodeScore | NON_FINITE_INPUT score=${score} - returning 0`);
        return 0;
    }
    return (score - SCORE_BIAS) / DELTA_SCALE;
}

/** Sentinel score meaning "no submission yet" - decodes to 0%. */
export const SCORE_ZERO = SCORE_BIAS;
