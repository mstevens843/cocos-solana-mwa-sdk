/**
 * One-shot admin bootstrap: init the singleton Treasury PDA.
 *
 * MUST be run AFTER `anchor build && anchor deploy` ships the
 * `initialize_treasury` ix (Session D). PDA seed = `[b"treasury"]`.
 *
 * Idempotency: running twice = second run sees the account already exists
 * and exits cleanly. Safe to re-run.
 *
 * Usage:
 *   cd scripts
 *   npx ts-node init-treasury.ts
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
import { PROGRAM_ID, RPC_URL, SEEDS } from '../assets/token-duel/scripts/constants';
import { findProgramAddress } from '../assets/token-duel/scripts/PdaDeriver';

const TAG = '[init-treasury]';

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

async function main() {
    console.log(`${TAG} START cluster=${RPC_URL} program=${PROGRAM_ID}`);
    const admin = await loadAdmin();
    const connection = new Connection(RPC_URL, 'confirmed');

    const [treasury] = findProgramAddress([SEEDS.TREASURY], PROGRAM_ID);
    console.log(`${TAG} pda=${treasury}`);

    const existing = await connection.getAccountInfo(new PublicKey(treasury));
    if (existing) {
        console.log(`${TAG} ALREADY_INITIALIZED lamports=${existing.lamports} data_len=${existing.data.length} owner=${existing.owner.toBase58()}`);
        console.log(`${TAG} No action needed — treasury PDA exists and is owned by the Token Duel program.`);
        return;
    }

    const balance = await connection.getBalance(admin.publicKey);
    console.log(`${TAG} admin_balance=${balance} lamports (${(balance / 1_000_000_000).toFixed(4)} SOL)`);
    if (balance < 10_000_000) {
        console.log(`${TAG} FAIL admin has ${balance} lamports, need ≥10000000 — fund via https://faucet.solana.com`);
        process.exit(1);
    }

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const txBytes = AnchorBackend.buildInitTreasuryTx(admin.publicKey.toBase58(), blockhash);
    console.log(`${TAG} tx_bytes=${txBytes.length} blockhash=${blockhash}`);

    const tx = Transaction.from(txBytes);
    tx.sign(admin);

    try {
        const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: 'confirmed' });
        console.log(`${TAG} SUCCESS sig=${sig}`);
        console.log(`${TAG} explorer=${explorer(sig)}`);
    } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.log(`${TAG} ERROR msg="${msg}"`);
        if (msg.includes('already in use') || msg.includes('already exists')) {
            console.log(`${TAG} INTERPRETATION treasury PDA was created by a concurrent tx; idempotent success`);
            return;
        }
        process.exit(1);
    }
}

main().catch((e) => {
    console.log(`${TAG} UNHANDLED error=${e?.message ?? e}`);
    process.exit(1);
});
