/**
 * RealStats.ts - thin wrapper over `UserStatsRpc` for the Portfolio Real tab.
 *
 * Session D Part 2: returns a shape compatible with what Part 3 will hydrate,
 * but currently reports zero for everything (real on-chain flow not wired
 * end-to-end yet). Portfolio Real tab shows "-" values.
 *
 * Part 3 will replace `load()` with a real call to `UserStatsRpc.getUserStats`.
 */

import { getUserStats, UserStatsState, xpBucketFor } from './UserStatsRpc';
import { TokenDuelRpc } from './TokenDuelRpc';
import {
    NATIVE_SOL_MINT_BASE58,
    skrMintForCluster,
} from './WagerCurrency';
import type { MatchHistoryItem } from './MatchHistoryDbRpc';

const TAG = '[RealStats]';

export interface RealStatsRecord {
    games: number;
    wins: number;
    losses: number;
    profitLamports: number;        // SOL-only P/L from the on-chain UserStats PDA.
    /** SKR P/L in atoms (10^-6 SKR). Always 0 from `loadRealStats` - the PDA
     *  doesn't track SKR. Populated by `aggregateRealStatsFromHistory` after
     *  the off-chain match_history table resolves. */
    profitSkrAtoms: number;
    xp: number;
    level: number;
    xpBucket: number;
    loaded: boolean; // false = not yet init'd on-chain OR RPC unavailable
}

const EMPTY: RealStatsRecord = {
    games: 0, wins: 0, losses: 0, profitLamports: 0, profitSkrAtoms: 0,
    xp: 0, level: 0, xpBucket: 0, loaded: false,
};

/**
 * Load real-mode stats for a player. Returns EMPTY-but-loaded when no PDA
 * exists yet (user hasn't played a real match).
 */
export async function loadRealStats(rpc: TokenDuelRpc, playerBase58: string): Promise<RealStatsRecord> {
    console.log(`${TAG} loadRealStats | START player=${playerBase58}`);
    if (!playerBase58) return { ...EMPTY };
    const pda = await getUserStats(rpc, playerBase58).catch((e) => {
        console.log(`${TAG} loadRealStats | ERROR error=${e}`);
        return null as UserStatsState | null;
    });
    if (!pda) {
        console.log(`${TAG} loadRealStats | NOT_INITIALIZED player=${playerBase58} - returning empty`);
        return { ...EMPTY, loaded: false };
    }
    const rec: RealStatsRecord = {
        games: pda.gamesPlayed,
        wins: pda.wins,
        losses: pda.losses,
        profitLamports: Number(pda.profitLamports),
        profitSkrAtoms: 0,
        xp: Number(pda.xp),
        level: pda.level,
        xpBucket: xpBucketFor(pda.xp),
        loaded: true,
    };
    console.log(`${TAG} loadRealStats | DONE games=${rec.games} wins=${rec.wins} losses=${rec.losses} xp=${rec.xp} level=${rec.level}`);
    return rec;
}

export interface PerCurrencyAggregate {
    /** Sum of (player_payout − player_wager) across all SOL real matches. */
    solProfitLamports: number;
    /** Sum of (player_payout − player_wager) across all SKR real matches. */
    skrProfitAtoms: number;
    /** Match counts per currency. Currently informational; subtitle still
     *  reports the all-currencies total to match the existing copy. */
    solMatches: number;
    skrMatches: number;
    /** Rows whose `wager_mint` is empty (pre-006 history) or matches neither
     *  the SOL nor the SKR mint. Excluded from both aggregates. */
    skippedRows: number;
}

/**
 * Aggregate per-player real-mode P/L from off-chain `match_history` rows,
 * split by wager currency. Caller filters to settled (status=2) rows;
 * cancelled matches refund 100% so they net to 0 anyway.
 */
export function aggregateRealStatsFromHistory(
    items: MatchHistoryItem[],
    playerPubkey: string,
): PerCurrencyAggregate {
    const skrMint = skrMintForCluster();
    let solProfitLamports = 0;
    let skrProfitAtoms = 0;
    let solMatches = 0;
    let skrMatches = 0;
    let skippedRows = 0;
    for (const m of items) {
        if (m.status !== 2) continue; // ignore cancelled/refunded
        const myPayout = (m.payouts_json ?? []).find((p) => p.pubkey === playerPubkey);
        const wager = Number(m.wager_lamports ?? 0);
        const payout = Number(myPayout?.lamports ?? 0);
        const delta = payout - wager;
        if (m.wager_mint === NATIVE_SOL_MINT_BASE58) {
            solProfitLamports += delta;
            solMatches += 1;
        } else if (m.wager_mint === skrMint && skrMint.length > 0) {
            skrProfitAtoms += delta;
            skrMatches += 1;
        } else {
            skippedRows += 1;
        }
    }
    return { solProfitLamports, skrProfitAtoms, solMatches, skrMatches, skippedRows };
}
