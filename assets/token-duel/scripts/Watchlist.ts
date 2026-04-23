/**
 * Watchlist.ts — localStorage-backed token watchlist.
 *
 * Mirrors solpulse's `NewPairsFeed.jsx` watchlist behavior:
 *   - Persistence key (ours): `tokenduel:watchlist`
 *   - Schema: `WatchlistItem[]` — dedupe by `baseMint`
 *   - Hot `has(mint)` lookup via an in-memory Set mirror
 *
 * Graceful degradation: if `localStorage` is unavailable (sandboxed Cocos
 * preview, SSR), the watchlist runs in-memory for the session and logs
 * `STORAGE_UNAVAILABLE` so missing persistence is visible.
 */

import { WATCHLIST_LS_KEY } from './constants';
import { TokenRow } from './birdeye/types';

const TAG = '[Watchlist]';

export interface WatchlistItem {
    baseMint: string;
    baseSymbol: string;
    baseName: string;
    logoURI: string;
    addedAt: number; // unix seconds
}

class WatchlistImpl {
    private _items: WatchlistItem[] = [];
    private _mintSet: Set<string> = new Set();
    private _storageOk: boolean = true;
    private _loaded: boolean = false;

    /** Read from localStorage into memory. Called lazily on first access. */
    private _ensureLoaded(): void {
        if (this._loaded) return;
        this._loaded = true;

        const ls = this._ls();
        if (!ls) {
            this._storageOk = false;
            console.log(`${TAG} LOAD | STORAGE_UNAVAILABLE — running in-memory only, no persistence`);
            return;
        }

        let raw: string | null;
        try {
            raw = ls.getItem(WATCHLIST_LS_KEY);
        } catch (e) {
            console.log(`${TAG} LOAD | READ_ERROR error=${e} — starting empty`);
            this._storageOk = false;
            return;
        }

        if (!raw) {
            console.log(`${TAG} LOAD | count=0 (empty storage)`);
            return;
        }

        try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
                const valid = parsed.filter((x): x is WatchlistItem => {
                    return !!x && typeof (x as any).baseMint === 'string' && (x as any).baseMint.length > 0;
                });
                this._items = valid;
                this._mintSet = new Set(valid.map((x) => x.baseMint));
                console.log(`${TAG} LOAD | count=${valid.length} skipped_invalid=${parsed.length - valid.length}`);
            } else {
                console.log(`${TAG} LOAD | MALFORMED expected_array got=${typeof parsed}`);
            }
        } catch (e) {
            console.log(`${TAG} LOAD | PARSE_ERROR error=${e} — starting empty`);
        }
    }

    /** Persist to localStorage. No-op if storage unavailable. */
    private _persist(): void {
        if (!this._storageOk) return;
        const ls = this._ls();
        if (!ls) { this._storageOk = false; return; }
        try {
            ls.setItem(WATCHLIST_LS_KEY, JSON.stringify(this._items));
        } catch (e) {
            console.log(`${TAG} PERSIST | WRITE_ERROR error=${e}`);
            this._storageOk = false;
        }
    }

    /** Safe accessor — returns null if localStorage missing (Cocos preview, SSR). */
    private _ls(): Storage | null {
        try {
            if (typeof localStorage !== 'undefined') return localStorage;
        } catch (_) { /* opaque origin or disabled */ }
        return null;
    }

    /** Add a token. Returns true if newly added, false if already present. */
    add(row: TokenRow): boolean {
        this._ensureLoaded();
        if (!row.address) {
            console.log(`${TAG} ADD | SKIP_NO_MINT symbol="${row.symbol}"`);
            return false;
        }
        if (this._mintSet.has(row.address)) {
            console.log(`${TAG} ADD | SKIP_DUPE mint=${row.address} symbol="${row.symbol}" count=${this._items.length}`);
            return false;
        }
        const item: WatchlistItem = {
            baseMint: row.address,
            baseSymbol: row.symbol,
            baseName: row.name,
            logoURI: row.logoUri,
            addedAt: Math.floor(Date.now() / 1000),
        };
        this._items.unshift(item); // newest first
        this._mintSet.add(row.address);
        this._persist();
        console.log(`${TAG} ADD | DONE mint=${row.address} symbol="${row.symbol}" count=${this._items.length}`);
        return true;
    }

    /** Remove by mint. Returns true if removed. */
    remove(mint: string): boolean {
        this._ensureLoaded();
        if (!this._mintSet.has(mint)) {
            console.log(`${TAG} REMOVE | SKIP_MISSING mint=${mint} count=${this._items.length}`);
            return false;
        }
        this._items = this._items.filter((x) => x.baseMint !== mint);
        this._mintSet.delete(mint);
        this._persist();
        console.log(`${TAG} REMOVE | DONE mint=${mint} count=${this._items.length}`);
        return true;
    }

    /** Toggle — returns the resulting state (true = now in watchlist). */
    toggle(row: TokenRow): boolean {
        this._ensureLoaded();
        if (this._mintSet.has(row.address)) {
            this.remove(row.address);
            return false;
        }
        this.add(row);
        return true;
    }

    /** O(1) membership check. */
    has(mint: string): boolean {
        this._ensureLoaded();
        return this._mintSet.has(mint);
    }

    /** Return a shallow copy ordered newest-first. */
    list(): WatchlistItem[] {
        this._ensureLoaded();
        return this._items.slice();
    }

    /** Current size. */
    size(): number {
        this._ensureLoaded();
        return this._items.length;
    }

    /** Nuke the entire watchlist. */
    clear(): void {
        this._ensureLoaded();
        const prev = this._items.length;
        this._items = [];
        this._mintSet.clear();
        this._persist();
        console.log(`${TAG} CLEAR | removed=${prev} count=0`);
    }

    /**
     * Convert stored items back to `TokenRow` shape (lossy — missing
     * price/vol/etc). Caller should enrich via `PriceFeed.enrichRows`
     * before rendering on the watchlist tab.
     */
    asRows(): TokenRow[] {
        this._ensureLoaded();
        return this._items.map((x) => ({
            address: x.baseMint,
            symbol: x.baseSymbol,
            name: x.baseName,
            priceUsd: 0,
            change24hPct: 0,
            volume24hUsd: 0,
            decimals: -1,
            logoUri: x.logoURI,
            liquidity: 0,
            marketCap: 0,
            fdv: 0,
            holders: 0,
            blockUnixTime: x.addedAt,
            source: '',
            smartTraders: 0,
            netFlow: 0,
        }));
    }
}

/** Module-level singleton. Cocos scripts have no DI; one instance is fine. */
export const Watchlist = new WatchlistImpl();
