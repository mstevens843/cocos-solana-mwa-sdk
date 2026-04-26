/**
 * MatchTickerRpc.ts — Part 12 Bundle C.
 *
 * Fetches "recent, interesting" matches so the HomeMatchTicker can rotate
 * through them: Waiting matches (people haven't started yet — joinable!)
 * and recently-Active matches (currently in progress — watchable).
 *
 * Uses a single `getProgramAccounts` call with a `dataSize` filter fixed to
 * `8 + 411 = 419` bytes — the Part 9 MatchAccount layout. No other program
 * account type matches that size, so the filter uniquely selects matches
 * without needing the account discriminator.
 *
 * The client polls every 30s (RPC-cheap at devnet scale) and the AppUI
 * rotates the displayed line every 6s from the cached list.
 */

import { TokenDuelRpc } from './TokenDuelRpc';
import { PROGRAM_ID, getTournamentHostPubkey } from './constants';
import { MODES, WAGER_TIERS_LAMPORTS } from './ModeDefs';
import { parseMatchAccount } from './MatchRpc';

const TAG = '[MatchTickerRpc]';

/** MatchAccount on-chain data size (8 disc + 411 struct). */
const MATCH_ACCOUNT_DATA_SIZE = 8 + 411;

export interface MatchTickerEntry {
    pda: string;
    status: number;          // 0=Waiting, 1=Active, 2=Settled, 3=Cancelled
    mode: number;
    wagerTier: number;
    timeWindow: number;
    playerCount: number;
    requiredPlayers: number;
    createdAt: bigint;       // unix sec
    startedAt: bigint;
    /** Derived: wager_lamports / 1e9 rounded to 3 dp. */
    wagerSol: number;
    /** Derived: short-hash for display. */
    shortPda: string;
    /** Part 14: true when players[0] == TOURNAMENT_HOST_PUBKEY. */
    isTournament: boolean;
}

const b64ToBytes = (b64: string): Uint8Array => {
    if (typeof atob === 'function') {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    const B: any = (globalThis as any).Buffer;
    if (B) return new Uint8Array(B.from(b64, 'base64'));
    throw new Error('no base64 decoder');
};

/**
 * Return up to `limit` recent matches ordered by created_at descending.
 * Only includes status == Waiting (0) or Active (1).
 */
export async function fetchRecentMatches(
    rpc: TokenDuelRpc,
    limit: number = 10,
): Promise<MatchTickerEntry[]> {
    try {
        const raw = await rpc.getProgramAccounts(PROGRAM_ID, [
            { dataSize: MATCH_ACCOUNT_DATA_SIZE },
        ]);
        const parsed = raw
            .map((r) => ({ state: parseMatchAccount(r.pubkey, b64ToBytes(r.dataBase64)), pda: r.pubkey }))
            .filter((x): x is { state: NonNullable<ReturnType<typeof parseMatchAccount>>; pda: string } => x.state !== null)
            .filter((x) => x.state.status === 0 || x.state.status === 1)
            .sort((a, b) => Number(b.state.createdAt - a.state.createdAt))
            .slice(0, limit);
        const hostPk = getTournamentHostPubkey();
        const entries: MatchTickerEntry[] = parsed.map(({ state, pda }) => ({
            pda,
            status: state.status,
            mode: state.mode,
            wagerTier: state.wagerTier,
            timeWindow: state.timeWindow,
            playerCount: state.playerCount,
            requiredPlayers: state.requiredPlayers,
            createdAt: state.createdAt,
            startedAt: state.startedAt,
            wagerSol: Number(state.wagerLamports) / 1e9,
            shortPda: pda.length > 10 ? `${pda.slice(0, 4)}…${pda.slice(-4)}` : pda,
            isTournament: !!hostPk && state.players[0] === hostPk,
        }));
        console.log(`${TAG} fetchRecentMatches | raw=${raw.length} parsed=${entries.length}`);
        return entries;
    } catch (e) {
        console.log(`${TAG} fetchRecentMatches | ERROR ${e}`);
        return [];
    }
}

/** UX overhaul: IconLibrary key for the ticker row's status badge. */
export type TickerIconName = 'sword' | 'clock' | 'bolt';
export function tickerStatusIcon(entry: MatchTickerEntry): TickerIconName {
    if (entry.isTournament) return 'sword';
    return entry.status === 0 ? 'clock' : 'bolt';
}

/** Format one ticker line for display (text-only — caller pairs with tickerStatusIcon).
 *  Example: "4p Pot · 2/4 joined · 0.05 SOL · 1h · 42s ago"
 *  Tournament variant (Part 14): "TOURNAMENT · 4/10 joined · 0.001 SOL · 24h · 42s ago"
 */
export function formatTickerLine(entry: MatchTickerEntry, nowSec: number): string {
    // Stage 3 modeU8: 0=1v1, 1=Trio, 2=4p, 3=8p.
    const modeKey = (['oneVone', 'trio', 'fourPlayer', 'eightPlayer'][entry.mode] ?? 'oneVone') as keyof typeof MODES;
    const modeLabel = entry.isTournament ? 'TOURNAMENT' : (MODES[modeKey]?.shortLabel ?? '1v1');
    const windowLabel = ['1h', '24h', '3d', '7d'][entry.timeWindow] ?? '24h';
    const elapsedSec = Math.max(0, nowSec - Number(entry.createdAt));
    const ago = elapsedSec < 60
        ? `${elapsedSec}s ago`
        : elapsedSec < 3600
            ? `${Math.floor(elapsedSec / 60)}m ago`
            : `${Math.floor(elapsedSec / 3600)}h ago`;
    return `${modeLabel} · ${entry.playerCount}/${entry.requiredPlayers} joined · ${entry.wagerSol.toFixed(3)} SOL · ${windowLabel} · ${ago}`;
}

/**
 * Part 14: fetch any currently-open tournament match. Returns at most one
 * entry — only one tournament is active at a time by design.
 *
 * Uses `fetchRecentMatches` + client-side filter on `isTournament` (which
 * is set when players[0] matches TOURNAMENT_HOST_PUBKEY). Could memcmp
 * on the 32-byte offset within the struct, but the additional RPC roundtrip
 * vs the existing broad fetch isn't worth it at current devnet scale.
 */
export async function fetchUpcomingTournaments(
    rpc: TokenDuelRpc,
): Promise<MatchTickerEntry[]> {
    if (!getTournamentHostPubkey()) return [];
    const all = await fetchRecentMatches(rpc, 30);
    return all.filter((e) => e.isTournament);
}

