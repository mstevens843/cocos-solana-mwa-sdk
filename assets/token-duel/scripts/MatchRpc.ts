/**
 * MatchRpc.ts — read + derive helpers for the Match PDA system.
 *
 * Keep this thin: tx composition lives in AnchorBackend; the Matchmaker
 * orchestrates discovery + poll loops using these primitives.
 *
 * Wire shape matches the Rust `MatchAccount` struct in state.rs — if the
 * struct reorders fields, update `parseMatchAccount` in lockstep.
 */

import { TokenDuelRpc } from './TokenDuelRpc';
import { PROGRAM_ID, RPC_URL, SEEDS } from './constants';
import { AnchorBackend } from './AnchorBackend';
import { base58Encode } from '../../solana-mwa/scripts/Base58';

const TAG = '[MatchRpc]';
const MATCH_DISCRIMINATOR_HEX = ''; // populated lazily at first use via AnchorBackend.discriminator('Match')

export interface MatchState {
    pda: string;
    mode: number;
    wagerTier: number;
    wagerLamports: bigint;
    xpBucket: number;
    requiredPlayers: number;
    playerCount: number;
    players: string[]; // base58; empty = Pubkey::default()
    heights: number[]; // u32::MAX = not-yet-settled
    settledCount: number;
    createdAt: bigint;
    startedAt: bigint;
    closedAt: bigint;
    status: number; // 0=Waiting 1=Active 2=Settled 3=Cancelled
    seq: bigint;
    bump: number;
    escrowBump: number;
    /** Part 9: 0=1h, 1=24h, 2=3d, 3=7d. */
    timeWindow: number;
}

export interface CounterState {
    seq: bigint;
    bump: number;
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
    // Node fallback via Buffer (scripts/ use this).
    const B: any = (globalThis as any).Buffer;
    if (B) return new Uint8Array(B.from(b64, 'base64'));
    throw new Error('No base64 decoder available (neither atob nor Buffer)');
}

/**
 * Parse a Match account's raw bytes (includes Anchor's 8-byte discriminator).
 * Part 9 layout (after discriminator):
 *   mode u8, wager_tier u8, wager_lamports u64, xp_bucket u16,
 *   required_players u8, player_count u8, players [Pubkey; 10],
 *   heights [u32; 10], settled_count u8, created_at i64, started_at i64,
 *   closed_at i64, status u8, seq u64, bump u8, escrow_bump u8,
 *   time_window u8
 * Total: 8 + 411 = 419 bytes. `time_window` sits at byte offset 418 and
 * is the memcmp target for per-window match discovery.
 */
const MATCH_MAX_PLAYERS = 10;
export const MATCH_TIME_WINDOW_OFFSET = 418;

export function parseMatchAccount(pdaBase58: string, raw: Uint8Array): MatchState | null {
    if (raw.length < 8 + 411) {
        console.log(`${TAG} parseMatchAccount | TOO_SHORT bytes=${raw.length} pda=${pdaBase58}`);
        return null;
    }
    let o = 8; // skip Anchor discriminator
    const mode = raw[o]; o += 1;
    const wagerTier = raw[o]; o += 1;
    const wagerLamports = readU64LE(raw, o); o += 8;
    const xpBucket = readU16LE(raw, o); o += 2;
    const requiredPlayers = raw[o]; o += 1;
    const playerCount = raw[o]; o += 1;
    const players: string[] = [];
    for (let i = 0; i < MATCH_MAX_PLAYERS; i++) {
        const sub = raw.subarray(o, o + 32);
        players.push(base58Encode(sub));
        o += 32;
    }
    const heights: number[] = [];
    for (let i = 0; i < MATCH_MAX_PLAYERS; i++) { heights.push(readU32LE(raw, o)); o += 4; }
    const settledCount = raw[o]; o += 1;
    const createdAt = readI64LE(raw, o); o += 8;
    const startedAt = readI64LE(raw, o); o += 8;
    const closedAt = readI64LE(raw, o); o += 8;
    const status = raw[o]; o += 1;
    const seq = readU64LE(raw, o); o += 8;
    const bump = raw[o]; o += 1;
    const escrowBump = raw[o]; o += 1;
    const timeWindow = raw[o]; o += 1;

    return { pda: pdaBase58, mode, wagerTier, wagerLamports, xpBucket, requiredPlayers, playerCount, players, heights, settledCount, createdAt, startedAt, closedAt, status, seq, bump, escrowBump, timeWindow };
}

/**
 * Parse the MatchCounter account (8-byte disc + u64 seq + u8 bump).
 */
export function parseCounterAccount(raw: Uint8Array): CounterState | null {
    if (raw.length < 8 + 9) {
        console.log(`${TAG} parseCounterAccount | TOO_SHORT bytes=${raw.length}`);
        return null;
    }
    const seq = readU64LE(raw, 8);
    const bump = raw[16];
    return { seq, bump };
}

/**
 * Read the MatchCounter PDA. Returns null if uninitialized.
 */
export async function getMatchCounter(rpc: TokenDuelRpc): Promise<CounterState | null> {
    const pda = AnchorBackend.deriveMatchCounterPda();
    const info = await rpc.getAccountInfo(pda);
    if (!info || !info.dataBase64) {
        console.log(`${TAG} getMatchCounter | NULL pda=${pda}`);
        return null;
    }
    const raw = b64ToBytes(info.dataBase64);
    const parsed = parseCounterAccount(raw);
    console.log(`${TAG} getMatchCounter | DONE pda=${pda} seq=${parsed?.seq ?? '?'} bump=${parsed?.bump ?? '?'}`);
    return parsed;
}

/**
 * Read a specific Match PDA. Returns null if the account doesn't exist yet.
 */
export async function getMatch(rpc: TokenDuelRpc, pda: string): Promise<MatchState | null> {
    const info = await rpc.getAccountInfo(pda);
    if (!info || !info.dataBase64) {
        console.log(`${TAG} getMatch | NULL pda=${pda}`);
        return null;
    }
    const raw = b64ToBytes(info.dataBase64);
    const parsed = parseMatchAccount(pda, raw);
    console.log(`${TAG} getMatch | DONE pda=${pda} status=${parsed?.status} player_count=${parsed?.playerCount}/${parsed?.requiredPlayers}`);
    return parsed;
}

/**
 * Discover open matches in (mode, wagerTier, xp_bucket ± drift).
 *
 * Filter strategy: two memcmp filters are safe + cheap.
 *   - offset 8+0  (mode)         matches `mode`
 *   - offset 8+1  (wager_tier)   matches `wagerTier`
 * We can't memcmp `status=Waiting` easily (byte offset within the struct
 * varies with alignment), so we post-filter client-side.
 *
 * XP-bucket filtering also done client-side (drift ±3) since on-chain
 * ordering isn't guaranteed.
 */
export async function findOpenMatches(
    rpc: TokenDuelRpc,
    mode: number,
    wagerTier: number,
    xpBucket: number,
    timeWindow: number,
    bucketDrift: number = 3,
): Promise<MatchState[]> {
    console.log(`${TAG} findOpenMatches | START mode=${mode} tier=${wagerTier} xp_bucket=${xpBucket} window=${timeWindow} drift=±${bucketDrift}`);
    const modeByte = base58Encode(new Uint8Array([mode & 0xff]));
    const tierByte = base58Encode(new Uint8Array([wagerTier & 0xff]));
    const windowByte = base58Encode(new Uint8Array([timeWindow & 0xff]));
    const raw = await rpc.getProgramAccounts(PROGRAM_ID, [
        { memcmp: { offset: 8, bytes: modeByte } },
        { memcmp: { offset: 9, bytes: tierByte } },
        { memcmp: { offset: MATCH_TIME_WINDOW_OFFSET, bytes: windowByte } },
    ]);
    const parsed = raw
        .map((r) => parseMatchAccount(r.pubkey, b64ToBytes(r.dataBase64)))
        .filter((m): m is MatchState => m !== null)
        .filter((m) => m.status === 0 && m.playerCount < m.requiredPlayers)
        .filter((m) => Math.abs(m.xpBucket - xpBucket) <= bucketDrift);
    console.log(`${TAG} findOpenMatches | DONE scanned=${raw.length} open=${parsed.length}`);
    return parsed;
}

export { RPC_URL, PROGRAM_ID, SEEDS };
