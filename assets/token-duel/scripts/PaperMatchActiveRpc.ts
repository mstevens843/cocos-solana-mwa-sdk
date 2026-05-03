/**
 * PaperMatchActiveRpc.ts - backend client for the paper_match_active table
 * (DB Stage 7). Signed-in users persist their in-flight paper / bot matches
 * here so MIP shows them cross-device. Guests stay in client memory only.
 *
 * All calls are best-effort - failures are logged but never thrown so a
 * backend hiccup can't block gameplay.
 */
import { RECEIPT_BACKEND_URL } from './constants';

const TAG = '[PaperMatchActiveRpc]';

export interface PaperMatchActiveRow {
    id: string;
    pubkey: string;
    modeU8: number;
    timeWindow: number;
    requiredPlayers: number;
    track: 'bot' | 'paper-real';
    startedAt: string;
    durationMs: number;
    lastHeight: number;
    lastBotHeights: number[];
    lastUpdated: string;
}

export interface RegisterArgs {
    id: string;
    pubkey: string;
    modeU8: number;
    timeWindow: number;
    requiredPlayers: number;
    track: 'bot' | 'paper-real';
    durationMs: number;
}

export async function registerPaperMatchActive(args: RegisterArgs): Promise<boolean> {
    if (!RECEIPT_BACKEND_URL) return false;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/paper-match/active`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(args),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.log(`${TAG} register | HTTP ${res.status} body="${txt.slice(0, 120)}"`);
            return false;
        }
        console.log(`${TAG} register | OK id=${args.id.slice(0, 18)}… pk=${args.pubkey.slice(0, 8)}… mode=${args.modeU8} window=${args.timeWindow} dur=${args.durationMs}ms track=${args.track}`);
        return true;
    } catch (e) {
        console.log(`${TAG} register | NET_ERR ${e}`);
        return false;
    }
}

export async function updatePaperMatchHeights(
    id: string,
    lastHeight: number,
    lastBotHeights: number[],
): Promise<boolean> {
    if (!RECEIPT_BACKEND_URL) return false;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/paper-match/active/${encodeURIComponent(id)}/heights`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ lastHeight, lastBotHeights }),
        });
        return res.ok;
    } catch (e) {
        console.log(`${TAG} updateHeights | NET_ERR ${e}`);
        return false;
    }
}

export async function deletePaperMatchActive(id: string): Promise<boolean> {
    if (!RECEIPT_BACKEND_URL) return false;
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/paper-match/active/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        return res.ok;
    } catch (e) {
        console.log(`${TAG} delete | NET_ERR ${e}`);
        return false;
    }
}

export async function listPaperMatchesActive(pubkey: string): Promise<PaperMatchActiveRow[]> {
    if (!RECEIPT_BACKEND_URL) return [];
    try {
        const res = await fetch(`${RECEIPT_BACKEND_URL}/paper-match/active/${encodeURIComponent(pubkey)}`);
        if (!res.ok) {
            console.log(`${TAG} list | HTTP ${res.status}`);
            return [];
        }
        const body = (await res.json()) as { rows: PaperMatchActiveRow[] };
        return Array.isArray(body?.rows) ? body.rows : [];
    } catch (e) {
        console.log(`${TAG} list | NET_ERR ${e}`);
        return [];
    }
}

export async function listAllPaperMatchesActive(
    limit: number = 50,
    offset: number = 0,
): Promise<PaperMatchActiveRow[]> {
    if (!RECEIPT_BACKEND_URL) return [];
    try {
        const res = await fetch(
            `${RECEIPT_BACKEND_URL}/paper-match/active?limit=${limit}&offset=${offset}`,
        );
        if (!res.ok) {
            console.log(`${TAG} listAll | HTTP ${res.status}`);
            return [];
        }
        const body = (await res.json()) as { rows: PaperMatchActiveRow[] };
        return Array.isArray(body?.rows) ? body.rows : [];
    } catch (e) {
        console.log(`${TAG} listAll | NET_ERR ${e}`);
        return [];
    }
}
