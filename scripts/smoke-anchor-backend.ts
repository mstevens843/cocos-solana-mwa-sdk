/**
 * Token Duel — AnchorBackend smoke test (Node only, no Cocos).
 *
 * Verifies that the bytes produced by AnchorBackend.buildCommitTx and
 * AnchorBackend.buildSettleTx are byte-equivalent to the ones that
 * `anchor.Program.methods.*.rpc()` produces, by signing + broadcasting them
 * to devnet and asserting the on-chain outcome matches Phase 4 results.
 *
 * If this passes, Phase 6 (wiring into AppUI + MWA) is a safe plug-in.
 *
 * Run:
 *   cd scripts
 *   npm run smoke-backend
 */

import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';

import { AnchorBackend } from '../assets/token-duel/scripts/AnchorBackend';
import { POOL_PDA, PROGRAM_ID, RPC_URL } from '../assets/token-duel/scripts/constants';

// AnchorBackend now returns base58 strings (Cocos-runtime swap — dropped
// @solana/web3.js for the bundle-size concern). Wrap when the smoke test
// needs a web3.js PublicKey for RPC/balance calls.
const POOL_PDA_PK = new PublicKey(POOL_PDA);
const PROGRAM_ID_PK = new PublicKey(PROGRAM_ID);

function explorer(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function main() {
    // Admin keypair acts as the "player" for this Node-only test (no MWA handshake).
    const adminPath = path.join(homedir(), '.config/solana/id.json');
    const adminBytes = JSON.parse(fs.readFileSync(adminPath, 'utf8'));
    const admin = Keypair.fromSecretKey(Uint8Array.from(adminBytes));
    const connection = new Connection(RPC_URL, 'confirmed');

    console.log('Program ID:', PROGRAM_ID);
    console.log('Pool PDA:  ', POOL_PDA);
    console.log('Admin:     ', admin.publicKey.toBase58());
    console.log('');

    // Fresh player keypair, funded from admin (devnet airdrop is rate-limited).
    const player = Keypair.generate();
    console.log('Player:    ', player.publicKey.toBase58());

    console.log('Funding player (admin → player, 0.2 SOL)…');
    const fundTx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: player.publicKey,
            lamports: Math.floor(0.2 * LAMPORTS_PER_SOL),
        })
    );
    await sendAndConfirmTransaction(connection, fundTx, [admin], {
        commitment: 'confirmed',
    });

    // === Commit via AnchorBackend ===
    const stake = 10_000_000n; // 0.01 SOL
    const sessionSeed = BigInt(Date.now() % 1_000_000);

    const { blockhash: bh1 } = await connection.getLatestBlockhash('confirmed');
    const commitBytes = AnchorBackend.buildCommitTx(
        player.publicKey.toBase58(),
        stake,
        sessionSeed,
        bh1
    );

    console.log('\n--- AnchorBackend.buildCommitTx ---');
    console.log('bytes length:', commitBytes.length);

    // Re-hydrate, sign with player, broadcast.
    const commitTx = Transaction.from(commitBytes);
    commitTx.sign(player);
    const commitSig = await connection.sendRawTransaction(commitTx.serialize(), {
        skipPreflight: false,
    });
    await connection.confirmTransaction(commitSig, 'confirmed');
    console.log('commit sig:', commitSig);
    console.log('explorer:  ', explorer(commitSig));

    const { session, escrow } = AnchorBackend.derivePdas(player.publicKey.toBase58(), sessionSeed);
    console.log('session PDA:', session);
    console.log('escrow PDA: ', escrow);
    const escrowBalance = await connection.getBalance(new PublicKey(escrow));
    console.log('escrow balance:', escrowBalance / LAMPORTS_PER_SOL, 'SOL (expected 0.01)');
    if (escrowBalance !== Number(stake)) {
        console.error('FAIL: escrow balance mismatch');
        process.exit(1);
    }

    // === Settle via AnchorBackend (tier 1 → half refund) ===
    const beforePool = await connection.getBalance(POOL_PDA_PK);

    const { blockhash: bh2 } = await connection.getLatestBlockhash('confirmed');
    const settleBytes = AnchorBackend.buildSettleTx(
        player.publicKey.toBase58(),
        sessionSeed,
        15,
        bh2
    );

    console.log('\n--- AnchorBackend.buildSettleTx ---');
    console.log('bytes length:', settleBytes.length);

    const settleTx = Transaction.from(settleBytes);
    settleTx.sign(player);
    const settleSig = await connection.sendRawTransaction(settleTx.serialize(), {
        skipPreflight: false,
    });
    await connection.confirmTransaction(settleSig, 'confirmed');
    console.log('settle sig:', settleSig);
    console.log('explorer:  ', explorer(settleSig));

    const afterPool = await connection.getBalance(POOL_PDA_PK);
    const escrowAfter = await connection.getBalance(new PublicKey(escrow));
    const poolDelta = afterPool - beforePool;

    console.log('\n--- Results ---');
    console.log('pool delta:   ', poolDelta, 'lamports (expected +5_000_000)');
    console.log('escrow after: ', escrowAfter, 'lamports (expected 0)');

    if (poolDelta === 5_000_000 && escrowAfter === 0) {
        console.log('\n✅ SUCCESS — AnchorBackend byte output produces correct on-chain state.');
        console.log('    Phase 6 wiring into AppUI is safe.');
    } else {
        console.error('\n❌ FAIL — on-chain state did not match expected tier-1 outcome.');
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
