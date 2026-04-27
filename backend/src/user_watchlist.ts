/**
 * user_watchlist.ts — DB-backed per-user token watchlist.
 *
 * Composite PK (pubkey, mint) keeps "is this mint watched" cheap and
 * avoids a surrogate id we'd otherwise have to reconcile with the
 * client. Conflict strategy on first hydrate is union-merge — see the
 * plan at ~/.claude/plans/db-persistence-ship-ready.md.
 *
 * Endpoints in server.ts:
 *   GET    /users/:pubkey/watchlist           → { items: [...] }
 *   POST   /users/:pubkey/watchlist           → upsert one item
 *   DELETE /users/:pubkey/watchlist/:mint     → remove one item
 */
import { query, queryOne, dbConfigured } from './db';
import { touchUser } from './users';

const TAG = '[user_watchlist]';

export interface WatchlistRow {
    pubkey: string;
    mint: string;
    base_symbol: string;
    base_name: string;
    logo_uri: string;
    added_at: Date;
}

export interface WatchlistInput {
    mint: string;
    baseSymbol?: string;
    baseName?: string;
    logoURI?: string;
    addedAt?: number;   // unix seconds; if omitted server stamps now()
}

export async function getWatchlist(pubkey: string): Promise<WatchlistRow[]> {
    if (!dbConfigured()) return [];
    return query<WatchlistRow>(
        `SELECT pubkey, mint, base_symbol, base_name, logo_uri, added_at
         FROM user_watchlist
         WHERE pubkey = $1
         ORDER BY added_at DESC`,
        [pubkey],
    );
}

export async function addToWatchlist(
    pubkey: string,
    item: WatchlistInput,
): Promise<WatchlistRow> {
    if (!dbConfigured()) throw new Error('db not configured');
    if (!item.mint || typeof item.mint !== 'string') {
        throw new Error('mint required');
    }

    await touchUser(pubkey);

    // Earlier-wins on conflict — protects "I added it on phone before this
    // sync" semantics so a re-add doesn't reset added_at to now.
    const addedAtIso = item.addedAt && Number.isFinite(item.addedAt)
        ? new Date(item.addedAt * 1000).toISOString()
        : null;

    const row = await queryOne<WatchlistRow>(
        `INSERT INTO user_watchlist (pubkey, mint, base_symbol, base_name, logo_uri, added_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()))
         ON CONFLICT (pubkey, mint)
         DO UPDATE SET
            base_symbol = EXCLUDED.base_symbol,
            base_name   = EXCLUDED.base_name,
            logo_uri    = EXCLUDED.logo_uri,
            added_at    = LEAST(user_watchlist.added_at, EXCLUDED.added_at)
         RETURNING pubkey, mint, base_symbol, base_name, logo_uri, added_at`,
        [
            pubkey,
            item.mint,
            item.baseSymbol ?? '',
            item.baseName ?? '',
            item.logoURI ?? '',
            addedAtIso,
        ],
    );
    if (!row) throw new Error('user_watchlist upsert returned no rows');
    console.log(`${TAG} add | pubkey=${pubkey.slice(0, 8)}… mint=${item.mint.slice(0, 8)}…`);
    return row;
}

export async function removeFromWatchlist(pubkey: string, mint: string): Promise<boolean> {
    if (!dbConfigured()) return false;
    const rows = await query<{ pubkey: string }>(
        `DELETE FROM user_watchlist WHERE pubkey = $1 AND mint = $2 RETURNING pubkey`,
        [pubkey, mint],
    );
    const removed = rows.length > 0;
    console.log(`${TAG} remove | pubkey=${pubkey.slice(0, 8)}… mint=${mint.slice(0, 8)}… removed=${removed}`);
    return removed;
}
