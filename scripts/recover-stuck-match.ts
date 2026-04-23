/**
 * recover-stuck-match.ts — recover a stuck Active match whose settle crashed
 * on the pre-fix program binary.
 *
 * Usage:
 *   cd scripts && npx ts-node recover-stuck-match.ts
 *
 * Hardcoded target: match GoWDtL64P3Wqf2Uo5er2CbsYBgApKBpHxy8bHLBPJoDB
 * (created during the 0.1 SOL smoke at tier 2 that pre-dated the box-fix).
 *
 * Strategy:
 *   1. Read the Match account — confirm Active + both players joined.
 *   2. Call settle_match as each player in order:
 *      - P0 partial settle with h=999800 (encoded -2%)
 *      - P1 final settle with h=999950 (encoded -0.5%) + payout to winner
 *   3. P1 wins by delta; receives ~0.194 SOL (pot 0.2 - rake 3%).
 *
 * P0 (user's main keypair) effectively loses 0.1 SOL; P1 (throwaway
 * test-player-b) gets 0.194 SOL, half of which is already covered by the
 * 0.25 SOL transfer used to fund the original smoke. Net cost to user:
 * ~0 SOL (the original 0.1 stake rotates through the throwaway back to
 * the testing float).
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
import { encodeDeltaPct } from '../assets/token-duel/scripts/ScoreEncoding';

const TAG = '[recover-stuck]';
const STUCK_MATCH_PDA = 'GoWDtL64P3Wqf2Uo5er2CbsYBgApKBpHxy8bHLBPJoDB';
const MATCH_MODE_U8 = 0; // 1v1

function loadKeypair(p: string): Keypair {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function readMatch(conn: Connection, pda: string): Promise<{
    status: number; playerCount: number; settledCount: number;
    players: string[]; heights: number[];
} | null> {
    const info = await conn.getAccountInfo(new PublicKey(pda));
    if (!info) return null;
    const raw = info.data;
    let o = 8;
    o += 1; // mode
    o += 1; // wager_tier
    o += 8; // wager_lamports
    o += 2; // xp_bucket
    o += 1; // required_players
    const playerCount = raw[o]; o += 1;
    const players: string[] = [];
    for (let i = 0; i < 10; i++) {
        players.push(new PublicKey(raw.slice(o, o + 32)).toBase58());
        o += 32;
    }
    const heights: number[] = [];
    for (let i = 0; i < 10; i++) {
        const h = raw[o] | (raw[o + 1] << 8) | (raw[o + 2] << 16) | (raw[o + 3] << 24);
        heights.push(h >>> 0); o += 4;
    }
    const settledCount = raw[o]; o += 1;
    o += 24; // created_at + started_at + closed_at
    const status = raw[o];
    return { status, playerCount, settledCount, players, heights };
}

async function main() {
    console.log(`${TAG} START match=${STUCK_MATCH_PDA} program=${PROGRAM_ID}`);
    const conn = new Connection(RPC_URL, 'confirmed');

    const playerA = loadKeypair(path.join(homedir(), '.config/solana/id.json'));
    const playerB = loadKeypair(path.join(__dirname, '.test-player-b.json'));
    console.log(`${TAG} PLAYER_A pubkey=${playerA.publicKey.toBase58()} bal=${(await conn.getBalance(playerA.publicKey) / LAMPORTS_PER_SOL).toFixed(4)}`);
    console.log(`${TAG} PLAYER_B pubkey=${playerB.publicKey.toBase58()} bal=${(await conn.getBalance(playerB.publicKey) / LAMPORTS_PER_SOL).toFixed(4)}`);

    const m = await readMatch(conn, STUCK_MATCH_PDA);
    if (!m) { console.log(`${TAG} FAIL match not readable`); process.exit(1); }
    console.log(`${TAG} match_state status=${m.status} player_count=${m.playerCount} settled_count=${m.settledCount} heights=[${m.heights.slice(0, m.playerCount).join(',')}]`);
    if (m.status === 2) {
        console.log(`${TAG} ALREADY_SETTLED — nothing to recover`);
        return;
    }
    if (m.status !== 1) {
        console.log(`${TAG} FAIL unexpected status=${m.status} (expected Active=1)`);
        process.exit(1);
    }

    const players = [playerA, playerB];
    const playerPubkeys = m.players.slice(0, 2);
    if (playerPubkeys[0] !== playerA.publicKey.toBase58() || playerPubkeys[1] !== playerB.publicKey.toBase58()) {
        console.log(`${TAG} FAIL player mismatch on_chain=[${playerPubkeys.join(',')}] expected=[A,B]`);
        process.exit(1);
    }

    // Deterministic heights: A = -2% delta, B = -0.5%. B wins.
    const heights = [encodeDeltaPct(-2), encodeDeltaPct(-0.5)];
    console.log(`${TAG} heights A=${heights[0]} B=${heights[1]} (B wins)`);

    // If P0 hasn't submitted yet (settled_count=0), partial settle by A first.
    if (m.settledCount === 0) {
        const { blockhash } = await conn.getLatestBlockhash('confirmed');
        const txBytes = AnchorBackend.buildSettleMatchTx(
            playerA.publicKey.toBase58(), STUCK_MATCH_PDA, MATCH_MODE_U8,
            playerPubkeys, [], heights[0], blockhash,
        );
        const tx = Transaction.from(txBytes); tx.sign(playerA);
        const sig = await sendAndConfirmTransaction(conn, tx, [playerA], { commitment: 'confirmed' });
        console.log(`${TAG} A partial_settle h=${heights[0]} sig=${sig}`);
    } else {
        console.log(`${TAG} skip_A settled_count=${m.settledCount} (already submitted)`);
    }

    // Final settler: B. Sort + payout to B (highest delta).
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const indexed = heights.map((h, i) => ({ slot: i, h })).sort((a, b) => b.h - a.h);
    const sortedSlots = indexed.map((x) => x.slot);
    const payoutRecipients = [playerPubkeys[sortedSlots[0]]];
    console.log(`${TAG} sorted_slots=[${sortedSlots.join(',')}] payout_recipient=${payoutRecipients[0]}`);
    const txBytes = AnchorBackend.buildSettleMatchTx(
        playerB.publicKey.toBase58(), STUCK_MATCH_PDA, MATCH_MODE_U8,
        playerPubkeys, payoutRecipients, heights[1], blockhash,
    );
    const tx = Transaction.from(txBytes); tx.sign(playerB);
    const sig = await sendAndConfirmTransaction(conn, tx, [playerB], { commitment: 'confirmed' });
    console.log(`${TAG} B final_settle h=${heights[1]} sig=${sig}`);

    const after = await readMatch(conn, STUCK_MATCH_PDA);
    if (!after) { console.log(`${TAG} FAIL match gone after settle`); process.exit(1); }
    console.log(`${TAG} after status=${after.status} settled_count=${after.settledCount}`);
    if (after.status === 2) {
        console.log(`${TAG} SUCCESS — match settled, 0.194 SOL routed to B`);
    } else {
        console.log(`${TAG} WARN unexpected final status=${after.status}`);
    }
}

main().catch((e) => {
    console.log(`${TAG} UNHANDLED error=${e?.message ?? e}\n${e?.stack ?? ''}`);
    process.exit(1);
});
