/**
 * MatchBrowser.ts — refresh + filter state for the FindMatchPanel.
 *
 * Wraps `findAllOpenMatchesUnfiltered` with auto-refresh + client-side
 * filter chips (mode / wagerTier / window / hideFull). The panel binds
 * once and calls `getRows()` every render.
 *
 * Filters are independent and ALL must match for a row to be visible.
 * Setting a filter to `null` means "any". hideFull is just a convenience —
 * the underlying RPC already excludes Active matches.
 */

import { TokenDuelRpc } from './TokenDuelRpc';
import { findAllOpenMatchesUnfiltered, findActiveMatchesUnfiltered, MatchState } from './MatchRpc';

const TAG = '[MatchBrowser]';

export type MatchBrowserMode = 'open' | 'live';

export interface MatchBrowserFilters {
    /** modeU8 (0..3) or null for any */
    mode: number | null;
    /** on-chain wager tier index (0..7) or null for any */
    wagerTier: number | null;
    /** windowU8 (0..3) or null for any */
    window: number | null;
    /** true → exclude lobbies that already matched their required count */
    hideFull: boolean;
}

export type MatchBrowserListener = (rows: MatchState[]) => void;

export class MatchBrowser {
    private _rpc: TokenDuelRpc;
    private _all: MatchState[] = [];
    private _filters: MatchBrowserFilters = { mode: null, wagerTier: null, window: null, hideFull: true };
    private _listeners: Set<MatchBrowserListener> = new Set();
    private _timer: any = null;
    private _refreshing = false;
    private _intervalMs: number;
    /** Phase H2 — toggle between open lobbies and live (Active) matches. */
    private _browserMode: MatchBrowserMode = 'open';

    constructor(rpc: TokenDuelRpc, intervalMs: number = 5000) {
        this._rpc = rpc;
        this._intervalMs = intervalMs;
    }

    /** Phase H2 — switch between open-lobbies and live-matches feeds. */
    setMode(mode: MatchBrowserMode): void {
        if (this._browserMode === mode) return;
        this._browserMode = mode;
        this._all = [];
        console.log(`${TAG} setMode | ${mode}`);
        this._fanout();
        // Trigger an immediate refresh in the new mode.
        void this.refresh();
    }

    getMode(): MatchBrowserMode { return this._browserMode; }

    /** Replace one or more filter dimensions. Pass `null` to clear a filter. */
    setFilter(patch: Partial<MatchBrowserFilters>): void {
        this._filters = { ...this._filters, ...patch };
        console.log(`${TAG} setFilter | mode=${this._filters.mode} tier=${this._filters.wagerTier} window=${this._filters.window} hideFull=${this._filters.hideFull}`);
        this._fanout();
    }

    getFilters(): MatchBrowserFilters {
        return { ...this._filters };
    }

    /** Most-recent matches that pass all active filters, sorted oldest-first. */
    getRows(): MatchState[] {
        const f = this._filters;
        return this._all.filter((m) => {
            if (f.mode !== null && m.mode !== f.mode) return false;
            if (f.wagerTier !== null && m.wagerTier !== f.wagerTier) return false;
            if (f.window !== null && m.timeWindow !== f.window) return false;
            if (f.hideFull && m.playerCount >= m.requiredPlayers) return false;
            return true;
        });
    }

    /** All matches before filters — useful for empty-state diagnostics. */
    getAllRowCount(): number {
        return this._all.length;
    }

    /** Subscribe to changes. Returns unsubscribe fn. */
    subscribe(fn: MatchBrowserListener): () => void {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    /** Single-shot refresh. Safe to call while auto-refresh is running. */
    async refresh(): Promise<void> {
        if (this._refreshing) {
            console.log(`${TAG} refresh | SKIP (already in flight)`);
            return;
        }
        this._refreshing = true;
        try {
            const rows = this._browserMode === 'live'
                ? await findActiveMatchesUnfiltered(this._rpc)
                : await findAllOpenMatchesUnfiltered(this._rpc);
            this._all = rows;
            console.log(`${TAG} refresh | mode=${this._browserMode} all=${rows.length} visible=${this.getRows().length}`);
            this._fanout();
        } catch (e: any) {
            console.log(`${TAG} refresh | ERROR ${e?.message ?? e}`);
        } finally {
            this._refreshing = false;
        }
    }

    /** Start the auto-refresh loop. Idempotent. Fires one immediate refresh. */
    start(): void {
        if (this._timer !== null) return;
        console.log(`${TAG} start | interval=${this._intervalMs}ms`);
        void this.refresh();
        this._timer = setInterval(() => { void this.refresh(); }, this._intervalMs);
    }

    /** Stop the auto-refresh loop. */
    stop(): void {
        if (this._timer === null) return;
        console.log(`${TAG} stop`);
        clearInterval(this._timer);
        this._timer = null;
    }

    /**
     * Re-arm the auto-refresh loop at a new interval. AppUI uses this to
     * throttle the home-screen browser to 15s (count-badge only, low RPC
     * pressure) and full 5s while the lobby is open. No-op if the new value
     * matches the current. Restarts the timer if it was running.
     */
    setIntervalMs(ms: number): void {
        if (ms <= 0 || ms === this._intervalMs) return;
        console.log(`${TAG} setIntervalMs | ${this._intervalMs}ms → ${ms}ms`);
        this._intervalMs = ms;
        if (this._timer !== null) {
            this.stop();
            this.start();
        }
    }

    private _fanout(): void {
        const rows = this.getRows();
        for (const fn of this._listeners) {
            try { fn(rows); } catch (e) { console.log(`${TAG} listener error ${e}`); }
        }
    }
}
