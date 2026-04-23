/**
 * receipt.test.ts — unit test for ReceiptSigner.
 *
 * Verifies:
 *   1. Produced ix data decodes to a valid Ed25519 precompile layout.
 *   2. The message embedded in the ix matches what the Rust program expects
 *      to see at offsets [0..32], [32..64], [64..68], [68..76].
 *   3. tweetnacl verifies our own signature (sanity round-trip).
 *
 * Run: `npm run test:receipt`
 * Exits 0 on green, 1 on any assertion failure.
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { ReceiptSigner } from './signer';

const TAG = '[receipt.test]';

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error(`${TAG} FAIL: ${msg}`);
        process.exit(1);
    }
}

function main() {
    const signer = new ReceiptSigner();
    const matchPda = Keypair.generate().publicKey;
    const player = Keypair.generate().publicKey;
    const height = 42;
    const signedAt = Math.floor(Date.now() / 1000);

    const { ixDataB64, messageHex } = signer.sign({ matchPda, player, height, signedAt });
    const ixBytes = Buffer.from(ixDataB64, 'base64');

    // Ed25519 header: 16 bytes.
    // Byte 0 = num signatures (1). Byte 1 = padding (0).
    assert(ixBytes[0] === 1, `num_signatures expected 1, got ${ixBytes[0]}`);

    // Extract offsets from header.
    const sigOff = ixBytes.readUInt16LE(2);
    const pkOff = ixBytes.readUInt16LE(6);
    const msgOff = ixBytes.readUInt16LE(10);
    const msgSize = ixBytes.readUInt16LE(12);
    console.log(`${TAG} offsets: sig=${sigOff} pk=${pkOff} msg=${msgOff} msg_size=${msgSize} total_len=${ixBytes.length}`);

    // @solana/web3.js Ed25519Program.createInstructionWithPublicKey lays out
    // header|pubkey|sig|msg — pk at 16, sig at 48, msg at 112, total 188.
    // This matches what our Rust `settle_match_verified` accepts since it
    // reads offsets from the header rather than hard-coding them.
    assert(pkOff === 16, `pk_off expected 16 (web3.js layout), got ${pkOff}`);
    assert(sigOff === 48, `sig_off expected 48 (web3.js layout), got ${sigOff}`);
    assert(msgOff === 112, `msg_off expected 112, got ${msgOff}`);
    assert(msgSize === 76, `msg_size expected 76, got ${msgSize}`);
    assert(ixBytes.length === 188, `total ix data length expected 188, got ${ixBytes.length}`);

    const embeddedPk = ixBytes.subarray(pkOff, pkOff + 32);
    assert(
        Buffer.compare(embeddedPk, signer.pubkey.toBytes()) === 0,
        'embedded pubkey != signer.pubkey',
    );

    const embeddedMsg = ixBytes.subarray(msgOff, msgOff + msgSize);
    assert(embeddedMsg.toString('hex') === messageHex, 'embedded message != signer output');

    // Parse message back out and compare to inputs.
    const parsedMatch = new PublicKey(embeddedMsg.subarray(0, 32));
    const parsedPlayer = new PublicKey(embeddedMsg.subarray(32, 64));
    const parsedHeight = embeddedMsg.readUInt32LE(64);
    const parsedSignedAt = Number(embeddedMsg.readBigInt64LE(68));
    assert(parsedMatch.equals(matchPda), 'match_pda roundtrip');
    assert(parsedPlayer.equals(player), 'player roundtrip');
    assert(parsedHeight === height, 'height roundtrip');
    assert(parsedSignedAt === signedAt, 'signed_at roundtrip');

    // Verify the signature.
    const sig = ixBytes.subarray(sigOff, sigOff + 64);
    const ok = nacl.sign.detached.verify(embeddedMsg, sig, embeddedPk);
    assert(ok, 'nacl.verify(message, sig, pubkey) failed');

    console.log(`${TAG} ALL ASSERTIONS PASSED · match=${matchPda.toBase58()} player=${parsedPlayer.toBase58().slice(0, 8)}... h=${height} sig=${sig.toString('hex').slice(0, 16)}...`);
}

main();
