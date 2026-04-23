/**
 * RealStats.ts — thin wrapper over `UserStatsRpc` for the Portfolio Real tab.
 *
 * Session D Part 2: returns a shape compatible with what Part 3 will hydrate,
 * but currently reports zero for everything (real on-chain flow not wired
 * end-to-end yet). Portfolio Real tab shows "—" values.
 *
 * Part 3 will replace `load()` with a real call to `UserStatsRpc.getUserStats`.
 */

import { getUserStats, UserStatsState, xpBucketFor } from './UserStatsRpc';
import { TokenDuelRpc } from './TokenDuelRpc';

const TAG = '[RealStats]';

export interface RealStatsRecord {
    games: number;
    wins: number;
    losses: number;
    profitLamports: number;
    xp: number;
    level: number;
    xpBucket: number;
    loaded: boolean; // false = not yet init'd on-chain OR RPC unavailable
}

const EMPTY: RealStatsRecord = {
    games: 0, wins: 0, losses: 0, profitLamports: 0,
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
        console.log(`${TAG} loadRealStats | NOT_INITIALIZED player=${playerBase58} — returning empty`);
        return { ...EMPTY, loaded: false };
    }
    const rec: RealStatsRecord = {
        games: pda.gamesPlayed,
        wins: pda.wins,
        losses: pda.losses,
        profitLamports: Number(pda.profitLamports),
        xp: Number(pda.xp),
        level: pda.level,
        xpBucket: xpBucketFor(pda.xp),
        loaded: true,
    };
    console.log(`${TAG} loadRealStats | DONE games=${rec.games} wins=${rec.wins} losses=${rec.losses} xp=${rec.xp} level=${rec.level}`);
    return rec;
}
