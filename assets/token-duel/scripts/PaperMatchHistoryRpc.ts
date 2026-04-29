/**
 * PaperMatchHistoryRpc.ts — backend client for the paper_match_history table
 * (DB Stage 8). Signed-in users POST here on settle / forfeit so a future
 * "Match History" UI can render the full off-chain history. Guests skip.
 *
 * All calls are best-effort — failures are logged but never thrown so a
 * backend hiccup can't block the post-match flow.
 *
 * 2026-04-28 — Added a localStorage mirror so paper / bot history is visible
 * even when the backend is unreachable, the user is a guest, or the row
 * never made it server-side. `listPaperMatchHistory` merges the backend page
 * with the local mirror, dedupes by id, and re-sorts desc by settledAt.
 */
import { sys } from 'cc';
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[PaperMatchHistoryRpc]';
const LOCAL_KEY = 'tokenduel:paper-history-local';
const LOCAL_CAP = 100;

interface KVStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

function safeStorage(): KVStorage | null {
    try {
        const s = (sys as any)?.localStorage as KVStorage | undefined;
        if (s && typeof s.getItem === 'function') return s;
    } catch (_) { /* native shim not yet ready */ }
    return null;
}

export interface PaperMatchHistoryRow {
    id: string;
    pubkey: string;
    modeU8: number;
    timeWindow: number;
    requiredPlayers: number;
    track: 'bot' | 'paper-real';
    players: string[];
    heights: number[];
    myHeight: number;
    winnerPubkey: string | null;
    placement: number;
    totalPlayers: number;
    won: boolean;
    xpGained: number;
    startedAt: string;
    settledAt: string;
}

export interface PostHistoryArgs {
    id: string;
    pubkey: string;
    modeU8: number;
    timeWindow: number;
    requiredPlayers: number;
    track: 'bot' | 'paper-real';
    players: string[];
    heights: number[];
    myHeight: number;
    winnerPubkey: string | null;
    placement: number;
    totalPlayers: number;
    won: boolean;
    xpGained: number;
    startedAt: string;
    settledAt: string;
}

export async function postPaperMatchHistory(args: PostHistoryArgs): Promise<boolean> {
    if (!RECEIPT_BACKEND_URL) return false;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/paper-match/history`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(args),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} post | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return false;
        }
        console.log(`${TAG} post | OK id=${args.id.slice(0, 18)}… pk=${args.pubkey.slice(0, 8)}… won=${args.won} placement=${args.placement + 1}/${args.totalPlayers} xp=${args.xpGained}`);
        return true;
    } catch (e) {
        console.log(`${TAG} post | NET_ERR ${e}`);
        return false;
    }
}

async function fetchBackendHistory(
    pubkey: string,
    limit: number,
    offset: number,
): Promise<PaperMatchHistoryRow[]> {
    if (!RECEIPT_BACKEND_URL) return [];
    try {
        const url = `${RECEIPT_BACKEND_URL}/paper-match/history/${encodeURIComponent(pubkey)}`
            + `?limit=${limit}&offset=${offset}`;
        const res = await fetch(url);
        if (!res.ok) {
            console.log(`${TAG} list | HTTP ${res.status}`);
            return [];
        }
        const body = (await res.json()) as { rows: PaperMatchHistoryRow[] };
        return Array.isArray(body?.rows) ? body.rows : [];
    } catch (e) {
        console.log(`${TAG} list | NET_ERR ${e}`);
        return [];
    }
}

function readLocalAll(): PaperMatchHistoryRow[] {
    const s = safeStorage();
    if (!s) return [];
    try {
        const raw = s.getItem(LOCAL_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter((r) => r && typeof r.id === 'string') : [];
    } catch (_) {
        return [];
    }
}

function writeLocalAll(rows: PaperMatchHistoryRow[]): void {
    const s = safeStorage();
    if (!s) return;
    try {
        const trimmed = rows.slice(0, LOCAL_CAP);
        s.setItem(LOCAL_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.log(`${TAG} local_write_err | ${e}`);
    }
}

/**
 * Persist a finished paper / bot match into the localStorage mirror so the
 * History tab shows it immediately, regardless of backend reachability.
 * Idempotent on `id` (later writes for the same id replace the earlier row).
 */
export function recordLocalHistory(row: PaperMatchHistoryRow): void {
    if (!row || typeof row.id !== 'string') return;
    const existing = readLocalAll().filter((r) => r.id !== row.id);
    existing.unshift(row); // newest first
    writeLocalAll(existing);
    console.log(`${TAG} local | id=${row.id.slice(0, 18)}… pk=${row.pubkey.slice(0, 8)}… won=${row.won} placement=${row.placement + 1}/${row.totalPlayers} xp=${row.xpGained}`);
}

export async function listPaperMatchHistory(
    pubkey: string,
    limit = 50,
    offset = 0,
): Promise<PaperMatchHistoryRow[]> {
    const backend = await fetchBackendHistory(pubkey, limit, offset);
    // Only merge the local mirror on the first page. Load-more pagination
    // continues against the backend cursor without re-injecting locals.
    if (offset > 0) return backend;

    const local = readLocalAll().filter((r) => r.pubkey === pubkey);
    if (local.length === 0) return backend;

    const seen = new Set<string>();
    const merged: PaperMatchHistoryRow[] = [];
    for (const r of backend) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push(r);
    }
    for (const r of local) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push(r);
    }
    merged.sort((a, b) => {
        const at = Date.parse(a.settledAt) || 0;
        const bt = Date.parse(b.settledAt) || 0;
        return bt - at;
    });
    return merged.slice(0, limit);
}
