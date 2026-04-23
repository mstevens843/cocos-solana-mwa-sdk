/**
 * smoke-match.ts — end-to-end N-keypair test of the Session D real-mode
 * match flow. Supports 1v1 / 4p / 8p / br10.
 *
 * Usage:
 *   cd scripts
 *   npm run smoke-match                    # default 1v1
 *   npm run smoke-match -- --mode 4p       # 4-player
 *   npm run smoke-match -- --mode 8p       # 8-player
 *   npm run smoke-match -- --mode br10     # battle royale (10 players)
 *
 * Prereqs:
 *   - `anchor deploy` ran successfully (Part 7 redeploy).
 *   - `npm run init-leaderboard`, `init-leaderboards`, `init-treasury`, `init-match-counter` green.
 *   - ~/.config/solana/id.json funded (≥0.5 SOL).
 *
 * Test players persist to scripts/.test-player-{b..j}.json so reruns reuse
 * the same on-chain UserStats PDAs.
 *
 * Exits 0 on green, 1 on any assertion failure.
 */

import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';

import { AnchorBackend } from '../assets/token-duel/scripts/AnchorBackend';
import { PROGRAM_ID, RPC_URL, SEEDS } from '../assets/token-duel/scripts/constants';
import { findProgramAddress } from '../assets/token-duel/scripts/PdaDeriver';
import { base58Decode } from '../assets/solana-mwa/scripts/Base58';
import { encodeDeltaPct } from '../assets/token-duel/scripts/ScoreEncoding';

const TAG = '[smoke-match]';
const WAGER_TIER_INDEX = 5;           // INTRO 0.001 SOL
const WAGER_LAMPORTS = 50_000_000;
const XP_BUCKET = 0;

interface ModeConfig {
    modeU8: number;
    requiredPlayers: number;
    payoutBps: number[];
    label: string;
}
const MODE_CONFIGS: Record<string, ModeConfig> = {
    '1v1':  { modeU8: 0, requiredPlayers: 2,  payoutBps: [10_000], label: '1v1 Duel' },
    '4p':   { modeU8: 1, requiredPlayers: 4,  payoutBps: [7_000, 3_000], label: '4p Pot' },
    '8p':   { modeU8: 2, requiredPlayers: 8,  payoutBps: [5_000, 3_000, 2_000], label: '8p Pot' },
    'br10': { modeU8: 3, requiredPlayers: 10, payoutBps: [5_000, 2_500, 1_500, 1_000], label: 'Battle Royale' },
};

const TIME_WINDOW_MAP: Record<string, number> = { '1h': 0, '1d': 1, '24h': 1, '3d': 2, '7d': 3 };

function parseArgs(): { mode: string; timeWindow: number; windowLabel: string; verified: boolean; backendUrl: string } {
    const args = process.argv.slice(2);
    let mode = '1v1';
    let windowLabel = '1d';
    let verified = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--mode' && args[i + 1]) { mode = args[i + 1]; i++; }
        else if (args[i] === '--window' && args[i + 1]) { windowLabel = args[i + 1]; i++; }
        else if (args[i] === '--verified') { verified = true; }
    }
    if (!MODE_CONFIGS[mode]) { console.log(`${TAG} FAIL unknown mode=${mode}`); process.exit(1); }
    const timeWindow = TIME_WINDOW_MAP[windowLabel];
    if (timeWindow === undefined) { console.log(`${TAG} FAIL unknown window=${windowLabel} (valid: 1h|1d|3d|7d)`); process.exit(1); }
    // --verified requires a local backend to issue Ed25519 receipts.
    const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3000';
    return { mode, timeWindow, windowLabel, verified, backendUrl };
}

/**
 * For --verified: negotiate a session with the local backend, play 3 valid
 * drops, finalize, and return the Ed25519 instruction data + signedAt + the
 * backend-recorded final height. Throws on any failure (backend unreachable,
 * physics reject, WS error, etc.) so the caller can fall back.
 */
async function fetchVerifiedReceipt(
    backendUrl: string,
    matchPda: string,
    playerPubkey: string,
    squadMints: string[],
    windowLabel: string,
    intendedHeight: number,
): Promise<{ ed25519IxDataB64: string; signedAt: number; height: number }> {
    const WebSocket = (await import('ws')).default;
    const startRes = await fetch(`${backendUrl}/session/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matchPda, playerPubkey, squadMints, timeWindow: windowLabel === '24h' ? '1d' : windowLabel }),
    });
    if (!startRes.ok) throw new Error(`/session/start HTTP ${startRes.status}: ${await startRes.text()}`);
    const start = await startRes.json() as { sessionId: string; serverPubkey: string; wsUrl: string; expectedWidths: number[]; startedAt: number };
    console.log(`${TAG} --verified session=${start.sessionId} server_pubkey=${start.serverPubkey}`);

    return await new Promise((resolve, reject) => {
        const ws = new WebSocket(start.wsUrl);
        let settled = false;
        ws.on('open', () => {
            // Send drops respecting physics bounds. MIN drop gap 150ms.
            const startTsMs = Date.now();
            const dropCount = Math.min(3, intendedHeight);
            for (let idx = 0; idx < dropCount; idx++) {
                setTimeout(() => {
                    const width = start.expectedWidths[idx] ?? 220;
                    ws.send(JSON.stringify({
                        kind: 'drop',
                        blockIdx: idx,
                        tsMs: startTsMs + idx * 200,
                        xPos: 0,
                        width,
                        outcome: 'land',
                    }));
                }, idx * 200);
            }
            setTimeout(() => {
                ws.send(JSON.stringify({ kind: 'finalize', finalHeight: dropCount }));
            }, dropCount * 200 + 100);
        });
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(String(raw));
                if (msg.kind === 'receipt') {
                    settled = true;
                    resolve({ ed25519IxDataB64: msg.ed25519IxDataB64, signedAt: msg.signedAt, height: msg.height });
                    ws.close();
                } else if (msg.kind === 'fatal') {
                    reject(new Error(`backend fatal: ${msg.reason}`));
                    ws.close();
                }
            } catch (e) { reject(e as any); ws.close(); }
        });
        ws.on('error', (e) => { if (!settled) reject(e as any); });
        ws.on('close', () => { if (!settled) reject(new Error('ws closed before receipt')); });
    });
}

function loadKeypair(p: string): Keypair {
    const bytes = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

/** Test players B, C, D, ... J (up to 10). Persists + reuses. */
function loadOrCreateTestPlayer(idx: number): Keypair {
    const letter = String.fromCharCode('a'.charCodeAt(0) + idx); // b, c, d, ...
    const keypairPath = path.join(__dirname, `.test-player-${letter}.json`);
    if (fs.existsSync(keypairPath)) {
        const kp = loadKeypair(keypairPath);
        console.log(`${TAG} PLAYER_${letter.toUpperCase()} loaded pubkey=${kp.publicKey.toBase58()}`);
        return kp;
    }
    const kp = Keypair.generate();
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(kp.secretKey)));
    console.log(`${TAG} PLAYER_${letter.toUpperCase()} generated pubkey=${kp.publicKey.toBase58()}`);
    return kp;
}

async function ensureBalance(conn: Connection, kp: Keypair, targetLamports: number): Promise<void> {
    let bal = await conn.getBalance(kp.publicKey);
    if (bal >= targetLamports) return;
    console.log(`${TAG} requesting airdrop pubkey=${kp.publicKey.toBase58().substring(0,8)} bal=${bal}`);
    for (let i = 0; i < 3; i++) {
        try {
            const sig = await conn.requestAirdrop(kp.publicKey, targetLamports);
            await conn.confirmTransaction(sig, 'confirmed');
            bal = await conn.getBalance(kp.publicKey);
            if (bal >= targetLamports) return;
        } catch (e: any) {
            console.log(`${TAG} airdrop attempt=${i + 1} error=${e?.message ?? e}`);
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(`${TAG} airdrop failed — bal=${bal} need=${targetLamports}`);
    process.exit(1);
}

async function ensureUserStats(conn: Connection, kp: Keypair): Promise<void> {
    const [pda] = findProgramAddress([SEEDS.USER_STATS, base58Decode(kp.publicKey.toBase58())], PROGRAM_ID);
    const info = await conn.getAccountInfo(new PublicKey(pda));
    if (info) return;
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const txBytes = AnchorBackend.buildInitUserStatsTx(kp.publicKey.toBase58(), blockhash);
    const tx = Transaction.from(txBytes); tx.sign(kp);
    const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: 'confirmed' });
    console.log(`${TAG} userstats init for ${kp.publicKey.toBase58().substring(0,8)} sig=${sig}`);
}

async function readCounterSeq(conn: Connection): Promise<bigint> {
    const [pda] = findProgramAddress([SEEDS.MATCH_COUNTER], PROGRAM_ID);
    const info = await conn.getAccountInfo(new PublicKey(pda));
    if (!info) { console.log(`${TAG} FAIL counter missing`); process.exit(1); }
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(info.data[8 + i]);
    return v;
}

async function readMatch(conn: Connection, pda: string): Promise<{
    status: number; playerCount: number; settledCount: number;
    players: string[]; heights: number[]; wagerLamports: bigint; requiredPlayers: number;
} | null> {
    const info = await conn.getAccountInfo(new PublicKey(pda));
    if (!info) return null;
    const raw = info.data;
    let o = 8;
    const mode = raw[o]; o += 1; void mode;
    const wagerTier = raw[o]; o += 1; void wagerTier;
    let wager = 0n; for (let i = 7; i >= 0; i--) wager = (wager << 8n) | BigInt(raw[o + i]); o += 8;
    o += 2; // xp_bucket
    const requiredPlayers = raw[o]; o += 1;
    const playerCount = raw[o]; o += 1;
    const players: string[] = [];
    for (let i = 0; i < 10; i++) {
        const pk = new PublicKey(raw.slice(o, o + 32));
        players.push(pk.toBase58());
        o += 32;
    }
    const heights: number[] = [];
    for (let i = 0; i < 10; i++) {
        const h = raw[o] | (raw[o + 1] << 8) | (raw[o + 2] << 16) | (raw[o + 3] << 24);
        heights.push(h >>> 0); o += 4;
    }
    const settledCount = raw[o]; o += 1;
    o += 8 + 8 + 8; // created_at, started_at, closed_at
    const status = raw[o]; o += 1;
    return { status, playerCount, settledCount, players, heights, wagerLamports: wager, requiredPlayers };
}

async function assertEq<T>(actual: T, expected: T, label: string): Promise<void> {
    if (actual !== expected) {
        console.log(`${TAG} FAIL ${label} expected=${expected} actual=${actual}`);
        process.exit(1);
    }
}

async function main() {
    const { mode, timeWindow, windowLabel, verified, backendUrl } = parseArgs();
    const cfg = MODE_CONFIGS[mode];
    const n = cfg.requiredPlayers;
    console.log(`${TAG} START mode=${mode} (${cfg.label}) window=${windowLabel}(u8=${timeWindow}) N=${n} verified=${verified}${verified ? ` backend=${backendUrl}` : ''} program=${PROGRAM_ID}`);
    const conn = new Connection(RPC_URL, 'confirmed');

    // Players.
    const playerA = loadKeypair(path.join(homedir(), '.config/solana/id.json'));
    console.log(`${TAG} PLAYER_A pubkey=${playerA.publicKey.toBase58()} bal=${(await conn.getBalance(playerA.publicKey) / LAMPORTS_PER_SOL).toFixed(4)}`);
    const players: Keypair[] = [playerA];
    for (let i = 1; i < n; i++) {
        const kp = loadOrCreateTestPlayer(i);
        await ensureBalance(conn, kp, 10_000_000); // 0.01 SOL covers INTRO stake + rent + fees
        players.push(kp);
    }

    // Init stats for all.
    for (const kp of players) await ensureUserStats(conn, kp);

    // A creates.
    const seq = await readCounterSeq(conn);
    const matchPda = AnchorBackend.deriveMatchPda(cfg.modeU8, WAGER_TIER_INDEX, seq);
    console.log(`${TAG} A creating match seq=${seq} pda=${matchPda}`);
    {
        const { blockhash } = await conn.getLatestBlockhash('confirmed');
        const txBytes = AnchorBackend.buildJoinMatchCreateTx(playerA.publicKey.toBase58(), cfg.modeU8, WAGER_TIER_INDEX, XP_BUCKET, timeWindow, seq, blockhash);
        const tx = Transaction.from(txBytes); tx.sign(playerA);
        const sig = await sendAndConfirmTransaction(conn, tx, [playerA], { commitment: 'confirmed' });
        console.log(`${TAG} A join_create sig=${sig}`);
    }

    // B..N-1 join in sequence.
    for (let i = 1; i < n; i++) {
        const p = players[i];
        const { blockhash } = await conn.getLatestBlockhash('confirmed');
        const txBytes = AnchorBackend.buildJoinMatchJoinTx(p.publicKey.toBase58(), matchPda, blockhash);
        const tx = Transaction.from(txBytes); tx.sign(p);
        const sig = await sendAndConfirmTransaction(conn, tx, [p], { commitment: 'confirmed' });
        console.log(`${TAG} P${i} join sig=${sig}`);
    }

    let m = await readMatch(conn, matchPda);
    if (!m) { console.log(`${TAG} FAIL match not readable after joins`); process.exit(1); }
    await assertEq(m.status, 1, `match.status=Active after ${n} joins`);
    await assertEq(m.playerCount, n, `match.playerCount=${n}`);

    // betting-duel: heights are now **encoded portfolio delta scores**.
    // Simulate each player finishing at a different portfolio delta so the
    // last joiner wins the rank-by-score check. P0=-2%, P1=+1%, ... Pn-1
    // gets the highest delta. The program still ranks by u32, which matches
    // ranking by delta since encoding is monotonic.
    const heights: number[] = [];
    for (let i = 0; i < n; i++) {
        const simulatedDeltaPct = -2 + i * 1.5; // P0=-2%, P1=-0.5%, P2=+1%, ...
        heights.push(encodeDeltaPct(simulatedDeltaPct));
    }
    console.log(`${TAG} simulated deltas → heights=[${heights.join(',')}]`);

    // All but last: partial settles.
    for (let i = 0; i < n - 1; i++) {
        const p = players[i];
        const { blockhash } = await conn.getLatestBlockhash('confirmed');
        // Partial settlers pass empty payout recipients.
        const txBytes = AnchorBackend.buildSettleMatchTx(
            p.publicKey.toBase58(), matchPda, cfg.modeU8,
            m.players.slice(0, n), [], // no payout recipients for partial
            heights[i], blockhash,
        );
        const tx = Transaction.from(txBytes); tx.sign(p);
        const sig = await sendAndConfirmTransaction(conn, tx, [p], { commitment: 'confirmed' });
        console.log(`${TAG} P${i} settle h=${heights[i]} sig=${sig}`);
        m = await readMatch(conn, matchPda);
        if (!m) { console.log(`${TAG} FAIL match gone after partial`); process.exit(1); }
        await assertEq(m.settledCount, i + 1, `settled_count=${i + 1} after P${i}`);
    }

    // Final settler: compute sorted winners + pass them. With --verified, the
    // final settle routes through settle_match_verified + an Ed25519 receipt
    // from the local backend. Falls back to legacy path if the backend
    // receipt fetch fails, with a warning.
    {
        const p = players[n - 1];
        const lastSettlerHeight = heights[n - 1];
        const projected = [...heights];
        const indexed = projected.map((h, i) => ({ slot: i, h })).sort((a, b) => b.h - a.h);
        const sortedSlots = indexed.map((x) => x.slot);
        const k = cfg.payoutBps.length;
        const payoutRecipients = sortedSlots.slice(0, k).map((slot) => m!.players[slot]);

        let receipt: { ed25519IxDataB64: string; signedAt: number; height: number } | null = null;
        if (verified) {
            try {
                // Dummy squad mints — physics just needs 3 valid-looking pubkeys.
                const squadMints = [
                    'So11111111111111111111111111111111111111112',
                    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
                ];
                receipt = await fetchVerifiedReceipt(
                    backendUrl, matchPda, p.publicKey.toBase58(), squadMints, windowLabel, lastSettlerHeight,
                );
                console.log(`${TAG} P${n - 1} RECEIPT h=${receipt.height} signed_at=${receipt.signedAt} ed25519_bytes=${receipt.ed25519IxDataB64.length}`);
            } catch (e: any) {
                console.log(`${TAG} --verified FAILED (${e?.message ?? e}) — falling back to legacy path`);
            }
        }

        const { blockhash } = await conn.getLatestBlockhash('confirmed');
        let txBytes: Uint8Array;
        let finalHeight = lastSettlerHeight;
        if (receipt) {
            finalHeight = receipt.height;
            txBytes = AnchorBackend.buildSettleMatchVerifiedTx(
                p.publicKey.toBase58(), matchPda, cfg.modeU8,
                m.players.slice(0, n), payoutRecipients,
                receipt.height, receipt.signedAt, receipt.ed25519IxDataB64, blockhash,
            );
        } else {
            txBytes = AnchorBackend.buildSettleMatchTx(
                p.publicKey.toBase58(), matchPda, cfg.modeU8,
                m.players.slice(0, n), payoutRecipients,
                lastSettlerHeight, blockhash,
            );
        }
        console.log(`${TAG} P${n - 1} final settle h=${finalHeight} path=${receipt ? 'verified' : 'legacy'} sorted_slots=[${sortedSlots.slice(0, k).join(',')}] recipients=${payoutRecipients.length}`);
        const tx = Transaction.from(txBytes); tx.sign(p);
        const sig = await sendAndConfirmTransaction(conn, tx, [p], { commitment: 'confirmed' });
        console.log(`${TAG} P${n - 1} settle sig=${sig}`);
        // Override heights[n-1] so downstream winner/payout checks reflect the
        // backend-recorded height (which may differ from intendedHeight).
        heights[n - 1] = finalHeight;
    }

    m = await readMatch(conn, matchPda);
    if (!m) { console.log(`${TAG} FAIL match gone after final`); process.exit(1); }
    await assertEq(m.status, 2, 'match.status=Settled');
    await assertEq(m.settledCount, n, `settled_count=${n}`);

    // Winner check: slot n-1 should have highest height.
    const winnerSlot = m.heights.slice(0, n).reduce((best, h, i, arr) => h > arr[best] ? i : best, 0);
    console.log(`${TAG} winner_slot=${winnerSlot} heights=[${m.heights.slice(0, n).join(',')}]`);
    if (winnerSlot !== n - 1) {
        console.log(`${TAG} FAIL expected winner=slot${n - 1}, got slot${winnerSlot}`);
        process.exit(1);
    }

    // Payout sanity: expected pot = n * wager; rake = 3%; first-place share = payoutBps[0] / 10000.
    const pot = WAGER_LAMPORTS * n;
    const rake = Math.floor((pot * 300) / 10_000);
    const distributable = pot - rake;
    console.log(`${TAG} pot=${pot} rake=${rake} distributable=${distributable}`);
    for (let rank = 0; rank < cfg.payoutBps.length; rank++) {
        const expected = Math.floor((distributable * cfg.payoutBps[rank]) / 10_000);
        console.log(`${TAG}   rank${rank + 1} expected=${expected} (bps=${cfg.payoutBps[rank]})`);
    }

    // ─── Session D Part 7: mode-specific leaderboard assertions ────────
    //
    // Each GameMode has its own Leaderboard PDA (seeds [b"leaderboard", &[mode]]).
    // The winner must appear in mode=N's board; other modes' boards are
    // untouched by this match (may contain entries from prior runs).
    const winner = m.players[winnerSlot];
    const winnerHeightU8 = Math.min(255, m.heights[winnerSlot]);
    await assertLeaderboardHasWinner(conn, cfg.modeU8, winner, winnerHeightU8);
    console.log(`${TAG} LEADERBOARD_OK mode=${cfg.modeU8} winner=${winner.substring(0, 8)}… h=${winnerHeightU8} landed`);

    console.log(`${TAG} SUCCESS mode=${mode} winner=${m.players[winnerSlot]} pot=${pot} rake=${rake}`);
}

/**
 * Fetch mode-specific Leaderboard PDA raw bytes, parse the 10 entries, and
 * assert `winner` appears at some rank with the expected height.
 */
async function assertLeaderboardHasWinner(
    conn: Connection,
    modeU8: number,
    winner: string,
    expectedHeight: number,
): Promise<void> {
    const modeByte = new Uint8Array([modeU8 & 0xff]);
    const [pda] = findProgramAddress([SEEDS.LEADERBOARD, modeByte], PROGRAM_ID);
    const info = await conn.getAccountInfo(new PublicKey(pda));
    if (!info) {
        console.log(`${TAG} FAIL leaderboard PDA missing for mode=${modeU8} pda=${pda} — did you run init-leaderboards?`);
        process.exit(1);
    }
    const raw = info.data;
    let o = 8; // skip Anchor discriminator
    for (let rank = 0; rank < 10; rank++) {
        const playerBytes = raw.slice(o, o + 32); o += 32;
        const h = raw[o]; o += 1;
        o += 8; // settled_at
        if (h === 0) continue;
        const player = new PublicKey(playerBytes).toBase58();
        if (player === winner) {
            if (h !== expectedHeight) {
                console.log(`${TAG} FAIL leaderboard mode=${modeU8}: winner found at rank=${rank + 1} but height=${h} expected=${expectedHeight}`);
                process.exit(1);
            }
            return; // found and height matches
        }
    }
    console.log(`${TAG} FAIL leaderboard mode=${modeU8} does not contain winner=${winner}`);
    process.exit(1);
}

main().catch((e) => {
    console.log(`${TAG} UNHANDLED error=${e?.message ?? e}\n${e?.stack ?? ''}`);
    process.exit(1);
});
