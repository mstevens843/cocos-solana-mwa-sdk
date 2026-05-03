/**
 * MatchLivePnlRpc.ts - one-shot snapshot of every published squad in a
 * match plus current Birdeye spot prices, ranked by portfolio delta. Used
 * by the MIP "details" modal to render live standings without spinning up
 * a SpectatorRpc WebSocket.
 *
 * Fire-and-forget pattern: failures are logged but never thrown so a
 * backend hiccup degrades the modal to "Squads not yet published" rather
 * than blocking the UI.
 */
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[MatchLivePnlRpc]';

export interface LivePnlPlayer {
    playerPubkey: string;
    mints: string[];
    entryPrices: Record<string, number>;
    currentPrices: Record<string, number>;
    /** Equal-weighted % delta across the player's resolved mints. */
    portfolioDeltaPct: number;
    /** Number of mints that had both entry + current prices (out of mints.length). */
    resolvedCount: number;
}

export interface LivePnlSnapshot {
    matchPda: string;
    /** Backend wall-clock ms when the snapshot was assembled. */
    fetchedAt: number;
    players: LivePnlPlayer[];
}

export async function fetchLivePnl(matchPda: string): Promise<LivePnlSnapshot | null> {
    if (!RECEIPT_BACKEND_URL) {
        console.log(`${TAG} fetchLivePnl SKIP no_backend match=${matchPda.slice(0, 8)}...`);
        return null;
    }
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/match/${encodeURIComponent(matchPda)}/live-pnl`);
        if (!res.ok) {
            console.log(`${TAG} fetchLivePnl HTTP ${res.status} match=${matchPda.slice(0, 8)}...`);
            return null;
        }
        const body = (await res.json()) as LivePnlSnapshot;
        if (!body || !Array.isArray(body.players)) {
            console.log(`${TAG} fetchLivePnl BAD_BODY match=${matchPda.slice(0, 8)}...`);
            return null;
        }
        console.log(`${TAG} fetchLivePnl OK match=${matchPda.slice(0, 8)}... players=${body.players.length}`);
        return body;
    } catch (e) {
        console.log(`${TAG} fetchLivePnl NET_ERR match=${matchPda.slice(0, 8)}... err=${e}`);
        return null;
    }
}
