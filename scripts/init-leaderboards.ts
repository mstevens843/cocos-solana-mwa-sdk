/**
 * Admin bootstrap for the 4 per-mode Leaderboard PDAs (Session D Part 7).
 *
 * Seeds: `[b"leaderboard", &[mode_u8]]` for each GameMode 0..=3.
 *   mode=0 → 1v1 Duel
 *   mode=1 → 4p Pot
 *   mode=2 → 8p Pot
 *   mode=3 → Battle Royale
 *
 * MUST be run AFTER `anchor deploy` ships the `initialize_mode_leaderboard`
 * ix. Idempotent: modes whose PDA already exists are skipped.
 *
 * Usage:
 *   cd scripts
 *   npm run init-leaderboards
 */

import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';

import { AnchorBackend } from '../assets/token-duel/scripts/AnchorBackend';
import { PROGRAM_ID, RPC_URL } from '../assets/token-duel/scripts/constants';

const TAG = '[init-leaderboards]';

const MODES: { u8: number; label: string }[] = [
    { u8: 0, label: '1v1 Duel' },
    { u8: 1, label: '4p Pot' },
    { u8: 2, label: '8p Pot' },
    { u8: 3, label: 'Battle Royale' },
];

async function loadAdmin(): Promise<Keypair> {
    const adminPath = path.join(homedir(), '.config/solana/id.json');
    console.log(`${TAG} loadAdmin | path=${adminPath}`);
    const bytes = JSON.parse(fs.readFileSync(adminPath, 'utf8'));
    const kp = Keypair.fromSecretKey(Uint8Array.from(bytes));
    console.log(`${TAG} loadAdmin | DONE pubkey=${kp.publicKey.toBase58()}`);
    return kp;
}

function explorer(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function initOne(
    conn: Connection,
    admin: Keypair,
    modeU8: number,
    label: string,
): Promise<'skipped' | 'created'> {
    const pda = AnchorBackend.deriveModeLeaderboardPda(modeU8);
    console.log(`${TAG} mode=${modeU8} (${label}) pda=${pda}`);

    const existing = await conn.getAccountInfo(new PublicKey(pda));
    if (existing) {
        console.log(`${TAG}   ALREADY_INITIALIZED lamports=${existing.lamports} data_len=${existing.data.length}`);
        return 'skipped';
    }

    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const txBytes = AnchorBackend.buildInitModeLeaderboardTx(admin.publicKey.toBase58(), modeU8, blockhash);
    const tx = Transaction.from(txBytes);
    tx.sign(admin);

    try {
        const sig = await sendAndConfirmTransaction(conn, tx, [admin], { commitment: 'confirmed' });
        console.log(`${TAG}   SUCCESS sig=${sig}`);
        console.log(`${TAG}   explorer=${explorer(sig)}`);
        return 'created';
    } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.log(`${TAG}   ERROR msg="${msg}"`);
        if (msg.includes('already in use') || msg.includes('already exists')) {
            console.log(`${TAG}   INTERPRETATION pda was created by a concurrent tx; idempotent success`);
            return 'skipped';
        }
        throw e;
    }
}

async function main() {
    console.log(`${TAG} START cluster=${RPC_URL} program=${PROGRAM_ID}`);
    const admin = await loadAdmin();
    const connection = new Connection(RPC_URL, 'confirmed');

    const balance = await connection.getBalance(admin.publicKey);
    console.log(`${TAG} admin_balance=${balance} lamports (${(balance / 1_000_000_000).toFixed(4)} SOL)`);
    // Rent for 418-byte account × 4 + fees. ~0.012 SOL total. Require ≥0.02 SOL.
    if (balance < 20_000_000) {
        console.log(`${TAG} FAIL admin has ${balance} lamports, need ≥20000000 — fund via https://faucet.solana.com`);
        process.exit(1);
    }

    let skipped = 0;
    let created = 0;
    for (const m of MODES) {
        const result = await initOne(connection, admin, m.u8, m.label);
        if (result === 'skipped') skipped += 1;
        else created += 1;
    }
    console.log(`${TAG} DONE created=${created} skipped=${skipped}`);
}

main().catch((e) => {
    console.log(`${TAG} UNHANDLED error=${e?.message ?? e}`);
    process.exit(1);
});
