/**
 * One-shot UserStats init for the tournament host keypair.
 *
 * The backend tournament cron (`backend/src/tournament_host.ts`) signs a
 * `join_match_create` tx as player 0 every 15 minutes. That tx does NOT
 * initialize the host's UserStats PDA — `initialize_user_stats` is a
 * separate instruction. Without a pre-existing UserStats PDA, the final
 * `settle_match` at tournament-end will fail its `remaining_accounts[0]`
 * check and the tournament pot would be stuck.
 *
 * Run this once per cluster after generating + funding the host keypair.
 *
 * Usage:
 *   cd scripts
 *   # Host keypair at a standard path:
 *   npx ts-node init-tournament-host.ts --keypair /path/to/host.json
 *
 * Idempotency: if the PDA already exists, logs ALREADY_INITIALIZED + exits 0.
 */

import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

import { AnchorBackend } from '../assets/token-duel/scripts/AnchorBackend';
import { PROGRAM_ID, RPC_URL, SEEDS } from '../assets/token-duel/scripts/constants';
import { findProgramAddress } from '../assets/token-duel/scripts/PdaDeriver';
import { base58Decode } from '../assets/solana-mwa/scripts/Base58';

const TAG = '[init-tournament-host]';

function parseArgs(): { keypairPath: string } {
    const args = process.argv.slice(2);
    let kp: string | null = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--keypair' && args[i + 1]) {
            kp = args[i + 1];
            i++;
        }
    }
    if (!kp) {
        console.error(`${TAG} --keypair <path> required (path to host keypair JSON file)`);
        process.exit(1);
    }
    return { keypairPath: kp };
}

function loadKeypair(p: string): Keypair {
    console.log(`${TAG} loadKeypair | path=${p}`);
    const bytes = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function main() {
    const { keypairPath } = parseArgs();
    console.log(`${TAG} START cluster=${RPC_URL} program=${PROGRAM_ID}`);
    const host = loadKeypair(keypairPath);
    console.log(`${TAG} host_pubkey=${host.publicKey.toBase58()}`);
    const connection = new Connection(RPC_URL, 'confirmed');

    const [pda] = findProgramAddress(
        [SEEDS.USER_STATS, base58Decode(host.publicKey.toBase58())],
        PROGRAM_ID,
    );
    console.log(`${TAG} host_stats_pda=${pda}`);

    const existing = await connection.getAccountInfo(new PublicKey(pda));
    if (existing) {
        console.log(`${TAG} ALREADY_INITIALIZED lamports=${existing.lamports} data_len=${existing.data.length}`);
        console.log(`${TAG} Add TOURNAMENT_HOST_SECRET (base58) to backend/.env.local and restart.`);
        return;
    }

    const balance = await connection.getBalance(host.publicKey);
    console.log(`${TAG} host_balance=${balance} lamports (${(balance / 1_000_000_000).toFixed(4)} SOL)`);
    if (balance < 10_000_000) {
        console.log(`${TAG} FAIL host has ${balance} lamports, need ≥10000000 for rent + tx fees`);
        console.log(`${TAG}        Fund with: solana airdrop 0.5 ${host.publicKey.toBase58()} --url devnet`);
        process.exit(1);
    }

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const txBytes = AnchorBackend.buildInitUserStatsTx(host.publicKey.toBase58(), blockhash);
    const tx = Transaction.from(txBytes);
    tx.sign(host);

    try {
        const sig = await sendAndConfirmTransaction(connection, tx, [host], { commitment: 'confirmed' });
        console.log(`${TAG} SUCCESS sig=${sig}`);
        console.log(`${TAG} explorer=https://explorer.solana.com/tx/${sig}?cluster=devnet`);
        console.log(`${TAG} Next: export the host's secret to base58 and set TOURNAMENT_HOST_SECRET in backend/.env.local`);
    } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (msg.includes('already in use') || msg.includes('already exists')) {
            console.log(`${TAG} IDEMPOTENT_OK — host UserStats existed after race`);
            return;
        }
        console.log(`${TAG} ERROR msg="${msg}"`);
        process.exit(1);
    }
}

main().catch((e) => {
    console.log(`${TAG} UNHANDLED error=${e?.message ?? e}`);
    process.exit(1);
});
