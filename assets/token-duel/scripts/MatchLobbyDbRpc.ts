/**
 * MatchLobbyDbRpc.ts - DB Stage 6 client for the backend `match_lobbies` table.
 *
 * Fire-and-forget POST after a host confirms `join_match_create`. Failures
 * are logged but never thrown - backend hiccups must not block gameplay.
 * Coexists with MatchHistoryDbRpc which mirrors settlement; together they
 * give the backend a full open→settle funnel without duplicating live
 * lobby discovery (still on-chain).
 */
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[MatchLobbyDbRpc]';

export interface LobbyCreatedPayload {
    matchPda: string;
    creatorPubkey: string;
    modeU8: number;
    wagerTier: number;
    wagerLamports: number;
    timeWindow: number;
    requiredPlayers: number;
    createdAt: string;          // ISO timestamp
}

/** Upload an open-lobby row. Fire-and-forget; failures logged only. */
export async function postLobbyCreated(payload: LobbyCreatedPayload): Promise<boolean> {
    if (!RECEIPT_BACKEND_URL) return false;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/matches/lobby`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} postLobbyCreated | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return false;
        }
        const body = (await res.json()) as { inserted: boolean };
        console.log(`${TAG} postLobbyCreated | OK match=${payload.matchPda.slice(0, 8)}… inserted=${body.inserted}`);
        return true;
    } catch (e) {
        console.log(`${TAG} postLobbyCreated | NET_ERR ${e}`);
        return false;
    }
}
