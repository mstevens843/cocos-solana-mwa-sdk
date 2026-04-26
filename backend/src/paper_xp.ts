/**
 * paper_xp.ts — DB-backed cross-device paper/bot XP.
 *
 * Real-mode XP stays on-chain (UserStats PDA). This table only handles
 * paper-track XP that has no on-chain home. Schema in
 * `migrations/001_initial.sql` (paper_xp table).
 *
 * Endpoints in server.ts:
 *   GET  /paper-xp/:pubkey   → current totals
 *   POST /paper-xp/:pubkey   → bump after a paper match resolves
 *
 * Client posts deltas (not absolute totals) so two devices both writing
 * during a brief offline period don't clobber each other.
 */
import { query, queryOne, dbConfigured } from './db';
import { touchUser } from './users';

const TAG = '[paper_xp]';

export interface PaperXpRow {
    pubkey: string;
    total_xp: string;          // bigint as string per pg default
    bot_xp: string;
    paper_real_xp: string;
    games_played: number;
    wins: number;
    losses: number;
    last_updated: Date;
}

export type PaperTrack = 'bot' | 'paper-real';

export async function getPaperXp(pubkey: string): Promise<PaperXpRow | null> {
    if (!dbConfigured()) return null;
    return queryOne<PaperXpRow>(
        `SELECT * FROM paper_xp WHERE pubkey = $1`,
        [pubkey],
    );
}

/**
 * Bump XP totals after a paper-match resolves. Idempotent w.r.t. the
 * caller's responsibility — clients should NOT call twice for the same
 * match (no idempotency key in v1; could add one later via a separate
 * `paper_match_log` table).
 */
export async function recordPaperMatch(
    pubkey: string,
    delta: { xp: number; track: PaperTrack; won: boolean },
): Promise<PaperXpRow> {
    if (!dbConfigured()) throw new Error('db not configured');
    if (delta.xp < 0) throw new Error('xp delta must be non-negative');

    // Ensure user row exists before INSERTing the FK-referenced paper_xp row.
    await touchUser(pubkey);

    const winInc = delta.won ? 1 : 0;
    const lossInc = delta.won ? 0 : 1;
    const botInc = delta.track === 'bot' ? delta.xp : 0;
    const prInc = delta.track === 'paper-real' ? delta.xp : 0;

    const row = await queryOne<PaperXpRow>(
        `INSERT INTO paper_xp (pubkey, total_xp, bot_xp, paper_real_xp, games_played, wins, losses, last_updated)
         VALUES ($1, $2, $3, $4, 1, $5, $6, now())
         ON CONFLICT (pubkey)
         DO UPDATE SET
            total_xp      = paper_xp.total_xp      + EXCLUDED.total_xp,
            bot_xp        = paper_xp.bot_xp        + EXCLUDED.bot_xp,
            paper_real_xp = paper_xp.paper_real_xp + EXCLUDED.paper_real_xp,
            games_played  = paper_xp.games_played  + 1,
            wins          = paper_xp.wins          + $5,
            losses        = paper_xp.losses        + $6,
            last_updated  = now()
         RETURNING *`,
        [pubkey, delta.xp, botInc, prInc, winInc, lossInc],
    );
    if (!row) throw new Error('paper_xp upsert returned no rows');
    console.log(`${TAG} record | pubkey=${pubkey.slice(0, 8)}… +${delta.xp} XP track=${delta.track} won=${delta.won} total=${row.total_xp}`);
    return row;
}
