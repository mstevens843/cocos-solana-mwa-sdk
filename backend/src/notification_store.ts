/**
 * notification_store.ts — Phase N5 backend notification queue.
 *
 * Per-pubkey ring buffer of notification events plus a per-pubkey set of
 * subscribed WebSockets. The on-chain log listener (`notification_listener.ts`)
 * pushes events; clients fetch via REST (`GET /notifications/:pubkey`)
 * for cold-launch catchup and via WS (`/notifications/:pubkey/stream`)
 * for live delivery.
 *
 * Identity of an event is the deterministic id derived from
 * `(matchPda, kind, slot)` so the SAME event arriving from multiple
 * sources collapses on the client side via dedupe-by-id.
 *
 * In-memory only for v1. ~50 events × ~2KB × N players is small. For
 * multi-replica scale, swap for Redis with same API.
 */

import { WebSocket } from 'ws';

const TAG = '[notification_store]';

export type NotificationKind =
    | 'match_filled'
    | 'match_started'
    | 'match_settled'
    | 'payout'
    | 'match_expired'
    | 'lobby_cancelled'
    | 'level_up'
    | 'streak_milestone'
    | 'tournament_starting'
    | 'tournament_full'
    | 'challenge_done';

export interface NotificationEvent {
    /** Deterministic id, e.g. "settled:<matchPda>:<player>". */
    id: string;
    kind: NotificationKind;
    /** Recipient pubkey. */
    player: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    /** Unix ms. */
    createdAt: number;
}

const STORE_LIMIT_PER_PLAYER = 50;
/** Prune events older than this many ms when clients fetch. */
const STALE_PRUNE_MS = 24 * 60 * 60 * 1000;

export class NotificationStore {
    private _byPlayer: Map<string, NotificationEvent[]> = new Map();
    private _subscribers: Map<string, Set<WebSocket>> = new Map();
    private _readBy: Map<string, Set<string>> = new Map();

    /** Push a new event for `player`. Returns the persisted record. */
    push(input: Omit<NotificationEvent, 'createdAt'> & { createdAt?: number }): NotificationEvent {
        const event: NotificationEvent = {
            ...input,
            createdAt: input.createdAt ?? Date.now(),
        };
        let buf = this._byPlayer.get(event.player);
        if (!buf) { buf = []; this._byPlayer.set(event.player, buf); }
        // Dedupe — drop if same id already present in the buffer.
        if (buf.some((e) => e.id === event.id)) {
            console.log(`${TAG} push | DEDUPE_SKIP id=${event.id} player=${event.player.slice(0, 8)}`);
            return event;
        }
        buf.unshift(event);
        if (buf.length > STORE_LIMIT_PER_PLAYER) buf.length = STORE_LIMIT_PER_PLAYER;
        console.log(`${TAG} push | id=${event.id} kind=${event.kind} player=${event.player.slice(0, 8)} buf_len=${buf.length}`);
        // Broadcast to live subscribers.
        const subs = this._subscribers.get(event.player);
        if (subs && subs.size > 0) {
            const msg = JSON.stringify({ kind: 'event', event });
            for (const ws of subs) {
                if (ws.readyState === WebSocket.OPEN) {
                    try { ws.send(msg); } catch (_) { /* ignore */ }
                }
            }
        }
        return event;
    }

    /** Recent (non-stale, non-read?) events for a player, optionally since a ts. */
    getRecent(player: string, since?: number, limit: number = STORE_LIMIT_PER_PLAYER): NotificationEvent[] {
        const buf = this._byPlayer.get(player) ?? [];
        const cutoff = Date.now() - STALE_PRUNE_MS;
        // Lazy prune anything stale.
        const fresh = buf.filter((e) => e.createdAt >= cutoff);
        if (fresh.length !== buf.length) this._byPlayer.set(player, fresh);
        const sinceTs = since ?? 0;
        return fresh
            .filter((e) => e.createdAt > sinceTs)
            .slice(0, limit);
    }

    markRead(player: string, id: string): boolean {
        let set = this._readBy.get(player);
        if (!set) { set = new Set(); this._readBy.set(player, set); }
        if (set.has(id)) return false;
        set.add(id);
        return true;
    }

    isRead(player: string, id: string): boolean {
        return this._readBy.get(player)?.has(id) ?? false;
    }

    /** Subscribe a WS to live events for `player`. Returns unsubscribe fn. */
    subscribe(player: string, ws: WebSocket): () => void {
        let set = this._subscribers.get(player);
        if (!set) { set = new Set(); this._subscribers.set(player, set); }
        set.add(ws);
        console.log(`${TAG} subscribe | player=${player.slice(0, 8)} subs=${set.size}`);
        return () => {
            const s = this._subscribers.get(player);
            if (s) {
                s.delete(ws);
                if (s.size === 0) this._subscribers.delete(player);
            }
        };
    }

    /** Stats for /health. */
    stats(): { players: number; totalEvents: number; subscribers: number } {
        let totalEvents = 0;
        for (const buf of this._byPlayer.values()) totalEvents += buf.length;
        let subscribers = 0;
        for (const s of this._subscribers.values()) subscribers += s.size;
        return { players: this._byPlayer.size, totalEvents, subscribers };
    }
}
