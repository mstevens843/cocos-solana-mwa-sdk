/**
 * LeaderboardRpc.ts — fetch + parse per-mode Leaderboard PDAs.
 *
 * Session D Part 7. Each GameMode (0..=3) has its own `Leaderboard` PDA at
 * seeds `[b"leaderboard", &[mode]]`. Layout on-chain mirrors the singleton
 * leaderboard used by legacy `settle`: 10 × LeaderboardEntry { player:32,
 * height:1, settled_at:8 } = 410 bytes plus 8-byte Anchor discriminator.
 */

import { TokenDuelRpc } from './TokenDuelRpc';
import { AnchorBackend } from './AnchorBackend';
import { base58Encode } from '../../solana-mwa/scripts/Base58';

const TAG = '[LeaderboardRpc]';

export interface LeaderboardEntry {
    player: string;       // base58
    height: number;       // u8
    settledAt: bigint;    // i64 unix seconds
    rank: number;         // 1..=10 (1-indexed for UI convenience)
}

function readI64LE(b: Uint8Array, off: number): bigint {
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[off + i]);
    if (v >= 1n << 63n) v -= 1n << 64n;
    return v;
}

function b64ToBytes(b64: string): Uint8Array {
    if (typeof atob === 'function') {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    const B: any = (globalThis as any).Buffer;
    if (B) return new Uint8Array(B.from(b64, 'base64'));
    throw new Error('No base64 decoder available');
}

/**
 * Parse raw Leaderboard bytes (includes 8-byte Anchor discriminator). Returns
 * only non-empty entries (height > 0), ranked 1..=N. Layout:
 *   disc:8 | entries: 10 × (player:32, height:1, settled_at:8) = 410
 */
export function parseLeaderboardEntries(raw: Uint8Array): LeaderboardEntry[] {
    if (raw.length < 8 + 410) {
        console.log(`${TAG} parseLeaderboardEntries | TOO_SHORT bytes=${raw.length}`);
        return [];
    }
    const out: LeaderboardEntry[] = [];
    let o = 8;
    for (let i = 0; i < 10; i++) {
        const playerBytes = raw.subarray(o, o + 32); o += 32;
        const height = raw[o]; o += 1;
        const settledAt = readI64LE(raw, o); o += 8;
        if (height === 0) continue; // empty slot
        out.push({
            player: base58Encode(playerBytes),
            height,
            settledAt,
            rank: i + 1,
        });
    }
    return out;
}

/**
 * 2026-04-28 — Always-on mock fixture so the Leaderboard panel stays fully
 * populated during UX iteration even when the on-chain PDA only has the
 * signed-in user. Heights span the u8 range to demonstrate ordering and
 * settledAt timestamps stagger across the past week. The real entries from
 * `fetchLeaderboard` are merged on top and re-ranked, so the user always
 * appears in the right slot relative to these synthetic rivals.
 */
const MOCK_PLAYERS: Array<{ player: string; height: number; settledAtSec: number }> = (() => {
    const now = Math.floor(Date.now() / 1000);
    return [
        { player: '9zQ8mP2VxRyT6wBbF5qLmNzAXcUgHd3kJtR2vY4hWeS6', height: 240, settledAtSec: now - 1 * 3600 },
        { player: '7nP9mK2VxRyQ8wTbF5qLmNzAXcUgHd3kJtR2vY4hWeP1', height: 215, settledAtSec: now - 2 * 3600 },
        { player: 'Lm2wQt8XvBpKf9NsRjGdHzCXcUgHd3kJtR2vY4hWeT2', height: 198, settledAtSec: now - 4 * 3600 },
        { player: 'xJ4P7Lk3VqRm8wBtF5sNgHzCXdUiKe2pAr4vY6hWeU3', height: 180, settledAtSec: now - 6 * 3600 },
        { player: 'A3pQ9mZ2KxRy7wBbF5tLnNcAXdUgHd3kJtR2vY4hWeV4', height: 165, settledAtSec: now - 9 * 3600 },
        { player: 'D6sLm8XvBpKf9NsRjGdHzAXcUgHd3kJtR2vY4hWeW5xQ', height: 142, settledAtSec: now - 12 * 3600 },
        { player: 'F2vRyQ8wTbF5qLmNzAXcUgHd3kJtR2vY4hWeX6mP2VxR', height: 120, settledAtSec: now - 18 * 3600 },
        { player: 'H4wBbF5qLmNzAXcUgHd3kJtR2vY4hWeY7mP2VxRyT6n9', height: 95, settledAtSec: now - 24 * 3600 },
        { player: 'K8jR2vY4hWeZ8mP2VxRyT6wBbF5qLmNzAXcUgHd3kJtA', height: 70, settledAtSec: now - 36 * 3600 },
    ];
})();

export function mockLeaderboard(): LeaderboardEntry[] {
    return MOCK_PLAYERS.map((p, i) => ({
        player: p.player,
        height: p.height,
        settledAt: BigInt(p.settledAtSec),
        rank: i + 1,
    }));
}

function rerankMerged(entries: LeaderboardEntry[]): LeaderboardEntry[] {
    const sorted = entries.slice().sort((a, b) => {
        if (b.height !== a.height) return b.height - a.height;
        // Earlier settle wins ties (lower settledAt = ranked higher).
        const at = a.settledAt < b.settledAt ? -1 : a.settledAt > b.settledAt ? 1 : 0;
        return at;
    });
    return sorted.slice(0, 10).map((e, i) => ({ ...e, rank: i + 1 }));
}

/**
 * Read the mode-specific Leaderboard PDA. Always merges the live PDA rows
 * with `mockLeaderboard()` so the panel is fully populated during UX
 * iteration even when only the signed-in user is on-chain. Real rows take
 * priority; mocks fill the rest of the top-10 by descending height.
 */
export async function fetchLeaderboard(
    rpc: TokenDuelRpc,
    modeU8: number,
): Promise<LeaderboardEntry[]> {
    const pda = AnchorBackend.deriveModeLeaderboardPda(modeU8);
    console.log(`${TAG} fetchLeaderboard | START mode=${modeU8} pda=${pda}`);
    let real: LeaderboardEntry[] = [];
    try {
        const info = await rpc.getAccountInfo(pda);
        if (info?.dataBase64) {
            const raw = b64ToBytes(info.dataBase64);
            real = parseLeaderboardEntries(raw);
        } else {
            console.log(`${TAG} fetchLeaderboard | NULL mode=${modeU8} pda=${pda}`);
        }
    } catch (e) {
        console.log(`${TAG} fetchLeaderboard | ERROR ${e}`);
    }
    // Dedupe by player so a real entry never collides with a mock one.
    const seen = new Set(real.map((e) => e.player));
    const filler = mockLeaderboard().filter((e) => !seen.has(e.player));
    const merged = rerankMerged(real.concat(filler));
    console.log(`${TAG} fetchLeaderboard | DONE mode=${modeU8} real=${real.length} mocks=${merged.length - real.length} total=${merged.length}`);
    return merged;
}
