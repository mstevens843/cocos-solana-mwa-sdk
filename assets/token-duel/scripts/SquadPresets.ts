/**
 * SquadPresets.ts - Part 10 Bundle 2.
 *
 * sys.localStorage-backed squad shortcuts. Player saves their favorite
 * 3-token combos with a name; Quick-Play uses the highest-winning preset
 * as a smart default when `squadStrategy === 'last-winning-squad'`.
 *
 * Storage shape (JSON array under `tokenduel:squadPresets`):
 *   [{ id, name, slots: [{mint,symbol,logoUri?}×3], savedAt, winCount }]
 *
 * Capped at MAX presets - saving a 6th evicts the oldest savedAt. Duplicate
 * slot signatures (same 3 mints, any order) are de-duped on save.
 *
 * DB Stage 9 - every mutation fires a fire-and-forget PUT to the backend
 * mirror. Hydration on wallet connect uses last-write-wins by `updated_at`
 * at the list level: if the backend's updatedAt is newer than the newest
 * local savedAt, replace local with server; otherwise push local up.
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

/** Pubkey set on connect by AppUI; null in guest mode (no backend sync). */
let _syncPubkey: string | null = null;

/** Fire-and-forget push of the current list to the backend mirror. */
function _syncToBackend(): void {
    if (!_syncPubkey) return;
    const pubkey = _syncPubkey;
    const list = readAll();
    void (async () => {
        try {
            const { putPresets } = await import('./SquadPresetsRpc');
            await putPresets(pubkey, list);
        } catch (e) {
            console.log(`${TAG} _syncToBackend | NET_ERR ${e}`);
        }
    })();
}

export class SquadPresets {
    /**
     * Bind this device to a pubkey for cross-device sync. Pass null on
     * disconnect / guest mode to stop syncing. Does not push or pull on
     * its own - call hydrateFromBackend() explicitly post-connect.
     */
    static setSyncPubkey(pubkey: string | null): void {
        _syncPubkey = pubkey || null;
    }

    /**
     * Pull the server's preset list and merge with local using LWW by
     * timestamp at the list level. Returns true if local was changed.
     * Safe to call repeatedly; only the first call after connect matters
     * for cross-device sync.
     */
    static async hydrateFromBackend(pubkey: string): Promise<boolean> {
        if (!pubkey) return false;
        try {
            const { fetchPresets } = await import('./SquadPresetsRpc');
            const remote = await fetchPresets(pubkey);
            if (!remote) return false;
            const remoteUpdated = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
            const local = readAll();
            const localNewest = local.reduce((max, p) => Math.max(max, p.savedAt || 0), 0);
            // If remote is meaningfully newer than the newest local edit,
            // replace local with server. Otherwise push local up so the
            // server catches up to whatever this device has.
            if (remoteUpdated > localNewest && Array.isArray(remote.presets)) {
                writeAll(remote.presets);
                console.log(`${TAG} hydrate | REMOTE_WINS local_newest=${localNewest} remote_updated=${remoteUpdated} count=${remote.presets.length}`);
                return true;
            }
            if (local.length > 0 && remoteUpdated < localNewest) {
                _syncToBackend();
                console.log(`${TAG} hydrate | LOCAL_WINS pushed count=${local.length}`);
            } else {
                console.log(`${TAG} hydrate | NOOP local_newest=${localNewest} remote_updated=${remoteUpdated}`);
            }
            return false;
        } catch (e) {
            console.log(`${TAG} hydrate | ERR ${e}`);
            return false;
        }
    }

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
            _syncToBackend();
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
        _syncToBackend();
        console.log(`${TAG} save | SAVED id=${preset.id} name="${trimmedName}" slots=[${slots.map((s) => s.symbol).join(',')}]`);
        return preset;
    }

    static delete(id: string): void {
        const list = readAll().filter((p) => p.id !== id);
        writeAll(list);
        _syncToBackend();
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
            _syncToBackend();
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
