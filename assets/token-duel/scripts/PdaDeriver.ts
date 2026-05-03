/**
 * PdaDeriver.ts - Solana `findProgramAddress` without @solana/web3.js.
 *
 * Replaces `PublicKey.findProgramAddressSync` from web3.js, which we dropped
 * from the Cocos runtime because web3.js transitively pulls in `tr46` + a
 * 1.2MB Unicode mapping table that Cocos's Rollup bundler can't resolve.
 *
 * Deps:
 *   - js-sha256 for the sha256 hash (same as web3.js uses).
 *   - @noble/curves/ed25519 for the "is point on curve" check - returns a
 *     thrown exception if `Point.fromHex(bytes)` can't decompress to a valid
 *     ed25519 point. Off-curve = PDA-eligible.
 *
 * Output is byte-equivalent to web3.js's `findProgramAddressSync`, verified
 * via `scripts/smoke-anchor-backend.ts` (which uses web3.js) + on-chain
 * behavior matching.
 */

import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';

import { base58Decode, base58Encode } from '../../solana-mwa/scripts/Base58';

const TAG = '[PdaDeriver]';

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

/** @returns true if `bytes32` decompresses to a valid ed25519 point (i.e. NOT a PDA). */
function isOnCurve(bytes32: Uint8Array): boolean {
    try {
        // ed25519.ExtendedPoint.fromHex throws on invalid/off-curve encodings.
        ed25519.ExtendedPoint.fromHex(bytes32);
        return true;
    } catch {
        return false;
    }
}

function concat(...arrays: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const a of arrays) total += a.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
        out.set(a, offset);
        offset += a.length;
    }
    return out;
}

/**
 * Find a PDA: iterate bump 255→0, for each compute
 *   sha256(seed_0 || ... || seed_N || [bump] || programId || "ProgramDerivedAddress")
 * Return the first result that is OFF the ed25519 curve (i.e. a valid PDA).
 *
 * @param seeds Raw seed bytes (each ≤ 32 bytes per Solana spec).
 * @param programIdBase58 Program ID in base58.
 * @returns Tuple `[pdaBase58, bump]`.
 * @throws If no valid bump is found (effectively never; probability ~1/256^255).
 */
export function findProgramAddress(
    seeds: Uint8Array[],
    programIdBase58: string,
): [string, number] {
    const programId = base58Decode(programIdBase58);
    if (programId.length !== 32) {
        throw new Error(`PdaDeriver: invalid programId length=${programId.length} (expected 32)`);
    }

    for (let bump = 255; bump >= 0; bump--) {
        const preimage = concat(...seeds, new Uint8Array([bump]), programId, PDA_MARKER);
        // @noble/hashes/sha256 returns Uint8Array directly - no hex parsing needed.
        const hashBytes = sha256(preimage);
        if (!isOnCurve(hashBytes)) {
            const pda = base58Encode(hashBytes);
            console.log(`${TAG} findProgramAddress | DONE seeds=${seeds.length} programId=${programIdBase58.substring(0, 8)}... bump=${bump} pda=${pda}`);
            return [pda, bump];
        }
    }
    throw new Error(`PdaDeriver: no valid PDA bump found for seeds + programId=${programIdBase58}`);
}

/** Utility: encode a JS bigint as 8 little-endian bytes (u64 LE). */
export function u64LeBytes(value: bigint): Uint8Array {
    const out = new Uint8Array(8);
    const dv = new DataView(out.buffer);
    dv.setBigUint64(0, value, true); // true = little-endian
    return out;
}
