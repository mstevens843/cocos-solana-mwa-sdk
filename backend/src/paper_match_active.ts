/**
 * paper_match_active.ts — DB-backed in-flight paper / bot matches (DB Stage 7).
 *
 * Signed-in users post a row when a paper / bot match starts so the match
 * shows up in MIP cross-device. Rows are removed on race end (settle /
 * forfeit / natural finish). Stale rows (started_at + duration_ms < now())
 * are pruned at GET time so a crashed client can't leak rows forever.
 *
 * Guests don't hit this — their matches stay in client memory only.
 */
import { query, queryOne, dbConfigured } from './db';
import { touchUser } from './users';

const TAG = '[paper_match_active]';

export interface PaperMatchActiveRow {
    id: string;
    pubkey: string;
    modeU8: number;
    timeWindow: number;
    requiredPlayers: number;
    track: 'bot' | 'paper-real';
    startedAt: string;       // ISO
    durationMs: number;
    lastHeight: number;
    lastBotHeights: number[];
    lastUpdated: string;     // ISO
}

interface DbRow {
    id: string;
    pubkey: string;
    mode_u8: number;
    time_window: number;
    required_players: number;
    track: string;
    started_at: Date;
    duration_ms: string;     // BIGINT comes back as string
    last_height: number;
    last_bot_heights: number[];
    last_updated: Date;
}

function toRecord(r: DbRow): PaperMatchActiveRow {
    return {
        id: r.id,
        pubkey: r.pubkey,
        modeU8: r.mode_u8,
        timeWindow: r.time_window,
        requiredPlayers: r.required_players,
        track: r.track === 'bot' ? 'bot' : 'paper-real',
        startedAt: r.started_at.toISOString(),
        durationMs: Number(r.duration_ms),
        lastHeight: r.last_height,
        lastBotHeights: r.last_bot_heights ?? [],
        lastUpdated: r.last_updated.toISOString(),
    };
}

export interface RegisterPayload {
    id: string;
    pubkey: string;
    modeU8: number;
    timeWindow: number;
    requiredPlayers: number;
    track: 'bot' | 'paper-real';
    durationMs: number;
}

export async function registerActive(p: RegisterPayload): Promise<PaperMatchActiveRow> {
    if (!dbConfigured()) throw new Error('db not configured');
    await touchUser(p.pubkey);
    const row = await queryOne<DbRow>(
        `INSERT INTO paper_match_active
            (id, pubkey, mode_u8, time_window, required_players, track, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING
         RETURNING *`,
        [p.id, p.pubkey, p.modeU8, p.timeWindow, p.requiredPlayers, p.track, p.durationMs],
    );
    if (!row) {
        // Conflict — fetch existing row.
        const existing = await queryOne<DbRow>(
            `SELECT * FROM paper_match_active WHERE id = $1`,
            [p.id],
        );
        if (!existing) throw new Error('register conflict but no existing row');
        return toRecord(existing);
    }
    console.log(`${TAG} registered | id=${p.id.slice(0, 18)} pk=${p.pubkey.slice(0, 8)}… mode=${p.modeU8} window=${p.timeWindow} dur=${p.durationMs}ms track=${p.track}`);
    return toRecord(row);
}

export async function updateHeights(
    id: string,
    lastHeight: number,
    lastBotHeights: number[],
): Promise<void> {
    if (!dbConfigured()) return;
    await query(
        `UPDATE paper_match_active
            SET last_height = $2,
                last_bot_heights = $3,
                last_updated = now()
          WHERE id = $1`,
        [id, lastHeight, lastBotHeights],
    );
}

export async function deleteActive(id: string): Promise<void> {
    if (!dbConfigured()) return;
    await query(
        `DELETE FROM paper_match_active WHERE id = $1`,
        [id],
    );
    console.log(`${TAG} deleted | id=${id.slice(0, 18)}`);
}

/**
 * List all in-flight rows for a user. Prunes any whose started_at +
 * duration_ms is in the past (presumed-finished by an offline client).
 */
export async function listActiveForUser(pubkey: string): Promise<PaperMatchActiveRow[]> {
    if (!dbConfigured()) return [];
    // Prune expired rows opportunistically.
    await query(
        `DELETE FROM paper_match_active
          WHERE pubkey = $1
            AND started_at + (duration_ms * INTERVAL '1 millisecond') < now()`,
        [pubkey],
    );
    const rows = await query<DbRow>(
        `SELECT * FROM paper_match_active
          WHERE pubkey = $1
          ORDER BY started_at ASC`,
        [pubkey],
    );
    return rows.map(toRecord);
}
