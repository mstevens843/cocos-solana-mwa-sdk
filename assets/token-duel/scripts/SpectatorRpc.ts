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
    /** Phase F7 — fired when auto-reconnect succeeds. Caller may want to refresh UI state. */
    onWsReconnected?: (attempt: number) => void;
    /** Phase F7 — fired when reconnect attempts are exhausted (WS lost permanently). */
    onWsGiveUp?: () => void;
}

// ═══════════════════════════════════════════════════════════════════
// SQUADS_HIDDEN_UNTIL_RACE_START — Phase C guard
//
// Squad-mint payloads (`opponent-squad` events + `spectate-ready` snapshot
// squads) MUST NOT reach the UI until the race actually starts (after
// 3-2-1 countdown). Backend broadcasts them as soon as the second player
// joins, so we buffer them per-matchPda here and only flush via
// `releasePreRaceBuffer(matchPda)` from AppUI._onStartGame.
//
// Lobbies, WaitingPanel, and FindMatchPanel never see opponent picks.
// ═══════════════════════════════════════════════════════════════════
type BufferedSquadMsg = SpectatorOpponentSquadEvent;
const _preRaceBuffer: Map<string, BufferedSquadMsg[]> = new Map();
/** matchPda → flushed flag. Once true, future messages pass through. */
const _preRaceReleased: Set<string> = new Set();
/** matchPda → list of (cb) listeners installed via subscribeToMatch. */
const _preRaceListeners: Map<string, Set<SpectatorCallbacks>> = new Map();

/**
 * Flush any buffered opponent-squad messages for this match and let future
 * messages pass through to subscribers immediately. Idempotent.
 *
 * Call from AppUI._onStartGame right before PortfolioRace.start().
 */
export function releasePreRaceBuffer(matchPda: string): void {
    if (_preRaceReleased.has(matchPda)) return;
    _preRaceReleased.add(matchPda);
    const queued = _preRaceBuffer.get(matchPda) ?? [];
    _preRaceBuffer.delete(matchPda);
    const listeners = _preRaceListeners.get(matchPda) ?? new Set();
    console.log(`${TAG} releasePreRaceBuffer | match=${matchPda.slice(0, 8)}... flushing=${queued.length} listeners=${listeners.size}`);
    for (const ev of queued) {
        for (const cb of listeners) {
            try { cb.onOpponentSquad?.(ev); } catch (_) { /* ignore listener errors */ }
        }
    }
}

/** Reset state when leaving a match (post-settle / cancel). */
export function resetPreRaceBuffer(matchPda: string): void {
    _preRaceBuffer.delete(matchPda);
    _preRaceReleased.delete(matchPda);
    _preRaceListeners.delete(matchPda);
}

export function subscribeToMatch(
    rpc: TokenDuelRpc,
    matchPda: string,
    cb: SpectatorCallbacks,
): () => void {
    let pollTimer: number | null = null;
    let ws: WebSocket | null = null;
    let stopped = false;
    if (!_preRaceListeners.has(matchPda)) _preRaceListeners.set(matchPda, new Set());
    _preRaceListeners.get(matchPda)!.add(cb);

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

    // ─── Channel 2: backend WS with Phase F7 auto-reconnect ──────────
    // Exponential backoff: 1s → 2s → 4s → 8s capped at 30s, max 10 attempts.
    const RECONNECT_MAX_ATTEMPTS = 10;
    const RECONNECT_MAX_BACKOFF_MS = 30_000;
    let reconnectAttempts = 0;
    let reconnectTimer: any = null;
    const httpBase = RECEIPT_BACKEND_URL;
    const wsBase = httpBase.replace(/^http(s?):/, 'ws$1:');
    const wsUrl = `${wsBase}/match/${matchPda}/spectate`;

    const openWs = () => {
        if (stopped) return;
        try {
            console.log(`${TAG} ws | opening ${wsUrl} attempt=${reconnectAttempts + 1}`);
            ws = new WebSocket(wsUrl);
            ws.onopen = () => {
                console.log(`${TAG} ws | OPEN attempt=${reconnectAttempts + 1}`);
                if (reconnectAttempts > 0) {
                    try { cb.onWsReconnected?.(reconnectAttempts); } catch (_) { /* ignore */ }
                }
                reconnectAttempts = 0;
                cb.onWsConnected?.();
            };
            ws.onmessage = (evt) => {
                try {
                    const data = JSON.parse(typeof evt.data === 'string' ? evt.data : '') as SpectatorWsEvent;
                    if (data.kind === 'drop-relay') cb.onDrop?.(data);
                    else if (data.kind === 'match-over') cb.onMatchOver?.(data);
                    else if (data.kind === 'spectate-ready') {
                        console.log(`${TAG} ws | ready session=${data.sessionId ?? 'null'} squads=${data.squads?.length ?? 0}`);
                        // SQUADS_HIDDEN_UNTIL_RACE_START — strip squad snapshot
                        // before forwarding the ready event, then queue each
                        // squad as if it had arrived as an opponent-squad msg.
                        const sanitized: SpectatorReadyEvent = { ...data, squads: [] };
                        cb.onReady?.(sanitized);
                        if (Array.isArray(data.squads)) {
                            for (const sq of data.squads) {
                                const ev: SpectatorOpponentSquadEvent = {
                                    kind: 'opponent-squad',
                                    playerPubkey: sq.playerPubkey,
                                    mints: sq.mints,
                                };
                                _routeOpponentSquad(matchPda, ev, cb);
                            }
                        }
                    }
                    else if (data.kind === 'opponent-squad') {
                        console.log(`${TAG} ws | opponent-squad player=${data.playerPubkey.slice(0, 8)}... mints=${data.mints.length}`);
                        _routeOpponentSquad(matchPda, data, cb);
                    }
                } catch (e) {
                    console.log(`${TAG} ws | BAD_MSG ${e}`);
                }
            };
            ws.onclose = (evt) => {
                console.log(`${TAG} ws | CLOSE code=${evt.code} reason="${evt.reason}" stopped=${stopped} attempt=${reconnectAttempts}`);
                cb.onWsClosed?.(evt.reason || `code ${evt.code}`);
                if (stopped) return;
                if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
                    console.log(`${TAG} ws | GIVE_UP after ${reconnectAttempts} attempts`);
                    try { cb.onWsGiveUp?.(); } catch (_) { /* ignore */ }
                    return;
                }
                const backoff = Math.min(RECONNECT_MAX_BACKOFF_MS, 1000 * Math.pow(2, reconnectAttempts));
                reconnectAttempts += 1;
                console.log(`${TAG} ws | RECONNECT scheduled attempt=${reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS} backoff=${backoff}ms`);
                reconnectTimer = setTimeout(openWs, backoff);
            };
            ws.onerror = (evt) => { console.log(`${TAG} ws | ERROR ${evt}`); };
        } catch (e) {
            console.log(`${TAG} ws | open failed ${e} — will retry`);
            ws = null;
            if (!stopped && reconnectAttempts < RECONNECT_MAX_ATTEMPTS) {
                const backoff = Math.min(RECONNECT_MAX_BACKOFF_MS, 1000 * Math.pow(2, reconnectAttempts));
                reconnectAttempts += 1;
                reconnectTimer = setTimeout(openWs, backoff);
            }
        }
    };
    openWs();

    return function unsubscribe() {
        stopped = true;
        if (pollTimer !== null) clearInterval(pollTimer);
        if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (ws) try { ws.close(); } catch (_) { /* ignore */ }
        const listeners = _preRaceListeners.get(matchPda);
        if (listeners) {
            listeners.delete(cb);
            if (listeners.size === 0) _preRaceListeners.delete(matchPda);
        }
        console.log(`${TAG} unsubscribe | match=${matchPda.slice(0, 8)}...`);
    };
}

/**
 * Route an opponent-squad event either to the listener immediately (race
 * has started) or into the per-match pre-race buffer (lobby phase).
 */
function _routeOpponentSquad(
    matchPda: string,
    ev: SpectatorOpponentSquadEvent,
    cb: SpectatorCallbacks,
): void {
    if (_preRaceReleased.has(matchPda)) {
        cb.onOpponentSquad?.(ev);
        return;
    }
    let queue = _preRaceBuffer.get(matchPda);
    if (!queue) { queue = []; _preRaceBuffer.set(matchPda, queue); }
    // Dedupe by playerPubkey — only keep latest squad per player.
    const existing = queue.findIndex((q) => q.playerPubkey === ev.playerPubkey);
    if (existing >= 0) queue[existing] = ev; else queue.push(ev);
    console.log(`${TAG} buffer | match=${matchPda.slice(0, 8)}... player=${ev.playerPubkey.slice(0, 8)}... queued (released=false)`);
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
