/**
 * Token Duel backend — Express + ws entry point.
 *
 * Responsibilities:
 *   - POST /session/start  → create session, return sessionId + serverPubkey.
 *   - WS   /session/:id/stream  → receive drop events + finalize; emit acks + receipt.
 *   - GET  /health         → 200 OK for Railway / Fly healthchecks.
 *   - GET  /pubkey         → reveal server's Ed25519 pubkey (for client sanity).
 *
 * Single-process design: all session state lives in memory. For multi-replica
 * scale, put sticky routing on sessionId in front.
 */

import 'dotenv/config';
import cors from 'cors';
import express, { Request, Response } from 'express';
import http from 'http';
import { Connection, PublicKey } from '@solana/web3.js';
import { WebSocketServer, WebSocket } from 'ws';

import { ReceiptSigner } from './signer';
import { SessionManager } from './session';
import { StartSessionRequest, StartSessionResponse, WsInbound, WsOutbound } from './types';
import { renderSharecard, MatchSummary } from './sharecard';
import { trophyMetadataJson } from './nft';
import { adminRouter } from './admin';
import { StatsBucket } from './stats';
import { TokenStatsBucket } from './token_stats';
import { RakeListener } from './rake_listener';
import { NotificationStore } from './notification_store';
import { NotificationListener } from './notification_listener';
import { TournamentHost } from './tournament_host';
import { ping as dbPing, dbConfigured, closePool } from './db';
import { runMigrations } from './migrate';
import { getUser, setUsername, touchUser, validateUsername } from './users';
import { getPaperXp, recordPaperMatch, type PaperTrack } from './paper_xp';
import { recordMatch, listForPlayer, type MatchHistoryRecord } from './match_history';
import { recordLobby, type MatchLobbyRecord } from './match_lobbies';
import {
    registerActive as registerPaperMatch,
    updateHeights as updatePaperMatchHeights,
    deleteActive as deletePaperMatch,
    listActiveForUser as listPaperMatchesForUser,
} from './paper_match_active';
import {
    recordPaperMatch as recordPaperMatchHistory,
    listForUser as listPaperMatchHistoryForUser,
    type PaperMatchHistoryRecord,
} from './paper_match_history';
import { RPC_URL } from '../../assets/token-duel/scripts/constants';
import { PROGRAM_ID } from '../../assets/token-duel/scripts/constants';
import * as path from 'path';

const TAG = '[server]';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_SESSIONS ?? 500);
const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY ?? '';
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim());

const signer = new ReceiptSigner();
const sessions = new SessionManager(BIRDEYE_KEY, MAX_CONCURRENT);
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(
    cors({
        origin: CORS_ORIGINS.length === 1 && CORS_ORIGINS[0] === '*' ? '*' : CORS_ORIGINS,
        credentials: false,
    }),
);

app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        sessions: sessions.stats(),
        uptimeSec: Math.floor(process.uptime()),
        dbConfigured: dbConfigured(),
    });
});

// DB Stage 1 — DB-specific health probe. Exposes pool latency for monitoring.
app.get('/health/db', async (_req, res) => {
    const result = await dbPing();
    res.status(result.ok ? 200 : 503).json(result);
});

// DB Stage 2 — user profile lookup. Returns 404 if user hasn't been seen yet.
app.get('/users/:pubkey', async (req: Request, res: Response) => {
    try {
        const pubkey = req.params.pubkey;
        try { new PublicKey(pubkey); } catch { return res.status(400).json({ error: 'invalid pubkey' }); }
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });
        const user = await getUser(pubkey);
        if (!user) return res.status(404).json({ error: 'user not found' });
        return res.json({
            pubkey: user.pubkey,
            username: user.username,
            joinedAt: user.joined_at,
            lastSeenAt: user.last_seen_at,
        });
    } catch (e: any) {
        console.log(`${TAG} GET /users/:pubkey error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

// DB Stage 3 — paper/bot XP read.
app.get('/paper-xp/:pubkey', async (req: Request, res: Response) => {
    try {
        const pubkey = req.params.pubkey;
        try { new PublicKey(pubkey); } catch { return res.status(400).json({ error: 'invalid pubkey' }); }
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });
        const row = await getPaperXp(pubkey);
        if (!row) {
            // Returning zeros (rather than 404) keeps the client chip happy on
            // a brand-new wallet without a special-case branch.
            return res.json({
                pubkey,
                totalXp: 0, botXp: 0, paperRealXp: 0,
                gamesPlayed: 0, wins: 0, losses: 0,
            });
        }
        return res.json({
            pubkey: row.pubkey,
            totalXp: Number(row.total_xp),
            botXp: Number(row.bot_xp),
            paperRealXp: Number(row.paper_real_xp),
            gamesPlayed: row.games_played,
            wins: row.wins,
            losses: row.losses,
            lastUpdated: row.last_updated,
        });
    } catch (e: any) {
        console.log(`${TAG} GET /paper-xp/:pubkey error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

// DB Stage 3 — paper/bot XP delta upload after match resolves.
app.post('/paper-xp/:pubkey', async (req: Request, res: Response) => {
    try {
        const pubkey = req.params.pubkey;
        const body = req.body as { xp?: number; track?: string; won?: boolean };
        try { new PublicKey(pubkey); } catch { return res.status(400).json({ error: 'invalid pubkey' }); }
        if (!body || typeof body.xp !== 'number' || typeof body.won !== 'boolean') {
            return res.status(400).json({ error: 'body must include { xp:number, track:"bot"|"paper-real", won:boolean }' });
        }
        if (body.track !== 'bot' && body.track !== 'paper-real') {
            return res.status(400).json({ error: 'track must be "bot" or "paper-real"' });
        }
        if (body.xp < 0 || body.xp > 100_000) {
            return res.status(400).json({ error: 'xp delta out of bounds (0..100000)' });
        }
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });
        const row = await recordPaperMatch(pubkey, {
            xp: Math.floor(body.xp),
            track: body.track as PaperTrack,
            won: body.won,
        });
        return res.json({
            pubkey: row.pubkey,
            totalXp: Number(row.total_xp),
            botXp: Number(row.bot_xp),
            paperRealXp: Number(row.paper_real_xp),
            gamesPlayed: row.games_played,
        });
    } catch (e: any) {
        console.log(`${TAG} POST /paper-xp/:pubkey error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

// DB Stage 4 — match history list (per-player).
app.get('/matches/history', async (req: Request, res: Response) => {
    try {
        const player = String(req.query.player ?? '');
        const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100);
        try { new PublicKey(player); } catch { return res.status(400).json({ error: 'invalid player pubkey' }); }
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });
        const rows = await listForPlayer(player, limit);
        return res.json({ player, count: rows.length, matches: rows });
    } catch (e: any) {
        console.log(`${TAG} GET /matches/history error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

// DB Stage 6 — open-lobby insert (idempotent on match_pda).
// Client-uploaded immediately after `join_match_create` confirms. Powers
// funnel analytics; on-chain stays authoritative for live discovery.
app.post('/matches/lobby', async (req: Request, res: Response) => {
    try {
        const body = req.body as Partial<MatchLobbyRecord>;
        if (!body || typeof body.matchPda !== 'string' || body.matchPda.length < 32) {
            return res.status(400).json({ error: 'matchPda required' });
        }
        if (typeof body.creatorPubkey !== 'string' || body.creatorPubkey.length < 32) {
            return res.status(400).json({ error: 'creatorPubkey required' });
        }
        if (typeof body.modeU8 !== 'number' || body.modeU8 < 0 || body.modeU8 > 3) {
            return res.status(400).json({ error: 'modeU8 must be 0..3' });
        }
        if (typeof body.wagerLamports !== 'number' || body.wagerLamports < 0) {
            return res.status(400).json({ error: 'wagerLamports must be non-negative number' });
        }
        if (typeof body.requiredPlayers !== 'number' || body.requiredPlayers < 2 || body.requiredPlayers > 10) {
            return res.status(400).json({ error: 'requiredPlayers must be 2..10' });
        }
        try { new PublicKey(body.matchPda); new PublicKey(body.creatorPubkey); }
        catch { return res.status(400).json({ error: 'malformed pubkey' }); }
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });

        const result = await recordLobby({
            matchPda: body.matchPda,
            creatorPubkey: body.creatorPubkey,
            modeU8: body.modeU8,
            wagerTier: body.wagerTier ?? 0,
            wagerLamports: body.wagerLamports,
            timeWindow: body.timeWindow ?? 0,
            requiredPlayers: body.requiredPlayers,
            createdAt: body.createdAt ?? new Date().toISOString(),
        });
        void touchUser(body.creatorPubkey).catch(() => {});
        return res.json({ ok: true, ...result });
    } catch (e: any) {
        console.log(`${TAG} POST /matches/lobby error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

// DB Stage 4 — match history insert (idempotent on match_pda).
// Client-uploaded after settle. Trust model documented in match_history.ts.
app.post('/matches/history', async (req: Request, res: Response) => {
    try {
        const body = req.body as Partial<MatchHistoryRecord> & { squadMintsByPlayer?: Record<string, string[]> };
        if (!body || typeof body.matchPda !== 'string' || body.matchPda.length < 32) {
            return res.status(400).json({ error: 'matchPda required' });
        }
        if (typeof body.modeU8 !== 'number' || body.modeU8 < 0 || body.modeU8 > 3) {
            return res.status(400).json({ error: 'modeU8 must be 0..3' });
        }
        if (!Array.isArray(body.players) || !Array.isArray(body.heights)) {
            return res.status(400).json({ error: 'players[] and heights[] required' });
        }
        try { new PublicKey(body.matchPda); for (const p of body.players) new PublicKey(p); }
        catch { return res.status(400).json({ error: 'malformed pubkey' }); }
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });

        const result = await recordMatch({
            matchPda: body.matchPda,
            modeU8: body.modeU8,
            wagerTier: body.wagerTier ?? 0,
            wagerLamports: body.wagerLamports ?? 0,
            timeWindow: body.timeWindow ?? 0,
            players: body.players,
            heights: body.heights,
            winnerPubkey: body.winnerPubkey ?? null,
            payouts: Array.isArray(body.payouts) ? body.payouts : [],
            rakeLamports: body.rakeLamports ?? 0,
            status: body.status ?? 2,
            createdAt: body.createdAt ?? new Date().toISOString(),
            startedAt: body.startedAt ?? null,
            settledAt: body.settledAt ?? new Date().toISOString(),
        }, body.squadMintsByPlayer);

        // Touch participating users so their last_seen_at refreshes.
        for (const p of body.players) {
            void touchUser(p).catch(() => {});
        }
        return res.json({ ok: true, ...result });
    } catch (e: any) {
        console.log(`${TAG} POST /matches/history error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

// DB Stage 7 — paper / bot in-flight match tracking. Signed-in users post
// here when a paper match starts so MIP shows them cross-device. Guests
// don't hit this — their matches stay in client memory.
app.post('/paper-match/active', async (req: Request, res: Response) => {
    try {
        const body = req.body as {
            id?: string; pubkey?: string; modeU8?: number; timeWindow?: number;
            requiredPlayers?: number; track?: string; durationMs?: number;
        };
        if (!body || typeof body.id !== 'string' || body.id.length < 4) {
            return res.status(400).json({ error: 'id required' });
        }
        if (typeof body.pubkey !== 'string' || body.pubkey.length < 32) {
            return res.status(400).json({ error: 'pubkey required' });
        }
        try { new PublicKey(body.pubkey); }
        catch { return res.status(400).json({ error: 'malformed pubkey' }); }
        if (typeof body.modeU8 !== 'number' || body.modeU8 < 0 || body.modeU8 > 3) {
            return res.status(400).json({ error: 'modeU8 must be 0..3' });
        }
        if (typeof body.timeWindow !== 'number' || body.timeWindow < 0 || body.timeWindow > 5) {
            return res.status(400).json({ error: 'timeWindow must be 0..5' });
        }
        if (typeof body.requiredPlayers !== 'number' || body.requiredPlayers < 2 || body.requiredPlayers > 8) {
            return res.status(400).json({ error: 'requiredPlayers must be 2..8' });
        }
        if (body.track !== 'bot' && body.track !== 'paper-real') {
            return res.status(400).json({ error: "track must be 'bot' or 'paper-real'" });
        }
        if (typeof body.durationMs !== 'number' || body.durationMs <= 0) {
            return res.status(400).json({ error: 'durationMs must be > 0' });
        }
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });

        const row = await registerPaperMatch({
            id: body.id,
            pubkey: body.pubkey,
            modeU8: body.modeU8,
            timeWindow: body.timeWindow,
            requiredPlayers: body.requiredPlayers,
            track: body.track,
            durationMs: body.durationMs,
        });
        return res.json({ ok: true, row });
    } catch (e: any) {
        console.log(`${TAG} POST /paper-match/active error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

app.patch('/paper-match/active/:id/heights', async (req: Request, res: Response) => {
    try {
        const id = req.params.id ?? '';
        if (id.length < 4) return res.status(400).json({ error: 'id required' });
        const body = req.body as { lastHeight?: number; lastBotHeights?: number[] };
        if (typeof body?.lastHeight !== 'number') {
            return res.status(400).json({ error: 'lastHeight (number) required' });
        }
        if (!Array.isArray(body?.lastBotHeights) || body.lastBotHeights.some((n) => typeof n !== 'number')) {
            return res.status(400).json({ error: 'lastBotHeights (number[]) required' });
        }
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });
        await updatePaperMatchHeights(id, body.lastHeight, body.lastBotHeights);
        return res.json({ ok: true });
    } catch (e: any) {
        console.log(`${TAG} PATCH /paper-match/active/:id/heights error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

app.delete('/paper-match/active/:id', async (req: Request, res: Response) => {
    try {
        const id = req.params.id ?? '';
        if (id.length < 4) return res.status(400).json({ error: 'id required' });
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });
        await deletePaperMatch(id);
        return res.json({ ok: true });
    } catch (e: any) {
        console.log(`${TAG} DELETE /paper-match/active/:id error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

app.get('/paper-match/active/:pubkey', async (req: Request, res: Response) => {
    try {
        const pubkey = req.params.pubkey ?? '';
        try { new PublicKey(pubkey); }
        catch { return res.status(400).json({ error: 'malformed pubkey' }); }
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });
        const rows = await listPaperMatchesForUser(pubkey);
        return res.json({ rows });
    } catch (e: any) {
        console.log(`${TAG} GET /paper-match/active/:pubkey error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

// DB Stage 8 — paper / bot finished match per-match history. Signed-in users
// post here on settle / forfeit so a "Match History" UI can show their full
// off-chain history (mode, window, track, placement, XP earned). Guests skip.
app.post('/paper-match/history', async (req: Request, res: Response) => {
    try {
        const body = req.body as Partial<PaperMatchHistoryRecord>;
        if (!body || typeof body.id !== 'string' || body.id.length < 4) {
            return res.status(400).json({ error: 'id required' });
        }
        if (typeof body.pubkey !== 'string' || body.pubkey.length < 32) {
            return res.status(400).json({ error: 'pubkey required' });
        }
        try { new PublicKey(body.pubkey); }
        catch { return res.status(400).json({ error: 'malformed pubkey' }); }
        if (typeof body.modeU8 !== 'number' || body.modeU8 < 0 || body.modeU8 > 3) {
            return res.status(400).json({ error: 'modeU8 must be 0..3' });
        }
        if (typeof body.timeWindow !== 'number' || body.timeWindow < 0 || body.timeWindow > 5) {
            return res.status(400).json({ error: 'timeWindow must be 0..5' });
        }
        if (typeof body.requiredPlayers !== 'number' || body.requiredPlayers < 2 || body.requiredPlayers > 8) {
            return res.status(400).json({ error: 'requiredPlayers must be 2..8' });
        }
        if (body.track !== 'bot' && body.track !== 'paper-real') {
            return res.status(400).json({ error: "track must be 'bot' or 'paper-real'" });
        }
        if (!Array.isArray(body.players) || !Array.isArray(body.heights)) {
            return res.status(400).json({ error: 'players[] and heights[] required' });
        }
        if (body.players.length !== body.heights.length) {
            return res.status(400).json({ error: 'players/heights length mismatch' });
        }
        if (typeof body.myHeight !== 'number' || typeof body.placement !== 'number'
            || typeof body.totalPlayers !== 'number' || typeof body.won !== 'boolean'
            || typeof body.xpGained !== 'number') {
            return res.status(400).json({ error: 'myHeight/placement/totalPlayers/won/xpGained required' });
        }
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });

        const result = await recordPaperMatchHistory({
            id: body.id,
            pubkey: body.pubkey,
            modeU8: body.modeU8,
            timeWindow: body.timeWindow,
            requiredPlayers: body.requiredPlayers,
            track: body.track,
            players: body.players,
            heights: body.heights,
            myHeight: body.myHeight,
            winnerPubkey: body.winnerPubkey ?? null,
            placement: body.placement,
            totalPlayers: body.totalPlayers,
            won: body.won,
            xpGained: body.xpGained,
            startedAt: body.startedAt ?? new Date().toISOString(),
            settledAt: body.settledAt ?? new Date().toISOString(),
        });
        return res.json({ ok: true, ...result });
    } catch (e: any) {
        console.log(`${TAG} POST /paper-match/history error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

app.get('/paper-match/history/:pubkey', async (req: Request, res: Response) => {
    try {
        const pubkey = req.params.pubkey ?? '';
        try { new PublicKey(pubkey); }
        catch { return res.status(400).json({ error: 'malformed pubkey' }); }
        const limit = Number.parseInt(String(req.query.limit ?? '50'), 10);
        const offset = Number.parseInt(String(req.query.offset ?? '0'), 10);
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });
        const rows = await listPaperMatchHistoryForUser(pubkey, limit, offset);
        return res.json({ rows });
    } catch (e: any) {
        console.log(`${TAG} GET /paper-match/history/:pubkey error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

// DB Stage 2 — set username for a pubkey. Returns 409 if name is taken,
// 400 if invalid. NOTE: this endpoint does NOT verify that the caller
// actually owns the pubkey — for hackathon scope we trust the client. A
// production version should require a signed message proving ownership.
app.post('/users/:pubkey/username', async (req: Request, res: Response) => {
    try {
        const pubkey = req.params.pubkey;
        const body = req.body as { username?: string };
        try { new PublicKey(pubkey); } catch { return res.status(400).json({ error: 'invalid pubkey' }); }
        if (!body || typeof body.username !== 'string') {
            return res.status(400).json({ error: 'body must include username (string)' });
        }
        const validation = validateUsername(body.username);
        if (!validation.ok) return res.status(400).json({ error: validation.error });
        if (!dbConfigured()) return res.status(503).json({ error: 'db not configured' });
        try {
            const updated = await setUsername(pubkey, body.username);
            return res.json({ pubkey: updated.pubkey, username: updated.username });
        } catch (e: any) {
            const msg = String(e?.message ?? e);
            if (msg.includes('already taken')) return res.status(409).json({ error: msg });
            throw e;
        }
    } catch (e: any) {
        console.log(`${TAG} POST /users/:pubkey/username error | ${e?.message ?? e}`);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

app.get('/pubkey', (_req, res) => {
    res.json({ pubkey: signer.pubkey.toBase58() });
});

/**
 * Phase F2 — direct receipt signing for betting-duel real-track matches.
 *
 * The legacy /session/start + WS path was tied to stack-jump physics
 * (drop-event validation). Betting-duel never streams drops, so finalize()
 * always rejected with "claimed != observed". This endpoint sidesteps the
 * session machinery: clients POST { matchPda, playerPubkey, height,
 * signedAt? } and get back a signed Ed25519 receipt that satisfies
 * `settle_match_verified`. Backend currently signs in attestation mode
 * (no independent height validation) — verification proves the backend
 * was reachable, which is what onchain enforces. Future Phase K can add
 * independent Birdeye recompute for full anti-cheat.
 */
app.post('/receipts/sign', (req: Request, res: Response) => {
    try {
        const body = req.body as { matchPda?: string; playerPubkey?: string; height?: number; signedAt?: number };
        if (!body || typeof body.matchPda !== 'string' || typeof body.playerPubkey !== 'string') {
            return res.status(400).json({ error: 'matchPda + playerPubkey required' });
        }
        if (typeof body.height !== 'number' || !Number.isInteger(body.height) || body.height < 0 || body.height > 0xffffffff) {
            return res.status(400).json({ error: 'height must be u32' });
        }
        let matchPk: PublicKey, playerPk: PublicKey;
        try { matchPk = new PublicKey(body.matchPda); playerPk = new PublicKey(body.playerPubkey); }
        catch { return res.status(400).json({ error: 'malformed pubkey' }); }
        const signedAt = typeof body.signedAt === 'number' && Number.isFinite(body.signedAt)
            ? Math.floor(body.signedAt)
            : Math.floor(Date.now() / 1000);
        const { ixDataB64 } = signer.sign({ matchPda: matchPk, player: playerPk, height: body.height, signedAt });
        // Track for admin dashboard.
        StatsBucket.bumpReceipt({
            matchPda: matchPk.toBase58(),
            player: playerPk.toBase58(),
            height: body.height,
            at: signedAt,
            verified: true,
        });
        console.log(`${TAG} /receipts/sign OK match=${matchPk.toBase58().slice(0, 8)}... player=${playerPk.toBase58().slice(0, 8)}... height=${body.height} signed_at=${signedAt}`);
        return res.json({ ed25519IxDataB64: ixDataB64, signedAt, height: body.height });
    } catch (e: any) {
        console.error(`${TAG} /receipts/sign ERROR`, e);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

// ═════════════════════════════════════════════════════════════════════
// Part 12 Bundle B — admin live dashboard
// Seeds StatsBucket context so /admin/stream can show server pubkey + tree.
// Mounts: /admin (static HTML/CSS/JS) + /admin/stream (SSE) + / → /admin redirect.
// ═════════════════════════════════════════════════════════════════════

StatsBucket.setContext(signer.pubkey.toBase58(), process.env.TROPHY_TREE_ADDRESS ?? '');
app.use('/admin', express.static(path.resolve(__dirname, '..', 'public')));
app.use(adminRouter());
app.get('/', (_req, res) => res.redirect('/admin'));

// ═════════════════════════════════════════════════════════════════════
// Part 13 B — rake listener + per-token analytics
// Subscribes to program logs, parses SettleMatch.FINAL msgs, bumps
// StatsBucket + TokenStatsBucket so the admin dashboard tracks rake +
// per-mint winrate in real time.
// ═════════════════════════════════════════════════════════════════════

const rakeConnection = new Connection(RPC_URL, 'confirmed');
const tokenStats = new TokenStatsBucket();
const rakeListener = new RakeListener({
    connection: rakeConnection,
    programId: new PublicKey(PROGRAM_ID),
    sessions,
    tokenStats,
});
void rakeListener.start();

// ═════════════════════════════════════════════════════════════════════
// Phase N5 — Notification listener + store.
// Listens to the same program logs as RakeListener but parses different
// patterns (JoinMatch.JOIN, SettleMatch.FINAL, CancelMatch) into
// notification events keyed by recipient pubkey. Live delivery via WS
// `/notifications/:pubkey/stream`; cold-launch catchup via REST
// `/notifications/:pubkey?since=<ts>`.
// ═════════════════════════════════════════════════════════════════════

const notificationStore = new NotificationStore();
const notificationListener = new NotificationListener({
    connection: rakeConnection,
    programId: new PublicKey(PROGRAM_ID),
    store: notificationStore,
});
void notificationListener.start();

app.get('/notifications/:pubkey', async (req: Request, res: Response) => {
    try {
        const pubkey = req.params.pubkey;
        if (!pubkey || pubkey.length < 32 || pubkey.length > 44) {
            return res.status(400).json({ error: 'invalid pubkey' });
        }
        try { new PublicKey(pubkey); }
        catch { return res.status(400).json({ error: 'malformed pubkey' }); }
        const since = Number(req.query.since ?? 0);
        const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 50)));
        const events = await notificationStore.getRecent(pubkey, Number.isFinite(since) ? since : 0, limit);
        return res.json({ events });
    } catch (e: any) {
        console.error(`${TAG} GET /notifications ERROR`, e);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

app.post('/notifications/:pubkey/:id/read', (req: Request, res: Response) => {
    try {
        const pubkey = req.params.pubkey;
        const id = req.params.id;
        if (!pubkey || pubkey.length < 32 || pubkey.length > 44) {
            return res.status(400).json({ error: 'invalid pubkey' });
        }
        try { new PublicKey(pubkey); }
        catch { return res.status(400).json({ error: 'malformed pubkey' }); }
        const ok = notificationStore.markRead(pubkey, id);
        return res.json({ ok });
    } catch (e: any) {
        console.error(`${TAG} POST /notifications/:id/read ERROR`, e);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

// Expose public /fees route as a clean alias to the static HTML page.
app.get('/fees', (_req, res) => res.redirect('/fees.html'));
// Also expose /admin/tokens JSON for direct inspection.
// DB Stage 5 — falls back to in-memory TokenStatsBucket when DB not configured
// or when the requested week has no rows yet (fresh DB after deploy).
app.get('/admin/tokens', async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10)));
    const week = String(req.query.week ?? '');
    try {
        if (dbConfigured()) {
            const { topTokensByWeek, isoWeek } = await import('./match_history');
            const w = week || isoWeek(new Date());
            const dbRows = await topTokensByWeek(w, limit);
            if (dbRows.length > 0) {
                return res.json({ tokens: dbRows, source: 'db', week: w });
            }
        }
    } catch (e: any) {
        console.log(`${TAG} /admin/tokens db_err | ${e?.message ?? e} — falling back to in-memory`);
    }
    res.json({ tokens: tokenStats.getTopTokens(limit), source: 'memory' });
});

// ═════════════════════════════════════════════════════════════════════
// Part 14 A — Tournament host cron
// Seeds a BR10 match every TOURNAMENT_CADENCE_MS using a dedicated host
// keypair as player 0. Host's stake subsidizes the winner pot (prize
// seed bonus); `force_settle` after 5 min redistributes to real players.
// ═════════════════════════════════════════════════════════════════════

if (process.env.TOURNAMENT_CRON_ENABLED !== 'false' && process.env.TOURNAMENT_HOST_SECRET) {
    try {
        const cadenceMs = Number(process.env.TOURNAMENT_CADENCE_MS ?? 15 * 60_000);
        const stakeTierIndex = process.env.TOURNAMENT_STAKE_TIER !== undefined
            ? Number(process.env.TOURNAMENT_STAKE_TIER)
            : undefined;
        const host = new TournamentHost({
            connection: rakeConnection,
            hostSecretB58: process.env.TOURNAMENT_HOST_SECRET,
            cadenceMs,
            stakeTierIndex,
        });
        host.start();
        // Expose the host's pubkey to client-side discovery via a tiny JSON.
        const hostPk = host.hostPubkey.toBase58();
        app.get('/tournaments/host', (_req, res) => res.json({ host: hostPk, cadenceMs }));
        StatsBucket.setTournamentHost(hostPk);
    } catch (e: any) {
        console.warn(`${TAG} tournament host startup failed: ${e?.message ?? e}`);
    }
} else {
    console.log(`${TAG} tournament cron disabled (TOURNAMENT_CRON_ENABLED=${process.env.TOURNAMENT_CRON_ENABLED ?? 'unset'} TOURNAMENT_HOST_SECRET=${process.env.TOURNAMENT_HOST_SECRET ? 'set' : 'unset'})`);
}

// ═════════════════════════════════════════════════════════════════════
// Part 11 Bundle A — share card PNG for Twitter/X
// ═════════════════════════════════════════════════════════════════════

/**
 * LRU-ish cache of rendered PNGs keyed by matchPda. 12-hr TTL; cap 2000.
 * No real LRU eviction on every access — we just sweep oldest when full.
 */
interface CacheEntry { png: Buffer; summary: MatchSummary; createdAt: number; }
const sharecardCache = new Map<string, CacheEntry>();
const SHARECARD_TTL_MS = 12 * 60 * 60 * 1000;
const SHARECARD_CACHE_MAX = 2000;

function sweepSharecardCache(): void {
    if (sharecardCache.size <= SHARECARD_CACHE_MAX) return;
    const entries = Array.from(sharecardCache.entries())
        .sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toDrop = entries.slice(0, entries.length - SHARECARD_CACHE_MAX);
    for (const [k] of toDrop) sharecardCache.delete(k);
    console.log(`${TAG} sharecard | sweep removed=${toDrop.length} remaining=${sharecardCache.size}`);
}

app.get('/sharecard/:matchPda.png', async (req: Request, res: Response) => {
    const matchPda = req.params.matchPda;
    if (!matchPda || matchPda.length < 32 || matchPda.length > 44) {
        return res.status(400).send('invalid matchPda');
    }

    // Cache check.
    const cached = sharecardCache.get(matchPda);
    if (cached && Date.now() - cached.createdAt < SHARECARD_TTL_MS) {
        res.set({
            'content-type': 'image/png',
            'cache-control': 'public, max-age=43200',
            'x-sharecard-cache': 'HIT',
        });
        return res.send(cached.png);
    }

    // For v1 we accept summary via query params rather than RPC-fetching the
    // Match account (keeps render service standalone + testable). Production
    // flow: client populates these from the PostMatchPanel state.
    const summary = parseMatchSummaryFromQuery(matchPda, req.query);
    if (!summary) {
        return res.status(400).send('missing summary query params — supply placement, requiredPlayers, height, payoutLamports, wagerLamports, modeLabel, timeWindowLabel, track, squadSymbols, squadDeltas, verified');
    }

    try {
        const png = renderSharecard(summary);
        sharecardCache.set(matchPda, { png, summary, createdAt: Date.now() });
        sweepSharecardCache();
        res.set({
            'content-type': 'image/png',
            'cache-control': 'public, max-age=43200',
            'x-sharecard-cache': 'MISS',
        });
        return res.send(png);
    } catch (e: any) {
        console.error(`${TAG} /sharecard | RENDER_ERROR`, e);
        return res.status(500).send('render failed');
    }
});

// ═════════════════════════════════════════════════════════════════════
// Part 11 Bundle B — NFT trophy metadata JSON
// Served directly so Metaplex / Phantom can resolve token metadata without
// needing external hosting (IPFS/Arweave). URL pattern matches what
// `nft.ts::mintTrophy` bakes into the on-chain metadata's `uri` field.
// ═════════════════════════════════════════════════════════════════════

app.get('/metadata/:weekId/:rank.json', (req: Request, res: Response) => {
    const weekId = parseInt(req.params.weekId, 10);
    const rank = parseInt(req.params.rank.replace('.json', ''), 10);
    if (!Number.isFinite(weekId) || weekId < 0) return res.status(400).send('invalid weekId');
    if (!Number.isFinite(rank) || rank < 1 || rank > 3) return res.status(400).send('rank must be 1/2/3');

    // Wins count not known here without an RPC lookup to the Season PDA.
    // For v1 we leave it 0 and let the image tell the full story. Cron can
    // POST /admin/cache-metadata if we later want accurate wins in the JSON.
    const protocol = (req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http') as string;
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? `localhost:${PORT}`;
    const imageBaseUrl = `${protocol}://${host}`;
    const body = trophyMetadataJson(weekId, rank, 0, imageBaseUrl);
    res.set({
        'content-type': 'application/json',
        'cache-control': 'public, max-age=604800', // 7 days — rank metadata is immutable
    });
    return res.json(body);
});

function parseMatchSummaryFromQuery(matchPda: string, q: any): MatchSummary | null {
    try {
        const placement = parseInt(q.placement ?? '0', 10);
        const requiredPlayers = parseInt(q.requiredPlayers ?? '2', 10);
        const height = parseInt(q.height ?? '0', 10);
        const payoutLamports = BigInt(q.payoutLamports ?? '0');
        const wagerLamports = BigInt(q.wagerLamports ?? '0');
        const modeLabel = String(q.modeLabel ?? '1v1 Duel');
        const timeWindowLabel = String(q.timeWindowLabel ?? '24h');
        const track = (q.track === 'real' ? 'real' : 'paper') as 'real' | 'paper';
        const squadSymbolsRaw = String(q.squadSymbols ?? 'SOL,SOL,SOL').split(',');
        const squadDeltasRaw = String(q.squadDeltas ?? '0,0,0').split(',').map((x) => parseFloat(x));
        const playerPubkey = String(q.playerPubkey ?? '');
        const playerShortName = String(q.playerShortName ?? (playerPubkey.slice(0, 4) + '...' + playerPubkey.slice(-4)));
        const verified = q.verified === 'true' || q.verified === '1';
        return {
            matchPda, playerPubkey, playerShortName,
            placement, requiredPlayers, height,
            payoutLamports, wagerLamports,
            modeLabel, timeWindowLabel, track,
            squadSymbols: [squadSymbolsRaw[0] ?? 'SOL', squadSymbolsRaw[1] ?? 'SOL', squadSymbolsRaw[2] ?? 'SOL'],
            squadDeltas: [squadDeltasRaw[0] ?? 0, squadDeltasRaw[1] ?? 0, squadDeltasRaw[2] ?? 0],
            verified,
        };
    } catch (e) {
        return null;
    }
}

/**
 * betting-duel live opponent delta — client POSTs its 3 squad mints after
 * Real-match commit. Backend stores + fans out to any WS subscribers on
 * this matchPda. Both clients then compute opponent live delta locally via
 * the same Birdeye price feed they already poll for their own squad.
 */
app.post('/match/:matchPda/publish-squad', (req: Request, res: Response) => {
    try {
        const matchPda = req.params.matchPda;
        const body = req.body as { playerPubkey?: string; mints?: string[] };
        if (!matchPda || matchPda.length < 32 || matchPda.length > 44) {
            return res.status(400).json({ error: 'invalid matchPda in path' });
        }
        if (!body || typeof body.playerPubkey !== 'string' || !Array.isArray(body.mints)) {
            return res.status(400).json({ error: 'body must include playerPubkey + mints[]' });
        }
        try { new PublicKey(matchPda); new PublicKey(body.playerPubkey); for (const m of body.mints) new PublicKey(m); }
        catch { return res.status(400).json({ error: 'malformed pubkey' }); }

        const result = sessions.publishMatchSquad(matchPda, body.playerPubkey, body.mints);
        if (!result.ok) return res.status(400).json({ error: result.reason });
        // DB Stage 2 — auto-create / touch user row on every interaction.
        // Fire-and-forget; DB unavailability shouldn't block the squad publish.
        void touchUser(body.playerPubkey).catch((e) =>
            console.log(`${TAG} touchUser_err | ${e?.message ?? e}`),
        );
        return res.json({ ok: true });
    } catch (e: any) {
        console.error(`${TAG} /match/:pda/publish-squad ERROR`, e);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

app.post('/session/start', async (req: Request, res: Response) => {
    try {
        const body = req.body as StartSessionRequest;
        const match = validateStartRequest(body);
        if (!match.ok) return res.status(400).json({ error: match.reason });

        const created = await sessions.create(body);
        if (!created.ok) return res.status(503).json({ error: created.reason });

        const wsUrl = pickWsUrl(req, created.state.id);
        const resp: StartSessionResponse = {
            sessionId: created.state.id,
            serverPubkey: signer.pubkey.toBase58(),
            wsUrl,
            expectedWidths: created.state.expectedWidths,
            startedAt: created.state.startedAt,
        };
        return res.json(resp);
    } catch (e: any) {
        console.error(`${TAG} /session/start ERROR`, e);
        return res.status(500).json({ error: e?.message ?? 'internal error' });
    }
});

function validateStartRequest(body: any): { ok: true } | { ok: false; reason: string } {
    if (!body || typeof body !== 'object') return { ok: false, reason: 'body must be json object' };
    const pks: string[] = [body.matchPda, body.playerPubkey, ...(body.squadMints ?? [])];
    for (const pk of pks) {
        if (typeof pk !== 'string' || pk.length < 32 || pk.length > 44) {
            return { ok: false, reason: `invalid base58 pubkey: ${pk}` };
        }
        try { new PublicKey(pk); } catch { return { ok: false, reason: `invalid pubkey: ${pk}` }; }
    }
    if (!Array.isArray(body.squadMints) || body.squadMints.length !== 3) {
        return { ok: false, reason: 'squadMints must be a 3-element array' };
    }
    if (!['1h', '1d', '3d', '7d'].includes(body.timeWindow)) {
        return { ok: false, reason: `timeWindow must be 1h|1d|3d|7d (got ${body.timeWindow})` };
    }
    return { ok: true };
}

function pickWsUrl(req: Request, sessionId: string): string {
    const proto = (req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http') as string;
    const wsProto = proto === 'https' ? 'wss' : 'ws';
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? `localhost:${PORT}`;
    return `${wsProto}://${host}/session/${sessionId}/stream`;
}

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';

    // Session stream (player): /session/:sessionId/stream
    const sessionStream = url.match(/^\/session\/([^/]+)\/stream$/);
    if (sessionStream) {
        const sessionId = sessionStream[1];
        const state = sessions.get(sessionId);
        if (!state) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => attachSession(ws, sessionId));
        return;
    }

    // Part 12 D: spectator stream (read-only): /match/:matchPda/spectate
    // betting-duel: if no session-backed match, still accept subscriber for
    // the squad-publication channel (live opponent delta).
    const specMatch = url.match(/^\/match\/([^/]+)\/spectate$/);
    if (specMatch) {
        const matchPda = specMatch[1];
        const sessionId = sessions.getSessionIdByMatchPda(matchPda);
        if (sessionId) {
            wss.handleUpgrade(request, socket, head, (ws) => attachSpectator(ws, sessionId, matchPda));
        } else {
            wss.handleUpgrade(request, socket, head, (ws) => attachMatchSpectator(ws, matchPda));
        }
        return;
    }

    // Phase N5 — notification stream per pubkey: /notifications/:pubkey/stream
    const notifStream = url.match(/^\/notifications\/([^/]+)\/stream$/);
    if (notifStream) {
        const pubkey = notifStream[1];
        try { new PublicKey(pubkey); }
        catch {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => attachNotificationSubscriber(ws, pubkey));
        return;
    }

    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
});

/** Phase N5 — bind a WebSocket to the notification store for a given player. */
function attachNotificationSubscriber(ws: WebSocket, pubkey: string): void {
    const unsubscribe = notificationStore.subscribe(pubkey, ws);
    console.log(`${TAG} notif_subscriber OPEN pubkey=${pubkey.slice(0, 8)}...`);
    // Welcome message confirms connection.
    try { ws.send(JSON.stringify({ kind: 'connected', pubkey, at: Date.now() })); } catch (_) { /* ignore */ }
    ws.on('message', () => { /* read-only channel */ });
    ws.on('close', () => {
        unsubscribe();
        console.log(`${TAG} notif_subscriber CLOSE pubkey=${pubkey.slice(0, 8)}...`);
    });
    ws.on('error', (e) => {
        console.warn(`${TAG} notif_subscriber ERROR pubkey=${pubkey.slice(0, 8)}...`, e);
    });
}

function send(ws: WebSocket, msg: WsOutbound): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function attachSpectator(ws: WebSocket, sessionId: string, matchPda: string): void {
    const ok = sessions.addSpectator(sessionId, ws);
    if (!ok) {
        ws.close();
        return;
    }
    console.log(`${TAG} spectator OPEN session=${sessionId} match=${matchPda.slice(0, 8)}...`);
    // Spectators can't send messages — ignore any inbound data, just in case.
    ws.on('message', () => { /* read-only channel */ });
    ws.on('close', () => {
        sessions.removeSpectator(sessionId, ws);
        console.log(`${TAG} spectator CLOSE session=${sessionId}`);
    });
    ws.on('error', (e) => {
        console.warn(`${TAG} spectator ERROR session=${sessionId}`, e);
    });
    // Welcome packet: include current squad snapshot so late subscribers get
    // both squads in one message (betting-duel live opponent delta).
    const squads = sessions.getMatchSquads(matchPda);
    try { ws.send(JSON.stringify({ kind: 'spectate-ready', sessionId, matchPda, squads })); } catch (_) { /* ignore */ }
}

/**
 * betting-duel live opponent delta — session-less spectator path. Registers
 * a WS subscriber scoped to matchPda only (no physics session). Receives
 * `spectate-ready` (with current squads) + subsequent `opponent-squad`
 * broadcasts as each player publishes.
 */
function attachMatchSpectator(ws: WebSocket, matchPda: string): void {
    sessions.addMatchSpectator(matchPda, ws);
    console.log(`${TAG} match_spectator OPEN match=${matchPda.slice(0, 8)}...`);
    ws.on('message', () => { /* read-only */ });
    ws.on('close', () => {
        sessions.removeMatchSpectator(matchPda, ws);
        console.log(`${TAG} match_spectator CLOSE match=${matchPda.slice(0, 8)}...`);
    });
    ws.on('error', (e) => {
        console.warn(`${TAG} match_spectator ERROR match=${matchPda.slice(0, 8)}...`, e);
    });
    const squads = sessions.getMatchSquads(matchPda);
    try { ws.send(JSON.stringify({ kind: 'spectate-ready', sessionId: null, matchPda, squads })); } catch (_) { /* ignore */ }
}

function attachSession(ws: WebSocket, sessionId: string): void {
    console.log(`${TAG} ws OPEN session=${sessionId}`);
    ws.on('message', (raw) => {
        let parsed: WsInbound;
        try {
            parsed = JSON.parse(String(raw));
        } catch (e) {
            send(ws, { kind: 'fatal', reason: 'malformed json' });
            ws.close();
            return;
        }
        handleMessage(ws, sessionId, parsed);
    });
    ws.on('close', () => {
        console.log(`${TAG} ws CLOSE session=${sessionId}`);
    });
    ws.on('error', (e) => {
        console.warn(`${TAG} ws ERROR session=${sessionId}`, e);
    });
}

function handleMessage(ws: WebSocket, sessionId: string, msg: WsInbound): void {
    if (msg.kind === 'drop') {
        const outcome = sessions.recordDrop(sessionId, {
            blockIdx: msg.blockIdx,
            tsMs: msg.tsMs,
            xPos: msg.xPos,
            width: msg.width,
            outcome: msg.outcome,
        });
        if (outcome.verdict.ok) {
            send(ws, { kind: 'ack', blockIdx: msg.blockIdx });
        } else {
            send(ws, { kind: 'reject', blockIdx: msg.blockIdx, reason: outcome.verdict.reason ?? 'invalid' });
            if (outcome.shouldTerminate) {
                send(ws, { kind: 'fatal', reason: 'blacklisted' });
                ws.close();
            }
        }
        return;
    }

    if (msg.kind === 'finalize') {
        const fin = sessions.finalize(sessionId, msg.finalHeight);
        if (!fin.ok) {
            send(ws, { kind: 'fatal', reason: fin.reason });
            ws.close();
            return;
        }
        const signedAt = Math.floor(Date.now() / 1000);
        const { ixDataB64 } = signer.sign({
            matchPda: new PublicKey(fin.state.matchPda),
            player: new PublicKey(fin.state.playerPubkey),
            height: fin.height,
            signedAt,
        });
        send(ws, { kind: 'receipt', ed25519IxDataB64: ixDataB64, signedAt, height: fin.height });
        ws.close();
        return;
    }

    send(ws, { kind: 'fatal', reason: `unknown kind ${(msg as any).kind}` });
    ws.close();
}

httpServer.listen(PORT, () => {
    console.log(`${TAG} listening on :${PORT} · serverPubkey=${signer.pubkey.toBase58()}`);
    console.log(`${TAG} CORS=${JSON.stringify(CORS_ORIGINS)} max_sessions=${MAX_CONCURRENT} birdeye=${BIRDEYE_KEY ? 'set' : 'MISSING (permissive physics)'}`);
    // DB Stage 1 — auto-apply pending migrations on startup.
    if (dbConfigured()) {
        runMigrations()
            .then((r) => {
                if (r.applied.length > 0) console.log(`${TAG} migrations applied=${r.applied.join(',')}`);
                else console.log(`${TAG} migrations up-to-date`);
            })
            .catch((e) => console.log(`${TAG} migration_failed | ${e?.message ?? e}`));
    } else {
        console.log(`${TAG} db DISABLED (DATABASE_URL not set) — DB-backed routes return 503`);
    }
});

// Part 10 pt2: retention cron — skip if CRON_ENABLED=false (local dev default)
// OR if ADMIN_SECRET is absent (missing credentials — no point starting).
// CRON_DRY_RUN=1 overrides the missing-credentials skip (uses ephemeral kp).
const cronEnabled = process.env.CRON_ENABLED !== 'false';
const cronHasCreds = !!process.env.ADMIN_SECRET || process.env.CRON_DRY_RUN === '1';
if (cronEnabled && cronHasCreds) {
    import('./cron').then(({ startCron }) => startCron().catch((e) => {
        console.warn(`${TAG} cron startup failed:`, e?.message ?? e);
    })).catch((e) => {
        console.warn(`${TAG} cron import failed:`, e?.message ?? e);
    });
} else {
    const reason = !cronEnabled ? 'CRON_ENABLED=false' : 'no ADMIN_SECRET (set CRON_DRY_RUN=1 for dry-run)';
    console.log(`${TAG} cron DISABLED (${reason})`);
}

process.on('SIGTERM', () => {
    console.log(`${TAG} SIGTERM — shutting down`);
    sessions.shutdown();
    void closePool();
    httpServer.close(() => process.exit(0));
});
