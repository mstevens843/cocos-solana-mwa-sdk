/**
 * SquadPresetsRpc.ts - DB Stage 9 cross-device squad-preset sync.
 *
 * Mirrors PaperXpRpc.ts shape: stale-while-revalidate read, fire-and-
 * forget write. Local sys.localStorage (via SquadPresets) is the device
 * source of truth; backend is the cross-device mirror.
 *
 * Conflict strategy on hydrate is last-write-wins by `updatedAt`. Caller
 * (SquadPresets.hydrateFromBackend) is responsible for choosing whether
 * to overwrite local with remote, push local up, or do nothing.
 */
import { RECEIPT_BACKEND_URL } from './constants';
import type { SquadPreset } from './SquadPresets';

const TAG = '[SquadPresetsRpc]';

export interface SquadPresetsResponse {
    pubkey: string;
    presets: SquadPreset[];
    updatedAt: string | null;   // ISO timestamp; null on never-saved
}

const TTL_MS = 30_000;
interface CacheEntry { value: SquadPresetsResponse; expires: number; }
const cache = new Map<string, CacheEntry>();

/** Get presets for a pubkey. Falls back to null when backend unreachable. */
export async function fetchPresets(pubkey: string): Promise<SquadPresetsResponse | null> {
    const now = Date.now();
    const hit = cache.get(pubkey);
    if (hit && hit.expires > now) return hit.value;

    if (!RECEIPT_BACKEND_URL) return null;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/users/${pubkey}/squad-presets`);
        if (!res.ok) {
            console.log(`${TAG} fetchPresets | HTTP ${res.status}`);
            return null;
        }
        const body = (await res.json()) as SquadPresetsResponse;
        cache.set(pubkey, { value: body, expires: now + TTL_MS });
        return body;
    } catch (e) {
        console.log(`${TAG} fetchPresets | NET_ERR ${e}`);
        return null;
    }
}

/** Replace the entire preset list for this pubkey. Fire-and-forget. */
export async function putPresets(pubkey: string, presets: SquadPreset[]): Promise<void> {
    if (!RECEIPT_BACKEND_URL || !pubkey) return;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/users/${pubkey}/squad-presets`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ presets }),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} putPresets | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return;
        }
        const body = (await res.json()) as SquadPresetsResponse;
        cache.set(pubkey, { value: body, expires: Date.now() + TTL_MS });
        console.log(`${TAG} putPresets | OK pubkey=${pubkey.slice(0, 8)}… count=${presets.length}`);
    } catch (e) {
        console.log(`${TAG} putPresets | NET_ERR ${e}`);
    }
}

/** Clear cache (e.g., on wallet disconnect). */
export function clearPresetsCache(): void {
    cache.clear();
}
