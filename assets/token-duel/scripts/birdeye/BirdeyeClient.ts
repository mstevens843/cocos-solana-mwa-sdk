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

import { BIRDEYE_API_KEY } from '../constants';
import {
    FeedTab,
    PriceUpdate,
    RawNewListingItem,
    RawPriceVolumeMulti,
    RawSearchTokenItem,
    RawTokenListItem,
    TokenRow,
} from './types';
import {
    BIRDEYE_CHAIN,
    gainersUrl,
    newListingsUrl,
    priceVolumeMultiUrl,
    searchUrl,
    trendingUrl,
} from './endpoints';

const TAG = '[BirdeyeClient]';

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
        console.log(`${TAG} getTrending | START call_id=${callId} tab=${tab} limit=${limit}`);

        let url: string;
        switch (tab) {
            case 'trending': url = trendingUrl(limit); break;
            case 'gainers':  url = gainersUrl(limit);  break;
            case 'new':      url = newListingsUrl(limit); break;
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

        const raw = await this._getWithRetry<{ data?: { tokens?: RawTokenListItem[]; items?: RawTokenListItem[] } }>(url, callId, `getTrending.${tab}`);
        if (raw === null) {
            console.log(`${TAG} getTrending | NULL_RESPONSE call_id=${callId} tab=${tab} — retry exhausted`);
            return [];
        }
        if (!raw.data) {
            console.log(`${TAG} getTrending | MALFORMED_BODY call_id=${callId} tab=${tab} has_data=false raw_keys=${Object.keys(raw).join(',')}`);
            return [];
        }
        // Birdeye returns `tokens` on some deploys, `items` on others. Accept both.
        const items = raw.data.tokens ?? raw.data.items ?? [];
        if (!Array.isArray(items)) {
            console.log(`${TAG} getTrending | ITEMS_NOT_ARRAY call_id=${callId} tab=${tab} items_type=${typeof items} has_tokens=${!!raw.data.tokens} has_items=${!!raw.data.items}`);
            return [];
        }
        const rows = items.map((i) => this._normalizeTokenList(i, callId));
        console.log(`${TAG} getTrending | DONE call_id=${callId} tab=${tab} rows=${rows.length}`);
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
        console.log(`${TAG} search | START call_id=${callId} keyword="${trimmed}" limit=${limit}`);

        if (trimmed.length === 0) {
            console.log(`${TAG} search | EMPTY_KEYWORD call_id=${callId} returning 0 rows`);
            return [];
        }

        const body = {
            chain: BIRDEYE_CHAIN,
            keyword: trimmed,
            target: 'token',
            search_by: 'combination',
            search_mode: 'fuzzy',
            sort_by: 'volume_24h_usd',
            sort_type: 'desc',
            verify_token: false,
            offset: 0,
            limit,
        };
        const raw = await this._postWithRetry<{
            data?: { items?: Array<{ type?: string; result?: RawSearchTokenItem[] }> }
        }>(searchUrl, body, callId, 'search');

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
     * Batch-fetch price + 24h change for up to 50 mints.
     * Returned map keys = mint addresses; missing mints (unlisted) are omitted.
     */
    async priceMulti(mints: string[]): Promise<Record<string, PriceUpdate>> {
        const callId = this._nextCallId++;
        const uniq = Array.from(new Set(mints.filter((m) => m && m.length > 0)));
        console.log(`${TAG} priceMulti | START call_id=${callId} requested=${mints.length} unique=${uniq.length}`);

        if (uniq.length === 0) {
            console.log(`${TAG} priceMulti | EMPTY_LIST call_id=${callId}`);
            return {};
        }

        const url = priceVolumeMultiUrl(uniq);
        const raw = await this._getWithRetry<{ data?: RawPriceVolumeMulti }>(url, callId, 'priceMulti');

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

    // ─── Normalizers ──────────────────────────────────────────────────────

    private _normalizeTokenList(i: RawTokenListItem, callId: number): TokenRow {
        if (!i.address) {
            console.log(`${TAG} _normalizeTokenList | MISSING_ADDRESS call_id=${callId} symbol="${i.symbol ?? ''}" name="${i.name ?? ''}"`);
        }
        const priceNum = Number(i.price ?? 0);
        const changeNum = Number(i.price_change_24h_percent ?? 0);
        const volNum = Number(i.volume_24h_usd ?? 0);
        if (Number.isNaN(priceNum) || Number.isNaN(changeNum) || Number.isNaN(volNum)) {
            console.log(`${TAG} _normalizeTokenList | NAN_FIELD call_id=${callId} address=${i.address} raw_price=${i.price} raw_change=${i.price_change_24h_percent} raw_volume=${i.volume_24h_usd}`);
        }
        return {
            address: i.address ?? '',
            symbol: i.symbol ?? '',
            name: i.name ?? '',
            priceUsd: Number.isFinite(priceNum) ? priceNum : 0,
            change24hPct: Number.isFinite(changeNum) ? changeNum : 0,
            volume24hUsd: Number.isFinite(volNum) ? volNum : 0,
            decimals: typeof i.decimals === 'number' ? i.decimals : -1,
            logoUri: i.logo_uri ?? i.logoURI ?? '',
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
            priceUsd: 0,
            change24hPct: 0,
            volume24hUsd: 0,
            decimals: typeof i.decimals === 'number' ? i.decimals : -1,
            logoUri: i.logo_uri ?? i.logoURI ?? '',
        };
    }

    private _normalizeSearchItem(i: RawSearchTokenItem, callId: number): TokenRow {
        if (!i.address) {
            console.log(`${TAG} _normalizeSearchItem | MISSING_ADDRESS call_id=${callId} symbol="${i.symbol ?? ''}" name="${i.name ?? ''}"`);
        }
        const priceNum = Number(i.price ?? 0);
        const changeNum = Number(i.price_change_24h_percent ?? 0);
        const volNum = Number(i.volume_24h_usd ?? 0);
        if (Number.isNaN(priceNum) || Number.isNaN(changeNum) || Number.isNaN(volNum)) {
            console.log(`${TAG} _normalizeSearchItem | NAN_FIELD call_id=${callId} address=${i.address} raw_price=${i.price} raw_change=${i.price_change_24h_percent} raw_volume=${i.volume_24h_usd}`);
        }
        return {
            address: i.address ?? '',
            symbol: i.symbol ?? '',
            name: i.name ?? '',
            priceUsd: Number.isFinite(priceNum) ? priceNum : 0,
            change24hPct: Number.isFinite(changeNum) ? changeNum : 0,
            volume24hUsd: Number.isFinite(volNum) ? volNum : 0,
            decimals: typeof i.decimals === 'number' ? i.decimals : -1,
            logoUri: i.logo_uri ?? i.logoURI ?? '',
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
        let response: Response;
        try {
            response = await fetch(url, { method: 'GET', headers: this._headers() });
        } catch (e) {
            // Network-layer failure (DNS, TLS, timeout) — distinct from parse failures below.
            console.log(`${TAG} _getOnce | FETCH_ERROR call_id=${callId} label=${label} attempt=${attempt} error=${e}`);
            return { data: null, transient: true };
        }
        if (!response.ok) {
            const transient = response.status === 429 || response.status >= 500;
            // 401 usually means the API key is missing/invalid — not transient.
            const auth = response.status === 401 || response.status === 403;
            console.log(`${TAG} _getOnce | HTTP_ERROR call_id=${callId} label=${label} attempt=${attempt} status=${response.status} transient=${transient} auth_failure=${auth}`);
            return { data: null, transient };
        }
        let json: { success?: boolean; message?: string } & T;
        try {
            json = await response.json() as { success?: boolean; message?: string } & T;
        } catch (e) {
            // Distinct from fetch errors — server replied 200 but the body was
            // not valid JSON. Usually an HTML error page from an upstream proxy.
            console.log(`${TAG} _getOnce | PARSE_ERROR call_id=${callId} label=${label} attempt=${attempt} error=${e}`);
            return { data: null, transient: false };
        }
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
