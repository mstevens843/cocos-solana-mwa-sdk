/**
 * Notifications.ts - Phase N1 client core for the notification system.
 *
 * Exports:
 *   - `NotificationKind` - enum-like union of the 11 notification kinds.
 *   - `Notification` - runtime shape of a single notification.
 *   - `NotificationStore` - singleton store with localStorage persistence.
 *
 * The store is the single source of truth for the bell badge + panel UI.
 * Locally-emitted notifications (from AppUI poll loops) and backend-pushed
 * notifications (Phase N6, via WS) both flow through `add()`.
 *
 * Persistence: writes JSON array to `tokenduel:notifications` (capped at
 * STORE_LIMIT entries). Mirrors the existing `(globalThis as any).sys?.localStorage`
 * fallback pattern used elsewhere in the codebase (AppUI.ts:8392-8403).
 */

const TAG = '[Notifications]';

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

export interface Notification {
    id: string;
    kind: NotificationKind;
    title: string;
    body: string;
    /** Arbitrary opaque data for deep-link handlers (matchPda, sol, level, etc). */
    payload?: Record<string, unknown>;
    /** Unix ms. */
    createdAt: number;
    /** Unix ms when marked read; null if unread. */
    readAt: number | null;
    /** Unix ms when dismissed/archived; null if visible. */
    dismissedAt: number | null;
    /**
     * If true, the toast overlay should NOT show this notification (it still
     * lands in the persistent feed). Used for events that already have their
     * own cinematic UI (e.g. level_up has `_showLevelUpOverlay`).
     */
    quietToast?: boolean;
}

export type NotificationListener = (snapshot: Notification[]) => void;

const STORAGE_KEY = 'tokenduel:notifications';
const STORE_LIMIT = 50;
const DEDUPE_WINDOW_MS = 60_000; // 60s suppression for same (kind, dedupeKey)

function getLs(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } | null {
    try {
        const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
        if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') return ls;
    } catch (_) { /* ignore */ }
    return null;
}

function genId(): string {
    try {
        const c = (globalThis as any).crypto;
        if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    } catch (_) { /* fall through */ }
    // Fallback: ts + random suffix; sufficiently unique for 50-entry buffer.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class NotificationStore {
    private static _instance: NotificationStore | null = null;

    /** Singleton accessor. Loads from localStorage on first call. */
    static get instance(): NotificationStore {
        if (!NotificationStore._instance) {
            NotificationStore._instance = new NotificationStore();
            NotificationStore._instance._restore();
        }
        return NotificationStore._instance;
    }

    private _list: Notification[] = []; // newest first
    private _listeners: Set<NotificationListener> = new Set();
    /** Tracks recent (kind, dedupeKey) → ts to suppress floods. */
    private _dedupeTs: Map<string, number> = new Map();
    /** DB Stage 10 - pubkey for fire-and-forget backend sync. Null = guest/disconnected. */
    private _syncPubkey: string | null = null;
    /** Ids that arrived via _ingestBackendEvent - never round-trip them back to the server. */
    private _serverOriginIds: Set<string> = new Set();

    /** Add a new notification. Returns the persisted record (with id+createdAt). */
    add(input: {
        kind: NotificationKind;
        title: string;
        body: string;
        payload?: Record<string, unknown>;
        quietToast?: boolean;
        /**
         * Optional dedupe key; calling add() twice with the same (kind,
         * dedupeKey) inside DEDUPE_WINDOW_MS is a no-op. Use for events
         * that may fire repeatedly (e.g. tournament_starting per-second).
         */
        dedupeKey?: string;
        /**
         * Optional id override - useful when the backend listener pushes
         * an event we may have already locally emitted. Same id → upsert
         * (no duplicate, no re-fire).
         */
        id?: string;
        /** Optional createdAt override (for backend-supplied timestamps). */
        createdAt?: number;
    }): Notification | null {
        // Dedupe within the window.
        if (input.dedupeKey) {
            const key = `${input.kind}:${input.dedupeKey}`;
            const last = this._dedupeTs.get(key) ?? 0;
            const now = Date.now();
            if (now - last < DEDUPE_WINDOW_MS) {
                console.log(`${TAG} add | DEDUPE_SUPPRESSED kind=${input.kind} key=${input.dedupeKey} since_last=${now - last}ms`);
                return null;
            }
            this._dedupeTs.set(key, now);
        }

        // Upsert by id if supplied.
        if (input.id) {
            const existing = this._list.find((n) => n.id === input.id);
            if (existing) {
                console.log(`${TAG} add | UPSERT_SKIP id=${input.id}`);
                return existing;
            }
        }

        const n: Notification = {
            id: input.id ?? genId(),
            kind: input.kind,
            title: input.title,
            body: input.body,
            payload: input.payload,
            quietToast: input.quietToast,
            createdAt: input.createdAt ?? Date.now(),
            readAt: null,
            dismissedAt: null,
        };
        this._list.unshift(n);
        if (this._list.length > STORE_LIMIT) this._list.length = STORE_LIMIT;
        console.log(`${TAG} add | id=${n.id.slice(0, 8)} kind=${n.kind} title="${n.title}" total=${this._list.length}`);
        this._persist();
        this._fanout();
        // DB Stage 10 - fire-and-forget backend write for *locally-emitted*
        // notifications. Server-origin entries (those passed through with
        // markServerOrigin) are not echoed back, since the server already
        // knows about them.
        if (this._syncPubkey && !this._serverOriginIds.has(n.id)) {
            this._postNotification(n);
        }
        return n;
    }

    markRead(id: string): boolean {
        const n = this._list.find((x) => x.id === id);
        if (!n || n.readAt !== null) return false;
        n.readAt = Date.now();
        console.log(`${TAG} markRead | id=${id.slice(0, 8)}`);
        this._persist();
        this._fanout();
        if (this._syncPubkey) this._postRead(id);
        return true;
    }

    markAllRead(): number {
        const now = Date.now();
        let count = 0;
        const newlyReadIds: string[] = [];
        for (const n of this._list) {
            if (n.readAt === null && n.dismissedAt === null) {
                n.readAt = now;
                count += 1;
                newlyReadIds.push(n.id);
            }
        }
        if (count > 0) {
            console.log(`${TAG} markAllRead | count=${count}`);
            this._persist();
            this._fanout();
            if (this._syncPubkey) {
                for (const id of newlyReadIds) this._postRead(id);
            }
        }
        return count;
    }

    dismiss(id: string): boolean {
        const n = this._list.find((x) => x.id === id);
        if (!n || n.dismissedAt !== null) return false;
        n.dismissedAt = Date.now();
        if (n.readAt === null) n.readAt = n.dismissedAt;
        console.log(`${TAG} dismiss | id=${id.slice(0, 8)}`);
        this._persist();
        this._fanout();
        return true;
    }

    dismissAll(): number {
        const now = Date.now();
        let count = 0;
        for (const n of this._list) {
            if (n.dismissedAt === null) {
                n.dismissedAt = now;
                if (n.readAt === null) n.readAt = now;
                count += 1;
            }
        }
        if (count > 0) {
            console.log(`${TAG} dismissAll | count=${count}`);
            this._persist();
            this._fanout();
        }
        return count;
    }

    /** Visible (non-dismissed) notifications, newest first. */
    getRecent(limit: number = 20): Notification[] {
        return this._list.filter((n) => n.dismissedAt === null).slice(0, limit);
    }

    getUnreadCount(): number {
        return this._list.reduce(
            (acc, n) => acc + (n.readAt === null && n.dismissedAt === null ? 1 : 0),
            0,
        );
    }

    /** Most recent createdAt across the store (or 0 if empty). Used for backend `since` cursor. */
    getLastSeenTs(): number {
        return this._list.length > 0 ? this._list[0].createdAt : 0;
    }

    /** Subscribe to changes; returns unsubscribe fn. Listener receives a fresh snapshot every change. */
    subscribe(listener: NotificationListener): () => void {
        this._listeners.add(listener);
        // Fire once immediately so subscribers can paint initial state.
        try { listener(this._snapshot()); } catch (e) { console.log(`${TAG} subscribe | initial fire ${e}`); }
        return () => { this._listeners.delete(listener); };
    }

    /** Wipe everything - used by tests + a future "clear all" UX. */
    clear(): void {
        this._list = [];
        this._dedupeTs.clear();
        this._persist();
        this._fanout();
    }

    // ── DB Stage 10 - backend sync ─────────────────────────────────────

    /** Bind to a pubkey for cross-device sync. Pass null to detach (guest mode / disconnect). */
    setSyncPubkey(pubkey: string | null): void {
        this._syncPubkey = pubkey || null;
    }

    /**
     * Mark an id as server-origin so add() doesn't echo it back to the
     * server. Called by AppUI._ingestBackendEvent before delegating to
     * add(). Bounded so the set can't grow unbounded over a long session.
     */
    markServerOrigin(id: string): void {
        this._serverOriginIds.add(id);
        // Trim the set if it gets too big - we only need recent ids.
        if (this._serverOriginIds.size > STORE_LIMIT * 2) {
            const arr = Array.from(this._serverOriginIds);
            this._serverOriginIds = new Set(arr.slice(arr.length - STORE_LIMIT));
        }
    }

    /**
     * Pull the server's notification list and merge in. Server is
     * authoritative on read_at/dismissed_at - once read on Device A, stays
     * read on Device B. Local entries the server hasn't seen survive.
     */
    async hydrateFromBackend(pubkey: string): Promise<void> {
        if (!pubkey) return;
        try {
            const { fetchNotifications } = await import('./NotificationsRpc');
            const remote = await fetchNotifications(pubkey, 0, STORE_LIMIT);
            if (!remote) return;
            const localById = new Map<string, Notification>(this._list.map((n) => [n.id, n]));
            for (const ev of remote.events) {
                this.markServerOrigin(ev.id);
                const existing = localById.get(ev.id);
                const remoteReadAt = (ev as any).readAt ?? null;
                const merged: Notification = {
                    id: ev.id,
                    kind: ev.kind as NotificationKind,
                    title: ev.title,
                    body: ev.body,
                    payload: ev.payload,
                    createdAt: ev.createdAt,
                    // Server wins on readAt - once read anywhere, stays read.
                    readAt: typeof remoteReadAt === 'number' ? remoteReadAt
                          : existing?.readAt ?? null,
                    // dismissed is currently device-local (no server column for it on this route);
                    // preserve local value if any.
                    dismissedAt: existing?.dismissedAt ?? null,
                    // Hydrated entries are historical by definition - silence their
                    // toast so they don't fire over the home on every reconnect.
                    // The backend doesn't persist quietToast (no column), so we'd
                    // otherwise re-toast every level_up / payout / match_settled
                    // every cold start. Local entries (still-fresh toast in flight)
                    // keep whatever flag they had.
                    quietToast: existing?.quietToast ?? true,
                };
                localById.set(ev.id, merged);
            }
            // Rebuild list: server entries + any local-only entries, newest first, capped.
            const all = Array.from(localById.values()).sort((a, b) => b.createdAt - a.createdAt);
            this._list = all.slice(0, STORE_LIMIT);
            this._persist();
            this._fanout();
            console.log(`${TAG} hydrate | server_count=${remote.events.length} merged_count=${this._list.length}`);
        } catch (e) {
            console.log(`${TAG} hydrate | ERR ${e}`);
        }
    }

    private _postNotification(n: Notification): void {
        const pubkey = this._syncPubkey;
        if (!pubkey) return;
        void (async () => {
            try {
                const { postNotification } = await import('./NotificationsRpc');
                await postNotification(pubkey, {
                    id: n.id,
                    kind: n.kind,
                    title: n.title,
                    body: n.body,
                    payload: n.payload,
                    createdAt: n.createdAt,
                });
            } catch (e) {
                console.log(`${TAG} _postNotification | NET_ERR ${e}`);
            }
        })();
    }

    private _postRead(id: string): void {
        const pubkey = this._syncPubkey;
        if (!pubkey) return;
        void (async () => {
            try {
                const { postNotificationRead } = await import('./NotificationsRpc');
                await postNotificationRead(pubkey, id);
            } catch (e) {
                console.log(`${TAG} _postRead | NET_ERR ${e}`);
            }
        })();
    }

    // ── internals ────────────────────────────────────────────────────

    private _fanout(): void {
        const snap = this._snapshot();
        for (const fn of this._listeners) {
            try { fn(snap); } catch (e) { console.log(`${TAG} fanout | listener error ${e}`); }
        }
    }

    private _snapshot(): Notification[] {
        // Return a shallow copy so subscribers can't mutate internal state.
        return this._list.slice();
    }

    private _persist(): void {
        const ls = getLs();
        if (!ls) return;
        try {
            ls.setItem(STORAGE_KEY, JSON.stringify(this._list));
        } catch (e) {
            console.log(`${TAG} persist | ERROR ${e}`);
        }
    }

    private _restore(): void {
        const ls = getLs();
        if (!ls) return;
        try {
            const raw = ls.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return;
            // Trust shape but coerce missing fields.
            this._list = parsed
                .filter((n: any) => n && typeof n.id === 'string' && typeof n.kind === 'string')
                .map((n: any) => ({
                    id: String(n.id),
                    kind: n.kind as NotificationKind,
                    title: String(n.title ?? ''),
                    body: String(n.body ?? ''),
                    payload: n.payload ?? undefined,
                    createdAt: Number.isFinite(n.createdAt) ? Number(n.createdAt) : Date.now(),
                    readAt: n.readAt === null ? null : (Number.isFinite(n.readAt) ? Number(n.readAt) : null),
                    dismissedAt: n.dismissedAt === null ? null : (Number.isFinite(n.dismissedAt) ? Number(n.dismissedAt) : null),
                    quietToast: !!n.quietToast,
                }))
                .slice(0, STORE_LIMIT);
            console.log(`${TAG} restore | loaded=${this._list.length} unread=${this.getUnreadCount()}`);
        } catch (e) {
            console.log(`${TAG} restore | ERROR ${e}`);
        }
    }
}
