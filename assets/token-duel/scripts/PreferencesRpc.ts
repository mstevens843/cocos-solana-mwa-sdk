/**
 * PreferencesRpc.ts — DB Stage 10 cross-device user-preferences sync.
 *
 * Backed by users.metadata->'preferences' JSONB (no schema change). PUT
 * is merge-patch: the server folds the incoming object into the existing
 * preferences sub-object, so individual fire-and-forget calls don't
 * clobber unrelated keys.
 */
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[PreferencesRpc]';

/**
 * Known preference keys. Server accepts any object so this list is for
 * client-side typing convenience, not a runtime contract.
 */
export interface UserPreferences {
    botDifficulty?: 'easy' | 'medium' | 'hard';
    qpMode?: string;       // ModeId
    qpWindow?: string;     // TimeWindowId
    qpWager?: string;      // wager-tier index as string (matches localStorage shape)
    qpTrack?: 'paper' | 'real';
    soundEnabled?: boolean;
    soundVolume?: number;  // 0..100
    hapticsEnabled?: boolean;
}

export interface PreferencesResponse {
    pubkey: string;
    preferences: UserPreferences;
}

const TTL_MS = 60_000;
interface CacheEntry { value: PreferencesResponse; expires: number; }
const cache = new Map<string, CacheEntry>();

export async function fetchPreferences(pubkey: string): Promise<PreferencesResponse | null> {
    const now = Date.now();
    const hit = cache.get(pubkey);
    if (hit && hit.expires > now) return hit.value;

    if (!RECEIPT_BACKEND_URL) return null;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/users/${pubkey}/preferences`);
        if (!res.ok) {
            console.log(`${TAG} fetchPreferences | HTTP ${res.status}`);
            return null;
        }
        const body = (await res.json()) as PreferencesResponse;
        cache.set(pubkey, { value: body, expires: now + TTL_MS });
        return body;
    } catch (e) {
        console.log(`${TAG} fetchPreferences | NET_ERR ${e}`);
        return null;
    }
}

/** Fire-and-forget merge-patch. Only the keys in `patch` are sent up. */
export async function putPreferences(pubkey: string, patch: UserPreferences): Promise<void> {
    if (!RECEIPT_BACKEND_URL || !pubkey) return;
    if (!patch || Object.keys(patch).length === 0) return;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/users/${pubkey}/preferences`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ preferences: patch }),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} putPreferences | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return;
        }
        const body = (await res.json()) as PreferencesResponse;
        cache.set(pubkey, { value: body, expires: Date.now() + TTL_MS });
        console.log(`${TAG} putPreferences | OK pubkey=${pubkey.slice(0, 8)}… keys=[${Object.keys(patch).join(',')}]`);
    } catch (e) {
        console.log(`${TAG} putPreferences | NET_ERR ${e}`);
    }
}

export function clearPreferencesCache(): void {
    cache.clear();
}
