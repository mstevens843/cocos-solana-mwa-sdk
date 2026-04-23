/**
 * One-shot admin bootstrap: init today's DailyChallenge PDA.
 *
 * MUST run AFTER `anchor deploy` ships Part 10 Bundle 3. Idempotent: a second
 * run of the same day exits cleanly. Intended to be re-run daily (00:00 UTC)
 * by the backend cron.
 *
 * Seeds: `[b"daily_challenge", day_id u64 LE]` where day_id = floor(unix_ts / 86400).
 *
 * Usage:
 *   cd scripts
 *   npm run init-daily-challenge             # initializes today with a rotating preset
 *   npm run init-daily-challenge -- --day <id>   # specific day_id (advanced)
 *   npm run init-daily-challenge -- --preset <0..13>  # override rotation
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

const TAG = '[init-daily-challenge]';

// 14-day rotation of challenge sets. Single source of truth is
// backend/challenges.json so the backend cron + this admin script stay in sync.
// kind: 0=WinNMatches, 1=WinOnTimeWindow (target = 0/1/2/3 for 1h/1d/3d/7d),
//       2=WinOnMode (target = 0/1/2/3 for 1v1/4p/8p/BR10), 3=FirstPlaceInPot (target = min players).
const ROTATION: Array<Array<{ kind: number; target: number; rewardXp: number }>> = (() => {
    const p = path.resolve(__dirname, '..', 'backend', 'challenges.json');
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(parsed?.rotation) || parsed.rotation.length !== 14) {
        throw new Error(`${TAG} challenges.json rotation must be 14 entries (got ${parsed?.rotation?.length})`);
    }
    return parsed.rotation;
})();

const DAY_SECONDS = 86_400;

function parseArgs(): { day: bigint; preset: number | null } {
    const args = process.argv.slice(2);
    let day = BigInt(Math.floor(Date.now() / 1000 / DAY_SECONDS));
    let preset: number | null = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--day' && args[i + 1]) { day = BigInt(args[i + 1]); i++; }
        else if (args[i] === '--preset' && args[i + 1]) { preset = parseInt(args[i + 1], 10); i++; }
    }
    return { day, preset };
}

async function loadAdmin(): Promise<Keypair> {
    const adminPath = path.join(homedir(), '.config/solana/id.json');
    const bytes = JSON.parse(fs.readFileSync(adminPath, 'utf8'));
    const kp = Keypair.fromSecretKey(Uint8Array.from(bytes));
    console.log(`${TAG} loadAdmin | pubkey=${kp.publicKey.toBase58()}`);
    return kp;
}

function explorer(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function main() {
    const { day, preset } = parseArgs();
    const rotationIdx = preset !== null ? preset % ROTATION.length : Number(day % BigInt(ROTATION.length));
    const challenges = ROTATION[rotationIdx];
    console.log(`${TAG} START cluster=${RPC_URL} program=${PROGRAM_ID} day_id=${day} rotation=${rotationIdx}`);
    console.log(`${TAG} challenges=${JSON.stringify(challenges)}`);

    const admin = await loadAdmin();
    const connection = new Connection(RPC_URL, 'confirmed');

    const pda = AnchorBackend.deriveDailyChallengePda(day);
    console.log(`${TAG} pda=${pda}`);

    const existing = await connection.getAccountInfo(new PublicKey(pda));
    if (existing) {
        console.log(`${TAG} ALREADY_INITIALIZED day_id=${day} lamports=${existing.lamports} data_len=${existing.data.length}`);
        return;
    }

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const txBytes = AnchorBackend.buildInitDailyChallengeTx(
        admin.publicKey.toBase58(),
        day,
        challenges,
        blockhash,
    );
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
            console.log(`${TAG} INTERPRETATION PDA exists — idempotent success`);
            return;
        }
        process.exit(1);
    }
}

main().catch((e) => {
    console.log(`${TAG} UNHANDLED ${e?.message ?? e}`);
    process.exit(1);
});
