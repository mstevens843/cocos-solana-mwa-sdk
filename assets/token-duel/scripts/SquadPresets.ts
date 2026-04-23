/**
 * SquadPresets.ts — Part 10 Bundle 2.
 *
 * LocalStorage-backed squad shortcuts. Player saves their favorite 3-token
 * combos with a name; Quick-Play uses the highest-winning preset as a smart
 * default when `squadStrategy === 'last-winning-squad'`.
 *
 * Storage shape (JSON array under `tokenduel:squadPresets`):
 *   [{ id, name, slots: [{mint,symbol,logoUri?}×3], savedAt, winCount }]
 *
 * Capped at MAX presets — saving a 6th evicts the oldest savedAt. Duplicate
 * slot signatures (same 3 mints, any order) are de-duped on save.
 */

const TAG = '[SquadPresets]';

export interface SquadPresetSlot {
    mint: string;
    symbol: string;
    logoUri?: string;
}

export interface SquadPreset {
    id: string;
    name: string;
    slots: [SquadPresetSlot, SquadPresetSlot, SquadPresetSlot];
    savedAt: number; // unix ms
    winCount: number;
}

const LS_KEY = 'tokenduel:squadPresets';
const MAX_PRESETS = 5;

function ls(): Storage | null {
    try {
        const s = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
        return s && typeof s.getItem === 'function' ? s : null;
    } catch (_) { return null; }
}

function readAll(): SquadPreset[] {
    const store = ls();
    if (!store) return [];
    try {
        const raw = store.getItem(LS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed as SquadPreset[];
    } catch (e) {
        console.log(`${TAG} readAll | PARSE_ERROR ${e}`);
        return [];
    }
}

function writeAll(list: SquadPreset[]): void {
    const store = ls();
    if (!store) return;
    try { store.setItem(LS_KEY, JSON.stringify(list)); }
    catch (e) { console.log(`${TAG} writeAll | WRITE_ERROR ${e}`); }
}

/** Canonical signature for a slot triple (sorted mints, joined with |). */
function sigFor(slots: SquadPresetSlot[]): string {
    return slots.map((s) => s.mint).sort().join('|');
}

export class SquadPresets {
    /** Return all presets, newest savedAt first. */
    static list(): SquadPreset[] {
        return readAll().slice().sort((a, b) => b.savedAt - a.savedAt);
    }

    /**
     * Save (or replace) a preset. Returns the stored entry. Existing presets
     * with the same slot-signature get their name updated + savedAt bumped.
     * Beyond MAX_PRESETS, evicts the oldest (smallest savedAt).
     */
    static save(name: string, slots: SquadPresetSlot[]): SquadPreset | null {
        if (slots.length !== 3 || slots.some((s) => !s?.mint)) {
            console.log(`${TAG} save | REJECTED invalid slots len=${slots.length}`);
            return null;
        }
        const trimmedName = name.trim().slice(0, 24);
        if (!trimmedName) { console.log(`${TAG} save | REJECTED empty name`); return null; }

        const list = readAll();
        const sig = sigFor(slots);
        const existing = list.find((p) => sigFor(p.slots) === sig);
        if (existing) {
            existing.name = trimmedName;
            existing.savedAt = Date.now();
            writeAll(list);
            console.log(`${TAG} save | UPDATED id=${existing.id} name="${trimmedName}"`);
            return existing;
        }

        const preset: SquadPreset = {
            id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
            name: trimmedName,
            slots: [slots[0], slots[1], slots[2]] as [SquadPresetSlot, SquadPresetSlot, SquadPresetSlot],
            savedAt: Date.now(),
            winCount: 0,
        };
        list.push(preset);

        if (list.length > MAX_PRESETS) {
            list.sort((a, b) => a.savedAt - b.savedAt);
            const evicted = list.shift();
            console.log(`${TAG} save | EVICTED oldest id=${evicted?.id} name="${evicted?.name}"`);
        }
        writeAll(list);
        console.log(`${TAG} save | SAVED id=${preset.id} name="${trimmedName}" slots=[${slots.map((s) => s.symbol).join(',')}]`);
        return preset;
    }

    static delete(id: string): void {
        const list = readAll().filter((p) => p.id !== id);
        writeAll(list);
        console.log(`${TAG} delete | id=${id} remaining=${list.length}`);
    }

    /** Bump winCount for any preset matching this slot signature. */
    static bumpWin(slots: SquadPresetSlot[]): void {
        if (slots.length !== 3) return;
        const list = readAll();
        const sig = sigFor(slots);
        let bumped = false;
        for (const p of list) {
            if (sigFor(p.slots) === sig) {
                p.winCount += 1;
                bumped = true;
                break; // only one preset per sig
            }
        }
        if (bumped) {
            writeAll(list);
            console.log(`${TAG} bumpWin | DONE sig=${sig}`);
        }
    }

    /** Highest-winCount preset, tiebreak by most recent savedAt. Null if none saved. */
    static getLastWinning(): SquadPreset | null {
        const list = readAll();
        if (list.length === 0) return null;
        list.sort((a, b) => (b.winCount - a.winCount) || (b.savedAt - a.savedAt));
        return list[0];
    }
}
