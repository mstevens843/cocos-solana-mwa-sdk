/**
 * Stats.ts — per-mode game statistics.
 *
 * Paper mode → localStorage (key: `tokenduel:paper-stats`).
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

export type StatsMode = 'paper' | 'real';

export interface StatsRecord {
    games: number;
    wins: number;
    losses: number;
    profitLamports: number;
    xp: number;
}

const TAG = '[Stats]';
const EMPTY: StatsRecord = { games: 0, wins: 0, losses: 0, profitLamports: 0, xp: 0 };
const PAPER_KEY = 'tokenduel:paper-stats';

function safeStorage(): Storage | null {
    try { if (typeof localStorage !== 'undefined') return localStorage; } catch (_) { /* blocked */ }
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
        console.log(`${TAG} readPaper | PARSE_ERROR error=${e} — returning empty`);
        return { ...EMPTY };
    }
}

function writePaper(rec: StatsRecord): void {
    const ls = safeStorage();
    if (!ls) {
        console.log(`${TAG} writePaper | STORAGE_UNAVAILABLE — record lost`);
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
            console.log(`${TAG} record | REAL_STUB win=${win} profit=${profitLamports} — Session D will wire on-chain UserStats`);
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
            console.log(`${TAG} load | REAL_STUB — returning empty until Session D`);
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
};
