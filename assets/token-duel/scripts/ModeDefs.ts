/**
 * ModeDefs.ts — game-mode constants + wager tiers + XP table.
 *
 * Mirrors `programs/token-duel/src/state.rs`:
 *   - GameMode enum (OneVOne = 0 shipped; others reserved)
 *   - WAGER_TIERS = [0.01, 0.05, 0.1, 0.25, 0.5] SOL
 *   - Rake BPS = 300 (3%)
 *   - XP per win/loss per mode
 *
 * Any change here MUST mirror in state.rs or payouts diverge.
 */

export type ModeId = 'oneVone' | 'fourPlayer' | 'eightPlayer' | 'battleRoyale';

export interface ModeDef {
    id: ModeId;
    modeU8: number;                 // on-chain enum byte (must match GameMode in state.rs)
    label: string;
    shortLabel: string;
    requiredPlayers: number;
    /** Payout bps per rank. Sum ≤ 10_000. Unranked slots get 0. */
    payoutBps: number[];
    /** XP table, one entry per rank. Unranked slots tail to `xpTable[last]`. */
    xpTable: number[];
    /** Back-compat convenience. */
    xpWin: number;
    xpLoss: number;
    /** Payout percentages for display. Derived from payoutBps / 100. */
    payoutPct: number[];
}

export const MODES: Record<ModeId, ModeDef> = {
    oneVone: {
        id: 'oneVone',
        modeU8: 0,
        label: '1v1 Duel',
        shortLabel: '1v1',
        requiredPlayers: 2,
        payoutBps: [10_000],
        xpTable: [100, 25],
        xpWin: 100,
        xpLoss: 25,
        payoutPct: [100],
    },
    fourPlayer: {
        id: 'fourPlayer',
        modeU8: 1,
        label: '4p Pot',
        shortLabel: '4p',
        requiredPlayers: 4,
        payoutBps: [7_000, 3_000],
        xpTable: [100, 60, 30, 15],
        xpWin: 100,
        xpLoss: 15,
        payoutPct: [70, 30],
    },
    eightPlayer: {
        id: 'eightPlayer',
        modeU8: 2,
        label: '8p Pot',
        shortLabel: '8p',
        requiredPlayers: 8,
        payoutBps: [5_000, 3_000, 2_000],
        xpTable: [150, 80, 60, 40, 20, 20, 20, 20],
        xpWin: 150,
        xpLoss: 20,
        payoutPct: [50, 30, 20],
    },
    battleRoyale: {
        id: 'battleRoyale',
        modeU8: 3,
        label: 'Battle Royale',
        shortLabel: 'BR10',
        requiredPlayers: 10,
        payoutBps: [5_000, 2_500, 1_500, 1_000],
        xpTable: [200, 100, 70, 40, 10, 10, 10, 10, 10, 10],
        xpWin: 200,
        xpLoss: 10,
        payoutPct: [50, 25, 15, 10],
    },
};

/** Reverse lookup — resolve modeU8 byte → ModeDef. */
export function modeFromU8(b: number): ModeDef {
    if (b === 0) return MODES.oneVone;
    if (b === 1) return MODES.fourPlayer;
    if (b === 2) return MODES.eightPlayer;
    if (b === 3) return MODES.battleRoyale;
    return MODES.oneVone;
}

/** Wager tier lamports, indexed 0-5. Mirrors WAGER_TIERS in state.rs.
 *  Index 5 is the Part 11 "intro" tier — appended at end so pre-Part-11
 *  Match PDAs with `wager_tier: 0..4` stay valid without migration. */
export const WAGER_TIERS_LAMPORTS: number[] = [
    10_000_000,    // 0.01 SOL
    50_000_000,    // 0.05 SOL
    100_000_000,   // 0.1 SOL
    250_000_000,   // 0.25 SOL
    500_000_000,   // 0.5 SOL
    1_000_000,     // 0.001 SOL — INTRO tier (Part 11)
];

export const WAGER_TIERS_LABELS: string[] = [
    '0.01 SOL',
    '0.05 SOL',
    '0.1 SOL',
    '0.25 SOL',
    '0.5 SOL',
    '0.001 · INTRO',
];

/** 3% rake (in basis points). Must match RAKE_BPS in state.rs. */
export const RAKE_BPS = 300;
export const BPS_DENOM = 10_000;

/** Match waiting timeout before anyone can cancel + refund. Mirrors state.rs. */
export const MATCH_WAIT_TIMEOUT_MS = 120_000;

/** Starting bot-handicap games for a new player. Mirrors BOT_HANDICAP_GAMES. */
export const BOT_HANDICAP_GAMES = 5;

/** Bot handicap height multiplier — bot height = raw × 0.7 during first N games. */
export const BOT_HANDICAP_MULTIPLIER = 0.7;

// ═══════════════════════════════════════════════════════════════════
// Part 9 — Time-window axis (1h / 1d / 3d / 7d)
// Mirrors `TimeWindow` enum in state.rs. The window is threaded through
// join_match_create so all players in a match see the same price-delta
// basis; it also gates matchmaking (you only meet players on the same
// window) and picks which `type` param we send to Birdeye.
// ═══════════════════════════════════════════════════════════════════

export type TimeWindowId = '1h' | '1d' | '3d' | '7d';

export interface TimeWindowDef {
    id: TimeWindowId;
    windowU8: number;
    label: string;
    /** Value passed as `type` to Birdeye's `/defi/price_volume/multi`. */
    birdeyeTypeParam: string;
    /** Approx window duration in ms — handy for future "session freshness" hints. */
    durationMs: number;
}

export const TIME_WINDOWS: Record<TimeWindowId, TimeWindowDef> = {
    '1h': { id: '1h', windowU8: 0, label: '1h',  birdeyeTypeParam: '1h',  durationMs: 3_600_000 },
    '1d': { id: '1d', windowU8: 1, label: '24h', birdeyeTypeParam: '24h', durationMs: 86_400_000 },
    '3d': { id: '3d', windowU8: 2, label: '3d',  birdeyeTypeParam: '3d',  durationMs: 259_200_000 },
    '7d': { id: '7d', windowU8: 3, label: '7d',  birdeyeTypeParam: '7d',  durationMs: 604_800_000 },
};

/** Default to the pre-Part-9 behavior (24h delta). */
export const DEFAULT_TIME_WINDOW: TimeWindowId = '1d';

/** Reverse lookup — resolve windowU8 byte → TimeWindowDef. */
export function timeWindowFromU8(b: number): TimeWindowDef {
    if (b === 0) return TIME_WINDOWS['1h'];
    if (b === 1) return TIME_WINDOWS['1d'];
    if (b === 2) return TIME_WINDOWS['3d'];
    if (b === 3) return TIME_WINDOWS['7d'];
    return TIME_WINDOWS['1d'];
}
