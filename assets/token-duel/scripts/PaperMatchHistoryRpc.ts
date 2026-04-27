/**
 * PaperMatchHistoryRpc.ts — backend client for the paper_match_history table
 * (DB Stage 8). Signed-in users POST here on settle / forfeit so a future
 * "Match History" UI can render the full off-chain history. Guests skip.
 *
 * All calls are best-effort — failures are logged but never thrown so a
 * backend hiccup can't block the post-match flow.
 */
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[PaperMatchHistoryRpc]';

export interface PaperMatchHistoryRow {
    id: string;
    pubkey: string;
    modeU8: number;
    timeWindow: number;
    requiredPlayers: number;
    track: 'bot' | 'paper-real';
    players: string[];
    heights: number[];
    myHeight: number;
    winnerPubkey: string | null;
    placement: number;
    totalPlayers: number;
    won: boolean;
    xpGained: number;
    startedAt: string;
    settledAt: string;
}

export interface PostHistoryArgs {
    id: string;
    pubkey: string;
    modeU8: number;
    timeWindow: number;
    requiredPlayers: number;
    track: 'bot' | 'paper-real';
    players: string[];
    heights: number[];
    myHeight: number;
    winnerPubkey: string | null;
    placement: number;
    totalPlayers: number;
    won: boolean;
    xpGained: number;
    startedAt: string;
    settledAt: string;
}

export async function postPaperMatchHistory(args: PostHistoryArgs): Promise<boolean> {
    if (!RECEIPT_BACKEND_URL) return false;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/paper-match/history`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(args),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} post | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return false;
        }
        return true;
    } catch (e) {
        console.log(`${TAG} post | NET_ERR ${e}`);
        return false;
    }
}

export async function listPaperMatchHistory(
    pubkey: string,
    limit = 50,
    offset = 0,
): Promise<PaperMatchHistoryRow[]> {
    if (!RECEIPT_BACKEND_URL) return [];
    try {
        const url = `${RECEIPT_BACKEND_URL}/paper-match/history/${encodeURIComponent(pubkey)}`
            + `?limit=${limit}&offset=${offset}`;
        const res = await fetch(url);
        if (!res.ok) {
            console.log(`${TAG} list | HTTP ${res.status}`);
            return [];
        }
        const body = (await res.json()) as { rows: PaperMatchHistoryRow[] };
        return Array.isArray(body?.rows) ? body.rows : [];
    } catch (e) {
        console.log(`${TAG} list | NET_ERR ${e}`);
        return [];
    }
}
