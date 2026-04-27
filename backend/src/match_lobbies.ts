/**
 * match_lobbies.ts — DB-backed open-lobby projection (DB Stage 6).
 *
 * Client uploads a row right after `join_match_create` confirms. Used for
 * funnel analytics + future operator surfaces; live lobby discovery still
 * comes from on-chain getProgramAccounts so there's only one source of
 * truth for what's currently joinable.
 *
 * Idempotent on match_pda — counter-race retries that resolve to the same
 * PDA, or both clients posting after a join, can't double-insert.
 */
import { query, queryOne, dbConfigured } from './db';

const TAG = '[match_lobbies]';

export interface MatchLobbyRecord {
    matchPda: string;
    creatorPubkey: string;
    modeU8: number;
    wagerTier: number;
    wagerLamports: number;
    timeWindow: number;
    requiredPlayers: number;
    createdAt: string | Date;
}

export interface RecordResult {
    inserted: boolean;
    matchPda: string;
}

/** Insert a new open-lobby row; no-op if matchPda already exists. */
export async function recordLobby(rec: MatchLobbyRecord): Promise<RecordResult> {
    if (!dbConfigured()) throw new Error('db not configured');
    const inserted = await queryOne<{ match_pda: string }>(
        `INSERT INTO match_lobbies
            (match_pda, creator_pubkey, mode_u8, wager_tier, wager_lamports,
             time_window, required_players, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (match_pda) DO NOTHING
         RETURNING match_pda`,
        [
            rec.matchPda, rec.creatorPubkey, rec.modeU8, rec.wagerTier, rec.wagerLamports,
            rec.timeWindow, rec.requiredPlayers, rec.createdAt,
        ],
    );
    if (!inserted) {
        return { inserted: false, matchPda: rec.matchPda };
    }
    console.log(`${TAG} inserted | match=${rec.matchPda.slice(0, 8)}… mode=${rec.modeU8} creator=${rec.creatorPubkey.slice(0, 8)}…`);
    return { inserted: true, matchPda: rec.matchPda };
}

/** Stamp started_at when the lobby fills + transitions Active. Idempotent. */
export async function markLobbyStarted(matchPda: string, startedAt: string | Date = new Date()): Promise<void> {
    if (!dbConfigured()) return;
    await query(
        `UPDATE match_lobbies SET started_at = $2
         WHERE match_pda = $1 AND started_at IS NULL`,
        [matchPda, startedAt],
    );
}

/** Stamp cancelled_at on host-cancel or 24h timeout refund. Idempotent. */
export async function markLobbyCancelled(matchPda: string, cancelledAt: string | Date = new Date()): Promise<void> {
    if (!dbConfigured()) return;
    await query(
        `UPDATE match_lobbies SET cancelled_at = $2
         WHERE match_pda = $1 AND cancelled_at IS NULL`,
        [matchPda, cancelledAt],
    );
}
