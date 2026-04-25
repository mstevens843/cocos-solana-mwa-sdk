/**
 * ReceiptSigner.ts — Part 10 Bundle 1 client.
 *
 * Talks to the Token Duel backend at RECEIPT_BACKEND_URL:
 *   1. POST /session/start with match + squad details → backend returns
 *      sessionId + wsUrl + expected block widths.
 *   2. Open WebSocket at wsUrl. Stream drop events as the game runs.
 *      Backend acks each or rejects.
 *   3. On game over, send { kind:'finalize', finalHeight }. Backend replies
 *      with { kind:'receipt', ed25519IxDataB64, signedAt, height }.
 *   4. Client feeds ed25519IxDataB64 + signedAt into a two-ix transaction
 *      that also calls `settle_match_verified(height, signedAt)` and signs
 *      via MWA.
 *
 * Fail-open: any network error at `start` or `finalize` leaves `start` /
 * `finalize` returning null, and AppUI falls back to legacy `settle_match`
 * so the match still settles (with a yellow "Unverified" badge).
 */

import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[ReceiptSigner]';

export interface StartResponse {
    sessionId: string;
    serverPubkey: string;
    wsUrl: string;
    expectedWidths: Record<string, number>;
    startedAt: number;
}

export interface BlockDropEvent {
    blockIdx: number;
    tsMs: number;
    xPos: number;
    width: number;
    outcome: 'ok' | 'miss';
}

export interface ReceiptPayload {
    ed25519IxDataB64: string;
    signedAt: number; // unix seconds
    height: number;
}

type OutboundMsg =
    | { kind: 'drop'; blockIdx: number; tsMs: number; xPos: number; width: number; outcome: 'ok' | 'miss' }
    | { kind: 'finalize'; finalHeight: number };

type InboundMsg =
    | { kind: 'ack'; blockIdx: number }
    | { kind: 'reject'; blockIdx?: number; reason: string }
    | { kind: 'receipt'; ed25519IxDataB64: string; signedAt: number; height: number }
    | { kind: 'fatal'; reason: string };

export class ReceiptSession {
    private _ws: WebSocket | null = null;
    private _sessionId: string | null = null;
    private _receiptResolver: ((r: ReceiptPayload | null) => void) | null = null;
    private _fatal: string | null = null;
    private _queued: OutboundMsg[] = []; // messages sent before ws is OPEN
    private _queuedAcks = 0;
    /** Latest reject reason surfaces to UI when fallback fires. */
    public lastReason: string | null = null;

    get sessionId(): string | null { return this._sessionId; }
    get isFatal(): boolean { return this._fatal !== null; }

    /**
     * POST /session/start, open WS. Returns the backend's server pubkey so
     * the caller can optionally verify it matches the RECEIPT_SIGNER_PUBKEY
     * they expect. On any failure returns null and the caller falls back.
     */
    async start(opts: {
        matchPda: string;
        playerPubkey: string;
        squadMints: [string, string, string];
        timeWindow: string; // '1h' | '1d' | '3d' | '7d'
        timeoutMs?: number;
    }): Promise<StartResponse | null> {
        const timeoutMs = opts.timeoutMs ?? 3500;
        const url = `${RECEIPT_BACKEND_URL}/session/start`;
        console.log(`${TAG} start | POST ${url} match=${opts.matchPda.substring(0, 8)}... window=${opts.timeWindow}`);
        let resp: StartResponse | null = null;
        try {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), timeoutMs);
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    matchPda: opts.matchPda,
                    playerPubkey: opts.playerPubkey,
                    squadMints: opts.squadMints,
                    timeWindow: opts.timeWindow,
                }),
                signal: ctl.signal as any,
            });
            clearTimeout(timer);
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                console.log(`${TAG} start | FAIL status=${res.status} body="${body.slice(0, 120)}"`);
                this.lastReason = `backend HTTP ${res.status}`;
                return null;
            }
            resp = (await res.json()) as StartResponse;
        } catch (e) {
            console.log(`${TAG} start | ERROR ${e}`);
            this.lastReason = `network error (${e})`;
            return null;
        }
        this._sessionId = resp.sessionId;

        // Open WS. We resolve `start` immediately — drops can queue until OPEN.
        try {
            this._ws = new WebSocket(resp.wsUrl);
            this._ws.onopen = () => this._flushQueue();
            this._ws.onmessage = (e) => this._onMessage(typeof e.data === 'string' ? e.data : '');
            this._ws.onerror = (e) => {
                console.log(`${TAG} ws ERROR ${e}`);
                this.lastReason = 'ws error';
            };
            this._ws.onclose = (e) => {
                console.log(`${TAG} ws CLOSE code=${e.code} reason="${e.reason}"`);
                if (this._receiptResolver) {
                    // Resolve pending finalize with null if ws closed before receipt.
                    const r = this._receiptResolver;
                    this._receiptResolver = null;
                    r(null);
                }
            };
        } catch (e) {
            console.log(`${TAG} start | WS open ERROR ${e}`);
            this.lastReason = `ws open error (${e})`;
            return null;
        }
        console.log(`${TAG} start | OK session=${resp.sessionId} server_pk=${resp.serverPubkey}`);
        return resp;
    }

    /** Fire-and-forget. No-op if ws is closed or session is fatal. */
    recordDrop(ev: BlockDropEvent): void {
        if (this._fatal || !this._ws) return;
        const msg: OutboundMsg = { kind: 'drop', ...ev };
        if (this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify(msg));
        } else if (this._ws.readyState === WebSocket.CONNECTING) {
            this._queued.push(msg);
        }
    }

    /**
     * Await the server's receipt after sending `finalize`. Resolves with
     * the receipt payload on success, or null on any error (network,
     * timeout, mismatch). 5s timeout.
     */
    async finalize(finalHeight: number, timeoutMs = 5000): Promise<ReceiptPayload | null> {
        if (this._fatal) {
            console.log(`${TAG} finalize | already fatal reason="${this._fatal}"`);
            return null;
        }
        if (!this._ws) {
            console.log(`${TAG} finalize | no ws`);
            return null;
        }
        const msg: OutboundMsg = { kind: 'finalize', finalHeight };
        return new Promise<ReceiptPayload | null>((resolve) => {
            const timer = setTimeout(() => {
                if (this._receiptResolver) {
                    this._receiptResolver = null;
                    this.lastReason = 'receipt timeout';
                    console.log(`${TAG} finalize | TIMEOUT ${timeoutMs}ms`);
                    resolve(null);
                }
            }, timeoutMs);
            this._receiptResolver = (r) => { clearTimeout(timer); resolve(r); };
            if (this._ws!.readyState === WebSocket.OPEN) {
                this._ws!.send(JSON.stringify(msg));
            } else if (this._ws!.readyState === WebSocket.CONNECTING) {
                this._queued.push(msg);
            } else {
                clearTimeout(timer);
                this._receiptResolver = null;
                this.lastReason = 'ws closed before finalize';
                resolve(null);
            }
        });
    }

    close(): void {
        try { this._ws?.close(); } catch (_) { /* ignore */ }
        this._ws = null;
        if (this._receiptResolver) {
            const r = this._receiptResolver;
            this._receiptResolver = null;
            r(null);
        }
    }

    private _flushQueue(): void {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
        for (const m of this._queued) this._ws.send(JSON.stringify(m));
        console.log(`${TAG} ws OPEN — flushed ${this._queued.length} queued msgs`);
        this._queued = [];
    }

    private _onMessage(data: string): void {
        let msg: InboundMsg;
        try { msg = JSON.parse(data) as InboundMsg; }
        catch { console.log(`${TAG} ws malformed msg "${data.slice(0, 80)}"`); return; }

        if (msg.kind === 'ack') {
            this._queuedAcks += 1;
            return;
        }
        if (msg.kind === 'reject') {
            this.lastReason = msg.reason;
            console.log(`${TAG} ws REJECT block=${msg.blockIdx ?? '?'} reason="${msg.reason}"`);
            return;
        }
        if (msg.kind === 'fatal') {
            this._fatal = msg.reason;
            this.lastReason = msg.reason;
            console.log(`${TAG} ws FATAL reason="${msg.reason}"`);
            if (this._receiptResolver) {
                const r = this._receiptResolver;
                this._receiptResolver = null;
                r(null);
            }
            return;
        }
        if (msg.kind === 'receipt') {
            console.log(`${TAG} ws RECEIPT height=${msg.height} signedAt=${msg.signedAt} ixDataLen=${msg.ed25519IxDataB64.length}`);
            if (this._receiptResolver) {
                const r = this._receiptResolver;
                this._receiptResolver = null;
                r({
                    ed25519IxDataB64: msg.ed25519IxDataB64,
                    signedAt: msg.signedAt,
                    height: msg.height,
                });
            }
            return;
        }
    }
}

/**
 * Phase F2 — one-shot receipt sign for betting-duel real-track matches.
 *
 * No WS, no session state. POSTs the height + (matchPda, player) to the
 * backend, gets back the Ed25519 precompile ix data ready to drop into
 * settle_match_verified ix[1]. On any error returns null and the caller
 * surfaces a "Backend unavailable — try again or wait for force-settle"
 * toast (the unverified path is gated onchain after Phase F2 redeploy).
 */
export async function requestReceiptSign(opts: {
    matchPda: string;
    playerPubkey: string;
    height: number;
    timeoutMs?: number;
}): Promise<ReceiptPayload | null> {
    const timeoutMs = opts.timeoutMs ?? 4000;
    const url = `${RECEIPT_BACKEND_URL}/receipts/sign`;
    console.log(`${TAG} requestReceiptSign | POST ${url} match=${opts.matchPda.slice(0, 8)}... player=${opts.playerPubkey.slice(0, 8)}... height=${opts.height}`);
    try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                matchPda: opts.matchPda,
                playerPubkey: opts.playerPubkey,
                height: opts.height,
            }),
            signal: ctl.signal as any,
        });
        clearTimeout(timer);
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.log(`${TAG} requestReceiptSign | FAIL status=${res.status} body="${body.slice(0, 120)}"`);
            return null;
        }
        const data = await res.json() as { ed25519IxDataB64: string; signedAt: number; height: number };
        if (!data?.ed25519IxDataB64 || typeof data.signedAt !== 'number') {
            console.log(`${TAG} requestReceiptSign | MALFORMED_RESPONSE`);
            return null;
        }
        console.log(`${TAG} requestReceiptSign | OK signed_at=${data.signedAt} ix_data_len=${data.ed25519IxDataB64.length}`);
        return { ed25519IxDataB64: data.ed25519IxDataB64, signedAt: data.signedAt, height: data.height };
    } catch (e) {
        console.log(`${TAG} requestReceiptSign | NET_ERR ${e}`);
        return null;
    }
}
