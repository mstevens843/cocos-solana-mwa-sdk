/**
 * PortfolioRace.ts — live portfolio-delta race (betting-duel core).
 *
 * Given a squad of N mints and a time window, polls spot prices from
 * Birdeye at a window-appropriate cadence, tracks each token's % change
 * vs its entry price, and emits tick snapshots for the RacePanel UI to
 * render (countdown, hero number, per-token cards). When the window
 * elapses it fetches final prices and emits `onComplete(finalDeltaPct)`.
 *
 * Outcome lives on the client as a plain percentage; consumers encode
 * it to u32 via `ScoreEncoding.encodeDeltaPct` before submitting to
 * `settle_match`. We keep the encoding at the edge so this class is
 * reusable for paper-mode + WS broadcasts.
 */

import { Holding } from './TokenDuelRpc';
import { PriceFeed } from './PriceFeed';

const TAG = '[PortfolioRace]';

export interface PortfolioRaceOptions {
    /** Squad tokens; mint preferred, symbol fallback for native/unsupported. */
    tokens: Holding[];
    /** Match duration in ms. 0 or negative disables the window (unsupported). */
    windowMs: number;
    /** Live price source. Must implement `getSpotPrices(mints) → { [mint]: priceUsd }`. */
    priceFeed: PriceFeed;
    /** Fired on each poll tick with the current race state. */
    onTick?: (snapshot: RaceSnapshot) => void;
    /** Fired exactly once when the window closes with the final portfolio delta %. */
    onComplete: (finalDeltaPct: number) => void;
    /** Optional: called after entry prices resolve but before polling begins. AppUI uses this for tutorial. */
    onBeforeStart?: () => Promise<void>;
}

export interface RaceSnapshot {
    /** ms since start() resolved entry prices. */
    elapsedMs: number;
    /** Max(0, windowMs - elapsedMs). Decreases each tick. */
    remainingMs: number;
    /** Per-mint: { entryPrice, currentPrice, deltaPct }. Keys match input token mints. */
    perToken: Record<string, { entryPrice: number; currentPrice: number; deltaPct: number }>;
    /** Equal-weighted portfolio % change across all squad tokens with resolved prices. */
    portfolioDeltaPct: number;
    /** Number of tokens that had a usable price this tick (out of tokens.length). */
    resolvedCount: number;
}

export class PortfolioRace {
    private _opts: PortfolioRaceOptions;
    private _entryPrices: Record<string, number> = {};
    private _pollTimer: any = null;
    private _windowTimer: any = null;
    private _startedAt = 0;
    private _running = false;
    private _completed = false;
    private _mintKeys: string[] = [];

    constructor(opts: PortfolioRaceOptions) {
        this._opts = opts;
    }

    /**
     * Resolve entry prices, fire `onBeforeStart`, start polling + the window timer.
     * Fire-and-forget from the caller (AppUI).
     */
    async start(): Promise<void> {
        if (this._running) {
            console.log(`${TAG} start | ALREADY_RUNNING — ignoring`);
            return;
        }
        this._running = true;

        this._mintKeys = this._collectMintKeys(this._opts.tokens);
        console.log(`${TAG} start | tokens=${this._opts.tokens.length} mints=${this._mintKeys.length} windowMs=${this._opts.windowMs}`);

        // 1. Fetch entry prices. If a token has no price we proceed anyway —
        // equal-weighted average ignores unresolved tokens (prevents a single
        // unlisted mint from tanking the whole match with 0%).
        try {
            this._entryPrices = await this._opts.priceFeed.getSpotPrices(this._mintKeys);
        } catch (e: any) {
            console.log(`${TAG} start | ENTRY_FETCH_ERROR mints=${this._mintKeys.length} error=${e?.message ?? e} — aborting, emitting 0% delta`);
            this._completeOnce(0);
            return;
        }
        const resolvedEntries = Object.keys(this._entryPrices).length;
        console.log(`${TAG} start | entry_prices resolved=${resolvedEntries}/${this._mintKeys.length} sample=${JSON.stringify(this._sampleEntries(this._entryPrices))}`);
        if (resolvedEntries === 0) {
            console.log(`${TAG} start | NO_ENTRY_PRICES — aborting race, emitting 0% delta`);
            this._completeOnce(0);
            return;
        }

        // 2. Tutorial hook (optional, non-blocking errors).
        if (this._opts.onBeforeStart) {
            try {
                await this._opts.onBeforeStart();
            } catch (e) {
                console.log(`${TAG} start | onBeforeStart_error ${e} — continuing`);
            }
        }

        // 3. Start polling + arm window timer.
        this._startedAt = Date.now();
        this._scheduleNextPoll();
        if (this._opts.windowMs > 0) {
            this._windowTimer = setTimeout(() => void this._finalize(), this._opts.windowMs);
        }
        // Immediate first tick so UI shows entry state at t=0.
        void this._tick();
    }

    /** Explicit early termination — used when AppUI tears down the panel. */
    destroy(): void {
        console.log(`${TAG} destroy | EXPLICIT_TEARDOWN running=${this._running} completed=${this._completed} had_poll=${!!this._pollTimer} had_window=${!!this._windowTimer}`);
        if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
        if (this._windowTimer) { clearTimeout(this._windowTimer); this._windowTimer = null; }
        this._running = false;
    }

    /**
     * No-op kept for TokenDuelGame contract compatibility. Portfolio races
     * have no player input — the outcome is purely the price feed.
     */
    onTap(): void { /* no-op */ }

    // ── internals ────────────────────────────────────────────────────

    private _collectMintKeys(tokens: Holding[]): string[] {
        const keys: string[] = [];
        let dropped = 0;
        for (const t of tokens) {
            if (!t) { dropped++; continue; }
            const k = t.mint || t.symbol || '';
            if (!k) { dropped++; continue; }
            if (keys.includes(k)) { dropped++; continue; }
            keys.push(k);
        }
        if (dropped > 0) {
            console.log(`${TAG} _collectMintKeys | DROPPED in=${tokens.length} out=${keys.length} dropped=${dropped} (null_or_empty_or_duplicate)`);
        }
        return keys;
    }

    private _sampleEntries(p: Record<string, number>): Array<{ k: string; v: number }> {
        const out: Array<{ k: string; v: number }> = [];
        for (const k of Object.keys(p).slice(0, 3)) out.push({ k: k.slice(0, 8), v: Number(p[k].toFixed(8)) });
        return out;
    }

    private _scheduleNextPoll(): void {
        if (!this._running || this._completed) return;
        const interval = this._pollIntervalFor(this._opts.windowMs);
        this._pollTimer = setTimeout(() => void this._tick(), interval);
    }

    /**
     * Window-appropriate poll interval. Tuned to balance dopamine (frequent
     * updates on short matches) with Birdeye CU cost (infrequent on long).
     */
    private _pollIntervalFor(windowMs: number): number {
        if (windowMs <= 60_000)     return 1_000;      // ≤1m match → 1s
        if (windowMs <= 300_000)    return 5_000;      // ≤5m match → 5s
        if (windowMs <= 1_800_000)  return 30_000;     // ≤30m match → 30s
        if (windowMs <= 3_600_000)  return 60_000;     // ≤1h match → 1min
        return 600_000;                                // longer → 10min
    }

    private async _tick(): Promise<void> {
        if (!this._running || this._completed) return;
        const elapsed = Date.now() - this._startedAt;
        const remaining = this._opts.windowMs > 0 ? Math.max(0, this._opts.windowMs - elapsed) : 0;

        let current: Record<string, number>;
        try {
            current = await this._opts.priceFeed.getSpotPrices(this._mintKeys);
        } catch (e: any) {
            console.log(`${TAG} tick | TICK_FETCH_ERROR elapsed=${elapsed}ms remaining=${remaining}ms mints=${this._mintKeys.length} error=${e?.message ?? e} — skipping tick`);
            this._scheduleNextPoll();
            return;
        }
        const snapshot = this._buildSnapshot(current, elapsed, remaining);
        console.log(`${TAG} tick | elapsed=${elapsed}ms remaining=${remaining}ms portfolio=${snapshot.portfolioDeltaPct.toFixed(2)}% resolved=${snapshot.resolvedCount}/${this._mintKeys.length}`);
        try { this._opts.onTick?.(snapshot); } catch (e) { console.log(`${TAG} tick | onTick_error ${e}`); }
        this._scheduleNextPoll();
    }

    private async _finalize(): Promise<void> {
        if (this._completed) return;
        if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
        let current: Record<string, number>;
        try {
            current = await this._opts.priceFeed.getSpotPrices(this._mintKeys);
        } catch (e: any) {
            console.log(`${TAG} finalize | FINALIZE_FETCH_ERROR mints=${this._mintKeys.length} error=${e?.message ?? e} — completing with 0% (no end prices)`);
            this._completeOnce(0);
            return;
        }
        const snapshot = this._buildSnapshot(current, this._opts.windowMs, 0);
        console.log(`${TAG} finalize | final_portfolio=${snapshot.portfolioDeltaPct.toFixed(2)}% resolved=${snapshot.resolvedCount}/${this._mintKeys.length}`);
        try { this._opts.onTick?.(snapshot); } catch (_) { /* already logged */ }
        this._completeOnce(snapshot.portfolioDeltaPct);
    }

    private _completeOnce(deltaPct: number): void {
        if (this._completed) return;
        this._completed = true;
        this._running = false;
        try { this._opts.onComplete(deltaPct); } catch (e) { console.log(`${TAG} _completeOnce | onComplete_error ${e}`); }
    }

    private _buildSnapshot(current: Record<string, number>, elapsed: number, remaining: number): RaceSnapshot {
        const perToken: Record<string, { entryPrice: number; currentPrice: number; deltaPct: number }> = {};
        let sumPct = 0;
        let resolved = 0;
        const skips: Array<{ mint: string; reason: string }> = [];
        for (const mint of this._mintKeys) {
            const entry = this._entryPrices[mint];
            const cur = current[mint] ?? entry;
            if (!entry || entry <= 0) { skips.push({ mint, reason: 'no_entry' }); continue; }
            if (!Number.isFinite(cur) || cur <= 0) { skips.push({ mint, reason: 'no_current_or_invalid' }); continue; }
            const deltaPct = ((cur - entry) / entry) * 100;
            perToken[mint] = { entryPrice: entry, currentPrice: cur, deltaPct };
            sumPct += deltaPct;
            resolved += 1;
        }
        if (skips.length > 0) {
            const summary = skips.map((s) => `${s.mint.slice(0, 8)}:${s.reason}`).join(',');
            console.log(`${TAG} _buildSnapshot | SKIPS count=${skips.length}/${this._mintKeys.length} detail=${summary}`);
        }
        const portfolioDeltaPct = resolved > 0 ? sumPct / resolved : 0;
        return { elapsedMs: elapsed, remainingMs: remaining, perToken, portfolioDeltaPct, resolvedCount: resolved };
    }
}
