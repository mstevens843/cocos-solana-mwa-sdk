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

/**
 * ModeId — Stage 3 rebalance (2026-04-25):
 *   modeU8=0: oneVone     (2p, unchanged)
 *   modeU8=1: trio        (3p, NEW — replaces former fourPlayer slot)
 *   modeU8=2: fourPlayer  (4p, slid down from u8=1)
 *   modeU8=3: eightPlayer (8p, slid down from u8=2; former battleRoyale retired)
 *
 * Mirrors `programs/token-duel/src/state.rs::GameMode`. Stage 4 redeploy
 * is required for old devnet matches with stale required_players.
 */
export type ModeId = 'oneVone' | 'trio' | 'fourPlayer' | 'eightPlayer';

export interface ModeDef {
    id: ModeId;
    modeU8: number;                 // on-chain enum byte (must match GameMode in state.rs)
    label: string;
    shortLabel: string;
    requiredPlayers: number;
    /** Payout bps per rank. Sum ≤ 10_000. Unranked slots get 0. */
    payoutBps: number[];
    /**
     * XP table per rank — BASE values (NOT including track multiplier).
     * For Real-track on-chain awards, the on-chain `xp_table()` already has
     * the 2.0× multiplier baked in (returns 200/350/500/1000 for 1st place).
     * Client uses these BASE values + applies multiplier per track:
     *   Bot Match    × 0.5
     *   Paper-Real   × 1.0
     *   Real (SOL)   × 2.0   ← on-chain table also returns this final value
     */
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
        xpTable: [100, 0],
        xpWin: 100,
        xpLoss: 0,
        payoutPct: [100],
    },
    trio: {
        id: 'trio',
        modeU8: 1,
        label: 'Trio · 1v1v1',
        shortLabel: 'Trio',
        requiredPlayers: 3,
        payoutBps: [10_000],
        xpTable: [175, 0, 0],
        xpWin: 175,
        xpLoss: 0,
        payoutPct: [100],
    },
    fourPlayer: {
        id: 'fourPlayer',
        modeU8: 2,
        label: '4p FFA',
        shortLabel: '4p',
        requiredPlayers: 4,
        payoutBps: [7_500, 2_500],
        xpTable: [250, 80, 0, 0],
        xpWin: 250,
        xpLoss: 0,
        payoutPct: [75, 25],
    },
    eightPlayer: {
        id: 'eightPlayer',
        modeU8: 3,
        label: 'Battle Royale',
        shortLabel: '8p',
        requiredPlayers: 8,
        payoutBps: [6_250, 2_500, 1_250],
        xpTable: [500, 125, 65, 0, 0, 0, 0, 0],
        xpWin: 500,
        xpLoss: 0,
        payoutPct: [62.5, 25, 12.5],
    },
};

/** Reverse lookup — resolve modeU8 byte → ModeDef. */
export function modeFromU8(b: number): ModeDef {
    if (b === 0) return MODES.oneVone;
    if (b === 1) return MODES.trio;
    if (b === 2) return MODES.fourPlayer;
    if (b === 3) return MODES.eightPlayer;
    return MODES.oneVone;
}

/** Track-XP multipliers — applied client-side to base XP table (Stage 3). */
export const TRACK_XP_MULTIPLIER: Record<'bot' | 'paper-real' | 'real', number> = {
    bot: 0.5,           // paper · vs bots · free practice
    'paper-real': 1.0,  // paper · PvP, no SOL
    real: 2.0,          // SOL on-chain
};

/** Wager tier lamports, indexed 0-7. Mirrors WAGER_TIERS in state.rs.
 *  Indices 6-7 added on betting-duel branch (1 SOL, 5 SOL high-stakes). */
export const WAGER_TIERS_LAMPORTS: number[] = [
    10_000_000,    // 0.01 SOL
    50_000_000,    // 0.05 SOL
    100_000_000,   // 0.1 SOL
    250_000_000,   // 0.25 SOL
    500_000_000,   // 0.5 SOL
    1_000_000,     // 0.001 SOL — INTRO tier (Part 11)
    1_000_000_000, // 1 SOL — betting-duel
    5_000_000_000, // 5 SOL — betting-duel
];

export const WAGER_TIERS_LABELS: string[] = [
    '0.01 SOL',
    '0.05 SOL',
    '0.1 SOL',
    '0.25 SOL',
    '0.5 SOL',
    '0.001 · INTRO',
    '1 SOL',
    '5 SOL',
];

/**
 * WagerDropdownRow_N display index → on-chain tier index.
 * The dropdown renders tiers in ascending $$ order with INTRO pinned to the
 * bottom (user preference), while the on-chain tier index for INTRO remains
 * 5 for wire-compat. `AppUI._onWagerRowTap` uses this lookup.
 * Display order:  0.01 / 0.05 / 0.1 / 0.25 / 0.5 / 1 / 5 / INTRO
 * On-chain idx :    0  /   1  /  2  /  3   /  4  / 6 / 7 /   5
 */
export const WAGER_DISPLAY_TO_TIER: readonly number[] = [0, 1, 2, 3, 4, 6, 7, 5];

/** 3% rake (in basis points). Must match RAKE_BPS in state.rs. */
export const RAKE_BPS = 300;
export const BPS_DENOM = 10_000;

/** Match waiting timeout before anyone can cancel + refund. Mirrors state.rs.
 *  Phase D bumped 120_000 → 86_400_000 (24h). The Anchor program enforces
 *  the same constant — early cancel by the lone creator is allowed via the
 *  `cancel_match` Branch B path even before this timeout elapses. */
export const MATCH_WAIT_TIMEOUT_MS = 86_400_000;

/** Starting bot-handicap games for a new player. Mirrors BOT_HANDICAP_GAMES. */
export const BOT_HANDICAP_GAMES = 5;

/** Bot handicap height multiplier — bot height = raw × 0.7 during first N games. */
export const BOT_HANDICAP_MULTIPLIER = 0.7;

/** Phase E — per-difficulty height multiplier applied to bot delta in
 *  paper matches. Stacks with BOT_HANDICAP_MULTIPLIER for new players. */
export const BOT_DIFFICULTY_MULTIPLIERS: Record<'easy' | 'medium' | 'hard', number> = {
    easy: 0.7,
    medium: 1.0,
    hard: 1.15,
};

/**
 * Phase J1 — streak-based XP bonus tiers (client display only on first
 * deploy). When the player's `currentStreak` matches or exceeds a tier,
 * multiplier applies to xpForPlacement to surface the bonus on PostMatch.
 *
 * Onchain XP is awarded by the program WITHOUT this multiplier today; the
 * UI shows what XP would-be-with-streak-bonus alongside the actual award.
 * Phase K will move enforcement onchain via a state.rs constant.
 */
export interface StreakBonusTier {
    minStreak: number;
    multiplier: number;
}
export const STREAK_BONUS_TABLE: StreakBonusTier[] = [
    { minStreak: 10, multiplier: 1.35 },
    { minStreak: 6,  multiplier: 1.20 },
    { minStreak: 3,  multiplier: 1.10 },
];

/** Returns the multiplier for a given streak count. Defaults to 1.0. */
export function streakBonusFor(currentStreak: number): number {
    for (const tier of STREAK_BONUS_TABLE) {
        if (currentStreak >= tier.minStreak) return tier.multiplier;
    }
    return 1.0;
}

// ═══════════════════════════════════════════════════════════════════
// Part 9 — Time-window axis (originally 1h / 1d / 3d / 7d Birdeye delta)
// REPURPOSED ON betting-duel BRANCH (Phase 5):
//   The on-chain `time_window` u8 and the four TimeWindowId members
//   remain unchanged for wire-compat, but the UI + durationMs values
//   now represent **match duration** (how long the portfolio race
//   runs) rather than a Birdeye-delta snapshot window. Label strings
//   are what the user sees; the ID '1h' is now historical/internal.
//
//     ID '1h' → label '30s' → 30s race (u8=0, default)
//     ID '1d' → label '1m'  → 60s race (u8=1)
//     ID '3d' → label '5m'  → 5m race  (u8=2)
//     ID '7d' → label '1h'  → 1h race  (u8=3)
//
//   `birdeyeTypeParam` is kept on the struct for legacy callers of
//   PriceFeed.setTimeframe() but is unused by PortfolioRace
//   (getSpotPrices consumes `priceUsd`, independent of delta window).
// ═══════════════════════════════════════════════════════════════════

export type TimeWindowId = '1h' | '1d' | '3d' | '7d';

export interface TimeWindowDef {
    id: TimeWindowId;
    windowU8: number;
    label: string;
    /** Value passed as `type` to Birdeye's `/defi/price_volume/multi`. Unused by PortfolioRace. */
    birdeyeTypeParam: string;
    /** Match duration in ms — how long the betting-duel race runs before settle. */
    durationMs: number;
}

export const TIME_WINDOWS: Record<TimeWindowId, TimeWindowDef> = {
    '1h': { id: '1h', windowU8: 0, label: '30s', birdeyeTypeParam: '1h',  durationMs:    30_000 },
    '1d': { id: '1d', windowU8: 1, label: '1m',  birdeyeTypeParam: '24h', durationMs:    60_000 },
    '3d': { id: '3d', windowU8: 2, label: '5m',  birdeyeTypeParam: '3d',  durationMs:   300_000 },
    '7d': { id: '7d', windowU8: 3, label: '1h',  birdeyeTypeParam: '7d',  durationMs: 3_600_000 },
};

/** Default to the shortest race for rapid iteration during testing. */
export const DEFAULT_TIME_WINDOW: TimeWindowId = '1h';

/** Reverse lookup — resolve windowU8 byte → TimeWindowDef. */
export function timeWindowFromU8(b: number): TimeWindowDef {
    if (b === 0) return TIME_WINDOWS['1h'];
    if (b === 1) return TIME_WINDOWS['1d'];
    if (b === 2) return TIME_WINDOWS['3d'];
    if (b === 3) return TIME_WINDOWS['7d'];
    return TIME_WINDOWS['1d'];
}
