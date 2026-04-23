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
    sessionId: string;
    matchPda: string;
}

export type SpectatorWsEvent = SpectatorDropEvent | SpectatorMatchOverEvent | SpectatorReadyEvent;

export interface SpectatorCallbacks {
    onState: (state: MatchState | null) => void;
    onDrop?: (ev: SpectatorDropEvent) => void;
    onMatchOver?: (ev: SpectatorMatchOverEvent) => void;
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
                else if (data.kind === 'spectate-ready') console.log(`${TAG} ws | ready session=${data.sessionId}`);
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
