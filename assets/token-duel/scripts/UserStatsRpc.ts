/**
 * UserStatsRpc.ts — read helper + PDA derivation for on-chain per-player
 * UserStats PDA introduced in Session D.
 *
 * PDA seed: [b"userstats", player_pubkey].
 * Used by Portfolio Real-tab + the match settlement flow (Part 3).
 *
 * Layout (after 8-byte discriminator): UserStats struct in state.rs.
 *   player:        Pubkey (32)
 *   games_played:  u32    (4)
 *   wins:          u32    (4)
 *   losses:        u32    (4)
 *   profit_lamports: i64  (8)
 *   xp:            u64    (8)
 *   level:         u16    (2)
 *   last_played_at: i64   (8)
 *   bot_games_remaining: u8 (1)
 *   bump:          u8     (1)
 */

import { TokenDuelRpc } from './TokenDuelRpc';
import { AnchorBackend } from './AnchorBackend';
import { base58Encode } from '../../solana-mwa/scripts/Base58';

const TAG = '[UserStatsRpc]';

export interface UserStatsState {
    pda: string;
    player: string;
    gamesPlayed: number;
    wins: number;
    losses: number;
    profitLamports: bigint;
    xp: bigint;
    level: number;
    lastPlayedAt: bigint;
    botGamesRemaining: number;
    bump: number;
    // Part 10 Bundle 3 — v2 retention fields. 0-valued on pre-migration accounts.
    currentStreak: number;
    bestStreak: number;
    lastDailyClaimAt: bigint;
    dailyChallengesBitmask: number;
    seasonWins: number;
    seasonId: bigint;
    /** True when the account is 112 bytes (v2); false if still 72 bytes (v1 pre-migration). */
    isV2: boolean;
}

function readU16LE(b: Uint8Array, off: number): number {
    return b[off] | (b[off + 1] << 8);
}
function readU32LE(b: Uint8Array, off: number): number {
    return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}
function readU64LE(b: Uint8Array, off: number): bigint {
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[off + i]);
    return v;
}
function readI64LE(b: Uint8Array, off: number): bigint {
    let v = readU64LE(b, off);
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

export function parseUserStats(pdaBase58: string, raw: Uint8Array): UserStatsState | null {
    if (raw.length < 8 + 72) {
        console.log(`${TAG} parseUserStats | TOO_SHORT bytes=${raw.length} pda=${pdaBase58}`);
        return null;
    }
    let o = 8;
    const player = base58Encode(raw.subarray(o, o + 32)); o += 32;
    const gamesPlayed = readU32LE(raw, o); o += 4;
    const wins = readU32LE(raw, o); o += 4;
    const losses = readU32LE(raw, o); o += 4;
    const profitLamports = readI64LE(raw, o); o += 8;
    const xp = readU64LE(raw, o); o += 8;
    const level = readU16LE(raw, o); o += 2;
    const lastPlayedAt = readI64LE(raw, o); o += 8;
    const botGamesRemaining = raw[o]; o += 1;
    const bump = raw[o]; o += 1;

    // Part 10 Bundle 3: v2 fields at offsets 72+. Guard so pre-migration
    // accounts (72 bytes of data) still parse — they just report zeros.
    const isV2 = raw.length >= 8 + 112;
    let currentStreak = 0;
    let bestStreak = 0;
    let lastDailyClaimAt = 0n;
    let dailyChallengesBitmask = 0;
    let seasonWins = 0;
    let seasonId = 0n;
    if (isV2) {
        currentStreak = readU16LE(raw, o); o += 2;
        bestStreak = readU16LE(raw, o); o += 2;
        lastDailyClaimAt = readI64LE(raw, o); o += 8;
        dailyChallengesBitmask = readU32LE(raw, o); o += 4;
        seasonWins = readU16LE(raw, o); o += 2;
        seasonId = readU64LE(raw, o); o += 8;
        // _reserved [14] — skipped
    }

    return {
        pda: pdaBase58, player,
        gamesPlayed, wins, losses, profitLamports,
        xp, level, lastPlayedAt, botGamesRemaining, bump,
        currentStreak, bestStreak, lastDailyClaimAt,
        dailyChallengesBitmask, seasonWins, seasonId, isV2,
    };
}

/**
 * Read a player's UserStats PDA. Returns null if not initialized.
 * Caller should `initialize_user_stats` before the first real-mode match.
 */
export async function getUserStats(rpc: TokenDuelRpc, playerBase58: string): Promise<UserStatsState | null> {
    const pda = AnchorBackend.deriveUserStatsPda(playerBase58);
    const info = await rpc.getAccountInfo(pda);
    if (!info || !info.dataBase64) {
        console.log(`${TAG} getUserStats | NOT_INITIALIZED pda=${pda} player=${playerBase58}`);
        return null;
    }
    const raw = b64ToBytes(info.dataBase64);
    const parsed = parseUserStats(pda, raw);
    if (!parsed) return null;
    console.log(`${TAG} getUserStats | DONE player=${playerBase58} games=${parsed.gamesPlayed} wins=${parsed.wins} losses=${parsed.losses} xp=${parsed.xp} level=${parsed.level} bot_games_remaining=${parsed.botGamesRemaining}`);
    return parsed;
}

/** Compute XP bucket (for matchmaker) from raw XP. Matches Rust `floor(xp / 100)`. */
export function xpBucketFor(xp: bigint | number): number {
    const n = typeof xp === 'bigint' ? Number(xp) : xp;
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n / 100);
}

/**
 * Check whether a player's UserStats PDA exists. Returns `'exists' | 'missing'`.
 * Callers use the result to decide whether to submit `initialize_user_stats`
 * before a real-mode match.
 */
export async function checkUserStatsExists(rpc: TokenDuelRpc, playerBase58: string): Promise<'exists' | 'missing'> {
    const existing = await getUserStats(rpc, playerBase58);
    return existing ? 'exists' : 'missing';
}
