/**
 * squad_presets.ts — DB-backed cross-device squad preset list.
 *
 * One row per pubkey, full-list replace. Cap of 5 is enforced client-side
 * but we trim defensively here in case a misbehaving client posts more.
 * Conflict strategy is last-write-wins by `updated_at` — see the plan at
 * ~/.claude/plans/db-persistence-ship-ready.md for why we don't merge per-row.
 *
 * Endpoints in server.ts:
 *   GET /users/:pubkey/squad-presets  → { presets, updatedAt }
 *   PUT /users/:pubkey/squad-presets  → replaces the entire list
 */
import { queryOne, dbConfigured } from './db';
import { touchUser } from './users';

const TAG = '[squad_presets]';

export interface SquadPresetSlot {
    mint: string;
    symbol: string;
    logoUri?: string;
}

export interface SquadPreset {
    id: string;
    name: string;
    slots: SquadPresetSlot[];     // exactly 3 — validated at write
    savedAt: number;              // unix ms
    winCount: number;
}

export interface SquadPresetsRow {
    pubkey: string;
    presets: SquadPreset[];
    updated_at: Date;
}

const MAX_PRESETS = 5;

export async function getPresets(pubkey: string): Promise<SquadPresetsRow | null> {
    if (!dbConfigured()) return null;
    return queryOne<SquadPresetsRow>(
        `SELECT pubkey, presets, updated_at FROM squad_presets WHERE pubkey = $1`,
        [pubkey],
    );
}

/**
 * Validate + normalise a single preset. Returns null when the entry is
 * structurally bad. Server is defensive but not strict: bad presets are
 * dropped rather than rejecting the whole list, so a corrupt local entry
 * can't lock a user out of saving the others.
 */
function sanitise(p: unknown): SquadPreset | null {
    if (!p || typeof p !== 'object') return null;
    const o = p as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : null;
    const name = typeof o.name === 'string' ? o.name.slice(0, 24) : null;
    const slots = Array.isArray(o.slots) ? o.slots : null;
    if (!id || !name || !slots || slots.length !== 3) return null;
    const cleanedSlots: SquadPresetSlot[] = [];
    for (const s of slots) {
        if (!s || typeof s !== 'object') return null;
        const so = s as Record<string, unknown>;
        if (typeof so.mint !== 'string' || !so.mint) return null;
        cleanedSlots.push({
            mint: so.mint,
            symbol: typeof so.symbol === 'string' ? so.symbol : '',
            logoUri: typeof so.logoUri === 'string' ? so.logoUri : undefined,
        });
    }
    const savedAt = Number(o.savedAt);
    const winCount = Number(o.winCount);
    return {
        id,
        name,
        slots: cleanedSlots,
        savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
        winCount: Number.isFinite(winCount) && winCount >= 0 ? Math.floor(winCount) : 0,
    };
}

export async function replacePresets(
    pubkey: string,
    presets: unknown[],
): Promise<SquadPresetsRow> {
    if (!dbConfigured()) throw new Error('db not configured');

    await touchUser(pubkey);

    const cleaned: SquadPreset[] = [];
    for (const p of presets ?? []) {
        const ok = sanitise(p);
        if (ok) cleaned.push(ok);
        if (cleaned.length >= MAX_PRESETS) break;
    }

    const row = await queryOne<SquadPresetsRow>(
        `INSERT INTO squad_presets (pubkey, presets, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (pubkey)
         DO UPDATE SET presets = EXCLUDED.presets,
                       updated_at = now()
         RETURNING pubkey, presets, updated_at`,
        [pubkey, JSON.stringify(cleaned)],
    );
    if (!row) throw new Error('squad_presets upsert returned no rows');
    console.log(`${TAG} replace | pubkey=${pubkey.slice(0, 8)}… count=${cleaned.length}`);
    return row;
}
