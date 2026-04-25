/**
 * VettedMints.ts — Part 10 Bundle 2.
 *
 * A hand-curated 20-mint safelist of tokens known to be liquid, legitimate,
 * and vaguely fun to play with. Used as a Quick-Play fallback when Birdeye
 * is unreachable, and as the source of the Suggested Squad's backup set
 * when the current window has no gainers data yet.
 *
 * NEVER auto-rug a new player: we only ship established tokens here. Add
 * new entries conservatively — one bad rug in this list torpedoes trust.
 */

export interface VettedMint {
    mint: string;
    symbol: string;
    decimals: number;
    logoUri?: string;
}

export const VETTED_MINTS: VettedMint[] = [
    // Stablecoins (wide spread = predictable 24h delta)
    { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
    { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', decimals: 6 },

    // SOL LSTs
    { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', symbol: 'JitoSOL', decimals: 9 },
    { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  symbol: 'mSOL',   decimals: 9 },
    { mint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',  symbol: 'bSOL',   decimals: 9 },

    // Top memecoins
    { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 },
    { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF',  decimals: 6 },
    { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', decimals: 9 },
    { mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',   symbol: 'MEW',  decimals: 5 },
    { mint: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',    symbol: 'WEN',  decimals: 5 },
    { mint: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',   symbol: 'BOME', decimals: 6 },
    { mint: 'CATSH1XzEKmDU3TrCWXr4pFcrt7KCfrKAbTXQLHXpump',  symbol: 'CATS', decimals: 6 },

    // Protocol / governance tokens
    { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  symbol: 'JUP',  decimals: 6 },
    { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', decimals: 6 },
    { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY',  decimals: 6 },
    { mint: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', symbol: 'W',    decimals: 6 },
    { mint: 'DBRiDgJAMu3KJL5kRh7s1h4jrM11ntPQm8WqHKSQFcWG', symbol: 'DBR',  decimals: 6 },
    { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',  symbol: 'ORCA', decimals: 6 },
    { mint: 'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6',  symbol: 'TNSR', decimals: 9 },
    { mint: 'J3dxNj7nDRRqRRXuEMynDG57DkZK4jYRuv3Garmb1i99', symbol: 'KMNO', decimals: 6 },
];

/**
 * Pull 3 random vetted mints with no duplicates. Used when Birdeye gainers
 * are unreachable; produces a boring-but-safe squad rather than failing.
 */
export function randomVettedTrio(): [VettedMint, VettedMint, VettedMint] {
    const shuffled = VETTED_MINTS.slice().sort(() => Math.random() - 0.5);
    return [shuffled[0], shuffled[1], shuffled[2]];
}

// ═══════════════════════════════════════════════════════════════════
// Phase E — Bot difficulty universes.
//
// Easy   → STABLE_BLUECHIP_MINTS (low-vol, predictable deltas).
// Medium → VETTED_MINTS (the full safelist above; current behavior).
// Hard   → getMomentumMints() pulls live Birdeye 24h gainers; falls back
//          to VETTED_MINTS if Birdeye is unreachable.
//
// Mints are referenced by symbol against VETTED_MINTS to avoid duplication.
// ═══════════════════════════════════════════════════════════════════

/** Easy universe — stables + LSTs + bluechip protocol tokens. Low vol. */
export const STABLE_BLUECHIP_SYMBOLS = ['USDC', 'USDT', 'JitoSOL', 'mSOL', 'bSOL', 'JUP', 'RAY', 'ORCA'];

export const STABLE_BLUECHIP_MINTS: VettedMint[] = VETTED_MINTS.filter(
    (m) => STABLE_BLUECHIP_SYMBOLS.includes(m.symbol),
);

/** Pick 3 stable/bluechip mints. Used by Easy bots. */
export function randomEasyTrio(): [VettedMint, VettedMint, VettedMint] {
    const pool = STABLE_BLUECHIP_MINTS.length >= 3 ? STABLE_BLUECHIP_MINTS : VETTED_MINTS;
    const shuffled = pool.slice().sort(() => Math.random() - 0.5);
    return [shuffled[0], shuffled[1], shuffled[2]];
}

/** Bot difficulty knob used by SquadBot to pick a token universe. */
export type BotDifficulty = 'easy' | 'medium' | 'hard';

/**
 * Hard universe — pulled live from Birdeye gainers by AppUI before kicking
 * a Hard bot match, then handed to SquadBot via this snapshot. If empty or
 * malformed, randomTrioForDifficulty falls back to VETTED_MINTS so a paper
 * match never fails on a network blip.
 */
export function randomHardTrio(snapshot: VettedMint[]): [VettedMint, VettedMint, VettedMint] {
    const pool = snapshot.length >= 3 ? snapshot : VETTED_MINTS;
    const shuffled = pool.slice().sort(() => Math.random() - 0.5);
    return [shuffled[0], shuffled[1], shuffled[2]];
}

/** Single dispatch for SquadBot. Pass `gainersSnapshot` only on Hard. */
export function randomTrioForDifficulty(
    difficulty: BotDifficulty,
    gainersSnapshot?: VettedMint[],
): [VettedMint, VettedMint, VettedMint] {
    if (difficulty === 'easy') return randomEasyTrio();
    if (difficulty === 'hard') return randomHardTrio(gainersSnapshot ?? []);
    return randomVettedTrio();
}
