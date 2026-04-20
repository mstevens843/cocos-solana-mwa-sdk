/**
 * Token Duel — leaderboard sort-insert-evict smoke test.
 *
 * Commits + settles 11 different player keypairs at a spread of heights
 * and asserts the on-chain leaderboard:
 *   - Contains exactly 10 entries (capacity = LEADERBOARD_SIZE).
 *   - Is sorted descending by height.
 *   - The one player whose height was the lowest is evicted.
 *
 * Must run AFTER:
 *   - Phase B5 deploy (new bytecode on devnet).
 *   - Phase B6 init-leaderboard (PDA exists, owned by program).
 *
 * Run:
 *   cd scripts
 *   npx ts-node smoke-leaderboard.ts
 *
 * Exits 0 on pass, 1 on any assertion failure.
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
import { PROGRAM_ID, RPC_URL, SEEDS } from '../assets/token-duel/scripts/constants';
import { findProgramAddress } from '../assets/token-duel/scripts/PdaDeriver';
import { base58Encode } from '../assets/solana-mwa/scripts/Base58';

const TAG = '[smoke-leaderboard]';
const STAKE = 10_000_000; // 0.01 SOL per player

/** 11 heights spanning all tiers. Lowest (5) should be evicted after insert #10. */
const HEIGHTS = [50, 45, 40, 35, 30, 25, 20, 15, 12, 11, 5];

function explorer(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function loadAdmin(): Promise<Keypair> {
    const adminPath = path.join(homedir(), '.config/solana/id.json');
    const bytes = JSON.parse(fs.readFileSync(adminPath, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function fundPlayer(conn: Connection, admin: Keypair, player: PublicKey, lamports: number): Promise<void> {
    const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: player, lamports })
    );
    await sendAndConfirmTransaction(conn, tx, [admin], { commitment: 'confirmed' });
}

interface ParsedEntry {
    player: string;
    height: number;
    settledAt: number;
}

/** Parse the 418-byte Leaderboard account (8 disc + 10 × 41). */
function parseLeaderboard(data: Buffer): ParsedEntry[] {
    const out: ParsedEntry[] = [];
    const DISC = 8;
    const ENTRY = 41;
    for (let i = 0; i < 10; i++) {
        const off = DISC + i * ENTRY;
        const playerBytes = data.subarray(off, off + 32);
        const height = data[off + 32];
        // i64 LE from offset+33, low 6 bytes are plenty for unix seconds until 2286.
        let ts = 0;
        for (let k = 0; k < 6; k++) ts |= data[off + 33 + k] << (k * 8);
        if (height === 0) continue;
        out.push({ player: base58Encode(playerBytes), height, settledAt: ts });
    }
    return out;
}

async function playRound(
    conn: Connection,
    admin: Keypair,
    height: number,
    label: string,
): Promise<string> {
    const player = Keypair.generate();
    await fundPlayer(conn, admin, player.publicKey, 0.1 * LAMPORTS_PER_SOL);

    const seed = BigInt(Date.now() % 1_000_000) + BigInt(Math.floor(Math.random() * 1_000_000_000));

    const bh1 = (await conn.getLatestBlockhash('confirmed')).blockhash;
    const commitBytes = AnchorBackend.buildCommitTx(player.publicKey.toBase58(), BigInt(STAKE), seed, bh1);
    const commitTx = Transaction.from(commitBytes);
    commitTx.sign(player);
    const commitSig = await conn.sendRawTransaction(commitTx.serialize());
    await conn.confirmTransaction(commitSig, 'confirmed');

    const bh2 = (await conn.getLatestBlockhash('confirmed')).blockhash;
    const settleBytes = AnchorBackend.buildSettleTx(player.publicKey.toBase58(), seed, height, bh2);
    const settleTx = Transaction.from(settleBytes);
    settleTx.sign(player);
    const settleSig = await conn.sendRawTransaction(settleTx.serialize());
    await conn.confirmTransaction(settleSig, 'confirmed');
    console.log(`${TAG} ${label} height=${height} player=${player.publicKey.toBase58()} commit=${explorer(commitSig)} settle=${explorer(settleSig)}`);

    return player.publicKey.toBase58();
}

async function main() {
    const admin = await loadAdmin();
    const conn = new Connection(RPC_URL, 'confirmed');
    const [leaderboardPk] = findProgramAddress([SEEDS.LEADERBOARD], PROGRAM_ID);
    console.log(`${TAG} START admin=${admin.publicKey.toBase58()} leaderboard=${leaderboardPk}`);

    const acct = await conn.getAccountInfo(new PublicKey(leaderboardPk));
    if (!acct) {
        console.log(`${TAG} FAIL leaderboard PDA missing — run init-leaderboard.ts first`);
        process.exit(1);
    }
    console.log(`${TAG} leaderboard_before entries=${parseLeaderboard(acct.data).length}`);

    const playedPubkeys: { height: number; player: string }[] = [];
    for (let i = 0; i < HEIGHTS.length; i++) {
        const h = HEIGHTS[i];
        const player = await playRound(conn, admin, h, `round_${i + 1}`);
        playedPubkeys.push({ height: h, player });
    }

    // Re-read leaderboard post-play.
    const after = await conn.getAccountInfo(new PublicKey(leaderboardPk));
    if (!after) {
        console.log(`${TAG} FAIL leaderboard disappeared after plays`);
        process.exit(1);
    }
    const entries = parseLeaderboard(after.data);
    console.log(`${TAG} entries_after=${entries.length} heights=[${entries.map((e) => e.height).join(',')}]`);

    let pass = true;

    // Assert 1: length == 10 (bounded capacity).
    if (entries.length !== 10) {
        console.log(`${TAG} FAIL expected 10 entries got ${entries.length}`);
        pass = false;
    }

    // Assert 2: sorted descending.
    for (let i = 1; i < entries.length; i++) {
        if (entries[i].height > entries[i - 1].height) {
            console.log(`${TAG} FAIL not sorted descending at index=${i} ${entries[i - 1].height} < ${entries[i].height}`);
            pass = false;
        }
    }

    // Assert 3: the player with the LOWEST height should have been evicted.
    const evicted = playedPubkeys.reduce((min, cur) => (cur.height < min.height ? cur : min));
    const found = entries.find((e) => e.player === evicted.player);
    if (found) {
        console.log(`${TAG} FAIL evicted player ${evicted.player} (height=${evicted.height}) still on board`);
        pass = false;
    } else {
        console.log(`${TAG} PASS evicted player ${evicted.player} (height=${evicted.height}) correctly dropped`);
    }

    // Assert 4: top-10 should contain the 10 highest heights (not counting ties).
    // Because rounds may have run against an already-populated board, we only
    // check the 10 NEW plays ranked by height — our 10 highest must all appear.
    const myTop10Heights = playedPubkeys
        .map((p) => p.height)
        .sort((a, b) => b - a)
        .slice(0, 10);
    // For each of our top-10 plays, the pubkey should be on the board.
    for (const play of playedPubkeys) {
        if (!myTop10Heights.includes(play.height)) continue; // we expected to evict this one
        const match = entries.find((e) => e.player === play.player);
        if (!match) {
            // Not fatal — a prior board population may have displaced us.
            console.log(`${TAG} WARN our_play height=${play.height} player=${play.player} not in top-10 (likely prior-state displacement)`);
        }
    }

    console.log(`${TAG} ${pass ? 'ALL_PASS' : 'FAIL'} entries=${entries.length}`);
    process.exit(pass ? 0 : 1);
}

main().catch((e) => {
    console.log(`${TAG} UNHANDLED error=${e?.message ?? e}`);
    process.exit(1);
});
