/**
 * NotificationsRpc.ts - DB Stage 10 cross-device notification sync.
 *
 * Wraps the three /notifications/:pubkey endpoints:
 *   - GET                            → fetchNotifications
 *   - POST /:pubkey                  → postNotification (client-emit)
 *   - POST /:pubkey/:id/read         → postNotificationRead
 *
 * Mirrors the stale-while-revalidate / fire-and-forget pattern used by
 * PaperXpRpc.ts. Local NotificationStore stays the device source of
 * truth; backend is the cross-device + offline catchup mirror.
 */
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[NotificationsRpc]';

export interface RemoteNotificationEvent {
    id: string;
    kind: string;
    player: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    createdAt: number;
    /** Server hydrate path includes this; null if unread. */
    readAt?: number | null;
}

export interface NotificationsResponse {
    events: RemoteNotificationEvent[];
}

const TTL_MS = 30_000;
interface CacheEntry { value: NotificationsResponse; expires: number; }
const cache = new Map<string, CacheEntry>();

export async function fetchNotifications(
    pubkey: string,
    sinceMs: number = 0,
    limit: number = 50,
): Promise<NotificationsResponse | null> {
    const now = Date.now();
    // Cache key includes since/limit so a paginated call doesn't poison the
    // hot "give me everything" cache.
    const key = `${pubkey}|${sinceMs}|${limit}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.value;

    if (!RECEIPT_BACKEND_URL) return null;
    try {
        const url = `${RECEIPT_BACKEND_URL}/notifications/${pubkey}?since=${sinceMs}&limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) {
            console.log(`${TAG} fetchNotifications | HTTP ${res.status}`);
            return null;
        }
        const body = (await res.json()) as NotificationsResponse;
        cache.set(key, { value: body, expires: now + TTL_MS });
        return body;
    } catch (e) {
        console.log(`${TAG} fetchNotifications | NET_ERR ${e}`);
        return null;
    }
}

/** Fire-and-forget enqueue. */
export async function postNotification(
    pubkey: string,
    payload: {
        id?: string;
        kind: string;
        title: string;
        body: string;
        payload?: Record<string, unknown>;
        createdAt?: number;
    },
): Promise<void> {
    if (!RECEIPT_BACKEND_URL || !pubkey) return;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/notifications/${pubkey}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} postNotification | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return;
        }
        // Bust caches so next fetch sees the new event.
        for (const k of cache.keys()) {
            if (k.startsWith(`${pubkey}|`)) cache.delete(k);
        }
        console.log(`${TAG} postNotification | OK pubkey=${pubkey.slice(0, 8)}… kind=${payload.kind}`);
    } catch (e) {
        console.log(`${TAG} postNotification | NET_ERR ${e}`);
    }
}

/** Fire-and-forget mark-read. */
export async function postNotificationRead(pubkey: string, id: string): Promise<void> {
    if (!RECEIPT_BACKEND_URL || !pubkey || !id) return;
    try {
        const res = await fetch(
            `${RECEIPT_BACKEND_URL}/notifications/${pubkey}/${encodeURIComponent(id)}/read`,
            { method: 'POST' },
        );
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} postNotificationRead | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return;
        }
    } catch (e) {
        console.log(`${TAG} postNotificationRead | NET_ERR ${e}`);
    }
}

export function clearNotificationsCache(): void {
    cache.clear();
}
