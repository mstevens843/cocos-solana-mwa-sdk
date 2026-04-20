/**
 * Birdeye endpoint URL builders.
 *
 * Centralized so the base URL and query-string shape have one source of
 * truth. All endpoints target chain=solana explicitly — Birdeye also
 * serves EVM chains on the same hostnames and the default is not stable.
 */

export const BIRDEYE_BASE = 'https://public-api.birdeye.so';
export const BIRDEYE_CHAIN = 'solana';

/** Helper — encodes params as `?a=1&b=two` (values passed through encodeURIComponent). */
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
 * Trending by 24h USD volume.
 *   GET /defi/v3/token/list?sort_by=volume_24h_usd&sort_type=desc&limit=N
 */
export function trendingUrl(limit: number): string {
    return `${BIRDEYE_BASE}/defi/v3/token/list${qs({
        sort_by: 'volume_24h_usd',
        sort_type: 'desc',
        offset: 0,
        limit,
    })}`;
}

/**
 * Top gainers by 24h price % change.
 *   GET /defi/v3/token/list?sort_by=price_change_24h_percent&sort_type=desc&limit=N
 */
export function gainersUrl(limit: number): string {
    return `${BIRDEYE_BASE}/defi/v3/token/list${qs({
        sort_by: 'price_change_24h_percent',
        sort_type: 'desc',
        offset: 0,
        limit,
        // Filter out microcaps — otherwise every list is 10000% scam rugs.
        min_liquidity: 50000,
        min_volume_24h_usd: 10000,
    })}`;
}

/**
 * Recently-listed tokens.
 *   GET /defi/v2/tokens/new_listing?limit=N
 */
export function newListingsUrl(limit: number): string {
    return `${BIRDEYE_BASE}/defi/v2/tokens/new_listing${qs({
        limit,
        meme_platform_enabled: true,
    })}`;
}

/**
 * Price + 24h % for up to 50 mints in a single call.
 *   GET /defi/price_volume/multi?list_address=<csv>&type=24h
 */
export function priceVolumeMultiUrl(mints: string[]): string {
    const list = mints.slice(0, 50).join(',');
    return `${BIRDEYE_BASE}/defi/price_volume/multi${qs({
        list_address: list,
        type: '24h',
    })}`;
}

/**
 * Fuzzy search.
 *   POST /defi/v3/search   body: {chain, keyword, target, search_by, search_mode, ...}
 */
export const searchUrl = `${BIRDEYE_BASE}/defi/v3/search`;
