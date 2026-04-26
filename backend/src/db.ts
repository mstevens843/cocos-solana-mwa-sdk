/**
 * db.ts — Postgres connection pool + thin query helpers.
 *
 * Reads `DATABASE_URL` from env. Designed for both:
 *   • Local dev: postgres://$USER@localhost:5432/token_duel_dev (no SSL)
 *   • Render production: postgres://...render.com/...     (SSL required)
 *
 * Render's free + starter tiers use self-signed certs; we set
 * `rejectUnauthorized: false` when DB_SSL=true so the connection succeeds
 * without bundling the CA cert.
 *
 * Use parameterized queries via `query()`. Never interpolate user input
 * directly into SQL strings.
 */
import { Pool, type QueryResult, type QueryResultRow } from 'pg';

const TAG = '[db]';

const databaseUrl = process.env.DATABASE_URL ?? '';
const poolMax = parseInt(process.env.DB_POOL_MAX ?? '10', 10);
const sslEnabled = process.env.DB_SSL === 'true';

if (!databaseUrl) {
    console.log(`${TAG} init | WARN DATABASE_URL not set — DB features disabled`);
}

export const pool = new Pool({
    connectionString: databaseUrl,
    max: poolMax,
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    // Fail fast on connection errors instead of hanging requests.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
    console.log(`${TAG} pool_error | ${err.message}`);
});

/** Whether the pool is configured (DATABASE_URL was provided). */
export function dbConfigured(): boolean {
    return databaseUrl.length > 0;
}

/**
 * Run a parameterized query and return the rows. Logs slow queries (>200ms)
 * to help spot N+1 + missing indexes early.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
): Promise<T[]> {
    const start = Date.now();
    try {
        const result: QueryResult<T> = await pool.query<T>(text, params as any[]);
        const ms = Date.now() - start;
        if (ms > 200) {
            console.log(`${TAG} slow_query | ms=${ms} sql=${text.replace(/\s+/g, ' ').slice(0, 100)}`);
        }
        return result.rows;
    } catch (e: any) {
        console.log(`${TAG} query_err | ${e.message ?? e} sql=${text.replace(/\s+/g, ' ').slice(0, 100)}`);
        throw e;
    }
}

/** Single-row helper. Returns null if no rows. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
): Promise<T | null> {
    const rows = await query<T>(text, params);
    return rows[0] ?? null;
}

/** Health probe — used by /health/db endpoint. */
export async function ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    if (!dbConfigured()) return { ok: false, latencyMs: 0, error: 'DATABASE_URL not set' };
    const start = Date.now();
    try {
        await query('SELECT 1');
        return { ok: true, latencyMs: Date.now() - start };
    } catch (e: any) {
        return { ok: false, latencyMs: Date.now() - start, error: String(e?.message ?? e) };
    }
}

/** Graceful shutdown — call from server.ts on SIGTERM/SIGINT. */
export async function closePool(): Promise<void> {
    try {
        await pool.end();
        console.log(`${TAG} pool closed`);
    } catch (e: any) {
        console.log(`${TAG} pool_close_err | ${e.message ?? e}`);
    }
}
