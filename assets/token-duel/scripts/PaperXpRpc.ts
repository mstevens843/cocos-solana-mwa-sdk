/**
 * PaperXpRpc.ts — DB Stage 3 client wrapper for cross-device paper/bot XP.
 *
 * Backend persistence at `paper_xp` table. Real-mode XP stays on-chain
 * (UserStats PDA) — this module only handles paper/bot training XP.
 *
 * Read pattern: stale-while-revalidate. Sync local cache returns instantly;
 * async fetch updates the cache for the next render.
 *
 * Write pattern: fire-and-forget delta POST. localStorage `Stats` keeps
 * being the local source of truth so an offline device still progresses;
 * next online session syncs up.
 */
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[PaperXpRpc]';

export interface PaperXpResponse {
    pubkey: string;
    totalXp: number;
    botXp: number;
    paperRealXp: number;
    gamesPlayed: number;
    wins: number;
    losses: number;
    lastUpdated?: string;
}

export type PaperXpTrack = 'bot' | 'paper-real';

const TTL_MS = 30_000;
interface CacheEntry { value: PaperXpResponse; expires: number; }
const cache = new Map<string, CacheEntry>();

/** Get paper-XP totals for a pubkey. Falls back to null when backend unreachable. */
export async function fetchPaperXp(pubkey: string): Promise<PaperXpResponse | null> {
    const now = Date.now();
    const hit = cache.get(pubkey);
    if (hit && hit.expires > now) return hit.value;

    if (!RECEIPT_BACKEND_URL) return null;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/paper-xp/${pubkey}`);
        if (!res.ok) {
            console.log(`${TAG} fetchPaperXp | HTTP ${res.status}`);
            return null;
        }
        const body = (await res.json()) as PaperXpResponse;
        cache.set(pubkey, { value: body, expires: now + TTL_MS });
        return body;
    } catch (e) {
        console.log(`${TAG} fetchPaperXp | NET_ERR ${e}`);
        return null;
    }
}

/**
 * Post a paper-match XP delta. Fire-and-forget; failures are logged but
 * don't throw. The local Stats system remains the device-side source of
 * truth — next successful sync picks up the missed delta.
 */
export async function postPaperXpDelta(
    pubkey: string,
    deltaXp: number,
    track: PaperXpTrack,
    won: boolean,
): Promise<void> {
    if (!RECEIPT_BACKEND_URL) return;
    if (!pubkey || deltaXp < 0) return;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/paper-xp/${pubkey}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ xp: Math.floor(deltaXp), track, won }),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} postPaperXpDelta | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return;
        }
        const body = (await res.json()) as PaperXpResponse;
        // Refresh local cache so chip picks up the new total on next read.
        cache.set(pubkey, { value: body, expires: Date.now() + TTL_MS });
        console.log(`${TAG} postPaperXpDelta | OK pubkey=${pubkey.slice(0, 8)}… +${deltaXp} XP track=${track} total=${body.totalXp}`);
    } catch (e) {
        console.log(`${TAG} postPaperXpDelta | NET_ERR ${e}`);
    }
}

/** Clear cache (e.g., on wallet disconnect). */
export function clearPaperXpCache(): void {
    cache.clear();
}
