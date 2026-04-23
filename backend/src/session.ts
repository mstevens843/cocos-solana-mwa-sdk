/**
 * Session manager — owns per-match state from WS open to receipt issuance.
 *
 * Flow:
 *   1. `create(req)` — fetches squad price deltas from Birdeye for the
 *      requested time_window, caches expected widths. Returns SessionState.
 *   2. `recordDrop(sessionId, event)` — forwards to Physics.validate. On
 *      reject, increments rejectedCount and blacklists player if >= 3.
 *   3. `finalize(sessionId, finalHeight)` — returns the final height that
 *      matches the session's drop count (or a reject if mismatched).
 *      Caller then passes the height to ReceiptSigner to produce a
 *      receipt. Session is marked finalized; no further drops accepted.
 *   4. `cleanup()` — runs every 60s via interval, removes sessions older
 *      than MAX_SESSION_MS × 2.
 */

import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';
import { BlockDropEvent, PhysicsVerdict, SessionState, StartSessionRequest } from './types';
import { Physics } from './physics';
import { StatsBucket } from './stats';

const TAG = '[session]';

// Birdeye timeframe → API type param. Mirrors TIME_WINDOWS in ModeDefs.ts.
const WINDOW_MAP: Record<string, string> = {
    '1h': '1h',
    '1d': '24h',
    '3d': '3d',
    '7d': '7d',
};

const MAX_REJECTS_BEFORE_BLACKLIST = 3;
const BLACKLIST_MS = 60 * 60 * 1000; // 1 hour
const SESSION_TTL_MS = 6 * 60 * 1000; // 6 min (2× MAX_SESSION_MS)

export interface DropOutcome {
    verdict: PhysicsVerdict;
    shouldTerminate: boolean;
}

export class SessionManager {
    private sessions = new Map<string, SessionState>();
    private blacklist = new Map<string, number>(); // player pubkey → unban ts
    private cleanupTimer: NodeJS.Timeout | null = null;
    // Part 12 D: spectator infra.
    // Map sessionId → list of open spectator websockets. When a play-session
    // records a drop or finalizes, we broadcast sanitized events to its
    // spectators so watch-along clients see live activity.
    private spectators = new Map<string, Set<WebSocket>>();
    // Map matchPda → sessionId so spectator clients can subscribe by on-chain
    // PDA without knowing the ephemeral session UUID. Only matches with a live
    // backend session appear here; legacy (unverified) matches aren't indexed.
    private sessionsByMatchPda = new Map<string, string>();

    // betting-duel live opponent delta — squad publication board.
    // Independent of the physics-session flow (which is dead on betting-duel).
    // Clients POST their 3 squad mints at match-commit time; backend stores +
    // broadcasts to anyone subscribed to that matchPda via WS.
    //
    // matchPda → Map(playerPubkey → {mints, publishedAt})
    private matchSquads = new Map<string, Map<string, { mints: string[]; publishedAt: number }>>();
    // matchPda → spectator WS set (separate from session-based spectators).
    private matchSpectators = new Map<string, Set<WebSocket>>();
    // 10-minute TTL on squad entries — 1h race max + buffer.
    private static readonly SQUAD_TTL_MS = 10 * 60 * 1000;

    constructor(
        private readonly birdeyeApiKey: string,
        private readonly maxConcurrent: number,
    ) {
        this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    }

    async create(req: StartSessionRequest): Promise<{ ok: true; state: SessionState } | { ok: false; reason: string }> {
        if (this.sessions.size >= this.maxConcurrent) {
            return { ok: false, reason: 'capacity exceeded' };
        }
        const unban = this.blacklist.get(req.playerPubkey);
        if (unban && unban > Date.now()) {
            const minsLeft = Math.ceil((unban - Date.now()) / 60_000);
            return { ok: false, reason: `player blacklisted, ${minsLeft}min left` };
        }

        // Fetch price deltas for squad mints in the requested window.
        const widths = await this.resolveExpectedWidths(req.squadMints, req.timeWindow);

        const state: SessionState = {
            id: randomUUID(),
            matchPda: req.matchPda,
            playerPubkey: req.playerPubkey,
            squadMints: req.squadMints,
            timeWindow: req.timeWindow,
            expectedWidths: widths,
            drops: [],
            startedAt: Date.now(),
            lastDropAt: Date.now(),
            rejectedCount: 0,
            finalized: false,
            receiptSignedAt: null,
        };
        this.sessions.set(state.id, state);
        // Part 12 D: index by matchPda so spectators can subscribe by PDA.
        this.sessionsByMatchPda.set(req.matchPda, state.id);
        // Part 12 B: track session creation in the admin dashboard.
        StatsBucket.bumpSessionCreated(req.matchPda);
        StatsBucket.setSessionsAlive(this.sessions.size);
        console.log(`${TAG} create id=${state.id} match=${req.matchPda.slice(0, 8)}... player=${req.playerPubkey.slice(0, 8)}... window=${req.timeWindow} widths=${JSON.stringify(widths)}`);
        return { ok: true, state };
    }

    get(id: string): SessionState | undefined {
        return this.sessions.get(id);
    }

    recordDrop(sessionId: string, ev: BlockDropEvent): DropOutcome {
        const s = this.sessions.get(sessionId);
        if (!s) return { verdict: { ok: false, reason: 'session not found' }, shouldTerminate: true };
        if (s.finalized) return { verdict: { ok: false, reason: 'session already finalized' }, shouldTerminate: true };

        const verdict = Physics.validate(s, ev);
        if (verdict.ok) {
            s.drops.push(ev);
            s.lastDropAt = ev.tsMs;
            // Part 12 D: relay to spectators (sanitized: drop inputs only).
            this.broadcastToSpectators(sessionId, {
                kind: 'drop-relay',
                blockIdx: ev.blockIdx,
                tsMs: ev.tsMs,
                xPos: ev.xPos,
                width: ev.width,
                outcome: ev.outcome,
            });
            return { verdict, shouldTerminate: false };
        }

        s.rejectedCount += 1;
        // Part 12 B: feed reject into the admin dashboard ring buffer.
        StatsBucket.bumpReject({
            player: s.playerPubkey,
            reason: verdict.reason ?? 'unknown',
            at: Math.floor(Date.now() / 1000),
            blockIdx: ev.blockIdx,
        });
        console.warn(`${TAG} reject id=${sessionId} idx=${ev.blockIdx} reason="${verdict.reason}" count=${s.rejectedCount}`);
        if (s.rejectedCount >= MAX_REJECTS_BEFORE_BLACKLIST) {
            this.blacklist.set(s.playerPubkey, Date.now() + BLACKLIST_MS);
            this.sessions.delete(sessionId);
            console.warn(`${TAG} BLACKLIST player=${s.playerPubkey} for ${BLACKLIST_MS / 60000}min`);
            return { verdict, shouldTerminate: true };
        }
        return { verdict, shouldTerminate: false };
    }

    /**
     * Accept finalize + return the final height. Mismatched heights (client
     * claims 20 but submitted 15 drops) are rejected.
     */
    finalize(sessionId: string, claimedHeight: number): { ok: true; height: number; state: SessionState } | { ok: false; reason: string } {
        const s = this.sessions.get(sessionId);
        if (!s) return { ok: false, reason: 'session not found' };
        if (s.finalized) return { ok: false, reason: 'already finalized' };

        // Height = number of successful drops (successful 'ok' drops, excluding miss).
        const actualHeight = s.drops.filter((d) => d.outcome === 'ok').length;
        if (claimedHeight !== actualHeight) {
            s.rejectedCount += 1;
            console.warn(`${TAG} finalize MISMATCH id=${sessionId} claimed=${claimedHeight} actual=${actualHeight}`);
            return { ok: false, reason: `claimed height ${claimedHeight} != observed ${actualHeight}` };
        }
        s.finalized = true;
        s.receiptSignedAt = Math.floor(Date.now() / 1000);
        // Part 12 B: feed receipt into the admin dashboard ring buffer.
        StatsBucket.bumpReceipt({
            matchPda: s.matchPda,
            player: s.playerPubkey,
            height: actualHeight,
            at: s.receiptSignedAt,
            verified: true,
        });
        // Part 12 D: relay match-over to spectators so they can show the final
        // height + close out their watch view.
        this.broadcastToSpectators(sessionId, {
            kind: 'match-over',
            finalHeight: actualHeight,
            at: s.receiptSignedAt,
        });
        console.log(`${TAG} finalize OK id=${sessionId} height=${actualHeight}`);
        return { ok: true, height: actualHeight, state: s };
    }

    /** Part 12 D: resolve a matchPda → active sessionId, or null if no live session. */
    getSessionIdByMatchPda(matchPda: string): string | null {
        return this.sessionsByMatchPda.get(matchPda) ?? null;
    }

    /**
     * Part 13 C: cross-reference a settled matchPda to the backend sessions
     * that contributed, returning the per-player squad mints. Used by the
     * rake listener to feed `TokenStatsBucket` on each MatchSettled event.
     *
     * Finds ALL sessions that share the same matchPda — multiplayer modes
     * open one session per player. Returns a map keyed by player pubkey.
     * Returns null when no session is known (e.g., legacy settle paths).
     */
    getOutcomeData(matchPda: string): { squads: Map<string, string[]> } | null {
        const squads = new Map<string, string[]>();
        for (const [_id, s] of this.sessions) {
            if (s.matchPda === matchPda) {
                squads.set(s.playerPubkey, s.squadMints.slice());
            }
        }
        if (squads.size === 0) return null;
        return { squads };
    }

    /** Part 12 D: register a read-only spectator websocket for a live session. */
    addSpectator(sessionId: string, ws: WebSocket): boolean {
        if (!this.sessions.has(sessionId)) return false;
        let set = this.spectators.get(sessionId);
        if (!set) {
            set = new Set();
            this.spectators.set(sessionId, set);
        }
        set.add(ws);
        StatsBucket.bumpSpectatorConnected();
        return true;
    }

    /** Part 12 D: remove a spectator (on ws close). */
    removeSpectator(sessionId: string, ws: WebSocket): void {
        const set = this.spectators.get(sessionId);
        if (!set) return;
        if (set.delete(ws)) StatsBucket.bumpSpectatorDisconnected();
        if (set.size === 0) this.spectators.delete(sessionId);
    }

    /** Part 12 D: fan out a sanitized event to all spectators of a session. */
    private broadcastToSpectators(sessionId: string, msg: unknown): void {
        const set = this.spectators.get(sessionId);
        if (!set || set.size === 0) return;
        const payload = JSON.stringify(msg);
        for (const ws of set) {
            try {
                if (ws.readyState === WebSocket.OPEN) ws.send(payload);
            } catch (_) { /* ignore broken pipe; cleanup happens on close event */ }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // betting-duel live opponent delta — squad publication board
    // ═══════════════════════════════════════════════════════════════

    /**
     * Client publishes its 3 squad mints after Real-match commit. Stores in
     * memory (TTL-bounded) and fans out an opponent-squad event to any WS
     * subscribers on this matchPda.
     */
    publishMatchSquad(matchPda: string, playerPubkey: string, mints: string[]): { ok: true } | { ok: false; reason: string } {
        if (mints.length !== 3) return { ok: false, reason: 'expected 3 mints' };
        for (const m of mints) {
            if (typeof m !== 'string' || m.length < 32 || m.length > 44) {
                return { ok: false, reason: `malformed mint "${m}"` };
            }
        }
        let board = this.matchSquads.get(matchPda);
        if (!board) {
            board = new Map();
            this.matchSquads.set(matchPda, board);
        }
        board.set(playerPubkey, { mints: mints.slice(), publishedAt: Date.now() });
        console.log(`${TAG} publishMatchSquad match=${matchPda.slice(0, 8)}... player=${playerPubkey.slice(0, 8)}... mints=[${mints.map(m => m.slice(0, 8)).join(',')}] board_size=${board.size}`);
        this.broadcastMatchSquadEvent(matchPda, { kind: 'opponent-squad', playerPubkey, mints });
        return { ok: true };
    }

    /** Return current squads published for a match (or empty map). */
    getMatchSquads(matchPda: string): Array<{ playerPubkey: string; mints: string[] }> {
        const board = this.matchSquads.get(matchPda);
        if (!board) return [];
        const out: Array<{ playerPubkey: string; mints: string[] }> = [];
        const cutoff = Date.now() - SessionManager.SQUAD_TTL_MS;
        for (const [playerPubkey, entry] of board) {
            if (entry.publishedAt < cutoff) continue;
            out.push({ playerPubkey, mints: entry.mints.slice() });
        }
        return out;
    }

    /** Register a read-only WS subscriber for a matchPda's squad events. */
    addMatchSpectator(matchPda: string, ws: WebSocket): void {
        let set = this.matchSpectators.get(matchPda);
        if (!set) {
            set = new Set();
            this.matchSpectators.set(matchPda, set);
        }
        set.add(ws);
    }

    removeMatchSpectator(matchPda: string, ws: WebSocket): void {
        const set = this.matchSpectators.get(matchPda);
        if (!set) return;
        set.delete(ws);
        if (set.size === 0) this.matchSpectators.delete(matchPda);
    }

    private broadcastMatchSquadEvent(matchPda: string, msg: unknown): void {
        const set = this.matchSpectators.get(matchPda);
        if (!set || set.size === 0) return;
        const payload = JSON.stringify(msg);
        for (const ws of set) {
            try {
                if (ws.readyState === WebSocket.OPEN) ws.send(payload);
            } catch (_) { /* ignore broken pipe */ }
        }
    }

    /**
     * Resolve each mint's expected block width via Birdeye. Falls back to
     * BASE_WIDTH (fully-permissive) if Birdeye returns nothing — better to
     * under-validate than fail honest players on a flaky upstream.
     */
    private async resolveExpectedWidths(mints: string[], window: string): Promise<Record<string, number>> {
        const typeParam = WINDOW_MAP[window] ?? '24h';
        const out: Record<string, number> = {};
        if (!this.birdeyeApiKey) {
            // No API key = dev mode, skip physics width checks.
            for (const m of mints) out[m] = 0;
            return out;
        }
        const url = `https://public-api.birdeye.so/defi/price_volume/multi?list_address=${mints.join(',')}&type=${typeParam}`;
        try {
            const res = await fetch(url, {
                headers: { 'accept': 'application/json', 'x-chain': 'solana', 'X-API-KEY': this.birdeyeApiKey },
            });
            if (!res.ok) {
                console.warn(`${TAG} birdeye HTTP ${res.status} — widths unknown, permissive mode`);
                for (const m of mints) out[m] = 0;
                return out;
            }
            const body = (await res.json()) as { data?: Record<string, { priceChangePercent?: number }> };
            for (const mint of mints) {
                const change = Number(body.data?.[mint]?.priceChangePercent ?? 0);
                out[mint] = Physics.widthFor(change);
            }
            return out;
        } catch (e) {
            console.warn(`${TAG} birdeye fetch error ${e} — permissive mode`);
            for (const m of mints) out[m] = 0;
            return out;
        }
    }

    private cleanup(): void {
        const now = Date.now();
        let removed = 0;
        for (const [id, s] of this.sessions) {
            if (now - s.startedAt > SESSION_TTL_MS) {
                this.sessions.delete(id);
                this.sessionsByMatchPda.delete(s.matchPda);
                // Close any lingering spectators; `ws.close()` triggers the
                // remove-spectator flow through their `close` listener.
                const specs = this.spectators.get(id);
                if (specs) {
                    for (const ws of specs) {
                        try { ws.close(); } catch (_) { /* ignore */ }
                    }
                    this.spectators.delete(id);
                }
                removed += 1;
            }
        }
        for (const [pk, unban] of this.blacklist) {
            if (unban <= now) this.blacklist.delete(pk);
        }
        // Part 12 B: keep dashboard gauges fresh even without new sessions.
        StatsBucket.setSessionsAlive(this.sessions.size);
        StatsBucket.setBlacklisted(this.blacklist.size);
        if (removed > 0) console.log(`${TAG} cleanup removed=${removed} alive=${this.sessions.size}`);
    }

    shutdown(): void {
        if (this.cleanupTimer) clearInterval(this.cleanupTimer);
        this.sessions.clear();
        this.blacklist.clear();
    }

    stats() {
        return {
            sessionsAlive: this.sessions.size,
            blacklisted: this.blacklist.size,
        };
    }
}
