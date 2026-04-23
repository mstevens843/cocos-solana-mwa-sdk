/**
 * keygen-receipt-signer.ts — Part 10 Bundle 1 helper.
 *
 * Generates an Ed25519 keypair for the Token Duel backend's receipt signer.
 * Outputs the pubkey (to paste into `programs/token-duel/src/state.rs`
 * `RECEIPT_SIGNER_PUBKEY`) and the base58-encoded 64-byte secret (to paste
 * into the backend's `RECEIPT_SIGNER_SECRET` env var).
 *
 * Usage:
 *   cd scripts
 *   npm run keygen-receipt-signer            # random fresh keypair
 *   npm run keygen-receipt-signer -- --seed my-custom-seed
 *                                             # deterministic from a seed phrase
 *
 * SECURITY: Treat the secret like any private key. Never commit it to git
 * or ship it in the Cocos bundle. Production flow:
 *   1. Run this with a random keypair (no --seed).
 *   2. Paste pubkey into `state.rs` + redeploy program.
 *   3. Paste secret into the backend's production env (Railway / Fly).
 *   4. Destroy your local copy of the secret.
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { createHash } from 'crypto';

function parseArgs(): { seed: string | null } {
    const args = process.argv.slice(2);
    let seed: string | null = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--seed' && args[i + 1]) { seed = args[i + 1]; i++; }
    }
    return { seed };
}

function main() {
    const { seed } = parseArgs();

    let kp: Keypair;
    if (seed) {
        const digest = createHash('sha256').update(seed).digest();
        kp = Keypair.fromSeed(digest);
        console.log(`\n[keygen-receipt-signer] deterministic keypair from seed "${seed}"`);
    } else {
        kp = Keypair.generate();
        console.log('\n[keygen-receipt-signer] RANDOM keypair (no seed)');
    }

    const pubkeyBase58 = kp.publicKey.toBase58();
    const encode = (bs58 as any).default?.encode ?? (bs58 as any).encode;
    const secretBase58 = encode(kp.secretKey);

    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────────');
    console.log('  │  Public key (paste into programs/token-duel/src/state.rs)');
    console.log('  │    RECEIPT_SIGNER_PUBKEY:');
    console.log(`  │    ${pubkeyBase58}`);
    console.log('  ├─────────────────────────────────────────────────────────');
    console.log('  │  Secret key (paste into backend env as RECEIPT_SIGNER_SECRET)');
    console.log(`  │    ${secretBase58}`);
    console.log('  └─────────────────────────────────────────────────────────');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Paste the pubkey into `RECEIPT_SIGNER_PUBKEY` in state.rs');
    console.log('  2. `anchor build && anchor deploy --provider.cluster devnet`');
    console.log('  3. Paste the secret into backend .env (`RECEIPT_SIGNER_SECRET`)');
    console.log('  4. Rebuild + redeploy the backend');
    console.log('');
    console.log('⚠  The secret does NOT get committed. Treat it like a wallet key.');
    console.log('');
}

main();
