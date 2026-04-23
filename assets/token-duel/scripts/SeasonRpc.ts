/**
 * SeasonRpc.ts — Part 10 Bundle 3.
 *
 * Read helper for the weekly Season PDA. Settle ixs accrue rake into it and
 * insert winning entries; cron's pay_season pays out 20% to top-3 on Monday.
 *
 * Layout (after 8-byte discriminator):
 *   season_id:              u64    (8)
 *   entries:                [SeasonEntry; 10] — each = 32+2+8 = 42 bytes
 *   total_rake_accumulated: u64    (8)
 *   started_at:             i64    (8)
 *   paid_out:               bool   (1)
 *   bump:                   u8     (1)
 * Total data = 446 bytes, plus 8 discriminator = 454 account size.
 */

import { TokenDuelRpc } from './TokenDuelRpc';
import { PROGRAM_ID, SEEDS } from './constants';
import { base58Encode } from '../../solana-mwa/scripts/Base58';
import { findProgramAddress, u64LeBytes } from './PdaDeriver';

const TAG = '[SeasonRpc]';
const WEEK_SECONDS = 7 * 86_400;
const SEASON_SIZE = 10;

export interface SeasonEntry {
    player: string; // base58
    wins: number;
    at: bigint;
}

export interface SeasonState {
    pda: string;
    seasonId: bigint;
    entries: SeasonEntry[];      // only non-empty entries (wins > 0)
    totalRakeAccumulated: bigint;
    startedAt: bigint;
    paidOut: boolean;
    bump: number;
}

function readU16LE(b: Uint8Array, off: number): number {
    return b[off] | (b[off + 1] << 8);
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
    throw new Error('no base64 decoder');
}

export function currentSeasonId(nowSec?: number): bigint {
    const sec = nowSec ?? Math.floor(Date.now() / 1000);
    return BigInt(Math.floor(sec / WEEK_SECONDS));
}

export function deriveSeasonPda(seasonId: bigint): string {
    const [pda] = findProgramAddress(
        [SEEDS.SEASON, u64LeBytes(seasonId)],
        PROGRAM_ID,
    );
    return pda;
}

export function parseSeason(pdaBase58: string, raw: Uint8Array): SeasonState | null {
    if (raw.length < 8 + 446) {
        console.log(`${TAG} parseSeason | TOO_SHORT bytes=${raw.length}`);
        return null;
    }
    let o = 8;
    const seasonId = readU64LE(raw, o); o += 8;
    const entries: SeasonEntry[] = [];
    for (let i = 0; i < SEASON_SIZE; i++) {
        const player = base58Encode(raw.subarray(o, o + 32)); o += 32;
        const wins = readU16LE(raw, o); o += 2;
        const at = readI64LE(raw, o); o += 8;
        if (wins > 0) entries.push({ player, wins, at });
    }
    const totalRakeAccumulated = readU64LE(raw, o); o += 8;
    const startedAt = readI64LE(raw, o); o += 8;
    const paidOut = raw[o] !== 0; o += 1;
    const bump = raw[o]; o += 1;
    return {
        pda: pdaBase58,
        seasonId,
        entries,
        totalRakeAccumulated,
        startedAt,
        paidOut,
        bump,
    };
}

export async function getCurrentSeason(rpc: TokenDuelRpc): Promise<SeasonState | null> {
    const seasonId = currentSeasonId();
    const pda = deriveSeasonPda(seasonId);
    const info = await rpc.getAccountInfo(pda);
    if (!info || !info.dataBase64) {
        console.log(`${TAG} getCurrentSeason | NOT_INIT season_id=${seasonId} pda=${pda}`);
        return null;
    }
    const raw = b64ToBytes(info.dataBase64);
    const parsed = parseSeason(pda, raw);
    if (!parsed) return null;
    console.log(`${TAG} getCurrentSeason | DONE season_id=${parsed.seasonId} entries=${parsed.entries.length} rake=${parsed.totalRakeAccumulated}`);
    return parsed;
}

/** Resolve a player's rank in the current season, or null if unranked. */
export async function getUserSeasonRank(
    rpc: TokenDuelRpc,
    playerPubkey: string,
): Promise<{ rank: number; wins: number } | null> {
    const s = await getCurrentSeason(rpc);
    if (!s) return null;
    for (let i = 0; i < s.entries.length; i++) {
        if (s.entries[i].player === playerPubkey) {
            return { rank: i + 1, wins: s.entries[i].wins };
        }
    }
    return null;
}

export const SEASON_PRIZE_SHARE_BPS = 2_000;
export const SEASON_PRIZE_BPS = [6_000, 3_000, 1_000];
