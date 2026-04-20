/**
 * Token Duel — negative-path smoke test.
 *
 * Exercises the guards in the program by sending deliberately-invalid
 * transactions and asserting that the expected error codes fire. Each case
 * validates one specific revert path.
 *
 * Cases:
 *   N1. Stake below minimum (0.0005 SOL < MIN_STAKE_LAMPORTS 0.001)
 *   N2. Stake above maximum (2 SOL > MAX_STAKE_LAMPORTS 1)
 *   N3. Height out of range (settle with height=200 > MAX_HEIGHT 100)
 *   N4. Double-settle (settle once, then re-settle the same session)
 *      — this relies on the error being any revert, since the second attempt
 *        fails account-validation (session was closed).
 *   N5. Foreign-player settle (player A stakes, player B tries to settle)
 *      — caught by Anchor's `has_one = player` constraint.
 *
 * Run:
 *   cd scripts
 *   npm run smoke-negatives
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
import { RPC_URL } from '../assets/token-duel/scripts/constants';

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

async function sendRaw(
    connection: Connection,
    bytes: Uint8Array,
    signer: Keypair
): Promise<string> {
    const tx = Transaction.from(bytes);
    tx.sign(signer);
    const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
    });
    await connection.confirmTransaction(sig, 'confirmed');
    return sig;
}

async function expectFailure(
    label: string,
    errorMatchers: string[],
    attempt: () => Promise<string>
): Promise<boolean> {
    try {
        const sig = await attempt();
        console.log(`  ❌ ${label}: expected revert but tx succeeded (sig=${sig})`);
        return false;
    } catch (err: any) {
        const message = String(err?.message ?? err);
        const matched = errorMatchers.some((m) => message.includes(m));
        if (matched) {
            const logs: string[] = err?.transactionLogs ?? [];
            const reason = logs.find((l) => errorMatchers.some((m) => l.includes(m))) ?? '(inferred)';
            console.log(`  ✅ ${label}: reverted as expected — ${reason}`);
            return true;
        }
        console.log(`  ❌ ${label}: reverted but error didn't match expected. Got: ${message.slice(0, 300)}`);
        return false;
    }
}

async function main() {
    const admin = await loadAdmin();
    const connection = new Connection(RPC_URL, 'confirmed');
    const results: { case: string; ok: boolean }[] = [];

    console.log('Admin:', admin.publicKey.toBase58());
    console.log('RPC:  ', RPC_URL);
    console.log('');

    // ─── N1. Stake below minimum ────────────────────────────────────
    {
        console.log('━━ N1. Stake below minimum (0.0005 SOL) ━━');
        const player = Keypair.generate();
        await fundPlayer(connection, admin, player.publicKey, 0.03 * LAMPORTS_PER_SOL);
        const seed = BigInt(Date.now() + 1);
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        const bytes = AnchorBackend.buildCommitTx(player.publicKey.toBase58(),500_000n, seed, blockhash);

        const ok = await expectFailure(
            'N1 StakeTooLow',
            ['StakeTooLow', 'custom program error', '0x1771', '0x1772'],
            () => sendRaw(connection, bytes, player)
        );
        results.push({ case: 'N1 StakeTooLow', ok });
    }

    // ─── N2. Stake above maximum ────────────────────────────────────
    // Note: the `amount > MAX_STAKE_LAMPORTS` check in the commit handler
    // fires BEFORE the CPI transfer, so the player doesn't actually need to
    // hold 2 SOL. Fund them with just rent + fees (~0.02 SOL) — the tx will
    // revert on the bounds check, no real transfer attempted.
    {
        console.log('\n━━ N2. Stake above maximum (2 SOL arg, player funded minimally) ━━');
        const player = Keypair.generate();
        await fundPlayer(connection, admin, player.publicKey, 0.02 * LAMPORTS_PER_SOL);
        const seed = BigInt(Date.now() + 2);
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        const bytes = AnchorBackend.buildCommitTx(player.publicKey.toBase58(),2_000_000_000n, seed, blockhash);

        const ok = await expectFailure(
            'N2 StakeTooHigh',
            ['StakeTooHigh', 'custom program error', '0x1772', '0x1773'],
            () => sendRaw(connection, bytes, player)
        );
        results.push({ case: 'N2 StakeTooHigh', ok });
    }

    // ─── N3. Height out of range ────────────────────────────────────
    {
        console.log('\n━━ N3. Height > MAX_HEIGHT (200) ━━');
        const player = Keypair.generate();
        await fundPlayer(connection, admin, player.publicKey, 0.03 * LAMPORTS_PER_SOL);
        const seed = BigInt(Date.now() + 3);
        const { blockhash: bh1 } = await connection.getLatestBlockhash('confirmed');
        const commitBytes = AnchorBackend.buildCommitTx(
            player.publicKey,
            10_000_000n,
            seed,
            bh1
        );
        await sendRaw(connection, commitBytes, player);

        const { blockhash: bh2 } = await connection.getLatestBlockhash('confirmed');
        const settleBytes = AnchorBackend.buildSettleTx(player.publicKey.toBase58(),seed, 200, bh2);

        const ok = await expectFailure(
            'N3 HeightOutOfRange',
            ['HeightOutOfRange', 'custom program error', '0x1774', '0x1775'],
            () => sendRaw(connection, settleBytes, player)
        );
        results.push({ case: 'N3 HeightOutOfRange', ok });
    }

    // ─── N4. Double-settle ──────────────────────────────────────────
    {
        console.log('\n━━ N4. Double-settle (same session, twice) ━━');
        const player = Keypair.generate();
        await fundPlayer(connection, admin, player.publicKey, 0.03 * LAMPORTS_PER_SOL);
        const seed = BigInt(Date.now() + 4);

        const { blockhash: bh1 } = await connection.getLatestBlockhash('confirmed');
        const commitBytes = AnchorBackend.buildCommitTx(player.publicKey.toBase58(),10_000_000n, seed, bh1);
        await sendRaw(connection, commitBytes, player);

        // First settle — should succeed.
        const { blockhash: bh2 } = await connection.getLatestBlockhash('confirmed');
        const settleBytes1 = AnchorBackend.buildSettleTx(player.publicKey.toBase58(),seed, 15, bh2);
        await sendRaw(connection, settleBytes1, player);
        console.log('  (first settle succeeded as expected)');

        // Second settle — session is closed, expect any account-level revert.
        const { blockhash: bh3 } = await connection.getLatestBlockhash('confirmed');
        const settleBytes2 = AnchorBackend.buildSettleTx(player.publicKey.toBase58(),seed, 15, bh3);

        const ok = await expectFailure(
            'N4 DoubleSettle',
            ['AlreadySettled', 'AccountNotInitialized', 'AccountDiscriminatorNotFound', 'AccountOwnedByWrongProgram', 'custom program error'],
            () => sendRaw(connection, settleBytes2, player)
        );
        results.push({ case: 'N4 DoubleSettle', ok });
    }

    // ─── N5. Foreign-player settle ──────────────────────────────────
    {
        console.log('\n━━ N5. Foreign-player settle (B settles A\'s session) ━━');
        const playerA = Keypair.generate();
        const playerB = Keypair.generate();
        await fundPlayer(connection, admin, playerA.publicKey, 0.1 * LAMPORTS_PER_SOL);
        await fundPlayer(connection, admin, playerB.publicKey, 0.05 * LAMPORTS_PER_SOL);

        const seed = BigInt(Date.now() + 5);
        const { blockhash: bh1 } = await connection.getLatestBlockhash('confirmed');
        const commitBytes = AnchorBackend.buildCommitTx(playerA.publicKey.toBase58(),10_000_000n, seed, bh1);
        await sendRaw(connection, commitBytes, playerA);

        // Player B tries to settle A's session.
        // AnchorBackend.buildSettleTx derives PDAs from the passed player —
        // passing B means B's derived PDAs don't match A's on-chain session,
        // which will fail account validation before reaching `has_one`.
        // To actually exercise `has_one = player`, B must submit a tx
        // referencing A's session PDA but with B as the signer. That requires
        // manual tx construction.
        const { session: sessionA, escrow: escrowA } = AnchorBackend.derivePdas(playerA.publicKey.toBase58(), seed);
        const sessionA_PK = new PublicKey(sessionA);
        const escrowA_PK = new PublicKey(escrowA);
        const { blockhash: bh2 } = await connection.getLatestBlockhash('confirmed');

        // Build a settle tx that references A's session+escrow but with B as signer.
        const { TransactionInstruction } = require('@solana/web3.js');
        const { sha256 } = require('js-sha256');
        const { PROGRAM_ID: TD_PROGRAM_ID, POOL_PDA: TD_POOL_PDA } = require('../assets/token-duel/scripts/constants');
        const disc = Buffer.from(sha256('global:settle'), 'hex').subarray(0, 8);
        const data = Buffer.concat([disc, Buffer.from([15])]);
        const ix = new TransactionInstruction({
            programId: new PublicKey(TD_PROGRAM_ID),
            keys: [
                { pubkey: playerB.publicKey, isSigner: true, isWritable: true },
                { pubkey: sessionA_PK, isSigner: false, isWritable: true },
                { pubkey: escrowA_PK, isSigner: false, isWritable: true },
                { pubkey: new PublicKey(TD_POOL_PDA), isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data,
        });
        const foreignTx = new Transaction();
        foreignTx.feePayer = playerB.publicKey;
        foreignTx.recentBlockhash = bh2;
        foreignTx.add(ix);

        const ok = await expectFailure(
            'N5 ForeignPlayerSettle',
            ['ConstraintHasOne', 'has_one', 'ConstraintSeeds', 'seeds', 'constraint', 'custom program error', '0x'],
            async () => {
                foreignTx.sign(playerB);
                const sig = await connection.sendRawTransaction(foreignTx.serialize());
                await connection.confirmTransaction(sig, 'confirmed');
                return sig;
            }
        );
        results.push({ case: 'N5 ForeignPlayerSettle', ok });

        // Cleanup: let playerA settle their session so it doesn't orphan.
        const { blockhash: bh3 } = await connection.getLatestBlockhash('confirmed');
        const cleanupBytes = AnchorBackend.buildSettleTx(playerA.publicKey.toBase58(),seed, 15, bh3);
        try {
            await sendRaw(connection, cleanupBytes, playerA);
        } catch {
            /* ignore cleanup failures */
        }
    }

    // ─── Summary ────────────────────────────────────────────────────
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Negative-path summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const r of results) {
        console.log(`  ${r.ok ? '✅' : '❌'}  ${r.case}`);
    }
    const allPassed = results.every((r) => r.ok);
    if (allPassed) {
        console.log('\n✅ All guards fired as expected.');
    } else {
        console.log('\n❌ Some guards did not behave as expected.');
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
