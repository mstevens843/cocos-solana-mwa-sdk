/**
 * token_stats.ts — Part 13 Bundle C.
 *
 * Per-mint win/loss aggregator fed by `rake_listener.ts`. Evaporates on
 * restart (acceptable for devnet + demo; post-hackathon → Postgres).
 *
 * Sunday 00:00 UTC is the weekly reset boundary — matches the Season PDA
 * cadence on-chain so "this week's winrate" lines up with weekly payouts.
 *
 * Winners get +1 win, losers get +1 match only. Each player's full squad
 * (3 mints) bumps together — if BONK was in the winning squad, BONK gets
 * a win; the other 2 mints in that squad also get wins. Losing squad's
 * mints each get a match-played but no win.
 */

const TAG = '[token-stats]';

export interface TokenStatsRow {
    mint: string;
    wins: number;
    matches: number;
    winratePct: number;
}

export class TokenStatsBucket {
    private buckets: Map<string, { wins: number; matches: number; firstSeen: number }> = new Map();
    private lastWeekId: number = currentWeekId();
    private seenMatches = new Set<string>();

    /**
     * Record a settled match. `squads` maps player pubkey → 3 mints. The
     * winner's mints get +1 win, +1 match; everyone else's mints get +1 match.
     * De-duped by matchPda so retries or log-replays don't double-count.
     */
    recordOutcome(matchPda: string, winner: string, squads: Map<string, string[]>): void {
        this.maybeResetWeek();
        if (this.seenMatches.has(matchPda)) {
            console.log(`${TAG} recordOutcome | SKIP_DUP match=${matchPda.slice(0, 8)}...`);
            return;
        }
        this.seenMatches.add(matchPda);

        const now = Math.floor(Date.now() / 1000);
        let bumped = 0;
        for (const [player, mints] of squads) {
            const isWinner = player === winner;
            for (const mint of mints) {
                if (!mint) continue;
                const b = this.buckets.get(mint) ?? { wins: 0, matches: 0, firstSeen: now };
                b.matches += 1;
                if (isWinner) b.wins += 1;
                this.buckets.set(mint, b);
                bumped += 1;
            }
        }
        console.log(`${TAG} recordOutcome | match=${matchPda.slice(0, 8)}... winner=${winner.slice(0, 8)}... buckets_bumped=${bumped}`);
    }

    /** Top-N by total matches (desc). Ties broken by winrate desc. */
    getTopTokens(limit: number = 10): TokenStatsRow[] {
        const rows: TokenStatsRow[] = [];
        for (const [mint, b] of this.buckets) {
            const winratePct = b.matches === 0 ? 0 : Math.round((b.wins * 1000) / b.matches) / 10;
            rows.push({ mint, wins: b.wins, matches: b.matches, winratePct });
        }
        rows.sort((a, b) => {
            if (b.matches !== a.matches) return b.matches - a.matches;
            return b.winratePct - a.winratePct;
        });
        return rows.slice(0, limit);
    }

    /** Stats for one mint (or null if never seen this week). */
    getMintStats(mint: string): TokenStatsRow | null {
        const b = this.buckets.get(mint);
        if (!b || b.matches === 0) return null;
        const winratePct = Math.round((b.wins * 1000) / b.matches) / 10;
        return { mint, wins: b.wins, matches: b.matches, winratePct };
    }

    /** Manual reset (used in tests + weekly boundary). */
    reset(): void {
        this.buckets.clear();
        this.seenMatches.clear();
    }

    private maybeResetWeek(): void {
        const wk = currentWeekId();
        if (wk !== this.lastWeekId) {
            console.log(`${TAG} maybeResetWeek | ROLL ${this.lastWeekId} → ${wk} buckets=${this.buckets.size}`);
            this.reset();
            this.lastWeekId = wk;
        }
    }
}

/** Unix-seconds → Solana-season week id (floor(ts / 604800)). */
function currentWeekId(): number {
    return Math.floor(Date.now() / 1000 / (7 * 86_400));
}
