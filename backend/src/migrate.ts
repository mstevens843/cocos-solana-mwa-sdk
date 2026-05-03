/**
 * migrate.ts - minimal file-based Postgres migration runner.
 *
 * Reads `backend/migrations/*.sql` in lex order and applies any not yet
 * recorded in the `schema_migrations` table. Idempotent; safe to call on
 * every startup.
 *
 * Usage:
 *   npm run migrate           # applies pending migrations against DATABASE_URL
 *   npm run migrate -- --dry  # lists pending migrations without applying
 */
import 'dotenv/config';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dbConfigured, pool, query, closePool } from './db';

const TAG = '[migrate]';

// migrations/ lives at backend/migrations relative to this file.
// Resolved via two strategies so it works under both `tsx` (source path) and
// the bundled production build (which sits in backend/dist/).
function resolveMigrationsDir(): string {
    const candidates = [
        resolve(process.cwd(), 'backend/migrations'),
        resolve(process.cwd(), 'migrations'),
        resolve(__dirname, '..', 'migrations'),
    ];
    for (const c of candidates) {
        if (existsSync(c)) return c;
    }
    throw new Error(`${TAG} could not locate migrations dir; tried: ${candidates.join(', ')}`);
}

async function ensureMigrationsTable(): Promise<void> {
    await query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id           TEXT PRIMARY KEY,
            applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

interface MigrationFile { id: string; path: string; sql: string; }

function listMigrations(dir: string): MigrationFile[] {
    return readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((f) => ({
            id: f.replace(/\.sql$/, ''),
            path: join(dir, f),
            sql: readFileSync(join(dir, f), 'utf8'),
        }));
}

async function appliedIds(): Promise<Set<string>> {
    const rows = await query<{ id: string }>('SELECT id FROM schema_migrations');
    return new Set(rows.map((r) => r.id));
}

async function applyMigration(m: MigrationFile): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await client.query('COMMIT');
        console.log(`${TAG} applied | ${m.id}`);
    } catch (e: any) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(`${TAG} apply_err | ${m.id} ${e.message ?? e}`);
        throw e;
    } finally {
        client.release();
    }
}

export async function runMigrations(opts: { dry?: boolean } = {}): Promise<{ applied: string[]; pending: string[] }> {
    if (!dbConfigured()) {
        console.log(`${TAG} DATABASE_URL not set - skipping migrations`);
        return { applied: [], pending: [] };
    }
    const dir = resolveMigrationsDir();
    await ensureMigrationsTable();
    const all = listMigrations(dir);
    const applied = await appliedIds();
    const pending = all.filter((m) => !applied.has(m.id));
    if (pending.length === 0) {
        console.log(`${TAG} up_to_date | ${all.length} migrations applied`);
        return { applied: [], pending: [] };
    }
    console.log(`${TAG} pending | ${pending.length} migration(s): ${pending.map((m) => m.id).join(', ')}`);
    if (opts.dry) {
        return { applied: [], pending: pending.map((m) => m.id) };
    }
    const newlyApplied: string[] = [];
    for (const m of pending) {
        await applyMigration(m);
        newlyApplied.push(m.id);
    }
    return { applied: newlyApplied, pending: [] };
}

// Allow running directly via `npm run migrate`.
const isMain = (() => {
    try {
        const argv1 = process.argv[1] ?? '';
        return argv1.endsWith('migrate.ts') || argv1.endsWith('migrate.js');
    } catch { return false; }
})();

if (isMain) {
    const dry = process.argv.includes('--dry');
    (async () => {
        const result = await runMigrations({ dry });
        if (dry && result.pending.length > 0) {
            console.log(`${TAG} DRY RUN - would apply ${result.pending.length} migration(s)`);
        }
        await closePool();
        process.exit(0);
    })().catch((e) => {
        console.log(`${TAG} fatal | ${e?.message ?? e}`);
        process.exit(1);
    });
}
