/**
 * TrophyRpc.ts — Part 11 Bundle B.
 *
 * Queries Helius DAS (Digital Asset Standard) API for a player's cNFTs filtered
 * to Token Duel's trophy merkle tree. Parses the metadata → returns a typed
 * list the Portfolio Trophies tab renders.
 *
 * Helius DAS docs: https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api
 *
 * Fallback: if Helius is unreachable or returns a non-JSON response, returns [].
 * Render layer shows "No trophies yet — win a weekly season" empty state.
 */

import { HELIUS_DAS_URL, TROPHY_TREE_ADDRESS } from './constants';

const TAG = '[TrophyRpc]';

export interface Trophy {
    mint: string;         // cNFT asset id (base58)
    weekId: number;       // parsed from name "Token Duel · Week #N · Nst"
    rank: number;         // 1, 2, or 3
    wins: number;         // read from metadata attributes (0 if unavailable)
    name: string;
    imageUri: string;
    mintedAt?: number;    // unix sec if available
}

interface DasAsset {
    id: string;
    content?: {
        metadata?: { name?: string; symbol?: string; attributes?: Array<{ trait_type?: string; value?: unknown }> };
        files?: Array<{ uri?: string }>;
        json_uri?: string;
        links?: { image?: string };
    };
    compression?: { tree?: string; leaf_id?: number; created_at?: number };
}

/**
 * Fetch all cNFTs owned by the given wallet, restrict to our trophy tree,
 * parse name/metadata, return sorted-by-weekId-descending list.
 */
export async function getPlayerTrophies(playerPubkey: string): Promise<Trophy[]> {
    if (!HELIUS_DAS_URL || HELIUS_DAS_URL.includes('YOUR_HELIUS_KEY')) {
        console.log(`${TAG} getPlayerTrophies | HELIUS_DAS_URL not configured — returning []`);
        return [];
    }
    if (!TROPHY_TREE_ADDRESS) {
        console.log(`${TAG} getPlayerTrophies | TROPHY_TREE_ADDRESS not set — returning []`);
        return [];
    }

    try {
        const res = await fetch(HELIUS_DAS_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'td-trophies',
                method: 'getAssetsByOwner',
                params: {
                    ownerAddress: playerPubkey,
                    page: 1,
                    limit: 200,
                    displayOptions: { showCollectionMetadata: false },
                },
            }),
        });
        if (!res.ok) {
            console.log(`${TAG} getPlayerTrophies | HTTP ${res.status}`);
            return [];
        }
        const body = await res.json() as { result?: { items?: DasAsset[] } };
        const items = body?.result?.items ?? [];
        const ours = items.filter((a) => a.compression?.tree === TROPHY_TREE_ADDRESS);
        const trophies = ours.map((a) => parseTrophy(a)).filter((t): t is Trophy => t !== null);
        trophies.sort((a, b) => b.weekId - a.weekId);
        console.log(`${TAG} getPlayerTrophies | DONE wallet=${playerPubkey.substring(0, 8)}... items_total=${items.length} ours=${ours.length} parsed=${trophies.length}`);
        return trophies;
    } catch (e) {
        console.log(`${TAG} getPlayerTrophies | ERROR ${e}`);
        return [];
    }
}

function parseTrophy(a: DasAsset): Trophy | null {
    const name = a.content?.metadata?.name ?? '';
    // Expected: "Token Duel · Week #N · Nst"
    const match = name.match(/Week #(\d+)\s*·\s*(\d+)(?:st|nd|rd|th)/);
    if (!match) {
        console.log(`${TAG} parseTrophy | UNPARSED name="${name}"`);
        return null;
    }
    const weekId = parseInt(match[1], 10);
    const rank = parseInt(match[2], 10);
    let wins = 0;
    const attrs = a.content?.metadata?.attributes ?? [];
    for (const attr of attrs) {
        if (attr.trait_type === 'Wins') {
            const v = Number(attr.value);
            if (Number.isFinite(v)) wins = v;
        }
    }
    const imageUri = a.content?.links?.image ?? a.content?.files?.[0]?.uri ?? '';
    const mintedAt = a.compression?.created_at ?? undefined;
    return { mint: a.id, weekId, rank, wins, name, imageUri, mintedAt };
}

/** Pretty rank emoji for tile display. Retained for back-compat / share-card / log lines. */
export function rankEmoji(rank: number): string {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '🏆';
}

/** UX overhaul: IconLibrary key for rank → procedural medal/trophy icon.
 *  Rank 4+ now resolves to 'starBurst' so participation cards read distinctly
 *  from the gold/silver/bronze podium tier rather than reusing the generic
 *  trophy glyph (which competed visually with the rank-1 medal).
 */
export type RankIconName = 'medalGold' | 'medalSilver' | 'medalBronze' | 'starBurst';
export function rankIcon(rank: number): RankIconName {
    if (rank === 1) return 'medalGold';
    if (rank === 2) return 'medalSilver';
    if (rank === 3) return 'medalBronze';
    return 'starBurst';
}

// Dev-only fixture for the Trophies tab so design work can proceed before any
// weekly season has run (no cNFTs in the trophy tree yet). Toggled at runtime
// via `globalThis.TD_MOCK_TROPHIES = true` and consumed from AppUI's
// `_refreshTrophies` only when the live Helius result is empty.
export function mockTrophies(): Trophy[] {
    const now = Math.floor(Date.now() / 1000);
    const week = 86400 * 7;
    const seed: Array<{ weekId: number; rank: number; wins: number }> = [
        { weekId: 6, rank: 1, wins: 12 },
        { weekId: 5, rank: 1, wins: 9 },
        { weekId: 4, rank: 2, wins: 7 },
        { weekId: 3, rank: 3, wins: 5 },
        { weekId: 2, rank: 3, wins: 4 },
        { weekId: 1, rank: 4, wins: 2 },
    ];
    return seed.map((s, i) => ({
        mint: `mock-w${s.weekId}-r${s.rank}`,
        weekId: s.weekId,
        rank: s.rank,
        wins: s.wins,
        name: `Token Duel · Week #${s.weekId} · ${s.rank}${s.rank === 1 ? 'st' : s.rank === 2 ? 'nd' : s.rank === 3 ? 'rd' : 'th'}`,
        imageUri: '',
        mintedAt: now - i * week,
    }));
}
