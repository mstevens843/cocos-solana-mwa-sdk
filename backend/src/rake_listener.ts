/**
 * rake_listener.ts - Part 13 Bundle B.
 *
 * Subscribes to program logs via `Connection.onLogs` and surfaces
 * `SettleMatch.FINAL` lines into the admin dashboard. Each such line
 * contains `match=<pda> ... winner=<pk> ... rake=<lamports> pot=<lamports>`
 * (see `programs/token-duel/src/instructions/settle_match.rs`). force_settle
 * emits the same shape, and `settle_match_verified` does too.
 *
 * We parse the raw `msg!()` output rather than decoding the Anchor event
 * (`emit!(MatchSettled { ... })`) because:
 *   1. No IDL dependency required - the msg format is pinned by source.
 *   2. Event decoding needs the anchor-client IDL bundle, which adds 20KB+
 *      to the backend container.
 *   3. One-regex-per-log-line keeps this listener < 150 LOC.
 *
 * Side effects:
 *   - `StatsBucket.bumpSettlement({...})` for dashboard rake cards.
 *   - `TokenStatsBucket.recordOutcome(matchPda, winner)` for per-mint winrate.
 *   - Calls back into `SessionManager` to resolve session → squadMints.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { StatsBucket } from './stats';
import { TokenStatsBucket } from './token_stats';
import { SessionManager } from './session';

const TAG = '[rake-listener]';

// Matches the msg!() format in all three settle handlers, e.g.:
//   "SettleMatch.FINAL: match=ABC1... mode=0 winner=DEF... winner_height=42 rake=1500000 pot=50000000"
// Both `force_settle` and `settle_match_verified` emit the same line.
const SETTLE_RE = /SettleMatch\.FINAL:\s+match=(\w+)\s+mode=\d+\s+winner=(\w+)\s+winner_height=\d+\s+rake=(\d+)\s+pot=(\d+)/;

export interface RakeListenerOptions {
    connection: Connection;
    programId: PublicKey;
    sessions: SessionManager;
    tokenStats: TokenStatsBucket;
}

export class RakeListener {
    private subId: number | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private retryDelayMs: number = 2_000;

    constructor(private readonly opts: RakeListenerOptions) {}

    async start(): Promise<void> {
        try {
            this.subId = this.opts.connection.onLogs(
                this.opts.programId,
                (logInfo, ctx) => {
                    if (logInfo.err) return;
                    for (const line of logInfo.logs) {
                        this.handleLogLine(line, ctx.slot);
                    }
                },
                'confirmed',
            );
            console.log(`${TAG} start | OK sub_id=${this.subId} program=${this.opts.programId.toBase58()}`);
            this.retryDelayMs = 2_000; // reset backoff on success
        } catch (e) {
            console.warn(`${TAG} start | FAIL ${e} - retrying in ${this.retryDelayMs}ms`);
            this.scheduleRetry();
        }
    }

    async shutdown(): Promise<void> {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.subId !== null) {
            try {
                await this.opts.connection.removeOnLogsListener(this.subId);
            } catch (_) {
                /* ignore */
            }
            this.subId = null;
        }
    }

    private scheduleRetry(): void {
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.start();
        }, this.retryDelayMs);
        // Exponential backoff, capped at 30s - Solana ws drops at hourly scale.
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, 30_000);
    }

    private handleLogLine(line: string, slot: number): void {
        // Anchor prepends each ix log with "Program log: " or "Program data: ".
        const m = SETTLE_RE.exec(line);
        if (!m) return;
        const matchPda = m[1];
        const winner = m[2];
        const rakeLamports = m[3];
        const potLamports = m[4];
        const at = Math.floor(Date.now() / 1000);

        console.log(`${TAG} SETTLED match=${matchPda.slice(0, 8)}... winner=${winner.slice(0, 8)}... rake=${rakeLamports} pot=${potLamports} slot=${slot}`);

        StatsBucket.bumpSettlement({
            matchPda,
            winner,
            potLamports,
            rakeLamports,
            at,
        });

        // Part 14: if this match was seeded by the tournament host, count
        // the completion for the admin dashboard's "tournaments finished" card.
        if (StatsBucket.isSeededTournament(matchPda)) {
            StatsBucket.bumpTournamentCompleted(matchPda);
            console.log(`${TAG} TOURNAMENT_COMPLETED match=${matchPda.slice(0, 8)}... winner=${winner.slice(0, 8)}...`);
        }

        // Token analytics: resolve session → player squad mints. No session
        // (e.g., legacy settle path without backend) = just skip token bump.
        try {
            const outcome = this.opts.sessions.getOutcomeData(matchPda);
            if (outcome) {
                this.opts.tokenStats.recordOutcome(matchPda, winner, outcome.squads);
                // Refresh admin dashboard's cached top-10 table each settlement.
                StatsBucket.setTokenStats(this.opts.tokenStats.getTopTokens(10));
            }
        } catch (e) {
            console.warn(`${TAG} token_stats | error ${e}`);
        }
    }
}
