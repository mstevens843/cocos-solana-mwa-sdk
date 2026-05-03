/**
 * match_history.ts - DB-backed per-player match history (DB Stage 4).
 *
 * Client-uploaded records. The on-chain MatchAccount remains the audit
 * source-of-truth; this table is a denormalized projection optimized for
 * "matches I've played" queries. INSERTs are idempotent on match_pda.
 *
 * Trust model: clients could lie about heights/winner. Acceptable for v1
 * because on-chain settlement is the authoritative scoreboard - DB is
 * read-only display. Production would verify via Solana RPC fetch.
 */
import { query, queryOne, dbConfigured } from './db';

const TAG = '[match_history]';

export interface MatchHistoryRecord {
    matchPda: string;
    modeU8: number;
    wagerTier: number;
    wagerLamports: number;
    timeWindow: number;
    players: string[];
    heights: number[];
    winnerPubkey: string | null;
    payouts: { rank: number; pubkey: string; lamports: number }[];
    rakeLamports: number;
    status: number;             // 2 = Settled, 3 = Cancelled
    createdAt: string | Date;
    startedAt?: string | Date | null;
    settledAt: string | Date;
    /** Base58 mint of the wager currency. NATIVE_SOL_MINT for SOL matches,
     *  SKR mint (cluster-specific) for SKR matches. Empty string on pre-006
     *  rows; new writes always populate it. Drives Portfolio Real per-currency
     *  P/L aggregation. */
    wagerMint: string;
}

/** ISO week string for token_winrates bucket. e.g., "2026-W17". */
function isoWeek(d: Date): string {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((+t - +yearStart) / 86_400_000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export interface RecordResult {
    inserted: boolean;
    matchPda: string;
}

/**
 * Upsert a match record. Returns { inserted: false } if a row with this
 * matchPda already exists (idempotent - second player's upload is a no-op).
 */
export async function recordMatch(rec: MatchHistoryRecord, squadMintsByPlayer?: Record<string, string[]>): Promise<RecordResult> {
    if (!dbConfigured()) throw new Error('db not configured');
    if (rec.players.length === 0) throw new Error('players[] empty');

    // INSERT ... DO NOTHING returns inserted row only on actual INSERT, so we
    // can use rowCount to detect dedupe.
    const inserted = await queryOne<{ match_pda: string }>(
        `INSERT INTO match_history
            (match_pda, mode_u8, wager_tier, wager_lamports, time_window,
             players, heights, winner_pubkey, payouts_json, rake_lamports,
             status, created_at, started_at, settled_at, wager_mint)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (match_pda) DO NOTHING
         RETURNING match_pda`,
        [
            rec.matchPda, rec.modeU8, rec.wagerTier, rec.wagerLamports, rec.timeWindow,
            rec.players, rec.heights, rec.winnerPubkey, JSON.stringify(rec.payouts), rec.rakeLamports,
            rec.status, rec.createdAt, rec.startedAt ?? null, rec.settledAt, rec.wagerMint ?? '',
        ],
    );

    if (!inserted) {
        return { inserted: false, matchPda: rec.matchPda };
    }

    // Bump token_winrates on first-time INSERT only.
    if (squadMintsByPlayer && rec.winnerPubkey) {
        const settledAt = rec.settledAt instanceof Date ? rec.settledAt : new Date(rec.settledAt);
        const week = isoWeek(settledAt);
        for (const [pubkey, mints] of Object.entries(squadMintsByPlayer)) {
            const won = pubkey === rec.winnerPubkey;
            for (const mint of mints) {
                if (typeof mint !== 'string' || mint.length < 32) continue;
                try {
                    await query(
                        `INSERT INTO token_winrates (mint, iso_week, matches, wins, last_updated)
                         VALUES ($1, $2, 1, $3, now())
                         ON CONFLICT (mint, iso_week) DO UPDATE SET
                             matches      = token_winrates.matches + 1,
                             wins         = token_winrates.wins + EXCLUDED.wins,
                             last_updated = now()`,
                        [mint, week, won ? 1 : 0],
                    );
                } catch (e: any) {
                    console.log(`${TAG} token_bump_err | mint=${mint.slice(0,8)}… ${e?.message ?? e}`);
                }
            }
        }
    }

    console.log(`${TAG} inserted | match=${rec.matchPda.slice(0,8)}… mode=${rec.modeU8} status=${rec.status} winner=${rec.winnerPubkey?.slice(0,8) ?? 'none'}`);
    return { inserted: true, matchPda: rec.matchPda };
}

export interface HistoryListItem {
    match_pda: string;
    mode_u8: number;
    wager_tier: number;
    wager_lamports: string;
    time_window: number;
    players: string[];
    heights: number[];
    winner_pubkey: string | null;
    payouts_json: { rank: number; pubkey: string; lamports: number }[];
    rake_lamports: string;
    status: number;
    created_at: Date;
    started_at: Date | null;
    settled_at: Date;
    wager_mint: string;
}

/** Per-player history. Uses GIN index on players[] for fast lookup. */
export async function listForPlayer(pubkey: string, limit: number = 20): Promise<HistoryListItem[]> {
    if (!dbConfigured()) return [];
    return query<HistoryListItem>(
        `SELECT * FROM match_history
         WHERE $1 = ANY(players)
         ORDER BY settled_at DESC
         LIMIT $2`,
        [pubkey, Math.min(Math.max(limit, 1), 100)],
    );
}

/** Top mints by winrate over a given ISO week. Used by /admin/tokens. */
export async function topTokensByWeek(week: string, limit: number = 10): Promise<
    Array<{ mint: string; matches: number; wins: number; winrate: number }>
> {
    if (!dbConfigured()) return [];
    const rows = await query<{ mint: string; matches: number; wins: number }>(
        `SELECT mint, matches, wins
         FROM token_winrates
         WHERE iso_week = $1 AND matches > 0
         ORDER BY (wins::float / matches) DESC, matches DESC
         LIMIT $2`,
        [week, limit],
    );
    return rows.map((r) => ({
        mint: r.mint,
        matches: r.matches,
        wins: r.wins,
        winrate: r.matches > 0 ? r.wins / r.matches : 0,
    }));
}

export { isoWeek };
