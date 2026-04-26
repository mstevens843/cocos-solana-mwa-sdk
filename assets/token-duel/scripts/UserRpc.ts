/**
 * UserRpc.ts — DB Stage 2 client wrapper for the backend `users` table.
 *
 * Provides display-name lookup + setter. Fail-soft when backend is offline:
 * `getUsername` returns null, callers fall back to truncated pubkey.
 *
 * Usernames are cached per-pubkey for 60s to keep match-list rendering snappy
 * (lobby polls every 5s; without caching that's an HTTP roundtrip per refresh).
 */
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[UserRpc]';
const TTL_MS = 60_000;

interface UserResponse {
    pubkey: string;
    username: string | null;
    joinedAt?: string;
    lastSeenAt?: string;
}

interface CacheEntry { value: string | null; expires: number; }
const cache = new Map<string, CacheEntry>();

/**
 * Fetch the display name for a pubkey. Returns the username string, or null
 * if the user has not set one (or the backend is unreachable).
 */
export async function getUsername(pubkey: string): Promise<string | null> {
    const now = Date.now();
    const hit = cache.get(pubkey);
    if (hit && hit.expires > now) return hit.value;

    if (!RECEIPT_BACKEND_URL) return null;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/users/${pubkey}`);
        if (res.status === 404) {
            cache.set(pubkey, { value: null, expires: now + TTL_MS });
            return null;
        }
        if (!res.ok) {
            console.log(`${TAG} getUsername | HTTP ${res.status} pubkey=${pubkey.slice(0, 8)}…`);
            return null;
        }
        const body = (await res.json()) as UserResponse;
        const value = body.username ?? null;
        cache.set(pubkey, { value, expires: now + TTL_MS });
        return value;
    } catch (e) {
        console.log(`${TAG} getUsername | NET_ERR ${e}`);
        return null;
    }
}

/**
 * Set this user's display name. Returns the saved username on success.
 * Throws on validation error (400) or taken-username collision (409).
 */
export async function setUsername(pubkey: string, username: string): Promise<string> {
    if (!RECEIPT_BACKEND_URL) throw new Error('backend not configured');
    const res = await fetch(`${RECEIPT_BACKEND_URL}/users/${pubkey}/username`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        if (res.status === 409) throw new Error(body.error ?? 'username already taken');
        if (res.status === 400) throw new Error(body.error ?? 'invalid username');
        throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const body = (await res.json()) as UserResponse;
    cache.set(pubkey, { value: body.username, expires: Date.now() + TTL_MS });
    console.log(`${TAG} setUsername | OK pubkey=${pubkey.slice(0, 8)}… name="${body.username}"`);
    return body.username ?? username;
}

/** Clear the cache (e.g., on wallet disconnect or after a setUsername). */
export function clearUsernameCache(): void {
    cache.clear();
}
