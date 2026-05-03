/**
 * Watchlist.ts - sys.localStorage-backed token watchlist.
 *
 * Mirrors solpulse's `NewPairsFeed.jsx` watchlist behavior:
 *   - Persistence key (ours): `tokenduel:watchlist`
 *   - Schema: `WatchlistItem[]` - dedupe by `baseMint`
 *   - Hot `has(mint)` lookup via an in-memory Set mirror
 *
 * Graceful degradation: if storage is unavailable (sandboxed Cocos
 * preview, SSR), the watchlist runs in-memory for the session and logs
 * `STORAGE_UNAVAILABLE` so missing persistence is visible.
 *
 * DB Stage 9 - every mutation fires fire-and-forget add/remove against
 * the backend mirror. On wallet connect, hydrateFromBackend does a
 * union-merge (local ∪ server, dedup by mint, earlier addedAt wins).
 */

import { sys } from 'cc';
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
    private _syncPubkey: string | null = null;

    /** Read from localStorage into memory. Called lazily on first access. */
    private _ensureLoaded(): void {
        if (this._loaded) return;
        this._loaded = true;

        const ls = this._ls();
        if (!ls) {
            this._storageOk = false;
            console.log(`${TAG} LOAD | STORAGE_UNAVAILABLE - running in-memory only, no persistence`);
            return;
        }

        let raw: string | null;
        try {
            raw = ls.getItem(WATCHLIST_LS_KEY);
        } catch (e) {
            console.log(`${TAG} LOAD | READ_ERROR error=${e} - starting empty`);
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
            console.log(`${TAG} LOAD | PARSE_ERROR error=${e} - starting empty`);
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

    /** Safe accessor - prefers Cocos sys.localStorage (SQLite-backed on
     *  native), falls back to web localStorage. Returns null in fully
     *  sandboxed contexts. */
    private _ls(): { getItem(k: string): string | null;
                     setItem(k: string, v: string): void;
                     removeItem(k: string): void } | null {
        try {
            const s = (sys as any)?.localStorage;
            if (s && typeof s.getItem === 'function') return s;
        } catch (_) { /* native shim not yet ready */ }
        try {
            const g = (globalThis as any).localStorage;
            if (g && typeof g.getItem === 'function') return g;
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
        this._syncAddToBackend(item);
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
        this._syncRemoveFromBackend(mint);
        console.log(`${TAG} REMOVE | DONE mint=${mint} count=${this._items.length}`);
        return true;
    }

    // ─── Backend sync (DB Stage 9) ────────────────────────────────────

    /** Bind to a pubkey for cross-device sync. Pass null to stop syncing. */
    setSyncPubkey(pubkey: string | null): void {
        this._syncPubkey = pubkey || null;
    }

    private _syncAddToBackend(item: WatchlistItem): void {
        if (!this._syncPubkey) return;
        const pubkey = this._syncPubkey;
        void (async () => {
            try {
                const { postWatchlistAdd } = await import('./WatchlistRpc');
                await postWatchlistAdd(pubkey, {
                    mint: item.baseMint,
                    baseSymbol: item.baseSymbol,
                    baseName: item.baseName,
                    logoURI: item.logoURI,
                    addedAt: item.addedAt,
                });
            } catch (e) {
                console.log(`${TAG} _syncAddToBackend | NET_ERR ${e}`);
            }
        })();
    }

    private _syncRemoveFromBackend(mint: string): void {
        if (!this._syncPubkey) return;
        const pubkey = this._syncPubkey;
        void (async () => {
            try {
                const { deleteWatchlistItem } = await import('./WatchlistRpc');
                await deleteWatchlistItem(pubkey, mint);
            } catch (e) {
                console.log(`${TAG} _syncRemoveFromBackend | NET_ERR ${e}`);
            }
        })();
    }

    /**
     * Pull the server's watchlist and union-merge with local. On collision,
     * the earlier `addedAt` wins (protects "I added it on this phone first
     * before connecting"). Items only present on one side are preserved.
     * After merge, push any local-only items up so the server catches up.
     */
    async hydrateFromBackend(pubkey: string): Promise<void> {
        if (!pubkey) return;
        this._ensureLoaded();
        try {
            const { fetchWatchlist, postWatchlistAdd } = await import('./WatchlistRpc');
            const remote = await fetchWatchlist(pubkey);
            if (!remote) return;

            const localByMint = new Map<string, WatchlistItem>(this._items.map((i) => [i.baseMint, i]));
            const remoteByMint = new Map<string, WatchlistItem>(remote.items.map((i) => [i.mint, {
                baseMint: i.mint,
                baseSymbol: i.baseSymbol,
                baseName: i.baseName,
                logoURI: i.logoURI,
                addedAt: i.addedAt,
            }]));

            const merged = new Map<string, WatchlistItem>();
            // Union local + remote, earlier addedAt wins on collision.
            for (const [mint, item] of localByMint) merged.set(mint, item);
            for (const [mint, item] of remoteByMint) {
                const prev = merged.get(mint);
                if (!prev || (item.addedAt > 0 && item.addedAt < prev.addedAt)) {
                    merged.set(mint, item);
                }
            }

            const localOnly: WatchlistItem[] = [];
            for (const mint of localByMint.keys()) {
                if (!remoteByMint.has(mint)) localOnly.push(localByMint.get(mint)!);
            }

            // Replace local with merged result, sorted newest-first.
            const next = Array.from(merged.values()).sort((a, b) => b.addedAt - a.addedAt);
            this._items = next;
            this._mintSet = new Set(next.map((i) => i.baseMint));
            this._persist();

            // Push local-only items up so the server learns about them.
            for (const item of localOnly) {
                try {
                    await postWatchlistAdd(pubkey, {
                        mint: item.baseMint,
                        baseSymbol: item.baseSymbol,
                        baseName: item.baseName,
                        logoURI: item.logoURI,
                        addedAt: item.addedAt,
                    });
                } catch (_) { /* fire-and-forget; ignore */ }
            }

            console.log(`${TAG} hydrate | DONE local_only_pushed=${localOnly.length} merged_count=${next.length}`);
        } catch (e) {
            console.log(`${TAG} hydrate | ERR ${e}`);
        }
    }

    /** Toggle - returns the resulting state (true = now in watchlist). */
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
     * Convert stored items back to `TokenRow` shape (lossy - missing
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
