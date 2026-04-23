/**
 * SpectatorRpc.ts — Part 12 Bundle D.
 *
 * Two channels per spectated match:
 *   1. On-chain polling at 3s cadence — fetches the Match PDA + emits a
 *      MatchState via `onState`. Works even when no live backend session
 *      exists (legacy settle path or empty match).
 *   2. Optional backend WebSocket at `/match/:matchPda/spectate` — emits
 *      per-drop events with ~200ms latency for the "feels live" experience.
 *      Gracefully skipped if the backend is unreachable.
 *
 * Caller gets one `subscribe(...)` call that returns an `unsubscribe` fn.
 */

import { RECEIPT_BACKEND_URL } from './constants';
import { TokenDuelRpc } from './TokenDuelRpc';
import { getMatch, MatchState } from './MatchRpc';

const TAG = '[SpectatorRpc]';

export interface SpectatorDropEvent {
    kind: 'drop-relay';
    blockIdx: number;
    tsMs: number;
    xPos: number;
    width: number;
    outcome: 'ok' | 'miss';
}

export interface SpectatorMatchOverEvent {
    kind: 'match-over';
    finalHeight: number;
    at: number;
}

export interface SpectatorReadyEvent {
    kind: 'spectate-ready';
    sessionId: string | null;
    matchPda: string;
    // betting-duel live opponent delta: snapshot of any squads already
    // published when the subscriber attached. Lets late subscribers get
    // both players' mints in one message.
    squads?: Array<{ playerPubkey: string; mints: string[] }>;
}

/**
 * betting-duel live opponent delta: fired each time a player publishes
 * their squad. Clients filter by `playerPubkey !== myPubkey` to pick the
 * opponent's mints.
 */
export interface SpectatorOpponentSquadEvent {
    kind: 'opponent-squad';
    playerPubkey: string;
    mints: string[];
}

export type SpectatorWsEvent =
    | SpectatorDropEvent
    | SpectatorMatchOverEvent
    | SpectatorReadyEvent
    | SpectatorOpponentSquadEvent;

export interface SpectatorCallbacks {
    onState: (state: MatchState | null) => void;
    onDrop?: (ev: SpectatorDropEvent) => void;
    onMatchOver?: (ev: SpectatorMatchOverEvent) => void;
    onReady?: (ev: SpectatorReadyEvent) => void;
    onOpponentSquad?: (ev: SpectatorOpponentSquadEvent) => void;
    onWsConnected?: () => void;
    onWsClosed?: (reason: string) => void;
}

export function subscribeToMatch(
    rpc: TokenDuelRpc,
    matchPda: string,
    cb: SpectatorCallbacks,
): () => void {
    let pollTimer: number | null = null;
    let ws: WebSocket | null = null;
    let stopped = false;

    // ─── Channel 1: on-chain state poller (3s) ─────────────────────
    const pollOnce = async () => {
        if (stopped) return;
        try {
            const state = await getMatch(rpc, matchPda);
            if (!stopped) cb.onState(state);
            // Auto-stop polling once match is Settled/Cancelled.
            if (state && (state.status === 2 || state.status === 3) && !stopped) {
                console.log(`${TAG} poll | match terminal status=${state.status} — stopping poll`);
                if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
            }
        } catch (e) {
            console.log(`${TAG} poll | ERROR ${e}`);
        }
    };
    void pollOnce();
    pollTimer = setInterval(pollOnce, 3_000) as unknown as number;

    // ─── Channel 2: backend WS (optional) ──────────────────────────
    try {
        // Compute ws(s):// from the HTTP backend URL.
        const httpBase = RECEIPT_BACKEND_URL;
        const wsBase = httpBase.replace(/^http(s?):/, 'ws$1:');
        const wsUrl = `${wsBase}/match/${matchPda}/spectate`;
        console.log(`${TAG} ws | opening ${wsUrl}`);
        ws = new WebSocket(wsUrl);
        ws.onopen = () => { console.log(`${TAG} ws | OPEN`); cb.onWsConnected?.(); };
        ws.onmessage = (evt) => {
            try {
                const data = JSON.parse(typeof evt.data === 'string' ? evt.data : '') as SpectatorWsEvent;
                if (data.kind === 'drop-relay') cb.onDrop?.(data);
                else if (data.kind === 'match-over') cb.onMatchOver?.(data);
                else if (data.kind === 'spectate-ready') {
                    console.log(`${TAG} ws | ready session=${data.sessionId ?? 'null'} squads=${data.squads?.length ?? 0}`);
                    cb.onReady?.(data);
                }
                else if (data.kind === 'opponent-squad') {
                    console.log(`${TAG} ws | opponent-squad player=${data.playerPubkey.slice(0, 8)}... mints=${data.mints.length}`);
                    cb.onOpponentSquad?.(data);
                }
            } catch (e) {
                console.log(`${TAG} ws | BAD_MSG ${e}`);
            }
        };
        ws.onclose = (evt) => {
            console.log(`${TAG} ws | CLOSE code=${evt.code} reason="${evt.reason}"`);
            cb.onWsClosed?.(evt.reason || `code ${evt.code}`);
        };
        ws.onerror = (evt) => { console.log(`${TAG} ws | ERROR ${evt}`); };
    } catch (e) {
        console.log(`${TAG} ws | open failed ${e} — polling-only mode`);
        ws = null;
    }

    return function unsubscribe() {
        stopped = true;
        if (pollTimer !== null) clearInterval(pollTimer);
        if (ws) try { ws.close(); } catch (_) { /* ignore */ }
        console.log(`${TAG} unsubscribe | match=${matchPda.slice(0, 8)}...`);
    };
}

/**
 * betting-duel live opponent delta — POST this player's 3 squad mints to
 * the backend after Real-match commit. Fire-and-forget; logs on failure
 * but doesn't throw (a missing backend should not block the race). The
 * backend's in-memory board expires entries after ~10 min.
 */
export async function publishSquadToBackend(
    matchPda: string,
    playerPubkey: string,
    mints: string[],
): Promise<boolean> {
    try {
        const url = `${RECEIPT_BACKEND_URL}/match/${matchPda}/publish-squad`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ playerPubkey, mints }),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} publishSquadToBackend | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return false;
        }
        console.log(`${TAG} publishSquadToBackend | OK match=${matchPda.slice(0, 8)}... player=${playerPubkey.slice(0, 8)}... mints=${mints.length}`);
        return true;
    } catch (e) {
        console.log(`${TAG} publishSquadToBackend | NET_ERR match=${matchPda.slice(0, 8)}... error=${e}`);
        return false;
    }
}
