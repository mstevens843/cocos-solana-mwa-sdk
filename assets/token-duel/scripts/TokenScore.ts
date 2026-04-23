/**
 * TokenScore.ts — 0-100 composite score per token.
 *
 * Port of solpulse's `frontend/src/utils/tokenScore.js`. Pure function, no
 * network, no side effects. Weights match solpulse verbatim:
 *   - Liquidity  30% (log10 ramped to $1M)
 *   - Volume     25% (log10 ramped to $1M)
 *   - Age        20% (fresher = higher; bucketed from 5min to 1d)
 *   - Holders    15% (log10 ramped to 10k)
 *   - Stability  10% (lower 24h abs change = higher)
 *
 * Individual components clamped to 0..100 before being mixed.
 *
 * Deliberately no per-call logging — this runs in the row-render loop and
 * would flood the log tape. If a future bug suggests mis-scoring, add a
 * one-off debug log in the caller, not here.
 */

import { TokenRow } from './birdeye/types';

const W_LIQ = 0.30;
const W_VOL = 0.25;
const W_AGE = 0.20;
const W_HLD = 0.15;
const W_STB = 0.10;

/** Clamp n to [0, 100]. */
function clamp100(n: number): number {
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
}

/** log10(max(1, x)) / divisor * 100 — standard Birdeye-style metric ramp. */
function logRamp(x: number, divisor: number): number {
    if (!Number.isFinite(x) || x <= 0) return 0;
    const log = Math.log10(Math.max(1, x));
    return clamp100((log / divisor) * 100);
}

/** Newer = higher. 0 blockUnixTime means unknown → score 0 for age. */
function ageScore(blockUnixTime: number): number {
    if (!blockUnixTime || blockUnixTime <= 0) return 0;
    const ageSec = Math.floor(Date.now() / 1000) - blockUnixTime;
    if (ageSec < 300) return 100;       // <5 min — fresh
    if (ageSec < 1800) return 80;       // <30 min
    if (ageSec < 7200) return 60;       // <2 h
    if (ageSec < 86400) return 40;      // <24 h
    return 20;                          // older than a day
}

/** |change| > 20% cuts stability hard; 0% change = 100. */
function stabilityScore(change24hPct: number): number {
    if (!Number.isFinite(change24hPct)) return 50; // neutral fallback
    return clamp100(100 - Math.abs(change24hPct) * 5);
}

/**
 * Compute the weighted composite score for a row.
 * Returns an integer in [0, 100].
 */
export function computeScore(row: TokenRow): number {
    const liq = logRamp(row.liquidity, 6);    // $1M ≈ 100
    const vol = logRamp(row.volume24hUsd, 6); // $1M ≈ 100
    const age = ageScore(row.blockUnixTime);
    const hld = logRamp(row.holders, 4);      // 10k ≈ 100
    const stb = stabilityScore(row.change24hPct);

    const mixed = liq * W_LIQ + vol * W_VOL + age * W_AGE + hld * W_HLD + stb * W_STB;
    return Math.round(clamp100(mixed));
}

/** Right-align a score so the column reads cleanly in fixed-width fonts. */
export function formatScore(n: number): string {
    if (!Number.isFinite(n)) return '--';
    const clamped = Math.max(0, Math.min(100, Math.round(n)));
    return String(clamped);
}
