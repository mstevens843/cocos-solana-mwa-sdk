/**
 * PriceFeed.ts — Live 24h price feed backed by Birdeye.
 *
 * Replaces (but does not remove) `PriceFeedMock`. The mock remains the
 * fallback path when (a) Birdeye is unreachable, (b) the API key is
 * blank/invalid, or (c) the caller set `globalThis.TD_DEMO_SEED` to lock
 * deterministic deltas for a pitch-video recording.
 *
 * Two consumption modes:
 *
 *   1. One-shot: `getSessionDeltas(mints)` — returns a map of mint → 24h %
 *      as `{ [mint]: number }`. Mirrors the old PriceFeedMock signature so
 *      TokenDuelGame can drop this in without structural changes.
 *
 *   2. Streaming: `start(mints, onTick)` starts a 15s polling loop that
 *      calls Birdeye and feeds each update to `onTick`. `stop()` cancels.
 *      Used by the squad picker to animate live delta pulses on tiles.
 */

import { BirdeyeClient } from './birdeye/BirdeyeClient';
import { PriceUpdate, TokenRow } from './birdeye/types';
import { PRICE_FEED_POLL_MS } from './constants';
import { TIME_WINDOWS, TimeWindowId, DEFAULT_TIME_WINDOW } from './ModeDefs';

const TAG = '[PriceFeed]';

export type PriceTickListener = (updates: Record<string, PriceUpdate>) => void;

export class PriceFeed {
    private readonly _client: BirdeyeClient;
    private _timer: number | null = null;
    private _lastMints: string[] = [];
    /** Part 9: currently-selected Birdeye `type` param (1h/24h/3d/7d). */
    private _currentTimeframe: string = TIME_WINDOWS[DEFAULT_TIME_WINDOW].birdeyeTypeParam;

    constructor(client?: BirdeyeClient) {
        this._client = client ?? new BirdeyeClient();
        console.log(`${TAG} ctor | DONE poll_ms=${PRICE_FEED_POLL_MS} default_timeframe=${this._currentTimeframe}`);
    }

    /**
     * Part 9: switch the session's price window. Called once per match,
     * before `getSessionDeltas`, from AppUI's match-start flow.
     */
    setTimeframe(window: TimeWindowId): void {
        const def = TIME_WINDOWS[window];
        if (!def) {
            console.log(`${TAG} setTimeframe | UNKNOWN_WINDOW window="${window}" — keeping ${this._currentTimeframe}`);
            return;
        }
        const prev = this._currentTimeframe;
        this._currentTimeframe = def.birdeyeTypeParam;
        console.log(`${TAG} setTimeframe | DONE prev=${prev} next=${this._currentTimeframe} (window=${window})`);
    }

    /**
     * One-shot fetch; returns a mint-keyed record of 24h %.
     *
     * Falls back to `PriceFeedMock` when:
     *   - `mints` is empty
     *   - `globalThis.TD_DEMO_SEED` is set (pitch-video lock)
     *   - Birdeye returns an empty map (e.g. unknown mints, API down)
     *
     * Contract: returns a record with ONE key per input mint. Missing
     * mints get 0.0 rather than being omitted, so the game-difficulty
     * calculation in TokenDuelGame never NaN's.
     */
    async getSessionDeltas(mints: string[]): Promise<Record<string, number>> {
        console.log(`${TAG} getSessionDeltas | START mints=${mints.length}`);

        if (mints.length === 0) {
            console.log(`${TAG} getSessionDeltas | EMPTY_MINTS returning {}`);
            return {};
        }

        // Deterministic-seed override (pitch-video recording) previously
        // routed through PriceFeedMock; on betting-duel we drop the mock
        // and return an empty map — callers must tolerate missing keys.
        const seed = (globalThis as any).TD_DEMO_SEED;
        if (typeof seed === 'number') {
            console.log(`${TAG} getSessionDeltas | DEMO_SEED_OVERRIDE seed=${seed} — mock removed on betting-duel, returning {}`);
            return {};
        }

        let live: Record<string, { priceUsd: number; change24hPct: number; volume24hUsd: number }>;
        try {
            live = await this._client.priceMulti(mints, this._currentTimeframe);
        } catch (e) {
            console.log(`${TAG} getSessionDeltas | CLIENT_ERROR error=${e} — returning {} (no mock fallback on betting-duel)`);
            return {};
        }
        const haveAny = Object.keys(live).length > 0;
        if (!haveAny) {
            console.log(`${TAG} getSessionDeltas | BIRDEYE_EMPTY mints=${mints.length} — returning {} (no mock fallback on betting-duel)`);
            return {};
        }

        const out: Record<string, number> = {};
        let missing = 0;
        let nanGuarded = 0;
        for (const m of mints) {
            const entry = live[m];
            if (!entry) { out[m] = 0; missing++; continue; }
            const raw = entry.change24hPct;
            if (!Number.isFinite(raw)) {
                console.log(`${TAG} getSessionDeltas | NAN_CHANGE mint=${m} raw=${raw} — coercing to 0`);
                out[m] = 0;
                nanGuarded++;
                continue;
            }
            out[m] = Math.round(raw * 10) / 10;
        }
        console.log(`${TAG} getSessionDeltas | DONE mints=${mints.length} live=${Object.keys(live).length} missing=${missing} nan_guarded=${nanGuarded} deltas=${JSON.stringify(out)}`);
        return out;
    }

    /**
     * Begin a polling loop against Birdeye every `PRICE_FEED_POLL_MS` ms.
     * Calls `onTick` once immediately, then on each interval.
     *
     * Idempotent — calling `start` with new mints stops the previous loop.
     */
    start(mints: string[], onTick: PriceTickListener): void {
        console.log(`${TAG} start | START mints=${mints.length}`);
        this.stop();
        this._lastMints = mints.slice();

        if (typeof setInterval !== 'function') {
            // Cocos Android runtime exposes setInterval via the JSB bridge — if
            // it's missing, the app is running in a stripped-down env (tests,
            // headless tooling). Fire a single tick instead of silent no-op.
            console.log(`${TAG} start | NO_SET_INTERVAL — firing one-shot tick only`);
            this._client.priceMulti(this._lastMints, this._currentTimeframe).then((updates) => {
                try { onTick(updates); } catch (e) { console.log(`${TAG} start.tick | LISTENER_ERROR error=${e}`); }
            }).catch((e) => console.log(`${TAG} start | ONE_SHOT_ERROR error=${e}`));
            return;
        }

        const tick = async () => {
            try {
                const updates = await this._client.priceMulti(this._lastMints, this._currentTimeframe);
                console.log(`${TAG} start.tick | mints=${this._lastMints.length} got=${Object.keys(updates).length} timeframe=${this._currentTimeframe}`);
                try { onTick(updates); } catch (e) {
                    console.log(`${TAG} start.tick | LISTENER_ERROR error=${e}`);
                }
            } catch (e) {
                // priceMulti already logs its own errors, but catch here too so
                // one failed tick doesn't kill the interval (unhandled rejection
                // in some runtimes aborts the timer callback).
                console.log(`${TAG} start.tick | CLIENT_ERROR error=${e}`);
            }
        };

        // Immediate first tick so the UI shows something before the first interval.
        tick();
        this._timer = setInterval(tick, PRICE_FEED_POLL_MS) as unknown as number;
        console.log(`${TAG} start | DONE poll_ms=${PRICE_FEED_POLL_MS} timer_id=${this._timer}`);
    }

    /** Update the mint list without restarting the interval. */
    setMints(mints: string[]): void {
        this._lastMints = mints.slice();
        console.log(`${TAG} setMints | DONE mints=${this._lastMints.length}`);
    }

    /**
     * Session 11: backfill price / 24h% / volume on rows that came back from
     * Birdeye without them. Particularly for `/defi/v2/tokens/new_listing`
     * which only returns address + symbol + liquidity — the trade-tab UI
     * needs price + change to render sensibly.
     *
     * Only calls Birdeye when there ARE rows missing data. Returns a NEW
     * array (immutable semantics) so callers can diff old vs new for
     * change animations.
     */
    async enrichRows(rows: TokenRow[]): Promise<TokenRow[]> {
        const candidates = rows.filter((r) => r.address && (r.priceUsd === 0 || r.change24hPct === 0));
        if (candidates.length === 0) {
            console.log(`${TAG} enrichRows | ENRICH_SKIP reason=nothing_missing rows=${rows.length}`);
            return rows;
        }
        console.log(`${TAG} enrichRows | ENRICH_START candidates=${candidates.length} total=${rows.length}`);
        const mints = candidates.map((r) => r.address);
        let live: Record<string, PriceUpdate>;
        try {
            live = await this._client.priceMulti(mints);
        } catch (e) {
            console.log(`${TAG} enrichRows | ENRICH_ERROR error=${e} — returning rows as-is`);
            return rows;
        }
        let applied = 0;
        const out = rows.map((r) => {
            const entry = live[r.address];
            if (!entry) return r;
            applied++;
            return {
                ...r,
                priceUsd: r.priceUsd || entry.priceUsd,
                change24hPct: r.change24hPct || entry.change24hPct,
                volume24hUsd: r.volume24hUsd || entry.volume24hUsd,
            };
        });
        console.log(`${TAG} enrichRows | ENRICH_DONE applied=${applied} skipped=${candidates.length - applied}`);
        return out;
    }

    /**
     * Session 11: backfill logo / name / symbol via Birdeye meta-data/multiple.
     * Opt-in because it costs CU; call only for rows with missing logos on
     * tabs where it matters (trending/smart-money tend to have gaps).
     */
    async enrichLogos(rows: TokenRow[]): Promise<TokenRow[]> {
        const needLogo = rows.filter((r) => r.address && !r.logoUri);
        if (needLogo.length === 0) {
            console.log(`${TAG} enrichLogos | SKIP reason=all_have_logos rows=${rows.length}`);
            return rows;
        }
        console.log(`${TAG} enrichLogos | START candidates=${needLogo.length} total=${rows.length}`);
        let meta;
        try {
            meta = await this._client.getMetaDataMulti(needLogo.map((r) => r.address));
        } catch (e) {
            console.log(`${TAG} enrichLogos | ERROR error=${e} — returning rows as-is`);
            return rows;
        }
        let applied = 0;
        const out = rows.map((r) => {
            const m = meta[r.address];
            if (!m || !m.logoUri) return r;
            applied++;
            return { ...r, logoUri: r.logoUri || m.logoUri, name: r.name || m.name };
        });
        console.log(`${TAG} enrichLogos | DONE applied=${applied}`);
        return out;
    }

    stop(): void {
        if (this._timer !== null) {
            clearInterval(this._timer as unknown as number);
            console.log(`${TAG} stop | timer_cleared`);
            this._timer = null;
        }
    }
}
