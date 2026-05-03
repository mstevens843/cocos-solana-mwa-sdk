/**
 * paper_match_history.ts - DB-backed per-match history for finished paper /
 * bot matches (DB Stage 8). Mirror of match_history.ts but for off-chain
 * matches (no PDA, no wager, no payouts). One row per settled match.
 *
 * INSERT is idempotent on `id` so a retry can't duplicate. Source of truth
 * is the client; we trust signed-in users not to fabricate placements/XP.
 * Acceptable for v1 because XP is also tracked aggregate in paper_xp.
 */
import { query, queryOne, dbConfigured } from './db';
import { touchUser } from './users';

const TAG = '[paper_match_history]';

export interface PaperMatchHistoryRecord {
    id: string;
    pubkey: string;
    modeU8: number;
    timeWindow: number;
    requiredPlayers: number;
    track: 'bot' | 'paper-real';
    players: string[];
    heights: number[];
    myHeight: number;
    winnerPubkey: string | null;
    placement: number;
    totalPlayers: number;
    won: boolean;
    xpGained: number;
    startedAt: string | Date;
    settledAt: string | Date;
}

interface DbRow {
    id: string;
    pubkey: string;
    mode_u8: number;
    time_window: number;
    required_players: number;
    track: string;
    players: string[];
    heights: number[];
    my_height: number;
    winner_pubkey: string | null;
    placement: number;
    total_players: number;
    won: boolean;
    xp_gained: number;
    started_at: Date;
    settled_at: Date;
}

function toRecord(r: DbRow): PaperMatchHistoryRecord {
    return {
        id: r.id,
        pubkey: r.pubkey,
        modeU8: r.mode_u8,
        timeWindow: r.time_window,
        requiredPlayers: r.required_players,
        track: r.track === 'bot' ? 'bot' : 'paper-real',
        players: r.players,
        heights: r.heights,
        myHeight: r.my_height,
        winnerPubkey: r.winner_pubkey,
        placement: r.placement,
        totalPlayers: r.total_players,
        won: r.won,
        xpGained: r.xp_gained,
        startedAt: r.started_at.toISOString(),
        settledAt: r.settled_at.toISOString(),
    };
}

export interface RecordResult {
    inserted: boolean;
    id: string;
}

export async function recordPaperMatch(rec: PaperMatchHistoryRecord): Promise<RecordResult> {
    if (!dbConfigured()) throw new Error('db not configured');
    if (rec.players.length === 0) throw new Error('players[] empty');
    if (rec.heights.length !== rec.players.length) throw new Error('heights/players length mismatch');
    await touchUser(rec.pubkey);
    const inserted = await queryOne<{ id: string }>(
        `INSERT INTO paper_match_history
            (id, pubkey, mode_u8, time_window, required_players, track,
             players, heights, my_height, winner_pubkey, placement,
             total_players, won, xp_gained, started_at, settled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
            rec.id, rec.pubkey, rec.modeU8, rec.timeWindow, rec.requiredPlayers, rec.track,
            rec.players, rec.heights, rec.myHeight, rec.winnerPubkey, rec.placement,
            rec.totalPlayers, rec.won, rec.xpGained, rec.startedAt, rec.settledAt,
        ],
    );
    if (!inserted) return { inserted: false, id: rec.id };
    console.log(`${TAG} recorded | id=${rec.id.slice(0, 18)} pk=${rec.pubkey.slice(0, 8)}… mode=${rec.modeU8} window=${rec.timeWindow} track=${rec.track} placement=${rec.placement}/${rec.totalPlayers} won=${rec.won} xp=${rec.xpGained}`);
    return { inserted: true, id: rec.id };
}

export async function listForUser(
    pubkey: string,
    limit = 50,
    offset = 0,
): Promise<PaperMatchHistoryRecord[]> {
    if (!dbConfigured()) return [];
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    const rows = await query<DbRow>(
        `SELECT * FROM paper_match_history
          WHERE pubkey = $1
          ORDER BY settled_at DESC
          LIMIT $2 OFFSET $3`,
        [pubkey, safeLimit, safeOffset],
    );
    return rows.map(toRecord);
}
