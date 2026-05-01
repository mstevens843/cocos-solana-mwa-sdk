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
import { JupiterPriceClient } from './jupiter/JupiterPriceClient';
import { PRICE_FEED_POLL_MS } from './constants';
import { TIME_WINDOWS, TimeWindowId, DEFAULT_TIME_WINDOW } from './ModeDefs';

const TAG = '[PriceFeed]';

export type PriceTickListener = (updates: Record<string, PriceUpdate>) => void;

export class PriceFeed {
    private readonly _client: BirdeyeClient;
    /**
     * Lazy-init fallback price source. Birdeye `/defi/multi_price` has
     * narrower coverage than its trending feed; squad picks that came from
     * trending sometimes never resolve via multi_price (small-caps and
     * pump.fun graduates), which would otherwise freeze each player card
     * at +0.00% for the whole race. Jupiter fills those gaps.
     */
    private _jupiterClient: JupiterPriceClient | null = null;
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

        // betting-duel: portfolio race drives its delta via spotPriceMulti
        // (entry price vs. current price), not Birdeye's 24h-delta window.
        // Skip the priceMulti round-trip so we don't log NULL_RESPONSE 404
        // for newly-launched pump.fun mints every match. Callers tolerate
        // an empty map (fallback entry prices come from the trending feed
        // snapshot already cached on the squad).
        console.log(`${TAG} getSessionDeltas | BETTING_DUEL_SKIP_24H_DELTA mints=${mints.length} — spotPriceMulti drives the race`);
        return {};
    }

    /**
     * Spot-price fetch used by PortfolioRace for live window computation.
     *
     * Returns a mint-keyed record of USD prices at the moment Birdeye
     * answered. Missing mints are omitted (caller must tolerate absence).
     *
     * Uses `/defi/multi_price` (broader token coverage than
     * `/defi/price_volume/multi` — new pump.fun tokens that 404 on the
     * latter resolve here). Delegates to BirdeyeClient.spotPriceMulti
     * which swallows network errors and returns {} on failure.
     */
    async getSpotPrices(mints: string[]): Promise<Record<string, number>> {
        console.log(`${TAG} getSpotPrices | START mints=${mints.length}`);
        if (mints.length === 0) {
            console.log(`${TAG} getSpotPrices | EMPTY_MINTS returning {}`);
            return {};
        }
        const birdeye = await this._client.spotPriceMulti(mints);
        const missing = mints.filter((m) => !(m in birdeye));
        if (missing.length === 0) {
            console.log(`${TAG} getSpotPrices | DONE mints=${mints.length} birdeye=${Object.keys(birdeye).length} jupiter=0 still_missing=0`);
            return birdeye;
        }
        // Jupiter fallback for the long tail Birdeye doesn't index. Lazy-init
        // because most well-known mints resolve via Birdeye and the client is
        // never needed.
        if (!this._jupiterClient) this._jupiterClient = new JupiterPriceClient();
        const jupiter = await this._jupiterClient.fetchPrices(missing);
        // Birdeye wins on overlap (it can't happen since we only asked Jupiter
        // for mints Birdeye missed, but spread order makes the precedence
        // explicit — defensive against future contract drift).
        const merged: Record<string, number> = { ...jupiter, ...birdeye };
        const stillMissing = mints.length - Object.keys(merged).length;
        console.log(`${TAG} getSpotPrices | DONE mints=${mints.length} birdeye=${Object.keys(birdeye).length} jupiter=${Object.keys(jupiter).length} total=${Object.keys(merged).length} still_missing=${stillMissing}`);
        return merged;
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
