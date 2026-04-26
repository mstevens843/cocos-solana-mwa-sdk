/**
 * users.ts — DB-backed read/write helpers for the `users` table.
 *
 * One row per wallet pubkey ever seen. Auto-created on first backend
 * interaction (publishSquad, paper_xp post, notification fetch, etc.).
 *
 * Username rules:
 *   - 3–20 chars
 *   - alphanumeric + underscore + dash
 *   - case-insensitive uniqueness (LOWER(username) UNIQUE index)
 *   - reserved blocklist for obvious bad words / system names
 */
import { query, queryOne, dbConfigured } from './db';

const TAG = '[users]';

export interface UserRow {
    pubkey: string;
    username: string | null;
    joined_at: Date;
    last_seen_at: Date;
    metadata: Record<string, unknown>;
}

const USERNAME_REGEX = /^[A-Za-z0-9_-]{3,20}$/;
const RESERVED_USERNAMES = new Set([
    'admin', 'root', 'system', 'support', 'help', 'mod', 'bot',
    'tournament', 'host', 'token', 'duel', 'tokenduel',
]);

export interface UsernameValidation {
    ok: boolean;
    error?: string;
}

export function validateUsername(name: string): UsernameValidation {
    if (typeof name !== 'string') return { ok: false, error: 'username must be a string' };
    if (name.length < 3) return { ok: false, error: 'username must be at least 3 characters' };
    if (name.length > 20) return { ok: false, error: 'username must be at most 20 characters' };
    if (!USERNAME_REGEX.test(name)) return { ok: false, error: 'username must be alphanumeric + _ -' };
    if (RESERVED_USERNAMES.has(name.toLowerCase())) return { ok: false, error: 'username is reserved' };
    return { ok: true };
}

/** Upsert a user row. Touches last_seen_at. Idempotent. Safe to call on every backend interaction. */
export async function touchUser(pubkey: string): Promise<UserRow | null> {
    if (!dbConfigured()) return null;
    return queryOne<UserRow>(
        `INSERT INTO users (pubkey, last_seen_at)
         VALUES ($1, now())
         ON CONFLICT (pubkey)
         DO UPDATE SET last_seen_at = now()
         RETURNING *`,
        [pubkey],
    );
}

/** Read a user row by pubkey. Returns null if not yet auto-created. */
export async function getUser(pubkey: string): Promise<UserRow | null> {
    if (!dbConfigured()) return null;
    return queryOne<UserRow>(
        `SELECT * FROM users WHERE pubkey = $1`,
        [pubkey],
    );
}

/** Read a user by username (case-insensitive). */
export async function getUserByUsername(name: string): Promise<UserRow | null> {
    if (!dbConfigured()) return null;
    return queryOne<UserRow>(
        `SELECT * FROM users WHERE LOWER(username) = LOWER($1)`,
        [name],
    );
}

/**
 * Set the username for a pubkey. Returns the updated row, or throws if the
 * username is invalid or already taken (Postgres unique-constraint error).
 */
export async function setUsername(pubkey: string, username: string): Promise<UserRow> {
    if (!dbConfigured()) throw new Error('db not configured');
    const validation = validateUsername(username);
    if (!validation.ok) throw new Error(validation.error ?? 'invalid username');

    // Touch first so the user row exists, then update.
    await touchUser(pubkey);
    try {
        const row = await queryOne<UserRow>(
            `UPDATE users SET username = $2, last_seen_at = now()
             WHERE pubkey = $1
             RETURNING *`,
            [pubkey, username],
        );
        if (!row) throw new Error('user not found');
        return row;
    } catch (e: any) {
        // Postgres unique-violation = error code 23505.
        if (e?.code === '23505') {
            throw new Error('username already taken');
        }
        throw e;
    }
}

/** Bulk lookup — returns map of pubkey → username for the input list. Missing pubkeys omitted. */
export async function getUsernamesBulk(pubkeys: string[]): Promise<Map<string, string>> {
    if (!dbConfigured() || pubkeys.length === 0) return new Map();
    const rows = await query<{ pubkey: string; username: string }>(
        `SELECT pubkey, username FROM users WHERE pubkey = ANY($1::text[]) AND username IS NOT NULL`,
        [pubkeys],
    );
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.pubkey, r.username);
    return m;
}
