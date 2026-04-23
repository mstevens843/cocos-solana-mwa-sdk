/**
 * One-shot admin bootstrap: init the current-week Season PDA.
 *
 * MUST run AFTER `anchor deploy` ships Part 10 Bundle 3. Idempotent. Intended
 * to be re-run weekly (Sunday 00:00 UTC) by the backend cron.
 *
 * Seeds: `[b"season", season_id u64 LE]` where season_id = floor(unix_ts / 604800).
 *
 * Usage:
 *   cd scripts
 *   npm run init-season                      # current week
 *   npm run init-season -- --season <id>     # specific week_id
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

const TAG = '[init-season]';

const WEEK_SECONDS = 7 * 86_400;

function parseArgs(): { season: bigint } {
    const args = process.argv.slice(2);
    let season = BigInt(Math.floor(Date.now() / 1000 / WEEK_SECONDS));
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--season' && args[i + 1]) { season = BigInt(args[i + 1]); i++; }
    }
    return { season };
}

async function loadAdmin(): Promise<Keypair> {
    const bytes = JSON.parse(fs.readFileSync(path.join(homedir(), '.config/solana/id.json'), 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function main() {
    const { season } = parseArgs();
    console.log(`${TAG} START cluster=${RPC_URL} program=${PROGRAM_ID} season_id=${season}`);
    const admin = await loadAdmin();
    const connection = new Connection(RPC_URL, 'confirmed');

    const pda = AnchorBackend.deriveSeasonPda(season);
    console.log(`${TAG} pda=${pda}`);

    const existing = await connection.getAccountInfo(new PublicKey(pda));
    if (existing) {
        console.log(`${TAG} ALREADY_INITIALIZED season_id=${season} size=${existing.data.length}`);
        return;
    }

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const txBytes = AnchorBackend.buildInitSeasonTx(admin.publicKey.toBase58(), season, blockhash);
    const tx = Transaction.from(txBytes);
    tx.sign(admin);

    try {
        const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: 'confirmed' });
        console.log(`${TAG} SUCCESS sig=${sig} explorer=https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.log(`${TAG} ERROR "${msg}"`);
        if (msg.includes('already in use') || msg.includes('already exists')) return;
        process.exit(1);
    }
}

main().catch((e) => { console.log(`${TAG} UNHANDLED ${e?.message ?? e}`); process.exit(1); });
