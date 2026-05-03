/**
 * MatchHistoryDbRpc.ts - DB Stage 4 client for the backend `match_history` table.
 *
 * Two ops:
 *   - `postMatchRecord` - fire-and-forget after settle to persist the row.
 *   - `listMatchHistory` - pulls per-player history for the Portfolio panel.
 *
 * Coexists with `MatchHistoryRpc.ts` (the on-chain tx-log scanner). DB-backed
 * lookups are faster (one query vs N getTransaction calls) and survive when
 * RPC providers throttle. Falls back to MatchHistoryRpc when backend offline.
 *
 * Backend is idempotent on matchPda - both winner and loser can post without
 * doubling counts. Posting from EVERY participant adds resilience: if one
 * client crashes between settle and post, the other completes the record.
 */
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[MatchHistoryDbRpc]';

export interface MatchPayout { rank: number; pubkey: string; lamports: number }

export interface MatchRecordPayload {
    matchPda: string;
    modeU8: number;
    wagerTier: number;
    wagerLamports: number;
    timeWindow: number;
    players: string[];
    heights: number[];
    winnerPubkey: string | null;
    payouts: MatchPayout[];
    rakeLamports: number;
    status: number;             // 2 = Settled, 3 = Cancelled
    createdAt: string;          // ISO timestamp
    startedAt?: string | null;
    settledAt: string;
    /** Base58 wager-currency mint. NATIVE_SOL_MINT_BASE58 for SOL matches,
     *  skrMintForCluster() for SKR. Drives Portfolio Real per-currency P/L. */
    wagerMint: string;
    /** Per-pubkey squad mints used by token_winrates. Optional but recommended. */
    squadMintsByPlayer?: Record<string, string[]>;
}

export interface MatchHistoryItem {
    match_pda: string;
    mode_u8: number;
    wager_tier: number;
    wager_lamports: string;
    time_window: number;
    players: string[];
    heights: number[];
    winner_pubkey: string | null;
    payouts_json: MatchPayout[];
    rake_lamports: string;
    status: number;
    created_at: string;
    started_at: string | null;
    settled_at: string;
    /** Empty string on rows written before migration 006 - those rows match
     *  neither the SOL nor the SKR aggregate filter so they're excluded. */
    wager_mint: string;
}

/** Upload a settled-match record. Fire-and-forget; failures logged only. */
export async function postMatchRecord(payload: MatchRecordPayload): Promise<boolean> {
    if (!RECEIPT_BACKEND_URL) return false;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/matches/history`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} postMatchRecord | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return false;
        }
        const body = (await res.json()) as { inserted: boolean };
        console.log(`${TAG} postMatchRecord | OK match=${payload.matchPda.slice(0, 8)}… inserted=${body.inserted}`);
        return true;
    } catch (e) {
        console.log(`${TAG} postMatchRecord | NET_ERR ${e}`);
        return false;
    }
}

/** Per-player match history. Empty array on backend offline / not-configured. */
export async function listMatchHistory(pubkey: string, limit: number = 20): Promise<MatchHistoryItem[]> {
    if (!RECEIPT_BACKEND_URL) return [];
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/matches/history?player=${encodeURIComponent(pubkey)}&limit=${limit}`);
        if (!res.ok) {
            console.log(`${TAG} listMatchHistory | HTTP ${res.status}`);
            return [];
        }
        const body = (await res.json()) as { matches: MatchHistoryItem[] };
        return body.matches ?? [];
    } catch (e) {
        console.log(`${TAG} listMatchHistory | NET_ERR ${e}`);
        return [];
    }
}
