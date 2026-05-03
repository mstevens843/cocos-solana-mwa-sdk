/**
 * notification_store.ts - Phase N5 backend notification queue.
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
 * DB Stage 6: write-through Postgres cache. push() persists each event in
 * the `notifications` table; getRecent() backfills the in-memory ring on
 * first request after restart. WS push remains in-memory for low-latency
 * live delivery.
 */

import { WebSocket } from 'ws';
import { dbConfigured, query } from './db';
import { touchUser } from './users';

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
    /** DB Stage 6 - pubkeys whose in-memory ring has been hydrated from DB. */
    private _hydrated: Set<string> = new Set();

    /** DB Stage 6 - fire-and-forget DB write. Failures don't block in-memory push. */
    private _persistAsync(event: NotificationEvent): void {
        if (!dbConfigured()) return;
        // Touch user FK first (notifications.pubkey REFERENCES users.pubkey).
        void touchUser(event.player).then(() =>
            query(
                `INSERT INTO notifications (id, pubkey, kind, title, body, payload, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, to_timestamp($7 / 1000.0))
                 ON CONFLICT (id) DO NOTHING`,
                [event.id, event.player, event.kind, event.title, event.body, JSON.stringify(event.payload ?? {}), event.createdAt],
            )
        ).catch((e: any) => {
            console.log(`${TAG} persist_err | id=${event.id} ${e?.message ?? e}`);
        });
    }

    /** DB Stage 6 - hydrate in-memory ring from DB on first read. */
    private async _hydrateFromDb(player: string): Promise<void> {
        if (this._hydrated.has(player)) return;
        if (!dbConfigured()) { this._hydrated.add(player); return; }
        try {
            const rows = await query<{
                id: string; pubkey: string; kind: string; title: string; body: string;
                payload: any; created_at: Date; read_at: Date | null;
            }>(
                `SELECT id, pubkey, kind, title, body, payload, created_at, read_at
                 FROM notifications WHERE pubkey = $1
                 ORDER BY created_at DESC LIMIT $2`,
                [player, STORE_LIMIT_PER_PLAYER],
            );
            const buf: NotificationEvent[] = rows.map((r) => ({
                id: r.id,
                kind: r.kind as NotificationKind,
                player: r.pubkey,
                title: r.title,
                body: r.body,
                payload: r.payload ?? {},
                createdAt: r.created_at instanceof Date ? r.created_at.getTime() : Number(r.created_at),
            }));
            // Merge with any in-memory entries (push could have arrived during hydration).
            const existing = this._byPlayer.get(player) ?? [];
            const seen = new Set(existing.map((e) => e.id));
            const merged = [...existing, ...buf.filter((e) => !seen.has(e.id))];
            // Sort newest-first, cap to limit.
            merged.sort((a, b) => b.createdAt - a.createdAt);
            this._byPlayer.set(player, merged.slice(0, STORE_LIMIT_PER_PLAYER));
            // Backfill _readBy from DB read_at.
            const readSet = this._readBy.get(player) ?? new Set<string>();
            for (const r of rows) if (r.read_at !== null) readSet.add(r.id);
            this._readBy.set(player, readSet);
            console.log(`${TAG} hydrate | player=${player.slice(0, 8)} loaded=${rows.length} merged=${merged.length}`);
        } catch (e: any) {
            console.log(`${TAG} hydrate_err | player=${player.slice(0, 8)} ${e?.message ?? e}`);
        } finally {
            this._hydrated.add(player);
        }
    }

    /** Push a new event for `player`. Returns the persisted record. */
    push(input: Omit<NotificationEvent, 'createdAt'> & { createdAt?: number }): NotificationEvent {
        const event: NotificationEvent = {
            ...input,
            createdAt: input.createdAt ?? Date.now(),
        };
        let buf = this._byPlayer.get(event.player);
        if (!buf) { buf = []; this._byPlayer.set(event.player, buf); }
        // Dedupe - drop if same id already present in the buffer.
        if (buf.some((e) => e.id === event.id)) {
            console.log(`${TAG} push | DEDUPE_SKIP id=${event.id} player=${event.player.slice(0, 8)}`);
            return event;
        }
        buf.unshift(event);
        if (buf.length > STORE_LIMIT_PER_PLAYER) buf.length = STORE_LIMIT_PER_PLAYER;
        console.log(`${TAG} push | id=${event.id} kind=${event.kind} player=${event.player.slice(0, 8)} buf_len=${buf.length}`);
        // DB Stage 6 - persist to Postgres in parallel. Fire-and-forget; failures
        // are logged but don't block the in-memory + WS push path.
        this._persistAsync(event);
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

    /**
     * Recent (non-stale, non-read?) events for a player, optionally since a ts.
     *
     * DB Stage 6: hydrates the in-memory ring from `notifications` table on
     * first call per pubkey (covers backend-restart case). Subsequent calls
     * read directly from the in-memory cache.
     */
    async getRecent(player: string, since?: number, limit: number = STORE_LIMIT_PER_PLAYER): Promise<NotificationEvent[]> {
        await this._hydrateFromDb(player);
        const buf = this._byPlayer.get(player) ?? [];
        const cutoff = Date.now() - STALE_PRUNE_MS;
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
        // DB Stage 6 - persist read_at. Fire-and-forget.
        if (dbConfigured()) {
            void query(
                `UPDATE notifications SET read_at = now() WHERE id = $1 AND pubkey = $2 AND read_at IS NULL`,
                [id, player],
            ).catch((e: any) => console.log(`${TAG} mark_read_err | id=${id} ${e?.message ?? e}`));
        }
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
