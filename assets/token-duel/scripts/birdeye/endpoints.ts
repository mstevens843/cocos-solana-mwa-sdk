/**
 * Birdeye endpoint URL builders - Session 11 (solpulse parity).
 *
 * Ported verbatim from the solpulse backend (`backend/api/tokenList.js` +
 * `backend/services/strategies/paid_api/*`) which is verified working
 * against the same Premium-tier Birdeye account.
 */

export const BIRDEYE_BASE = 'https://public-api.birdeye.so';
export const BIRDEYE_CHAIN = 'solana';

/** Helper - encodes params as `?a=1&b=two` (values passed through encodeURIComponent). */
function qs(params: Record<string, string | number | boolean | undefined>): string {
    const parts: string[] = [];
    for (const k of Object.keys(params)) {
        const v = params[k];
        if (v === undefined || v === null) continue;
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Trending by rank (Birdeye's internal momentum ranking).
 *   GET /defi/token_trending?sort_by=rank&sort_type=asc&limit=N&offset=0
 * Response: { data: { updateUnixTime, updateTime, total, tokens: [...] } }
 * Fields are camelCase: `volume24hUSD`, `price24hChangePercent`, `logoURI`.
 */
export function trendingUrl(limit: number): string {
    return `${BIRDEYE_BASE}/defi/token_trending${qs({
        sort_by: 'rank',
        sort_type: 'asc',
        limit,
        offset: 0,
    })}`;
}

/**
 * True "gainers" via the v3 token list - Premium tier required.
 *   GET /defi/v3/token/list?sort_by=price_change_24h_percent&sort_type=desc&min_liquidity=10000&limit=N&offset=0
 * Response: { data: { items/tokens: [...] } } with snake_case fields
 * (`price_change_24h_percent`, `volume_24h_usd`, `logo_uri`).
 */
export function gainersUrl(limit: number): string {
    return `${BIRDEYE_BASE}/defi/v3/token/list${qs({
        sort_by: 'price_change_24h_percent',
        sort_type: 'desc',
        min_liquidity: 10000,
        limit,
        offset: 0,
    })}`;
}

/**
 * Smart-money rotation list - Premium tier.
 *   GET /smart-money/v1/token/list?interval=1d&trader_style=all&sort_by=smart_traders_no&sort_type=desc&limit=N&offset=0
 * Response shape mirrors the v3 endpoints (items/tokens under data). Fields
 * use snake_case, key is `token` not `address` for the mint.
 */
export function smartMoneyUrl(limit: number): string {
    return `${BIRDEYE_BASE}/smart-money/v1/token/list${qs({
        interval: '1d',
        trader_style: 'all',
        sort_by: 'smart_traders_no',
        sort_type: 'desc',
        limit,
        offset: 0,
    })}`;
}

/**
 * Recently-listed tokens.
 *   GET /defi/v2/tokens/new_listing?meme_platform_enabled=true&limit=N&offset=0
 * Matches solpulse's production config (meme_platform_enabled=true).
 * Response: { data: { items: [...] } }.
 */
export function newListingsUrl(limit: number): string {
    return `${BIRDEYE_BASE}/defi/v2/tokens/new_listing${qs({
        meme_platform_enabled: true,
        limit,
        offset: 0,
    })}`;
}

/**
 * Price + % change for up to 50 mints in a single call.
 *   GET /defi/price_volume/multi?list_address=<csv>&type=<1h|24h|3d|7d>
 *
 * Part 9: the `type` param is now caller-supplied so Token Duel can mint a
 * match on 1h / 24h / 3d / 7d deltas. Default stays `24h` for code paths
 * that haven't yet been updated. Birdeye Premium tier supports 1h / 24h /
 * 3d / 7d; `8h` and longer-tail windows also work per their docs but we
 * don't expose them through the UI.
 */
export function priceVolumeMultiUrl(mints: string[], timeframe: string = '24h'): string {
    const list = mints.slice(0, 50).join(',');
    return `${BIRDEYE_BASE}/defi/price_volume/multi${qs({
        list_address: list,
        type: timeframe,
    })}`;
}

/**
 * Lightweight spot-price fetch for up to 100 mints.
 *   GET /defi/multi_price?list_address=<csv>&include_liquidity=true
 *
 * betting-duel branch: used by PortfolioRace to get entry/current spot
 * prices during a race. Wider token coverage than `/defi/price_volume/multi`
 * - in particular, new pump.fun tokens that 404 on price_volume/multi
 * still resolve here because multi_price queries the raw pool oracles.
 *
 * Response shape:
 *   { data: { "<mint>": { value: <usd>, updateUnixTime: <sec>,
 *                         priceChange24h?: <pct>, liquidity?: <usd> } } }
 * Note the price field is `value`, not `price` - differs from price_volume/multi.
 */
export function multiPriceUrl(mints: string[]): string {
    const list = mints.slice(0, 100).join(',');
    return `${BIRDEYE_BASE}/defi/multi_price${qs({
        list_address: list,
        include_liquidity: 'true',
    })}`;
}

/**
 * Batch token metadata (name, symbol, logo, socials, description) - up to 50.
 *   GET /defi/v3/token/meta-data/multiple?list_address=<csv>
 * Response: `{ data: [...] }` OR `{ data: { <mint>: {...} } }` depending on
 * Birdeye's current version - normalizer handles both.
 */
export function metaDataMultipleUrl(mints: string[]): string {
    const list = mints.slice(0, 50).join(',');
    return `${BIRDEYE_BASE}/defi/v3/token/meta-data/multiple${qs({
        list_address: list,
    })}`;
}

/**
 * Fuzzy search (GET with query params - NOT POST).
 *   GET /defi/v3/search?keyword=<q>&target=token&chain=solana&search_by=combination&search_mode=fuzzy&sort_by=volume_24h_usd&sort_type=desc&verify_token=true&limit=N&offset=0
 * Response: { data: { items: [{ type: 'token'|'market', result: [...] }] } }
 * token-group fields are snake_case.
 */
export function searchUrl(keyword: string, limit: number): string {
    return `${BIRDEYE_BASE}/defi/v3/search${qs({
        keyword,
        target: 'token',
        chain: BIRDEYE_CHAIN,
        search_by: 'combination',
        search_mode: 'fuzzy',
        sort_by: 'volume_24h_usd',
        sort_type: 'desc',
        verify_token: true,
        limit,
        offset: 0,
    })}`;
}

/**
 * OHLCV candles for the chart detail view.
 *   GET /defi/ohlcv?address=<mint>&type=<1m|5m|15m|1H|4H|1D>&time_from=<sec>&time_to=<sec>
 * Response: { data: { items: [{ unixTime, o, h, l, c, v }] }, success }.
 */
export function ohlcvUrl(mint: string, type: string, fromSec: number, toSec: number): string {
    return `${BIRDEYE_BASE}/defi/ohlcv${qs({
        address: mint,
        type,
        time_from: fromSec,
        time_to: toSec,
    })}`;
}

/** Path-only (for log correlation - stripped of query string + host). */
export function pathOf(url: string): string {
    const q = url.indexOf('?');
    const p = q >= 0 ? url.substring(0, q) : url;
    const base = p.indexOf(BIRDEYE_BASE);
    return base === 0 ? p.substring(BIRDEYE_BASE.length) : p;
}
