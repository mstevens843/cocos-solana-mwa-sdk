/**
 * TokenStatsRpc.ts - Part 13 Bundle C.
 *
 * Client-side fetch for the backend's /admin/tokens aggregate. Caches
 * responses in-memory for 5 minutes - the backend's bucket changes slowly
 * (one match at a time), so rapid-fire UI re-renders shouldn't hammer the
 * endpoint.
 *
 * Shape mirrors backend/src/token_stats.ts::TokenStatsRow. Clients lookup
 * by mint via `getTokenWinrate(mint)` which returns null when the mint is
 * absent or below the minimum-match threshold (default 10).
 */
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[TokenStatsRpc]';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_MATCHES_FOR_DISPLAY = 10;

export interface TokenStatsRow {
    mint: string;
    wins: number;
    matches: number;
    winratePct: number;
}

interface CacheEntry {
    rows: TokenStatsRow[];
    fetchedAt: number;
}

let _cache: CacheEntry | null = null;
let _inFlight: Promise<TokenStatsRow[]> | null = null;

/**
 * Returns the current top-10 token stats. Populates cache on first call;
 * serves cache thereafter until TTL. Resilient to backend unavailability -
 * returns `[]` rather than throwing.
 */
export async function fetchTopTokens(limit: number = 10): Promise<TokenStatsRow[]> {
    const now = Date.now();
    if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
        return _cache.rows;
    }
    if (_inFlight) return _inFlight;
    _inFlight = (async () => {
        try {
            const url = `${RECEIPT_BACKEND_URL}/admin/tokens?limit=${limit}`;
            const res = await fetch(url, { headers: { accept: 'application/json' } });
            if (!res.ok) {
                console.log(`${TAG} fetchTopTokens | HTTP ${res.status}`);
                return [];
            }
            const body = await res.json() as { tokens: TokenStatsRow[] };
            _cache = { rows: body.tokens ?? [], fetchedAt: Date.now() };
            console.log(`${TAG} fetchTopTokens | OK rows=${_cache.rows.length}`);
            return _cache.rows;
        } catch (e) {
            console.log(`${TAG} fetchTopTokens | ERROR ${e}`);
            return [];
        } finally {
            _inFlight = null;
        }
    })();
    return _inFlight;
}

/**
 * Winrate for a single mint, or null when absent / below the display
 * threshold (10 matches). Reads from the cached top-N list - does NOT
 * round-trip a per-mint endpoint because the admin snapshot already
 * includes top-10 and we don't want to chase the long tail.
 */
export async function getTokenWinrate(mint: string): Promise<{ winratePct: number; matches: number } | null> {
    const rows = await fetchTopTokens(20);
    const hit = rows.find((r) => r.mint === mint);
    if (!hit || hit.matches < MIN_MATCHES_FOR_DISPLAY) return null;
    return { winratePct: hit.winratePct, matches: hit.matches };
}

/** Force a cache flush (e.g., on app foreground after > 5min in background). */
export function invalidateCache(): void {
    _cache = null;
}
