/**
 * BirdeyeClient.ts — HTTP wrapper around Birdeye's public-api endpoints.
 *
 * Mirrors the logging + retry pattern from `TokenDuelRpc._call` so Token
 * Duel has one consistent network story:
 *   - Deterministic logs at START / DONE / *_ERROR / RETRY.
 *   - Single retry on HTTP 429 / 5xx / fetch errors. No retry on 4xx bad
 *     requests (those are caller bugs, not rate limits).
 *   - All network I/O via the browser `fetch` global (present in Cocos's
 *     Android runtime via the built-in WebView bridge).
 *
 * API-key strategy for v1 (hackathon): the key is embedded in the Cocos
 * bundle via `constants.ts`. Known trade-off: APK-decompile gets you the
 * key. Acceptable scope — Birdeye key is read-only + CU-metered, can't
 * sign. Post-hackathon: proxy via backend.
 */

import { BIRDEYE_API_KEY, FEED_ROW_LIMIT, META_DATA_BATCH } from '../constants';
import {
    Candle,
    FeedTab,
    OhlcvType,
    PriceUpdate,
    RawMetaDataItem,
    RawNewListingItem,
    RawOhlcvCandle,
    RawPriceVolumeMulti,
    RawSearchTokenItem,
    RawSmartMoneyItem,
    RawTokenListItem,
    RawTrendingToken,
    TokenMetaData,
    TokenRow,
} from './types';
import {
    BIRDEYE_CHAIN,
    gainersUrl,
    metaDataMultipleUrl,
    multiPriceUrl,
    newListingsUrl,
    ohlcvUrl,
    priceVolumeMultiUrl,
    searchUrl,
    smartMoneyUrl,
    trendingUrl,
} from './endpoints';

// Session 9: prefixed with `AppUI:` so the entire Birdeye log stream passes
// through the user's default adb logcat grep filter (which anchors on
// `\[(MWA|AppUI|...)`). Without this, HTTP_ERROR / OK / PARSE_ERROR lines
// are stripped before they reach the terminal — which is exactly what
// silently burned 3 debug rounds (Sessions 2, 4, 8).
const TAG = '[AppUI:Birdeye]';

interface FetchOutcome<T> {
    data: T | null;
    transient: boolean;
}

export class BirdeyeClient {
    private readonly _apiKey: string;
    private _nextCallId = 1;

    constructor(apiKey: string = BIRDEYE_API_KEY) {
        this._apiKey = apiKey;
        const keyLen = apiKey ? apiKey.length : 0;
        const keyTail = keyLen >= 4 ? apiKey.substring(keyLen - 4) : apiKey;
        // Birdeye returns 401 (non-transient, caller-bug) on empty keys. Log
        // up-front so failing calls are traceable to configuration, not the
        // network layer — the retry path would otherwise mask it.
        if (keyLen === 0) {
            console.log(`${TAG} ctor | NO_API_KEY — every request will 401; PriceFeed will fall back to mock`);
        }
        console.log(`${TAG} ctor | DONE chain=${BIRDEYE_CHAIN} api_key_len=${keyLen} api_key_tail="${keyTail}"`);
    }

    /**
     * Fetch feed rows for a tab. Returns up to `limit` rows, normalized.
     * Tab-specific endpoints (trending = volume-sorted, gainers =
     * change-sorted, new = recent listings).
     */
    async getTrending(tab: FeedTab, limit: number): Promise<TokenRow[]> {
        const callId = this._nextCallId++;
        // Session 10: defensive — Birdeye validates limit as integer in [1, 20]
        // for token_trending/new_listing and [1, 100] for v3/token/list.
        // `limit=0` (which is what happens when the UI row pool is empty at
        // call time) produces a 400 "limit should be integer, range 1-N"
        // that wastes the retry budget and returns no rows. Force to a
        // sane default rather than letting a caller-bug hit the wire.
        const requested = limit;
        if (!Number.isFinite(limit) || limit <= 0) limit = FEED_ROW_LIMIT;
        const maxForEndpoint = tab === 'gainers' ? 100 : 20;
        if (limit > maxForEndpoint) limit = maxForEndpoint;
        if (limit !== requested) {
            console.log(`${TAG} getTrending | LIMIT_CLAMPED call_id=${callId} tab=${tab} requested=${requested} effective=${limit}`);
        }
        console.log(`${TAG} getTrending | START call_id=${callId} tab=${tab} limit=${limit}`);

        let url: string;
        switch (tab) {
            case 'trending':    url = trendingUrl(limit); break;
            case 'gainers':     url = gainersUrl(limit);  break;
            case 'new':         url = newListingsUrl(limit); break;
            case 'smart_money': url = smartMoneyUrl(limit); break;
            default:
                console.log(`${TAG} getTrending | UNKNOWN_TAB call_id=${callId} tab=${tab}`);
                return [];
        }

        // New-listing endpoint returns a different body shape than /token/list.
        if (tab === 'new') {
            const raw = await this._getWithRetry<{ data?: { items?: RawNewListingItem[] } }>(url, callId, 'getTrending.new');
            if (raw === null) {
                console.log(`${TAG} getTrending | NULL_RESPONSE call_id=${callId} tab=${tab} — retry exhausted`);
                return [];
            }
            if (!raw.data) {
                console.log(`${TAG} getTrending | MALFORMED_BODY call_id=${callId} tab=${tab} has_data=false raw_keys=${Object.keys(raw).join(',')}`);
                return [];
            }
            const items = raw.data.items ?? [];
            if (!Array.isArray(items)) {
                console.log(`${TAG} getTrending | ITEMS_NOT_ARRAY call_id=${callId} tab=${tab} items_type=${typeof items}`);
                return [];
            }
            const rows = items.map((i) => this._normalizeNewListing(i, callId));
            console.log(`${TAG} getTrending | DONE call_id=${callId} tab=${tab} rows=${rows.length}`);
            return rows;
        }

        // Session 11: ported solpulse's fallback chain (backend/api/tokenList.js:144).
        // Birdeye has shifted response shapes over time:
        //   - /defi/token_trending    → data.tokens[]  (camelCase fields)
        //   - /defi/v3/token/list     → data.items[]   (snake_case fields)
        //   - /defi/v2/new_listing    → data.items[]   (mixed case)
        // Old code only checked `data.tokens`, so gainers silently returned 0
        // rows despite 54 KB of data at `data.items`.
        const raw = await this._getWithRetry<{ data?: { tokens?: unknown[]; items?: unknown[]; total?: number } }>(url, callId, `getTrending.${tab}`);
        if (raw === null) {
            console.log(`${TAG} getTrending | NULL_RESPONSE call_id=${callId} tab=${tab} — retry exhausted`);
            return [];
        }
        if (!raw.data) {
            console.log(`${TAG} getTrending | MALFORMED_BODY call_id=${callId} tab=${tab} has_data=false raw_keys=${Object.keys(raw).join(',')}`);
            return [];
        }
        const items = (raw.data.items ?? raw.data.tokens ?? []) as unknown[];
        if (!Array.isArray(items)) {
            console.log(`${TAG} getTrending | ITEMS_NOT_ARRAY call_id=${callId} tab=${tab} items_type=${typeof items} raw_data_keys=${Object.keys(raw.data).join(',')}`);
            return [];
        }
        if (items.length === 0) {
            console.log(`${TAG} getTrending | EMPTY_ITEMS call_id=${callId} tab=${tab} raw_data_keys=${Object.keys(raw.data).join(',')} — check if shape shifted`);
        }
        let rows: TokenRow[];
        if (tab === 'gainers') {
            rows = (items as RawTokenListItem[]).map((i) => this._normalizeTokenList(i, callId));
        } else if (tab === 'smart_money') {
            rows = (items as RawSmartMoneyItem[]).map((i) => this._normalizeSmartMoney(i, callId));
        } else {
            rows = (items as RawTrendingToken[]).map((i) => this._normalizeTrendingToken(i, callId));
        }

        // Session 11 aggregate log: counts of normalizer-side issues so we know
        // what % of rows had missing logos/prices without spamming per-row.
        let missingLogo = 0, missingPrice = 0, missingLiq = 0;
        for (const r of rows) {
            if (!r.logoUri) missingLogo++;
            if (!r.priceUsd) missingPrice++;
            if (!r.liquidity) missingLiq++;
        }
        console.log(`${TAG} getTrending | NORMALIZE_SUMMARY call_id=${callId} tab=${tab} rows=${rows.length} missing_logo=${missingLogo} missing_price=${missingPrice} missing_liq=${missingLiq}`);
        console.log(`${TAG} getTrending | DONE call_id=${callId} tab=${tab} rows=${rows.length} total_available=${raw.data.total ?? '?'}`);
        return rows;
    }

    /**
     * Fuzzy search by keyword (symbol, name, or mint address).
     *
     * If the keyword already looks like a base58 Solana mint (32–44 chars,
     * no whitespace, valid chars), Birdeye returns an exact match. Otherwise
     * fuzzy-matches against symbol + name.
     */
    async search(keyword: string, limit: number): Promise<TokenRow[]> {
        const callId = this._nextCallId++;
        const trimmed = keyword.trim();
        // Session 10: same guard as getTrending — /defi/v3/search rejects
        // limit=0 as out-of-range. Force to a sane default on bad input.
        const requested = limit;
        if (!Number.isFinite(limit) || limit <= 0) limit = FEED_ROW_LIMIT;
        if (limit > 20) limit = 20;
        if (limit !== requested) {
            console.log(`${TAG} search | LIMIT_CLAMPED call_id=${callId} requested=${requested} effective=${limit}`);
        }
        console.log(`${TAG} search | START call_id=${callId} keyword="${trimmed}" limit=${limit}`);

        if (trimmed.length === 0) {
            console.log(`${TAG} search | EMPTY_KEYWORD call_id=${callId} returning 0 rows`);
            return [];
        }

        // Session 8: Birdeye /defi/v3/search is GET with query params, not POST.
        // Previous POST implementation returned 0 results on every call — see
        // Session 8 plan for details.
        const url = searchUrl(trimmed, limit);
        const raw = await this._getWithRetry<{
            data?: { items?: Array<{ type?: string; result?: RawSearchTokenItem[] }> }
        }>(url, callId, 'search');

        if (raw === null) {
            console.log(`${TAG} search | NULL_RESPONSE call_id=${callId} keyword="${trimmed}" — retry exhausted`);
            return [];
        }
        if (!raw.data) {
            console.log(`${TAG} search | MALFORMED_BODY call_id=${callId} keyword="${trimmed}" has_data=false raw_keys=${Object.keys(raw).join(',')}`);
            return [];
        }
        // v3/search groups matches by target; we only care about `token` results.
        const groups = raw.data.items ?? [];
        if (!Array.isArray(groups)) {
            console.log(`${TAG} search | GROUPS_NOT_ARRAY call_id=${callId} groups_type=${typeof groups}`);
            return [];
        }
        const tokenGroup = groups.find((g) => g.type === 'token' || g.type === undefined);
        if (!tokenGroup) {
            const seenTypes = groups.map((g) => g.type ?? 'undefined').join(',');
            console.log(`${TAG} search | NO_TOKEN_GROUP call_id=${callId} keyword="${trimmed}" group_types=[${seenTypes}]`);
            return [];
        }
        const items = tokenGroup.result ?? [];
        if (!Array.isArray(items)) {
            console.log(`${TAG} search | RESULT_NOT_ARRAY call_id=${callId} result_type=${typeof items}`);
            return [];
        }
        const rows = items.map((i) => this._normalizeSearchItem(i, callId));
        console.log(`${TAG} search | DONE call_id=${callId} keyword="${trimmed}" rows=${rows.length}`);
        return rows;
    }

    /**
     * Batch-fetch price + % change for up to 50 mints on the given window.
     * `timeframe` ∈ {'1h','24h','3d','7d'} — Part 9 added 1h/3d/7d alongside
     * the pre-existing 24h default. Returned map keys = mint addresses;
     * missing mints (unlisted) are omitted.
     */
    async priceMulti(mints: string[], timeframe: string = '24h'): Promise<Record<string, PriceUpdate>> {
        const callId = this._nextCallId++;
        const uniq = Array.from(new Set(mints.filter((m) => m && m.length > 0)));
        console.log(`${TAG} priceMulti | START call_id=${callId} requested=${mints.length} unique=${uniq.length} timeframe=${timeframe}`);

        if (uniq.length === 0) {
            console.log(`${TAG} priceMulti | EMPTY_LIST call_id=${callId}`);
            return {};
        }

        const url = priceVolumeMultiUrl(uniq, timeframe);
        const raw = await this._getWithRetry<{ data?: RawPriceVolumeMulti }>(url, callId, `priceMulti.${timeframe}`);

        if (raw === null) {
            console.log(`${TAG} priceMulti | NULL_RESPONSE call_id=${callId} mints=${uniq.length} — retry exhausted`);
            return {};
        }
        if (!raw.data) {
            console.log(`${TAG} priceMulti | MALFORMED_BODY call_id=${callId} has_data=false raw_keys=${Object.keys(raw).join(',')}`);
            return {};
        }

        const out: Record<string, PriceUpdate> = {};
        const data = raw.data;
        const nowMs = Date.now();
        let nanCount = 0;
        let nullEntryCount = 0;
        let missingCount = 0;
        for (const mint of uniq) {
            const entry = data[mint];
            if (!entry) { missingCount++; continue; }
            const price = Number(entry.price ?? 0);
            const change = Number(entry.priceChangePercent ?? 0);
            const volume = Number(entry.volumeUSD ?? 0);
            if (Number.isNaN(price) || Number.isNaN(change) || Number.isNaN(volume)) {
                nanCount++;
                console.log(`${TAG} priceMulti | NAN_FIELD call_id=${callId} mint=${mint} price=${entry.price} change=${entry.priceChangePercent} volume=${entry.volumeUSD}`);
                continue;
            }
            out[mint] = {
                mint,
                priceUsd: price,
                change24hPct: change,
                volume24hUsd: volume,
                ts: entry.updateUnixTime ? entry.updateUnixTime * 1000 : nowMs,
            };
        }
        // Entries present in `data` but not in `uniq` (shouldn't happen — means
        // Birdeye returned a mint we didn't ask for). Log so we notice.
        for (const mint of Object.keys(data)) {
            if (uniq.indexOf(mint) === -1) {
                console.log(`${TAG} priceMulti | UNEXPECTED_MINT call_id=${callId} mint=${mint} — not in request list`);
                nullEntryCount++;
            }
        }
        console.log(`${TAG} priceMulti | DONE call_id=${callId} requested=${uniq.length} returned=${Object.keys(out).length} missing=${missingCount} nan=${nanCount} unexpected=${nullEntryCount}`);
        return out;
    }

    /**
     * betting-duel — lightweight spot-price batch.
     *
     * Uses `/defi/multi_price` which has broader token coverage than the
     * `priceMulti` endpoint used for feed delta rendering. Returns a simple
     * mint → priceUsd map (no volume, no % change). Missing mints are
     * omitted from the output.
     *
     * Never throws — returns `{}` on any network / parse failure so the
     * PortfolioRace can fall back to its squad-cached prices.
     */
    async spotPriceMulti(mints: string[]): Promise<Record<string, number>> {
        const callId = this._nextCallId++;
        const uniq = Array.from(new Set(mints.filter((m) => m && m.length > 0)));
        console.log(`${TAG} spotPriceMulti | START call_id=${callId} requested=${mints.length} unique=${uniq.length}`);
        if (uniq.length === 0) {
            console.log(`${TAG} spotPriceMulti | EMPTY_LIST call_id=${callId}`);
            return {};
        }
        const url = multiPriceUrl(uniq);
        const raw = await this._getWithRetry<{ data?: Record<string, { value?: number }> }>(url, callId, `spotPriceMulti`);
        if (raw === null) {
            console.log(`${TAG} spotPriceMulti | NULL_RESPONSE call_id=${callId} mints=${uniq.length} — retry exhausted`);
            return {};
        }
        if (!raw.data || typeof raw.data !== 'object') {
            console.log(`${TAG} spotPriceMulti | MALFORMED_BODY call_id=${callId} has_data=${!!raw.data} raw_keys=${Object.keys(raw).join(',')}`);
            return {};
        }
        const out: Record<string, number> = {};
        let missingCount = 0;
        let nanCount = 0;
        for (const mint of uniq) {
            const entry = raw.data[mint];
            if (!entry) { missingCount++; continue; }
            const price = Number(entry.value ?? 0);
            if (!Number.isFinite(price) || price <= 0) {
                nanCount++;
                console.log(`${TAG} spotPriceMulti | BAD_VALUE call_id=${callId} mint=${mint} value=${entry.value}`);
                continue;
            }
            out[mint] = price;
        }
        console.log(`${TAG} spotPriceMulti | DONE call_id=${callId} requested=${uniq.length} resolved=${Object.keys(out).length} missing=${missingCount} nan=${nanCount}`);
        return out;
    }

    /**
     * Batch-fetch token metadata (name, symbol, logo, socials) for up to
     * META_DATA_BATCH mints per chunk. Used to hydrate rows that come back
     * without a `logoURI` (common on /defi/token_trending and /smart-money).
     *
     * Returns a mint-keyed record — missing entries are omitted (NOT zeroed)
     * so callers can distinguish "Birdeye has no metadata" from "we asked
     * and got an empty object".
     */
    async getMetaDataMulti(mints: string[]): Promise<Record<string, TokenMetaData>> {
        const callId = this._nextCallId++;
        const uniq = Array.from(new Set(mints.filter((m) => m && m.length > 0)));
        console.log(`${TAG} getMetaDataMulti | START call_id=${callId} requested=${mints.length} unique=${uniq.length}`);

        if (uniq.length === 0) {
            console.log(`${TAG} getMetaDataMulti | EMPTY_LIST call_id=${callId}`);
            return {};
        }

        const chunks: string[][] = [];
        for (let i = 0; i < uniq.length; i += META_DATA_BATCH) {
            chunks.push(uniq.slice(i, i + META_DATA_BATCH));
        }
        console.log(`${TAG} getMetaDataMulti | CHUNKS call_id=${callId} count=${chunks.length} batch_size=${META_DATA_BATCH}`);

        const out: Record<string, TokenMetaData> = {};
        let chunkIdx = 0;
        for (const chunk of chunks) {
            chunkIdx++;
            const url = metaDataMultipleUrl(chunk);
            const raw = await this._getWithRetry<{ data?: RawMetaDataItem[] | Record<string, RawMetaDataItem> }>(url, callId, `metaDataMulti.${chunkIdx}`);
            if (raw === null || !raw.data) {
                console.log(`${TAG} getMetaDataMulti | CHUNK_NULL call_id=${callId} chunk=${chunkIdx} — skip`);
                continue;
            }
            // Birdeye ships either an array or a mint-keyed object. Solpulse's
            // `getTokenMetadata.js` handles both; we do the same.
            const records: RawMetaDataItem[] = Array.isArray(raw.data)
                ? raw.data
                : Object.keys(raw.data).map((k) => (raw.data as Record<string, RawMetaDataItem>)[k]);
            for (const rec of records) {
                if (!rec || !rec.address) continue;
                out[rec.address] = {
                    address: rec.address,
                    name: rec.name ?? '',
                    symbol: rec.symbol ?? '',
                    decimals: typeof rec.decimals === 'number' ? rec.decimals : -1,
                    logoUri: rec.logo_uri ?? rec.logoURI ?? '',
                    website: rec.website ?? '',
                    twitter: rec.twitter ?? '',
                    description: rec.description ?? '',
                };
            }
        }
        console.log(`${TAG} getMetaDataMulti | DONE call_id=${callId} requested=${uniq.length} returned=${Object.keys(out).length}`);
        return out;
    }

    /**
     * Session 13: fetch OHLCV candles for the chart detail view.
     *   /defi/ohlcv?address=<mint>&type=<tf>&time_from=<sec>&time_to=<sec>
     * Normalizes camelCase `unixTime` → `t` so CandlestickChart has a clean
     * Candle[] to draw. Empty array on any failure (caller renders
     * "No candles" placeholder).
     */
    async getOhlcv(mint: string, type: OhlcvType, fromSec: number, toSec: number): Promise<Candle[]> {
        const callId = this._nextCallId++;
        console.log(`${TAG} getOhlcv | START call_id=${callId} mint=${mint.substring(0, 6)}…${mint.substring(mint.length - 4)} type=${type} from=${fromSec} to=${toSec}`);
        if (!mint || mint.length < 32) {
            console.log(`${TAG} getOhlcv | BAD_MINT call_id=${callId} mint="${mint}"`);
            return [];
        }
        const url = ohlcvUrl(mint, type, fromSec, toSec);
        const raw = await this._getWithRetry<{ data?: { items?: RawOhlcvCandle[] } }>(url, callId, `ohlcv.${type}`);
        if (raw === null) {
            console.log(`${TAG} getOhlcv | NULL_RESPONSE call_id=${callId} — retry exhausted`);
            return [];
        }
        if (!raw.data) {
            console.log(`${TAG} getOhlcv | MALFORMED_BODY call_id=${callId} raw_keys=${Object.keys(raw).join(',')}`);
            return [];
        }
        const items = raw.data.items ?? [];
        if (!Array.isArray(items)) {
            console.log(`${TAG} getOhlcv | ITEMS_NOT_ARRAY call_id=${callId} items_type=${typeof items}`);
            return [];
        }
        const candles: Candle[] = items.map((r) => ({
            t: this._num(r.unixTime),
            o: this._num(r.o),
            h: this._num(r.h),
            l: this._num(r.l),
            c: this._num(r.c),
            v: this._num(r.v),
        })).filter((c) => c.t > 0 && c.c > 0);
        console.log(`${TAG} getOhlcv | DONE call_id=${callId} type=${type} candles=${candles.length} range=${candles[0]?.t ?? 0}..${candles[candles.length - 1]?.t ?? 0}`);
        return candles;
    }

    // ─── Normalizers ──────────────────────────────────────────────────────
    //
    // Session 11: all normalizers populate the extended TokenRow shape
    // (liquidity, marketCap, fdv, holders, blockUnixTime, source). Fields
    // unknown to a given endpoint are zero-valued — never left undefined, so
    // downstream render code can safely read any field without optional checks.

    /** Safe number coercion; returns 0 for null/undef/NaN/Infinity. */
    private _num(v: unknown): number {
        if (v === null || v === undefined) return 0;
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }

    /** Parse ISO-8601 date OR unix-sec number into unix seconds. 0 if unparseable. */
    private _toUnixSec(v: unknown): number {
        if (typeof v === 'number' && Number.isFinite(v)) {
            // Heuristic: values > 10^12 are ms, > 10^9 are seconds.
            return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
        }
        if (typeof v === 'string' && v.length > 0) {
            const parsed = Date.parse(v);
            if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
        }
        return 0;
    }

    private _normalizeTokenList(i: RawTokenListItem, callId: number): TokenRow {
        if (!i.address) {
            console.log(`${TAG} _normalizeTokenList | MISSING_ADDRESS call_id=${callId} symbol="${i.symbol ?? ''}" name="${i.name ?? ''}"`);
        }
        return {
            address: i.address ?? '',
            symbol: i.symbol ?? '',
            name: i.name ?? '',
            priceUsd: this._num(i.price),
            change24hPct: this._num(i.price_change_24h_percent),
            volume24hUsd: this._num(i.volume_24h_usd),
            decimals: typeof i.decimals === 'number' ? i.decimals : -1,
            logoUri: i.logo_uri ?? i.logoURI ?? '',
            liquidity: this._num(i.liquidity),
            marketCap: this._num(i.market_cap ?? i.marketcap),
            fdv: this._num(i.fdv),
            holders: this._num(i.holder),
            blockUnixTime: 0,
            source: '',
            smartTraders: 0,
            netFlow: 0,
        };
    }

    /**
     * Normalize a /defi/token_trending item. Unlike /defi/v3/token/list, the
     * fields here are camelCase per Birdeye's documented example:
     *   volume24hUSD, price24hChangePercent, volume24hChangePercent, logoURI.
     */
    private _normalizeTrendingToken(i: RawTrendingToken, callId: number): TokenRow {
        if (!i.address) {
            console.log(`${TAG} _normalizeTrendingToken | MISSING_ADDRESS call_id=${callId} symbol="${i.symbol ?? ''}" name="${i.name ?? ''}" rank=${i.rank ?? '?'}`);
        }
        return {
            address: i.address ?? '',
            symbol: i.symbol ?? '',
            name: i.name ?? '',
            priceUsd: this._num(i.price),
            change24hPct: this._num(i.price24hChangePercent),
            volume24hUsd: this._num(i.volume24hUSD),
            decimals: typeof i.decimals === 'number' ? i.decimals : -1,
            logoUri: i.logoURI ?? i.logo_uri ?? '',
            liquidity: this._num(i.liquidity),
            marketCap: this._num(i.marketcap ?? i.market_cap),
            fdv: this._num(i.fdv),
            holders: 0,
            blockUnixTime: 0,
            source: '',
            smartTraders: 0,
            netFlow: 0,
        };
    }

    private _normalizeNewListing(i: RawNewListingItem, callId: number): TokenRow {
        if (!i.address) {
            console.log(`${TAG} _normalizeNewListing | MISSING_ADDRESS call_id=${callId} symbol="${i.symbol ?? ''}" name="${i.name ?? ''}"`);
        }
        return {
            address: i.address ?? '',
            symbol: i.symbol ?? '',
            name: i.name ?? '',
            // New-listing endpoint does not return price/change/volume — those
            // get backfilled by the PriceFeed.enrichRows pass after fetch.
            priceUsd: 0,
            change24hPct: 0,
            volume24hUsd: 0,
            decimals: typeof i.decimals === 'number' ? i.decimals : -1,
            logoUri: i.logo_uri ?? i.logoURI ?? '',
            liquidity: this._num(i.liquidity),
            marketCap: 0,
            fdv: 0,
            holders: 0,
            blockUnixTime: this._toUnixSec(i.liquidityAddedAt ?? i.block_unix_time),
            source: i.source ?? '',
            smartTraders: 0,
            netFlow: 0,
        };
    }

    private _normalizeSearchItem(i: RawSearchTokenItem, callId: number): TokenRow {
        const address = i.address ?? i.token ?? '';
        if (!address) {
            console.log(`${TAG} _normalizeSearchItem | MISSING_ADDRESS call_id=${callId} symbol="${i.symbol ?? ''}" name="${i.name ?? ''}"`);
        }
        return {
            address,
            symbol: i.symbol ?? '',
            name: i.name ?? '',
            priceUsd: this._num(i.price),
            change24hPct: this._num(i.price_change_24h_percent),
            volume24hUsd: this._num(i.volume_24h_usd),
            decimals: typeof i.decimals === 'number' ? i.decimals : -1,
            logoUri: i.logo_uri ?? i.logoURI ?? '',
            liquidity: this._num(i.liquidity),
            marketCap: this._num(i.market_cap ?? i.marketCap),
            fdv: this._num(i.fdv),
            holders: 0,
            blockUnixTime: 0,
            source: '',
            smartTraders: 0,
            netFlow: 0,
        };
    }

    private _normalizeSmartMoney(i: RawSmartMoneyItem, callId: number): TokenRow {
        const address = i.token ?? i.address ?? '';
        if (!address) {
            console.log(`${TAG} _normalizeSmartMoney | MISSING_ADDRESS call_id=${callId} symbol="${i.symbol ?? ''}" name="${i.name ?? ''}"`);
        }
        return {
            address,
            symbol: i.symbol ?? '',
            name: i.name ?? '',
            priceUsd: this._num(i.price),
            change24hPct: this._num(i.price_change_percent),
            volume24hUsd: this._num(i.volume_usd),
            decimals: typeof i.decimals === 'number' ? i.decimals : -1,
            logoUri: i.logo_uri ?? i.logoURI ?? '',
            liquidity: this._num(i.liquidity),
            marketCap: this._num(i.market_cap),
            fdv: 0,
            holders: 0,
            blockUnixTime: 0,
            source: '',
            smartTraders: this._num(i.smart_traders_no),
            netFlow: this._num(i.net_flow),
        };
    }

    // ─── Network internals ────────────────────────────────────────────────

    private _headers(): Record<string, string> {
        return {
            'accept': 'application/json',
            'x-chain': BIRDEYE_CHAIN,
            'X-API-KEY': this._apiKey,
        };
    }

    private async _getWithRetry<T>(url: string, callId: number, label: string): Promise<T | null> {
        let res = await this._getOnce<T>(url, callId, label, 1);
        if (res.data === null && res.transient) {
            await new Promise((r) => setTimeout(r, 500));
            console.log(`${TAG} _getWithRetry | RETRY call_id=${callId} label=${label} url="${url}"`);
            res = await this._getOnce<T>(url, callId, label, 2);
        }
        return res.data;
    }

    private async _postWithRetry<T>(url: string, body: unknown, callId: number, label: string): Promise<T | null> {
        let res = await this._postOnce<T>(url, body, callId, label, 1);
        if (res.data === null && res.transient) {
            await new Promise((r) => setTimeout(r, 500));
            console.log(`${TAG} _postWithRetry | RETRY call_id=${callId} label=${label} url="${url}"`);
            res = await this._postOnce<T>(url, body, callId, label, 2);
        }
        return res.data;
    }

    private async _getOnce<T>(url: string, callId: number, label: string, attempt: number): Promise<FetchOutcome<T>> {
        // Session 8: log the URL (with API key stripped — it's in the header
        // anyway) + attempt number so the user can correlate each call with
        // exactly what went out. `path_only` keeps the log line short.
        const pathOnly = url.length > 100 ? url.substring(0, 100) + '...' : url;
        console.log(`${TAG} _getOnce | ENTER call_id=${callId} label=${label} attempt=${attempt} url="${pathOnly}"`);
        let response: Response;
        try {
            response = await fetch(url, { method: 'GET', headers: this._headers() });
        } catch (e) {
            console.log(`${TAG} _getOnce | FETCH_ERROR call_id=${callId} label=${label} attempt=${attempt} error=${e}`);
            return { data: null, transient: true };
        }
        if (!response.ok) {
            const transient = response.status === 429 || response.status >= 500;
            const auth = response.status === 401 || response.status === 403;
            // Try to capture the error body for the user — helps distinguish
            // "invalid api key" from "param rejected" vs "rate limit".
            let errBody = '';
            try { errBody = (await response.text()).substring(0, 200); } catch (_) { /* ignore */ }
            console.log(`${TAG} _getOnce | HTTP_ERROR call_id=${callId} label=${label} attempt=${attempt} status=${response.status} transient=${transient} auth_failure=${auth} body_snip="${errBody.replace(/"/g, "'")}"`);
            return { data: null, transient };
        }
        let rawText: string;
        try {
            rawText = await response.text();
        } catch (e) {
            console.log(`${TAG} _getOnce | READ_ERROR call_id=${callId} label=${label} attempt=${attempt} error=${e}`);
            return { data: null, transient: false };
        }
        let json: { success?: boolean; message?: string } & T;
        try {
            json = JSON.parse(rawText) as { success?: boolean; message?: string } & T;
        } catch (e) {
            console.log(`${TAG} _getOnce | PARSE_ERROR call_id=${callId} label=${label} attempt=${attempt} body_bytes=${rawText.length} body_snip="${rawText.substring(0, 120).replace(/"/g, "'")}" error=${e}`);
            return { data: null, transient: false };
        }
        const topKeys = json && typeof json === 'object' ? Object.keys(json).join(',') : '(not-object)';
        console.log(`${TAG} _getOnce | OK call_id=${callId} label=${label} attempt=${attempt} status=${response.status} body_bytes=${rawText.length} top_keys=${topKeys} success=${(json as any)?.success}`);
        if (json && typeof json === 'object' && 'success' in json && json.success === false) {
            console.log(`${TAG} _getOnce | API_ERROR call_id=${callId} label=${label} attempt=${attempt} message="${json.message ?? ''}"`);
            return { data: null, transient: false };
        }
        return { data: json, transient: false };
    }

    private async _postOnce<T>(url: string, body: unknown, callId: number, label: string, attempt: number): Promise<FetchOutcome<T>> {
        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { ...this._headers(), 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (e) {
            console.log(`${TAG} _postOnce | FETCH_ERROR call_id=${callId} label=${label} attempt=${attempt} error=${e}`);
            return { data: null, transient: true };
        }
        if (!response.ok) {
            const transient = response.status === 429 || response.status >= 500;
            const auth = response.status === 401 || response.status === 403;
            console.log(`${TAG} _postOnce | HTTP_ERROR call_id=${callId} label=${label} attempt=${attempt} status=${response.status} transient=${transient} auth_failure=${auth}`);
            return { data: null, transient };
        }
        let json: { success?: boolean; message?: string } & T;
        try {
            json = await response.json() as { success?: boolean; message?: string } & T;
        } catch (e) {
            console.log(`${TAG} _postOnce | PARSE_ERROR call_id=${callId} label=${label} attempt=${attempt} error=${e}`);
            return { data: null, transient: false };
        }
        if (json && typeof json === 'object' && 'success' in json && json.success === false) {
            console.log(`${TAG} _postOnce | API_ERROR call_id=${callId} label=${label} attempt=${attempt} message="${json.message ?? ''}"`);
            return { data: null, transient: false };
        }
        return { data: json, transient: false };
    }
}
