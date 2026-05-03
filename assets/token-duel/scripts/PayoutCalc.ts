/**
 * PayoutCalc.ts - pure-JS mirror of Rust `compute_1v1_payout` +
 * `level_from_xp` from `programs/token-duel/src/state.rs`.
 *
 * Used by PostMatchPanel to show payout preview AND by the paper-mode
 * settlement path (no Anchor program touched for paper).
 *
 * Keep in lockstep with Rust - any formula change must happen in both.
 */

import { RAKE_BPS, BPS_DENOM, MODES, ModeId, ModeDef, modeFromU8 } from './ModeDefs';

const TAG = '[PayoutCalc]';

/**
 * Part 13: level-scaled rake bounds. Must mirror Rust state.rs
 * `RAKE_BPS_{MIN,MAX}` and `rake_bps_for_level`.
 */
export const RAKE_BPS_MAX = 500; // 5.00% at level 1
export const RAKE_BPS_MIN = 300; // 3.00% at level 10+

/**
 * Rake basis-points for a player of `level`. Linear interp 1..10 → 500..300,
 * capped on both ends. Level 0 (uninitialized) treated as level 1.
 *
 * Mirror of Rust `rake_bps_for_level` - update both in lockstep.
 */
export function rakeBpsForLevel(level: number): number {
    const clamped = Math.max(1, Math.min(10, Math.floor(level)));
    const steps = clamped - 1;
    const range = RAKE_BPS_MAX - RAKE_BPS_MIN;
    return RAKE_BPS_MAX - Math.floor((steps * range) / 9);
}

export interface PayoutBreakdown {
    winnerSlot: number;    // 0 or 1 (legacy for 1v1 callers)
    toWinnerLamports: number;
    toTreasuryLamports: number;
    potLamports: number;
}

export interface ModePayoutBreakdown {
    /** Slots sorted descending by height (1st, 2nd, …). Length = requiredPlayers. */
    sortedSlots: number[];
    /** Lamports per rank (1st, 2nd, …). Length = payout table. Unranked slots get 0. */
    winnerLamports: number[];
    /** Same length as winnerLamports - the slot index that won each rank. */
    winnerSlots: number[];
    toTreasuryLamports: number;
    potLamports: number;
}

/**
 * Mirror of Rust `compute_1v1_payout` - kept for 1v1 callers.
 */
export function compute1v1Payout(potLamports: number, heights: [number, number]): PayoutBreakdown {
    const winnerSlot = heights[0] >= heights[1] ? 0 : 1;
    const rake = Math.floor((potLamports * RAKE_BPS) / BPS_DENOM);
    const toWinner = Math.max(0, potLamports - rake);
    console.log(`${TAG} compute1v1Payout | DONE pot=${potLamports} heights=[${heights[0]}, ${heights[1]}] winner_slot=${winnerSlot} to_winner=${toWinner} rake=${rake}`);
    return {
        winnerSlot,
        toWinnerLamports: toWinner,
        toTreasuryLamports: rake,
        potLamports,
    };
}

/**
 * Mirror of Rust `compute_mode_payout` for any mode. Returns sorted slots
 * (rank order) + per-rank payout lamports for the top-K.
 *
 * Part 13: when `levels` is supplied, rake scales per-player via
 * `rakeBpsForLevel`. Without levels, falls back to the flat `RAKE_BPS`
 * legacy rate - caller responsibility to pass levels when on the verified
 * settle path. (Paper mode and pre-settle previews are OK with the
 * conservative RAKE_BPS default.)
 */
export function computeModePayout(
    modeOrU8: ModeId | number,
    potLamports: number,
    heights: number[],
    levels?: number[],
): ModePayoutBreakdown {
    const mode = typeof modeOrU8 === 'number' ? modeFromU8(modeOrU8) : MODES[modeOrU8];
    const n = mode.requiredPlayers;
    let rake: number;
    if (levels && levels.length >= n) {
        const stakePerPlayer = Math.floor(potLamports / n);
        rake = 0;
        for (let i = 0; i < n; i++) {
            rake += Math.floor((stakePerPlayer * rakeBpsForLevel(levels[i])) / BPS_DENOM);
        }
    } else {
        rake = Math.floor((potLamports * RAKE_BPS) / BPS_DENOM);
    }
    const distributable = Math.max(0, potLamports - rake);
    const indexed: { slot: number; h: number }[] = [];
    for (let i = 0; i < n; i++) indexed.push({ slot: i, h: heights[i] ?? 0 });
    indexed.sort((a, b) => b.h - a.h); // descending

    const sortedSlots = indexed.map((x) => x.slot);
    const winnerSlots: number[] = [];
    const winnerLamports: number[] = [];
    for (let rank = 0; rank < mode.payoutBps.length; rank++) {
        const bps = mode.payoutBps[rank];
        const lamports = Math.floor((distributable * bps) / BPS_DENOM);
        winnerSlots.push(indexed[rank].slot);
        winnerLamports.push(lamports);
    }
    console.log(`${TAG} computeModePayout | mode=${mode.id} pot=${potLamports} rake=${rake} sorted_slots=[${sortedSlots.join(',')}] winner_lamports=[${winnerLamports.join(',')}]`);
    return {
        sortedSlots,
        winnerSlots,
        winnerLamports,
        toTreasuryLamports: rake,
        potLamports,
    };
}

/** XP for a given 0-indexed placement under a given mode. */
export function xpForPlacement(modeOrU8: ModeId | number, rank: number): number {
    const mode = typeof modeOrU8 === 'number' ? modeFromU8(modeOrU8) : MODES[modeOrU8];
    const table = mode.xpTable;
    if (rank < table.length) return table[rank];
    return table[table.length - 1];
}

/**
 * Stage 3 XP curve: floor(500 * (n-1) * (2n+3) / 2) = 250 * (n-1) * (2n+3)
 * Matches `xp_for_level` in `programs/token-duel/src/state.rs`.
 *
 * Thresholds:
 *   L1=0, L2=1750, L3=4500, L4=8250, L5=13000, L6=18750, L7=25500,
 *   L8=33250, L9=42000, L10=51750.
 */
export function xpForLevel(n: number): number {
    if (n <= 0) return 0;
    if (n === 1) return 0;
    return 250 * (n - 1) * (2 * n + 3);
}

/** Returns highest N where xpForLevel(N) ≤ xp. xp=0 → L1. */
export function levelFromXp(xp: number): number {
    if (!Number.isFinite(xp) || xp < 0) return 1;
    let n = 0;
    while (true) {
        const next = n + 1;
        if (xpForLevel(next) > xp) return Math.max(1, n);
        n = next;
        if (n >= 65535) return n; // cap at u16 bound
    }
}

/** Progress to next level as 0..1 + amount needed. */
export function levelProgress(xp: number): { level: number; progress: number; toNext: number } {
    const lvl = levelFromXp(xp);
    const atLevel = xpForLevel(lvl);
    const toLevel = xpForLevel(lvl + 1);
    const progress = toLevel > atLevel ? (xp - atLevel) / (toLevel - atLevel) : 0;
    return { level: lvl, progress, toNext: toLevel - xp };
}

/**
 * Stage 5 - payoutPreview: returns rake-honest per-rank lamports for a given
 * mode + wager tier + level, accounting for the 5%→3% rake taken from the
 * full pot before split. Used to power the JoinMatchConfirmOverlay copy +
 * ModePicker readouts so users see real take-home, not gross pot %.
 *
 * Returns:
 *   first  - lamports won by 1st place
 *   second - lamports won by 2nd place (0 for 1v1 / Trio)
 *   third  - lamports won by 3rd place (0 for 1v1 / Trio / 4p)
 *   rake   - total rake withheld (informational)
 *   pot    - total pot (informational)
 *
 * Assumes uniform level across all players (uses `level` for per-player rake
 * estimate). Real splits can vary because rake_bps_for_level reads each
 * player's level individually; this is a single-player preview.
 */
export function payoutPreview(
    mode: ModeDef,
    wagerLamports: number,
    level: number,
): { first: number; second: number; third: number; rake: number; pot: number } {
    const players = mode.requiredPlayers;
    const pot = wagerLamports * players;
    const rakeBps = rakeBpsForLevel(level);
    const rake = Math.floor((pot * rakeBps) / BPS_DENOM);
    const distributable = pot - rake;
    const split = (rank: number) => {
        const bps = mode.payoutBps[rank] ?? 0;
        return Math.floor((distributable * bps) / BPS_DENOM);
    };
    return {
        first: split(0),
        second: split(1),
        third: split(2),
        rake,
        pot,
    };
}
