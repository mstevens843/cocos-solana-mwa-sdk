/**
 * WatchlistRpc.ts - DB Stage 9 cross-device watchlist sync.
 *
 * Stale-while-revalidate read; fire-and-forget add/remove. Local
 * Watchlist (sys.localStorage) is the device source of truth. On first
 * hydrate Watchlist does a union-merge (local ∪ server, dedup by mint,
 * earlier addedAt wins) - see ~/.claude/plans/db-persistence-ship-ready.md.
 */
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[WatchlistRpc]';

export interface WatchlistRemoteItem {
    mint: string;
    baseSymbol: string;
    baseName: string;
    logoURI: string;
    addedAt: number;   // unix seconds
}

export interface WatchlistResponse {
    pubkey: string;
    items: WatchlistRemoteItem[];
}

const TTL_MS = 30_000;
interface CacheEntry { value: WatchlistResponse; expires: number; }
const cache = new Map<string, CacheEntry>();

export async function fetchWatchlist(pubkey: string): Promise<WatchlistResponse | null> {
    const now = Date.now();
    const hit = cache.get(pubkey);
    if (hit && hit.expires > now) return hit.value;

    if (!RECEIPT_BACKEND_URL) return null;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/users/${pubkey}/watchlist`);
        if (!res.ok) {
            console.log(`${TAG} fetchWatchlist | HTTP ${res.status}`);
            return null;
        }
        const body = (await res.json()) as WatchlistResponse;
        cache.set(pubkey, { value: body, expires: now + TTL_MS });
        return body;
    } catch (e) {
        console.log(`${TAG} fetchWatchlist | NET_ERR ${e}`);
        return null;
    }
}

export async function postWatchlistAdd(
    pubkey: string,
    item: WatchlistRemoteItem,
): Promise<void> {
    if (!RECEIPT_BACKEND_URL || !pubkey || !item?.mint) return;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/users/${pubkey}/watchlist`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(item),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} postWatchlistAdd | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return;
        }
        // Bust cache so next read sees the addition.
        cache.delete(pubkey);
        console.log(`${TAG} postWatchlistAdd | OK pubkey=${pubkey.slice(0, 8)}… mint=${item.mint.slice(0, 8)}…`);
    } catch (e) {
        console.log(`${TAG} postWatchlistAdd | NET_ERR ${e}`);
    }
}

export async function deleteWatchlistItem(pubkey: string, mint: string): Promise<void> {
    if (!RECEIPT_BACKEND_URL || !pubkey || !mint) return;
    try {
        const res = await fetch(
            `${RECEIPT_BACKEND_URL}/users/${pubkey}/watchlist/${encodeURIComponent(mint)}`,
            { method: 'DELETE' },
        );
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} deleteWatchlistItem | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return;
        }
        cache.delete(pubkey);
        console.log(`${TAG} deleteWatchlistItem | OK pubkey=${pubkey.slice(0, 8)}… mint=${mint.slice(0, 8)}…`);
    } catch (e) {
        console.log(`${TAG} deleteWatchlistItem | NET_ERR ${e}`);
    }
}

export function clearWatchlistCache(): void {
    cache.clear();
}
