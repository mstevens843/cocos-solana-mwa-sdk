/**
 * admin-withdraw.ts — Session D Part 8.
 *
 * Drains SOL from the Treasury PDA (rake sink) or Pool PDA (legacy) to an
 * arbitrary recipient — the admin's own wallet by default. Admin-gated
 * on-chain: signer must equal `state::ADMIN_PUBKEY` in the Rust program.
 *
 * Usage:
 *   npm run admin-withdraw -- --amount 0.05                         # treasury → admin
 *   npm run admin-withdraw -- --amount 0.05 --source treasury
 *   npm run admin-withdraw -- --amount 10   --source pool
 *   npm run admin-withdraw -- --amount 0.1  --recipient <pubkey>
 *
 * --amount is in SOL (not lamports). If the requested amount exceeds
 * `balance - rent_exempt_floor`, the program clamps to available and we log
 * the actual withdrawn amount.
 */

import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';

import { AnchorBackend } from '../assets/token-duel/scripts/AnchorBackend';
import { PROGRAM_ID, RPC_URL } from '../assets/token-duel/scripts/constants';

const TAG = '[admin-withdraw]';

interface Args {
    amountSol: number;
    source: 'treasury' | 'pool';
    recipient?: string;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    let amountSol = 0;
    let source: 'treasury' | 'pool' = 'treasury';
    let recipient: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        const v = argv[i + 1];
        if (k === '--amount' && v) { amountSol = parseFloat(v); i++; continue; }
        if (k === '--source' && v) {
            if (v !== 'treasury' && v !== 'pool') {
                console.log(`${TAG} FAIL --source must be treasury|pool (got ${v})`);
                process.exit(1);
            }
            source = v; i++; continue;
        }
        if (k === '--recipient' && v) { recipient = v; i++; continue; }
    }
    if (!(amountSol > 0)) {
        console.log(`${TAG} FAIL --amount <sol> required (got ${amountSol})`);
        process.exit(1);
    }
    return { amountSol, source, recipient };
}

async function loadAdmin(): Promise<Keypair> {
    const p = path.join(homedir(), '.config/solana/id.json');
    const bytes = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function explorer(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function main() {
    const args = parseArgs();
    const amountLamports = Math.floor(args.amountSol * LAMPORTS_PER_SOL);
    console.log(`${TAG} START source=${args.source} amount_sol=${args.amountSol} amount_lamports=${amountLamports} program=${PROGRAM_ID}`);

    const admin = await loadAdmin();
    const recipient = args.recipient ? new PublicKey(args.recipient) : admin.publicKey;
    console.log(`${TAG} admin=${admin.publicKey.toBase58()} recipient=${recipient.toBase58()}`);

    const conn = new Connection(RPC_URL, 'confirmed');

    const treasuryPda = new PublicKey(AnchorBackend.deriveTreasuryPda());
    const poolPda = new PublicKey(AnchorBackend.derivePoolPda());
    const sourcePda = args.source === 'treasury' ? treasuryPda : poolPda;

    const [treasuryInfoBefore, poolInfoBefore] = await Promise.all([
        conn.getAccountInfo(treasuryPda),
        conn.getAccountInfo(poolPda),
    ]);
    console.log(`${TAG} treasury_balance_before=${treasuryInfoBefore?.lamports ?? 0} pool_balance_before=${poolInfoBefore?.lamports ?? 0}`);
    const beforeBalance = args.source === 'treasury'
        ? (treasuryInfoBefore?.lamports ?? 0)
        : (poolInfoBefore?.lamports ?? 0);

    if (!treasuryInfoBefore && args.source === 'treasury') {
        console.log(`${TAG} FAIL treasury PDA missing — run init-treasury first`);
        process.exit(1);
    }
    if (!poolInfoBefore && args.source === 'pool') {
        console.log(`${TAG} FAIL pool PDA missing — run initialize_pool first`);
        process.exit(1);
    }
    if (beforeBalance === 0) {
        console.log(`${TAG} NOTE source=${args.source} balance is 0 — nothing to withdraw`);
        process.exit(0);
    }

    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const txBytes = args.source === 'treasury'
        ? AnchorBackend.buildAdminWithdrawTx(admin.publicKey.toBase58(), recipient.toBase58(), BigInt(amountLamports), blockhash)
        : AnchorBackend.buildAdminWithdrawPoolTx(admin.publicKey.toBase58(), recipient.toBase58(), BigInt(amountLamports), blockhash);

    console.log(`${TAG} tx_bytes=${txBytes.length} blockhash=${blockhash}`);
    const tx = Transaction.from(txBytes);
    tx.sign(admin);

    try {
        const sig = await sendAndConfirmTransaction(conn, tx, [admin], { commitment: 'confirmed' });
        console.log(`${TAG} SUCCESS sig=${sig}`);
        console.log(`${TAG} explorer=${explorer(sig)}`);
    } catch (e: any) {
        console.log(`${TAG} ERROR ${e?.message ?? e}`);
        process.exit(1);
    }

    const afterInfo = await conn.getAccountInfo(sourcePda);
    const afterBalance = afterInfo?.lamports ?? 0;
    const delta = beforeBalance - afterBalance;
    console.log(`${TAG} ${args.source}_balance_after=${afterBalance} (withdrew=${delta} lamports = ${(delta / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
}

main().catch((e) => {
    console.log(`${TAG} UNHANDLED ${e?.message ?? e}`);
    process.exit(1);
});
