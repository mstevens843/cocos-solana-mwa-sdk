/**
 * One-shot per-player init for the UserStats PDA.
 *
 * Each wallet needs its own UserStats account initialized once before it can
 * play a real-mode match. The Cocos app auto-calls this at `_onPickerStart`
 * time via MWA, but this standalone script is useful for:
 *   - Pre-seeding a second test wallet before `smoke-match.ts`.
 *   - Fixing a stuck init (e.g. wallet signed init but tx timed out).
 *
 * Usage:
 *   cd scripts
 *   npx ts-node init-user-stats.ts                         # uses ~/.config/solana/id.json
 *   npx ts-node init-user-stats.ts --keypair <path>         # custom keypair file
 *
 * Idempotency: if the PDA already exists, logs ALREADY_INITIALIZED + exit 0.
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
import { base58Decode } from '../assets/solana-mwa/scripts/Base58';

const TAG = '[init-user-stats]';

function parseArgs(): { keypairPath: string } {
    const args = process.argv.slice(2);
    let kp = path.join(homedir(), '.config/solana/id.json');
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--keypair' && args[i + 1]) {
            kp = args[i + 1];
            i++;
        }
    }
    return { keypairPath: kp };
}

function loadKeypair(p: string): Keypair {
    console.log(`${TAG} loadKeypair | path=${p}`);
    const bytes = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function explorer(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function main() {
    const { keypairPath } = parseArgs();
    console.log(`${TAG} START cluster=${RPC_URL} program=${PROGRAM_ID}`);
    const player = loadKeypair(keypairPath);
    console.log(`${TAG} player_pubkey=${player.publicKey.toBase58()}`);
    const connection = new Connection(RPC_URL, 'confirmed');

    const [pda] = findProgramAddress(
        [SEEDS.USER_STATS, base58Decode(player.publicKey.toBase58())],
        PROGRAM_ID,
    );
    console.log(`${TAG} stats_pda=${pda}`);

    const existing = await connection.getAccountInfo(new PublicKey(pda));
    if (existing) {
        console.log(`${TAG} ALREADY_INITIALIZED lamports=${existing.lamports} data_len=${existing.data.length} owner=${existing.owner.toBase58()}`);
        return;
    }

    const balance = await connection.getBalance(player.publicKey);
    console.log(`${TAG} player_balance=${balance} lamports (${(balance / 1_000_000_000).toFixed(4)} SOL)`);
    if (balance < 10_000_000) {
        console.log(`${TAG} FAIL player has ${balance} lamports, need ≥10000000 — fund via https://faucet.solana.com`);
        process.exit(1);
    }

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const txBytes = AnchorBackend.buildInitUserStatsTx(player.publicKey.toBase58(), blockhash);
    console.log(`${TAG} tx_bytes=${txBytes.length} blockhash=${blockhash}`);

    const tx = Transaction.from(txBytes);
    tx.sign(player);

    try {
        const sig = await sendAndConfirmTransaction(connection, tx, [player], { commitment: 'confirmed' });
        console.log(`${TAG} SUCCESS sig=${sig}`);
        console.log(`${TAG} explorer=${explorer(sig)}`);
    } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.log(`${TAG} ERROR msg="${msg}"`);
        if (msg.includes('already in use') || msg.includes('already exists')) {
            console.log(`${TAG} INTERPRETATION PDA was created by a concurrent tx; idempotent success`);
            return;
        }
        process.exit(1);
    }
}

main().catch((e) => {
    console.log(`${TAG} UNHANDLED error=${e?.message ?? e}`);
    process.exit(1);
});
