/**
 * Ed25519 receipt signer.
 *
 * Loads the server's secret key from either:
 *   1. `RECEIPT_SIGNER_SECRET` env var (base58-encoded 64-byte secret) - prod path.
 *   2. Deterministic derivation from `token-duel-receipt-signer-devnet-v1`
 *      seed - dev fallback that matches the `RECEIPT_SIGNER_PUBKEY` hard-coded
 *      into programs/token-duel/src/state.rs. Signals loudly on startup.
 *
 * Produces a signed `ed25519_instruction.data` blob in the exact layout
 * expected by Solana's Ed25519 precompile, ready for the client to include
 * as ix[0] of a transaction that calls `settle_match_verified`.
 */

import { Ed25519Program, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { createHash } from 'crypto';
import nacl from 'tweetnacl';

const TAG = '[signer]';

const DEV_SEED_PHRASE = 'token-duel-receipt-signer-devnet-v1';

function loadKeypairFromEnv(): Keypair {
    const envSecret = process.env.RECEIPT_SIGNER_SECRET?.trim();
    if (envSecret && envSecret.length > 0) {
        const bytes = (bs58 as any).default?.decode?.(envSecret) ?? (bs58 as any).decode(envSecret);
        if (bytes.length !== 64) {
            throw new Error(
                `${TAG} RECEIPT_SIGNER_SECRET must be 64 bytes base58 (got ${bytes.length})`,
            );
        }
        const kp = Keypair.fromSecretKey(bytes);
        console.log(`${TAG} loaded PROD keypair from env · pubkey=${kp.publicKey.toBase58()}`);
        return kp;
    }
    const seed = createHash('sha256').update(DEV_SEED_PHRASE).digest();
    const kp = Keypair.fromSeed(seed);
    console.warn(
        `${TAG} ⚠ RECEIPT_SIGNER_SECRET not set - using deterministic DEV keypair. DO NOT RUN IN PRODUCTION.`,
    );
    console.warn(`${TAG} DEV pubkey=${kp.publicKey.toBase58()} (must match RECEIPT_SIGNER_PUBKEY in state.rs)`);
    return kp;
}

export class ReceiptSigner {
    readonly keypair: Keypair;
    readonly pubkey: PublicKey;

    constructor() {
        this.keypair = loadKeypairFromEnv();
        this.pubkey = this.keypair.publicKey;
    }

    /**
     * Build the 76-byte receipt payload and sign it, returning the
     * fully-formed Ed25519 precompile instruction data (a base64 string).
     * The client pastes this straight into ix[0] of the settle transaction.
     *
     * Layout of signed message (mirrors programs/.../settle_match_verified.rs):
     *   [0..32]   match_pda   (Pubkey bytes)
     *   [32..64]  player      (Pubkey bytes)
     *   [64..68]  height      (u32 LE)
     *   [68..76]  signed_at   (i64 LE)
     */
    sign(opts: {
        matchPda: PublicKey;
        player: PublicKey;
        height: number;
        signedAt: number; // unix seconds (i64) - matches Clock::unix_timestamp on-chain
    }): { ixDataB64: string; messageHex: string } {
        const message = Buffer.alloc(76);
        opts.matchPda.toBuffer().copy(message, 0);
        opts.player.toBuffer().copy(message, 32);
        message.writeUInt32LE(opts.height >>> 0, 64);
        // Write i64 LE by storing as BigInt.
        message.writeBigInt64LE(BigInt(opts.signedAt), 68);

        // Sign raw bytes. tweetnacl.sign.detached returns 64-byte sig.
        const signature = nacl.sign.detached(message, this.keypair.secretKey);

        // Compose the Ed25519 precompile ix data via @solana/web3.js helper
        // so we don't hand-roll the 16-byte offsets header.
        const ix = Ed25519Program.createInstructionWithPublicKey({
            publicKey: this.pubkey.toBytes(),
            message,
            signature,
        });
        const ixDataB64 = Buffer.from(ix.data).toString('base64');
        return { ixDataB64, messageHex: message.toString('hex') };
    }

    /** Derive the same ix-data the client would emit, without signing. Used in tests. */
    static expectedMessage(matchPda: PublicKey, player: PublicKey, height: number, signedAt: number): Buffer {
        const m = Buffer.alloc(76);
        matchPda.toBuffer().copy(m, 0);
        player.toBuffer().copy(m, 32);
        m.writeUInt32LE(height >>> 0, 64);
        m.writeBigInt64LE(BigInt(signedAt), 68);
        return m;
    }
}
