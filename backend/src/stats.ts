/**
 * stats.ts — Part 12 Bundle B.
 *
 * In-memory counters + recent-event ring buffers for the admin dashboard
 * (`/admin`). Evaporates on server restart — intentionally ephemeral;
 * persistent analytics is a post-hackathon concern.
 *
 * Session lifecycle bumps counters here (see session.ts), and `/admin/stream`
 * emits a StatsSnapshot every 2s to connected SSE clients.
 */

const TAG = '[stats]';
const RING_CAP = 20;

export interface ReceiptLogEntry {
    matchPda: string;
    player: string;
    height: number;
    at: number;        // unix sec
    verified: boolean; // true if Ed25519-backed path (vs fallback legacy settle)
}

export interface RejectLogEntry {
    player: string;
    reason: string;
    at: number;        // unix sec
    blockIdx?: number;
}

/**
 * Part 13: each MatchSettled event becomes a SettlementLogEntry so the
 * dashboard can render a "recent settlements" stream alongside rake cards.
 * `rakeLamports` is serialized as a string because BigInt doesn't round-trip
 * through JSON and we want no precision loss for sub-lamport accounting.
 */
export interface SettlementLogEntry {
    matchPda: string;
    winner: string;
    potLamports: string;    // bigint as string
    rakeLamports: string;   // bigint as string
    at: number;             // unix sec
}

/**
 * Part 13: per-token winrate row for the admin dashboard + public analytics.
 * Mint-to-symbol lookup is lazy on the client side (dashboard fetches
 * `/admin/mint/:mint/meta`). `winratePct` is pre-rounded to 1 decimal.
 */
export interface TokenStatsRow {
    mint: string;
    wins: number;
    matches: number;
    winratePct: number;
}

export interface StatsSnapshot {
    // Lifetime counters (since process start).
    receiptsSigned: number;
    cheatRejects: number;
    totalSessionsEver: number;
    totalMatchesWitnessed: number;   // unique matchPdas ever observed
    spectatorsConnectedEver: number;
    // Live gauges.
    sessionsAliveNow: number;
    spectatorsAliveNow: number;
    blacklistedPlayers: number;
    // Recent-event ring buffers.
    recentReceipts: ReceiptLogEntry[];
    recentRejects: RejectLogEntry[];
    // Server context.
    startedAt: number;               // unix sec
    uptimeSec: number;
    serverPubkey: string;
    treeAddress: string;             // TROPHY_TREE_ADDRESS (or empty if disabled)
    // Part 13: economics transparency.
    rakeAccruedAllTime: string;      // lamports as string (BigInt → JSON-safe)
    rakeAccruedThisWeek: string;
    rakeAccruedToday: string;
    recentSettlements: SettlementLogEntry[];
    tokenStats: TokenStatsRow[];     // top 10 by matches desc (empty if unknown)
    // Part 14: tournament host telemetry.
    tournamentHost: string;                  // base58 pubkey ('' when host disabled)
    tournamentsSeededToday: number;          // since UTC 00:00
    tournamentsSeededAllTime: number;        // since process start
    tournamentsCompletedAllTime: number;     // MatchSettled events with player0 == host
}

class StatsBucketImpl {
    private _receiptsSigned = 0;
    private _cheatRejects = 0;
    private _totalSessionsEver = 0;
    private _totalMatchesWitnessed = 0;
    private _spectatorsConnectedEver = 0;
    private _sessionsAliveNow = 0;
    private _spectatorsAliveNow = 0;
    private _blacklistedPlayers = 0;
    private _recentReceipts: ReceiptLogEntry[] = [];
    private _recentRejects: RejectLogEntry[] = [];
    private _matchSet = new Set<string>();
    private _startedAt = Math.floor(Date.now() / 1000);
    private _serverPubkey = '';
    private _treeAddress = '';
    // Part 13: rake + settlement tracking. Lifetime lamports as BigInt for
    // overflow safety (even a decade of devnet won't exhaust u64, but
    // mainnet could). Daily/weekly derived from `_recentSettlements` at
    // snapshot time — no timer needed.
    private _rakeAllTime: bigint = 0n;
    private _recentSettlements: SettlementLogEntry[] = [];
    private _tokenStats: TokenStatsRow[] = [];
    // Part 14: tournament host telemetry.
    private _tournamentHost = '';
    private _tournamentsSeededEver = 0;
    private _tournamentsCompletedEver = 0;
    /** Timestamps of recent tournament seeds — used to derive "today" count. */
    private _tournamentsSeededAts: number[] = [];
    /** Set of matchPdas seeded by the host — lets rake_listener recognize
     *  tournament completions without re-reading the Match PDA. Bounded
     *  via a prune pass when it grows past 500 entries. */
    private _seededTournamentPdas: Set<string> = new Set();

    setContext(serverPubkey: string, treeAddress: string): void {
        this._serverPubkey = serverPubkey;
        this._treeAddress = treeAddress;
    }

    bumpSessionCreated(matchPda: string): void {
        this._totalSessionsEver += 1;
        if (!this._matchSet.has(matchPda)) {
            this._matchSet.add(matchPda);
            this._totalMatchesWitnessed += 1;
        }
    }

    bumpReceipt(entry: ReceiptLogEntry): void {
        this._receiptsSigned += 1;
        this._recentReceipts.unshift(entry);
        if (this._recentReceipts.length > RING_CAP) this._recentReceipts.length = RING_CAP;
    }

    bumpReject(entry: RejectLogEntry): void {
        this._cheatRejects += 1;
        this._recentRejects.unshift(entry);
        if (this._recentRejects.length > RING_CAP) this._recentRejects.length = RING_CAP;
    }

    bumpSpectatorConnected(): void {
        this._spectatorsConnectedEver += 1;
        this._spectatorsAliveNow += 1;
    }

    bumpSpectatorDisconnected(): void {
        if (this._spectatorsAliveNow > 0) this._spectatorsAliveNow -= 1;
    }

    setSessionsAlive(n: number): void {
        this._sessionsAliveNow = n;
    }

    setBlacklisted(n: number): void {
        this._blacklistedPlayers = n;
    }

    /**
     * Part 13: record a MatchSettled event. Rake + pot are lamport strings;
     * we parse to BigInt for the all-time accumulator. Settlement log
     * retains a 100-entry ring — that's enough to derive a 7-day weekly
     * bucket at devnet match cadence without unbounded growth.
     */
    bumpSettlement(entry: SettlementLogEntry): void {
        try {
            this._rakeAllTime += BigInt(entry.rakeLamports);
        } catch (_) {
            /* malformed — skip accumulation but keep the log entry */
        }
        this._recentSettlements.unshift(entry);
        if (this._recentSettlements.length > 100) this._recentSettlements.length = 100;
    }

    /** Part 13: replace the top-N token stats table with a fresh snapshot. */
    setTokenStats(rows: TokenStatsRow[]): void {
        this._tokenStats = rows.slice(0, 10);
    }

    /** Part 14: publish the tournament host pubkey for the snapshot (client discovery). */
    setTournamentHost(pubkey: string): void {
        this._tournamentHost = pubkey ?? '';
    }

    /** Part 14: one tournament match was just created by the host cron. */
    bumpTournamentCreated(matchPda: string): void {
        this._tournamentsSeededEver += 1;
        this._tournamentsSeededAts.unshift(Math.floor(Date.now() / 1000));
        this._seededTournamentPdas.add(matchPda);
        if (this._seededTournamentPdas.size > 500) {
            // Prune oldest entries — convert to array, drop the first 100.
            const arr = Array.from(this._seededTournamentPdas);
            this._seededTournamentPdas = new Set(arr.slice(100));
        }
        // Keep a week of history so "today" + "this week" buckets can be
        // derived without ever-growing storage.
        const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86_400;
        while (this._tournamentsSeededAts.length && this._tournamentsSeededAts[this._tournamentsSeededAts.length - 1] < weekAgo) {
            this._tournamentsSeededAts.pop();
        }
    }

    /** Part 14: was this matchPda seeded by the tournament host? */
    isSeededTournament(matchPda: string): boolean {
        return this._seededTournamentPdas.has(matchPda);
    }

    /** Part 14: one tournament match was just Settled on-chain. */
    bumpTournamentCompleted(_matchPda: string): void {
        this._tournamentsCompletedEver += 1;
    }

    snapshot(): StatsSnapshot {
        const nowSec = Math.floor(Date.now() / 1000);
        // Part 13: derive today/this-week rake totals by scanning the
        // settlement log. UTC day boundary = floor(now/86400)*86400;
        // week boundary = floor(now/(86400*7))*86400*7.
        const dayStart = Math.floor(nowSec / 86_400) * 86_400;
        const weekStart = Math.floor(nowSec / (86_400 * 7)) * 86_400 * 7;
        let rakeToday: bigint = 0n;
        let rakeWeek: bigint = 0n;
        for (const s of this._recentSettlements) {
            let l: bigint;
            try { l = BigInt(s.rakeLamports); } catch (_) { continue; }
            if (s.at >= weekStart) rakeWeek += l;
            if (s.at >= dayStart) rakeToday += l;
        }
        return {
            receiptsSigned: this._receiptsSigned,
            cheatRejects: this._cheatRejects,
            totalSessionsEver: this._totalSessionsEver,
            totalMatchesWitnessed: this._totalMatchesWitnessed,
            spectatorsConnectedEver: this._spectatorsConnectedEver,
            sessionsAliveNow: this._sessionsAliveNow,
            spectatorsAliveNow: this._spectatorsAliveNow,
            blacklistedPlayers: this._blacklistedPlayers,
            recentReceipts: this._recentReceipts.slice(),
            recentRejects: this._recentRejects.slice(),
            startedAt: this._startedAt,
            uptimeSec: nowSec - this._startedAt,
            serverPubkey: this._serverPubkey,
            treeAddress: this._treeAddress,
            rakeAccruedAllTime: this._rakeAllTime.toString(),
            rakeAccruedThisWeek: rakeWeek.toString(),
            rakeAccruedToday: rakeToday.toString(),
            recentSettlements: this._recentSettlements.slice(0, 20),
            tokenStats: this._tokenStats.slice(),
            // Part 14: tournament host telemetry. "Today" is derived from
            // the same UTC day boundary used by the rake bucket above.
            tournamentHost: this._tournamentHost,
            tournamentsSeededToday: this._tournamentsSeededAts.filter((t) => t >= dayStart).length,
            tournamentsSeededAllTime: this._tournamentsSeededEver,
            tournamentsCompletedAllTime: this._tournamentsCompletedEver,
        };
    }
}

export const StatsBucket = new StatsBucketImpl();
