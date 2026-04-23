/**
 * EventDecoder.ts — Part 9 match-history helper.
 *
 * Anchor emits `#[event]` structs as borsh-serialized bytes behind an
 * 8-byte discriminator (sha256("event:<Name>").slice(0, 8)), printed by
 * `emit!` as `Program data: <base64>` log lines. This module scans a
 * transaction's `meta.logMessages` for those lines and decodes the ones
 * whose discriminator matches a known event schema.
 *
 * Currently handled:
 *   - MatchSettled        (settle_match.rs & force_settle.rs both emit)
 *   - MatchForceSettled   (force_settle.rs only — lets the history view
 *                          tag AFK-reclaim matches)
 *
 * Client-side borsh is hand-rolled so we don't drag in a fat dep. The
 * numeric helpers mirror MatchRpc.ts / UserStatsRpc.ts.
 */

import { sha256 } from '@noble/hashes/sha256';
import { base58Encode } from '../../solana-mwa/scripts/Base58';

const TAG = '[EventDecoder]';

function computeEventDiscriminator(name: string): Uint8Array {
    const input = `event:${name}`;
    const inputBytes = new TextEncoder().encode(input);
    return sha256(inputBytes).subarray(0, 8);
}

/** Lazily-computed 8-byte event discriminators. */
let _discMatchSettled: Uint8Array | null = null;
let _discMatchForceSettled: Uint8Array | null = null;

function matchSettledDisc(): Uint8Array {
    if (!_discMatchSettled) _discMatchSettled = computeEventDiscriminator('MatchSettled');
    return _discMatchSettled;
}
function matchForceSettledDisc(): Uint8Array {
    if (!_discMatchForceSettled) _discMatchForceSettled = computeEventDiscriminator('MatchForceSettled');
    return _discMatchForceSettled;
}

function discriminatorMatches(buf: Uint8Array, expected: Uint8Array): boolean {
    if (buf.length < expected.length) return false;
    for (let i = 0; i < expected.length; i++) if (buf[i] !== expected[i]) return false;
    return true;
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
    throw new Error('No base64 decoder available (neither atob nor Buffer)');
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

export interface MatchSettledEvent {
    kind: 'MatchSettled';
    matchPda: string;
    winner: string;
    winnerSlot: number;
    pot: bigint;
    rake: bigint;
    settledCount: number;
    at: bigint;
}

export interface MatchForceSettledEvent {
    kind: 'MatchForceSettled';
    matchPda: string;
    caller: string;
    forfeits: number;
    pot: bigint;
    rake: bigint;
    at: bigint;
}

export type DecodedMatchEvent = MatchSettledEvent | MatchForceSettledEvent;

/**
 * Scan a transaction log-messages array for MatchSettled / MatchForceSettled
 * `Program data:` lines, decode them, and return the resulting event list.
 * Returns an empty array when no matching events are present.
 */
export function decodeMatchEventLogs(logMessages: string[] | null | undefined): DecodedMatchEvent[] {
    if (!logMessages || logMessages.length === 0) return [];
    const out: DecodedMatchEvent[] = [];
    for (const line of logMessages) {
        if (!line.startsWith('Program data: ')) continue;
        const b64 = line.substring('Program data: '.length).trim();
        if (!b64) continue;
        let buf: Uint8Array;
        try { buf = b64ToBytes(b64); } catch (e) {
            console.log(`${TAG} decodeMatchEventLogs | B64_ERROR err=${e}`);
            continue;
        }
        if (buf.length < 8) continue;

        if (discriminatorMatches(buf, matchSettledDisc())) {
            const ev = decodeMatchSettled(buf);
            if (ev) out.push(ev);
            continue;
        }
        if (discriminatorMatches(buf, matchForceSettledDisc())) {
            const ev = decodeMatchForceSettled(buf);
            if (ev) out.push(ev);
            continue;
        }
    }
    if (out.length > 0) {
        console.log(`${TAG} decodeMatchEventLogs | DONE logs=${logMessages.length} events=${out.length} kinds=[${out.map((e) => e.kind).join(',')}]`);
    }
    return out;
}

/** Payload after the 8-byte discriminator: 32+32+1+8+8+1+8 = 90 bytes. */
function decodeMatchSettled(buf: Uint8Array): MatchSettledEvent | null {
    if (buf.length < 8 + 90) return null;
    let o = 8;
    const matchPda = base58Encode(buf.subarray(o, o + 32)); o += 32;
    const winner = base58Encode(buf.subarray(o, o + 32)); o += 32;
    const winnerSlot = buf[o]; o += 1;
    const pot = readU64LE(buf, o); o += 8;
    const rake = readU64LE(buf, o); o += 8;
    const settledCount = buf[o]; o += 1;
    const at = readI64LE(buf, o); o += 8;
    return { kind: 'MatchSettled', matchPda, winner, winnerSlot, pot, rake, settledCount, at };
}

/** Payload after the 8-byte discriminator: 32+32+1+8+8+8 = 89 bytes. */
function decodeMatchForceSettled(buf: Uint8Array): MatchForceSettledEvent | null {
    if (buf.length < 8 + 89) return null;
    let o = 8;
    const matchPda = base58Encode(buf.subarray(o, o + 32)); o += 32;
    const caller = base58Encode(buf.subarray(o, o + 32)); o += 32;
    const forfeits = buf[o]; o += 1;
    const pot = readU64LE(buf, o); o += 8;
    const rake = readU64LE(buf, o); o += 8;
    const at = readI64LE(buf, o); o += 8;
    return { kind: 'MatchForceSettled', matchPda, caller, forfeits, pot, rake, at };
}
