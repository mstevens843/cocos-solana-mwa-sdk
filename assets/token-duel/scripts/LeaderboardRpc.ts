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
 * Read the mode-specific Leaderboard PDA. Returns an empty array if
 * uninitialized (admin hasn't run init-leaderboards yet) or if every slot is
 * empty.
 */
export async function fetchLeaderboard(
    rpc: TokenDuelRpc,
    modeU8: number,
): Promise<LeaderboardEntry[]> {
    const pda = AnchorBackend.deriveModeLeaderboardPda(modeU8);
    console.log(`${TAG} fetchLeaderboard | START mode=${modeU8} pda=${pda}`);
    const info = await rpc.getAccountInfo(pda);
    if (!info || !info.dataBase64) {
        console.log(`${TAG} fetchLeaderboard | NULL mode=${modeU8} pda=${pda}`);
        return [];
    }
    const raw = b64ToBytes(info.dataBase64);
    const entries = parseLeaderboardEntries(raw);
    console.log(`${TAG} fetchLeaderboard | DONE mode=${modeU8} rows=${entries.length}`);
    return entries;
}
