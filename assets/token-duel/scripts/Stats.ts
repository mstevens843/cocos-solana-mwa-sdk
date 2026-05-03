/**
 * Stats.ts - per-mode game statistics.
 *
 * Paper mode → sys.localStorage (key: `tokenduel:paper-stats`).
 * Real  mode → stub for Session D on-chain UserStats PDA.
 *
 * Schema:
 *   { games, wins, losses, profitLamports, xp }
 *
 * Public API:
 *   Stats.record(mode, win, profitLamports)
 *   Stats.load(mode) → StatsRecord
 *   Stats.clear(mode)
 */

import { sys } from 'cc';

export type StatsMode = 'paper' | 'real';

export interface StatsRecord {
    games: number;
    wins: number;
    losses: number;
    profitLamports: number;
    xp: number;
}

interface KVStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const TAG = '[Stats]';
const EMPTY: StatsRecord = { games: 0, wins: 0, losses: 0, profitLamports: 0, xp: 0 };
const PAPER_KEY = 'tokenduel:paper-stats';
const LAST_MATCH_KEY = 'tokenduel:last-match';

/**
 * 2026-04-28 home UX polish - single-row snapshot of the user's most-recent
 * settled match. Drives the HomeMatchTicker "Last Result" strip. Persists
 * across sessions in localStorage (paper) so guests + signed-in users see
 * the same anchor on Home.
 */
export interface LastMatchRecord {
    outcome: 'win' | 'loss';
    deltaSol: number;        // signed: +0.10 win, -0.05 loss
    modeLabel: string;       // "1v1", "Trio", "4p", "8p"
    stakeSol: number;        // wager amount, e.g. 0.10
    atSec: number;           // unix seconds when settled
}

// Cocos sys.localStorage is SQLite-backed on native (Android/iOS) and
// LocalStorage on Web. Plain `localStorage` is undefined on native, which
// is why every paper-stats write was silently lost - see AuthCache.ts:5.
function safeStorage(): KVStorage | null {
    try {
        const s = (sys as any)?.localStorage as KVStorage | undefined;
        if (s && typeof s.getItem === 'function') return s;
    } catch (_) { /* native shim not yet ready */ }
    try {
        const g = (globalThis as any).localStorage as KVStorage | undefined;
        if (g && typeof g.getItem === 'function') return g;
    } catch (_) { /* blocked */ }
    return null;
}

function readPaper(): StatsRecord {
    const ls = safeStorage();
    if (!ls) return { ...EMPTY };
    try {
        const raw = ls.getItem(PAPER_KEY);
        if (!raw) return { ...EMPTY };
        const parsed = JSON.parse(raw);
        return {
            games: Number(parsed.games) || 0,
            wins: Number(parsed.wins) || 0,
            losses: Number(parsed.losses) || 0,
            profitLamports: Number(parsed.profitLamports) || 0,
            xp: Number(parsed.xp) || 0,
        };
    } catch (e) {
        console.log(`${TAG} readPaper | PARSE_ERROR error=${e} - returning empty`);
        return { ...EMPTY };
    }
}

function writePaper(rec: StatsRecord): void {
    const ls = safeStorage();
    if (!ls) {
        console.log(`${TAG} writePaper | STORAGE_UNAVAILABLE - record lost`);
        return;
    }
    try {
        ls.setItem(PAPER_KEY, JSON.stringify(rec));
    } catch (e) {
        console.log(`${TAG} writePaper | WRITE_ERROR error=${e}`);
    }
}

export const Stats = {
    /**
     * Record the outcome of one game.
     *   win=true  → wins++, xp += 100, profitLamports += (gross − wager)
     *   win=false → losses++, xp += 10, profitLamports -= wager
     */
    record(mode: StatsMode, win: boolean, profitLamports: number): void {
        if (mode === 'real') {
            console.log(`${TAG} record | REAL_STUB win=${win} profit=${profitLamports} - Session D will wire on-chain UserStats`);
            return;
        }
        const rec = readPaper();
        rec.games += 1;
        if (win) { rec.wins += 1; rec.xp += 100; }
        else     { rec.losses += 1; rec.xp += 10; }
        rec.profitLamports += Math.round(profitLamports);
        writePaper(rec);
        console.log(`${TAG} record | PAPER_DONE games=${rec.games} wins=${rec.wins} losses=${rec.losses} profit=${rec.profitLamports} xp=${rec.xp}`);
    },

    /** Load the current record for a mode. Returns a fresh copy. */
    load(mode: StatsMode): StatsRecord {
        if (mode === 'real') {
            // Real-mode stats live in an on-chain UserStats PDA (Session D).
            console.log(`${TAG} load | REAL_STUB - returning empty until Session D`);
            return { ...EMPTY };
        }
        return readPaper();
    },

    /** Wipe the record (for a "reset stats" menu option, if we add one). */
    clear(mode: StatsMode): void {
        if (mode === 'real') {
            console.log(`${TAG} clear | REAL_STUB`);
            return;
        }
        const ls = safeStorage();
        if (!ls) return;
        ls.removeItem(PAPER_KEY);
        console.log(`${TAG} clear | PAPER_CLEARED`);
    },

    /**
     * Persist a snapshot of the most-recent settled match for the home
     * "Last Result" strip. Overwrites any prior snapshot - single-slot.
     */
    recordLastMatch(rec: LastMatchRecord): void {
        const ls = safeStorage();
        if (!ls) return;
        try {
            ls.setItem(LAST_MATCH_KEY, JSON.stringify(rec));
            console.log(`${TAG} recordLastMatch | outcome=${rec.outcome} delta=${rec.deltaSol.toFixed(3)} mode=${rec.modeLabel} stake=${rec.stakeSol}`);
        } catch (e) {
            console.log(`${TAG} recordLastMatch | WRITE_ERROR ${e}`);
        }
    },

    /** Read the last-match snapshot. Null if never recorded or storage empty. */
    loadLastMatch(): LastMatchRecord | null {
        const ls = safeStorage();
        if (!ls) return null;
        try {
            const raw = ls.getItem(LAST_MATCH_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw);
            const outcome = p?.outcome === 'win' ? 'win' : p?.outcome === 'loss' ? 'loss' : null;
            if (!outcome) return null;
            return {
                outcome,
                deltaSol: Number(p.deltaSol) || 0,
                modeLabel: String(p.modeLabel ?? ''),
                stakeSol: Number(p.stakeSol) || 0,
                atSec: Number(p.atSec) || 0,
            };
        } catch (e) {
            console.log(`${TAG} loadLastMatch | PARSE_ERROR ${e}`);
            return null;
        }
    },
};
