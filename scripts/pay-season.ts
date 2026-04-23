/**
 * pay-season.ts — admin CLI to pay out a completed Season.
 *
 * Normally the backend cron fires this Monday 00:00 UTC for the previous week.
 * This CLI is the manual / emergency / smoke-test equivalent.
 *
 * Usage:
 *   cd scripts
 *   npm run pay-season                          # previous week (current - 1)
 *   npm run pay-season -- --season <id>         # specific season_id
 *
 * Contract:
 *   - Fetches Season PDA, reads top-3 entries (player pubkeys).
 *   - Builds pay_season tx via AnchorBackend.buildPaySeasonTx.
 *   - Signs as the admin (~/.config/solana/id.json), sends, confirms.
 *   - Idempotent: program rejects paid_out seasons.
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
import { parseSeason } from '../assets/token-duel/scripts/SeasonRpc';

const TAG = '[pay-season]';
const WEEK_SECONDS = 7 * 86_400;

function parseArgs(): { seasonId: bigint } {
    const args = process.argv.slice(2);
    let seasonId = BigInt(Math.floor(Date.now() / 1000 / WEEK_SECONDS)) - 1n;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--season' && args[i + 1]) { seasonId = BigInt(args[i + 1]); i++; }
    }
    return { seasonId };
}

async function loadAdmin(): Promise<Keypair> {
    const bytes = JSON.parse(fs.readFileSync(path.join(homedir(), '.config/solana/id.json'), 'utf8'));
    const kp = Keypair.fromSecretKey(Uint8Array.from(bytes));
    console.log(`${TAG} loadAdmin | pubkey=${kp.publicKey.toBase58()}`);
    return kp;
}

async function main() {
    const { seasonId } = parseArgs();
    console.log(`${TAG} START cluster=${RPC_URL} program=${PROGRAM_ID} season_id=${seasonId}`);

    const connection = new Connection(RPC_URL, 'confirmed');
    const admin = await loadAdmin();
    const pda = AnchorBackend.deriveSeasonPda(seasonId);
    console.log(`${TAG} pda=${pda}`);

    const info = await connection.getAccountInfo(new PublicKey(pda));
    if (!info) {
        console.log(`${TAG} ABORT season PDA not initialized (id=${seasonId})`);
        process.exit(1);
    }
    const state = parseSeason(pda, new Uint8Array(info.data));
    if (!state) {
        console.log(`${TAG} ABORT parseSeason returned null for pda=${pda}`);
        process.exit(1);
    }
    if (state.paidOut) {
        console.log(`${TAG} IDEMPOTENT_OK already paid_out season_id=${seasonId}`);
        return;
    }
    const top3 = state.entries.slice(0, 3).map((e) => e.player);
    if (top3.length === 0) {
        console.log(`${TAG} ABORT no entries (no winners to pay) season_id=${seasonId}`);
        process.exit(1);
    }
    console.log(`${TAG} top3=${JSON.stringify(top3)} rake_accumulated=${state.totalRakeAccumulated}`);

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const txBytes = AnchorBackend.buildPaySeasonTx(
        admin.publicKey.toBase58(),
        seasonId,
        top3,
        blockhash,
    );
    const tx = Transaction.from(txBytes);
    tx.sign(admin);

    try {
        const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: 'confirmed' });
        console.log(`${TAG} SUCCESS sig=${sig}`);
        console.log(`${TAG} explorer=https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.log(`${TAG} ERROR msg="${msg}"`);
        if (msg.includes('already paid') || msg.includes('already_paid_out')) {
            console.log(`${TAG} INTERPRETATION season already paid — idempotent success`);
            return;
        }
        process.exit(1);
    }
}

main().catch((e) => {
    console.log(`${TAG} UNHANDLED ${e?.message ?? e}`);
    process.exit(1);
});
