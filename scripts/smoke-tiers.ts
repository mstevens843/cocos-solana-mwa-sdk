/**
 * Token Duel — all-tiers smoke test.
 *
 * Runs one full commit + settle roundtrip for each tier (0, 1, 2, 3) and
 * asserts the on-chain balance deltas match the tier formula. This catches
 * bugs in the tier-3 `pool → player` CPI path specifically, which uses a
 * DIFFERENT PDA signer (pool seeds) than the escrow-leg CPIs.
 *
 * Tier table (matches `programs/token-duel/src/instructions/settle.rs`):
 *   height ≤ 10 → Forfeit: stake → pool,                player +0
 *   height ≤ 20 → Half:    stake/2 → player, stake/2 → pool
 *   height ≤ 35 → Full:    stake → player,              pool unchanged
 *   height > 35 → Double:  stake + stake → player,      pool −stake
 *
 * Run:
 *   cd scripts
 *   npm run smoke-tiers
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
import { POOL_PDA, RPC_URL } from '../assets/token-duel/scripts/constants';

const STAKE = 10_000_000; // 0.01 SOL

interface TierSpec {
    name: string;
    height: number;
    expectedPoolDelta: number; // absolute signed lamports
    expectedEscrowFinal: number; // always 0 — escrow drains every time
}

const TIERS: TierSpec[] = [
    { name: 'Tier 0 (Forfeit)', height: 5, expectedPoolDelta: +STAKE, expectedEscrowFinal: 0 },
    { name: 'Tier 1 (Half)', height: 15, expectedPoolDelta: +STAKE / 2, expectedEscrowFinal: 0 },
    { name: 'Tier 2 (Full)', height: 25, expectedPoolDelta: 0, expectedEscrowFinal: 0 },
    { name: 'Tier 3 (Double)', height: 40, expectedPoolDelta: -STAKE, expectedEscrowFinal: 0 },
];

function explorer(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function loadAdmin(): Promise<Keypair> {
    const adminPath = path.join(homedir(), '.config/solana/id.json');
    const bytes = JSON.parse(fs.readFileSync(adminPath, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function fundPlayer(
    connection: Connection,
    admin: Keypair,
    player: PublicKey,
    lamports: number
): Promise<void> {
    const tx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: player,
            lamports,
        })
    );
    await sendAndConfirmTransaction(connection, tx, [admin], { commitment: 'confirmed' });
}

async function runTier(
    connection: Connection,
    admin: Keypair,
    tier: TierSpec
): Promise<boolean> {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ${tier.name} — height=${tier.height}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Fresh player per tier so funding state is isolated.
    const player = Keypair.generate();
    await fundPlayer(connection, admin, player.publicKey, 0.15 * LAMPORTS_PER_SOL);

    const sessionSeed = BigInt(Date.now() % 1_000_000) + BigInt(Math.floor(Math.random() * 1_000_000));

    // Pre-check: pool must have enough for a tier-3 bonus.
    if (tier.expectedPoolDelta < 0) {
        const poolBal = await connection.getBalance(new PublicKey(POOL_PDA));
        if (poolBal < -tier.expectedPoolDelta) {
            console.log(`  SKIP: pool has ${poolBal} lamports, need ${-tier.expectedPoolDelta} for tier-3`);
            return false;
        }
    }

    // === Commit ===
    const { blockhash: bh1 } = await connection.getLatestBlockhash('confirmed');
    const commitBytes = AnchorBackend.buildCommitTx(
        player.publicKey.toBase58(),
        BigInt(STAKE),
        sessionSeed,
        bh1
    );
    const commitTx = Transaction.from(commitBytes);
    commitTx.sign(player);
    const commitSig = await connection.sendRawTransaction(commitTx.serialize());
    await connection.confirmTransaction(commitSig, 'confirmed');
    console.log(`  commit: ${explorer(commitSig)}`);

    const { session, escrow } = AnchorBackend.derivePdas(player.publicKey.toBase58(), sessionSeed);
    const escrowPk = new PublicKey(escrow);
    const sessionPk = new PublicKey(session);
    const escrowAfterCommit = await connection.getBalance(escrowPk);
    if (escrowAfterCommit !== STAKE) {
        console.log(`  ❌ FAIL: escrow had ${escrowAfterCommit} lamports after commit, expected ${STAKE}`);
        return false;
    }

    // === Settle ===
    const poolBefore = await connection.getBalance(new PublicKey(POOL_PDA));
    const playerBefore = await connection.getBalance(player.publicKey);

    const { blockhash: bh2 } = await connection.getLatestBlockhash('confirmed');
    const settleBytes = AnchorBackend.buildSettleTx(
        player.publicKey.toBase58(),
        sessionSeed,
        tier.height,
        bh2
    );
    const settleTx = Transaction.from(settleBytes);
    settleTx.sign(player);
    const settleSig = await connection.sendRawTransaction(settleTx.serialize());
    await connection.confirmTransaction(settleSig, 'confirmed');
    console.log(`  settle: ${explorer(settleSig)}`);

    const poolAfter = await connection.getBalance(new PublicKey(POOL_PDA));
    const escrowAfter = await connection.getBalance(escrowPk);
    const sessionAfter = await connection.getBalance(sessionPk);
    const poolDelta = poolAfter - poolBefore;

    let ok = true;

    if (poolDelta !== tier.expectedPoolDelta) {
        console.log(`  ❌ FAIL: pool delta = ${poolDelta}, expected ${tier.expectedPoolDelta}`);
        ok = false;
    } else {
        console.log(`  ✓ pool delta = ${poolDelta} lamports`);
    }

    if (escrowAfter !== tier.expectedEscrowFinal) {
        console.log(`  ❌ FAIL: escrow = ${escrowAfter} lamports, expected ${tier.expectedEscrowFinal}`);
        ok = false;
    } else {
        console.log(`  ✓ escrow drained to 0`);
    }

    if (sessionAfter !== 0) {
        console.log(`  ❌ FAIL: session not closed, still has ${sessionAfter} lamports`);
        ok = false;
    } else {
        console.log(`  ✓ session closed + rent refunded`);
    }

    return ok;
}

async function main() {
    const admin = await loadAdmin();
    const connection = new Connection(RPC_URL, 'confirmed');

    console.log('Admin:  ', admin.publicKey.toBase58());
    console.log('Pool:   ', POOL_PDA);
    console.log('Cluster:', RPC_URL);

    const results: { tier: string; ok: boolean }[] = [];
    for (const tier of TIERS) {
        const ok = await runTier(connection, admin, tier);
        results.push({ tier: tier.name, ok });
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const r of results) {
        console.log(`  ${r.ok ? '✅' : '❌'}  ${r.tier}`);
    }

    const allPassed = results.every((r) => r.ok);
    if (allPassed) {
        console.log('\n✅ ALL TIERS PASSED — on-chain payout math verified for Forfeit / Half / Full / Double.');
    } else {
        console.log('\n❌ SOME TIERS FAILED — inspect the logs above.');
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
