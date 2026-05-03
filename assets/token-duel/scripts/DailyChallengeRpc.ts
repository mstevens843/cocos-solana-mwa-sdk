/**
 * DailyChallengeRpc.ts - Part 10 Bundle 3.
 *
 * Read helper for the per-UTC-day DailyChallenge PDA. The cron initializes
 * one of these every 00:00 UTC; settle ixs require!() day_id matches today.
 *
 * Layout (after 8-byte discriminator):
 *   day_id:      u64     (8)
 *   challenges:  [Challenge; 3] - each = u8 kind + u32 target + u16 reward_xp = 7 bytes
 *   created_at:  i64     (8)
 *   bump:        u8      (1)
 * Total data = 38 bytes, plus 8 discriminator = 46 bytes account size.
 */

import { TokenDuelRpc } from './TokenDuelRpc';
import { PROGRAM_ID, SEEDS } from './constants';
import { findProgramAddress, u64LeBytes } from './PdaDeriver';

const TAG = '[DailyChallengeRpc]';

export interface ChallengeDef {
    kind: number;      // 0=WinNMatches, 1=WinOnTimeWindow, 2=WinOnMode, 3=FirstPlaceInPot
    target: number;    // u32
    rewardXp: number;  // u16
}

export interface DailyChallengeState {
    pda: string;
    dayId: bigint;
    challenges: [ChallengeDef, ChallengeDef, ChallengeDef];
    createdAt: bigint;
    bump: number;
}

const DAY_SECONDS = 86_400;

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
    throw new Error('no base64 decoder');
}

/** Compute the current UTC-day id the way the program does. */
export function currentDayId(nowSec?: number): bigint {
    const sec = nowSec ?? Math.floor(Date.now() / 1000);
    return BigInt(Math.floor(sec / DAY_SECONDS));
}

/** Derive the DailyChallenge PDA for a given day_id. */
export function deriveDailyChallengePda(dayId: bigint): string {
    const [pda] = findProgramAddress(
        [SEEDS.DAILY_CHALLENGE, u64LeBytes(dayId)],
        PROGRAM_ID,
    );
    return pda;
}

export function parseDailyChallenge(pdaBase58: string, raw: Uint8Array): DailyChallengeState | null {
    if (raw.length < 8 + 38) {
        console.log(`${TAG} parseDailyChallenge | TOO_SHORT bytes=${raw.length}`);
        return null;
    }
    let o = 8;
    const dayId = readU64LE(raw, o); o += 8;
    const challenges: ChallengeDef[] = [];
    for (let i = 0; i < 3; i++) {
        const kind = raw[o]; o += 1;
        const target = readU32LE(raw, o); o += 4;
        const rewardXp = readU16LE(raw, o); o += 2;
        challenges.push({ kind, target, rewardXp });
    }
    const createdAt = readI64LE(raw, o); o += 8;
    const bump = raw[o]; o += 1;
    return {
        pda: pdaBase58,
        dayId,
        challenges: challenges as [ChallengeDef, ChallengeDef, ChallengeDef],
        createdAt,
        bump,
    };
}

export async function getCurrentDailyChallenge(rpc: TokenDuelRpc): Promise<DailyChallengeState | null> {
    const dayId = currentDayId();
    const pda = deriveDailyChallengePda(dayId);
    const info = await rpc.getAccountInfo(pda);
    if (!info || !info.dataBase64) {
        console.log(`${TAG} getCurrentDailyChallenge | NOT_INIT day_id=${dayId} pda=${pda} - cron hasn't run?`);
        return null;
    }
    const raw = b64ToBytes(info.dataBase64);
    const parsed = parseDailyChallenge(pda, raw);
    if (!parsed) return null;
    console.log(`${TAG} getCurrentDailyChallenge | DONE day_id=${parsed.dayId} challenges=${JSON.stringify(parsed.challenges)}`);
    return parsed;
}

/** Render a challenge spec into a human description ("Win a 4p Pot match", etc). */
export function describeChallenge(c: ChallengeDef): string {
    const winLbl = (mode: number) => ['1v1 Duel', '4p Pot', '8p Pot', 'Battle Royale'][mode] ?? `mode${mode}`;
    const windowLbl = (w: number) => ['1h', '24h', '3d', '7d'][w] ?? `w${w}`;
    switch (c.kind) {
        case 0: return `Win ${c.target} match${c.target === 1 ? '' : 'es'}`;
        case 1: return `Win a match on ${windowLbl(c.target)}`;
        case 2: return `Win a ${winLbl(c.target)}`;
        case 3: return `1st place in a ${c.target}+ player pot`;
        default: return `Unknown challenge (kind ${c.kind})`;
    }
}

/** Count bits set in the bitmask (0..3). */
export function countCompleted(bitmask: number): number {
    return ((bitmask & 1) | 0) + ((bitmask >> 1) & 1) + ((bitmask >> 2) & 1);
}
