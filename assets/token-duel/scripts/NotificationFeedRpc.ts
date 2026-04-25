/**
 * NotificationFeedRpc.ts — Phase N6 client subscriber.
 *
 * Connects to the backend notification feed for a given pubkey:
 *   1. REST GET /notifications/:pubkey?since=<lastSeenTs>  (catchup batch)
 *   2. WS  /notifications/:pubkey/stream                   (live events)
 *
 * Mirrors `SpectatorRpc.ts` Phase F7 patterns: exponential backoff
 * reconnect (1s → 2s → 4s → 8s → 30s), max 10 attempts, callbacks for
 * lifecycle events. Caller threads inbound events into NotificationStore
 * (which dedupes by id).
 *
 * Backend payload shape:
 *   { kind: 'connected', pubkey, at }       — handshake on WS open
 *   { kind: 'event', event: BackendEvent }  — live notification
 */

import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[NotificationFeedRpc]';

export interface BackendEvent {
    id: string;
    kind: string;
    player: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    createdAt: number;
}

export interface NotificationFeedCallbacks {
    /** History batch fetched on connect (REST). */
    onCatchupBatch: (events: BackendEvent[]) => void;
    /** Live event arrived via WS. */
    onEvent: (event: BackendEvent) => void;
    onWsConnected?: () => void;
    onWsClosed?: (reason: string) => void;
    onWsReconnected?: (attempt: number) => void;
    onWsGiveUp?: () => void;
}

const RECONNECT_MAX_ATTEMPTS = 10;
const RECONNECT_MAX_BACKOFF_MS = 30_000;

/**
 * Subscribe to backend notification feed for `pubkey`. Returns an
 * unsubscribe fn. `lastSeenTs` (unix ms) bounds the catchup batch — pass
 * 0 on first launch, or the most-recent createdAt from local store on
 * subsequent launches to skip already-known events.
 */
export function subscribeToNotifications(
    pubkey: string,
    cb: NotificationFeedCallbacks,
    lastSeenTs: number = 0,
): () => void {
    let stopped = false;
    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: any = null;

    if (!RECEIPT_BACKEND_URL || RECEIPT_BACKEND_URL.includes('10.0.2.2')) {
        // Android-emulator default that real devices can't reach. Skip silently.
        console.log(`${TAG} subscribe | SKIP url=${RECEIPT_BACKEND_URL || '(unset)'} — set globalThis.TD_RECEIPT_URL to enable`);
        return () => { stopped = true; };
    }

    // 1. REST catchup.
    const catchupUrl = `${RECEIPT_BACKEND_URL}/notifications/${pubkey}?since=${lastSeenTs}`;
    void (async () => {
        try {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 6000);
            const res = await fetch(catchupUrl, {
                method: 'GET',
                headers: { accept: 'application/json' },
                signal: ctl.signal as any,
            });
            clearTimeout(timer);
            if (stopped) return;
            if (!res.ok) {
                console.log(`${TAG} catchup | HTTP ${res.status} — skipping`);
                return;
            }
            const body = await res.json() as { events?: BackendEvent[] };
            const events = Array.isArray(body.events) ? body.events : [];
            console.log(`${TAG} catchup | DONE pubkey=${pubkey.slice(0, 8)} count=${events.length} since=${lastSeenTs}`);
            try { cb.onCatchupBatch(events); } catch (e) { console.log(`${TAG} catchup | listener error ${e}`); }
        } catch (e) {
            console.log(`${TAG} catchup | NET_ERR ${e}`);
        }
    })();

    // 2. WS live channel with auto-reconnect (mirrors SpectatorRpc Phase F7).
    const wsBase = RECEIPT_BACKEND_URL.replace(/^http(s?):/, 'ws$1:');
    const wsUrl = `${wsBase}/notifications/${pubkey}/stream`;
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
                    const data = JSON.parse(typeof evt.data === 'string' ? evt.data : '') as { kind: string; event?: BackendEvent };
                    if (data.kind === 'event' && data.event) {
                        cb.onEvent(data.event);
                    }
                    // 'connected' handshake is informational; ignore.
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
        if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (ws) try { ws.close(); } catch (_) { /* ignore */ }
        console.log(`${TAG} unsubscribe | pubkey=${pubkey.slice(0, 8)}`);
    };
}

/** POST mark-read; fire-and-forget. */
export async function markNotificationReadOnBackend(pubkey: string, id: string): Promise<void> {
    if (!RECEIPT_BACKEND_URL || RECEIPT_BACKEND_URL.includes('10.0.2.2')) return;
    try {
        const url = `${RECEIPT_BACKEND_URL}/notifications/${pubkey}/${encodeURIComponent(id)}/read`;
        await fetch(url, { method: 'POST' });
    } catch (_) { /* fire-and-forget */ }
}
