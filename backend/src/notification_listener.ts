/**
 * notification_listener.ts - Phase N5 onchain → notifications bridge.
 *
 * Subscribes to program logs via `Connection.onLogs` (mirrors
 * `rake_listener.ts`) and parses raw `msg!()` lines from the program to
 * derive notification events. Caches per-match player rosters from
 * JoinMatch lines so settle events can fan out to all players (not just
 * the winner referenced in the settle log).
 *
 * Events emitted:
 *   - JoinMatch.JOIN  → match_filled (creator) + match_started (all in match) when status=Active
 *   - SettleMatch.FINAL / SettleMatchVerified.FINAL / ForceSettle.FINAL
 *                     → match_settled (all players) + payout (winner only)
 *   - CancelMatch     → lobby_cancelled (refund recipient)
 *
 * Determinism: ids are derived from (matchPda, kind, player) so a client
 * that already locally emitted the same notification de-dupes by id.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { NotificationStore, NotificationKind } from './notification_store';

const TAG = '[notification_listener]';

// Patterns extracted from programs/token-duel/src/instructions/*.rs msg!() format strings.
// Order matters: more-specific lines (verified, force) BEFORE the plain settle.
const SETTLE_VERIFIED_RE = /SettleMatchVerified\.FINAL:\s+match=(\w+)\s+winner=(\w+)\s+winner_height=\d+\s+rake=(\d+)\s+pot=(\d+)/;
const FORCE_SETTLE_RE    = /ForceSettle\.FINAL:\s+match=(\w+)\s+caller=\w+\s+forfeits=\d+\s+winner=(\w+)\s+winner_height=\d+\s+rake=(\d+)\s+pot=(\d+)/;
const SETTLE_RE          = /SettleMatch\.FINAL:\s+match=(\w+)\s+mode=\d+\s+winner=(\w+)\s+winner_height=\d+\s+rake=(\d+)\s+pot=(\d+)/;
const JOIN_CREATE_RE     = /JoinMatch\.CREATE:\s+pda=(\w+)\s+player=(\w+)\s+mode=(\d+)\s+wager=(\d+)\s+seq=\d+\s+xp_bucket=\d+\s+window=(\d+)/;
const JOIN_JOIN_RE       = /JoinMatch\.JOIN:\s+pda=(\w+)\s+player=(\w+)\s+slot=\d+\s+player_count=(\d+)\/(\d+)\s+now_status=(\d+)/;
const CANCEL_RE          = /CancelMatch:\s+match=(\w+)\s+refunded=(\d+)\s+lamports\s+to=(\w+)/;

export interface NotificationListenerOptions {
    connection: Connection;
    programId: PublicKey;
    store: NotificationStore;
}

interface MatchCtx {
    /** All players seen for this match in JoinMatch lines, slot order. */
    players: string[];
    /** From JoinMatch.CREATE: mode (0=1v1, 1=4p, 2=8p, 3=BR10). */
    mode: number;
    /** From JoinMatch.CREATE: wager_lamports per player. */
    wagerLamports: bigint;
    /** From JoinMatch.CREATE: time_window byte (0=30s,1=1m,2=5m,3=1h). */
    window: number;
}

const MODE_LABEL = ['1v1 Duel', '4p Pot', '8p Pot', 'Battle Royale'];
const WINDOW_LABEL = ['30s', '1m', '5m', '1h'];

export class NotificationListener {
    private _subId: number | null = null;
    private _retryDelayMs: number = 2_000;
    private _retryTimer: NodeJS.Timeout | null = null;
    /** matchPda → roster + metadata gleaned from JoinMatch lines. */
    private _matchCtx: Map<string, MatchCtx> = new Map();

    constructor(private readonly opts: NotificationListenerOptions) {}

    async start(): Promise<void> {
        try {
            this._subId = this.opts.connection.onLogs(
                this.opts.programId,
                (info, ctx) => {
                    if (info.err) return;
                    for (const line of info.logs) this._handleLine(line, ctx.slot);
                },
                'confirmed',
            );
            console.log(`${TAG} start | OK sub_id=${this._subId} program=${this.opts.programId.toBase58()}`);
            this._retryDelayMs = 2_000;
        } catch (e) {
            console.warn(`${TAG} start | FAIL ${e} - retrying in ${this._retryDelayMs}ms`);
            this._scheduleRetry();
        }
    }

    async shutdown(): Promise<void> {
        if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
        if (this._subId !== null) {
            try { await this.opts.connection.removeOnLogsListener(this._subId); } catch (_) { /* ignore */ }
            this._subId = null;
        }
    }

    private _scheduleRetry(): void {
        this._retryTimer = setTimeout(() => {
            this._retryTimer = null;
            void this.start();
        }, this._retryDelayMs);
        this._retryDelayMs = Math.min(this._retryDelayMs * 2, 30_000);
    }

    private _handleLine(line: string, slot: number): void {
        // CREATE - first player joins a fresh match.
        let m: RegExpExecArray | null;
        if ((m = JOIN_CREATE_RE.exec(line))) {
            const [, matchPda, player, modeStr, wagerStr, windowStr] = m;
            this._matchCtx.set(matchPda, {
                players: [player],
                mode: parseInt(modeStr, 10),
                wagerLamports: BigInt(wagerStr),
                window: parseInt(windowStr, 10),
            });
            console.log(`${TAG} JOIN_CREATE match=${matchPda.slice(0, 8)} player=${player.slice(0, 8)} mode=${modeStr} wager=${wagerStr} window=${windowStr}`);
            return;
        }
        // JOIN - additional player. Cache + emit on Active flip.
        if ((m = JOIN_JOIN_RE.exec(line))) {
            const [, matchPda, player, countStr, requiredStr, statusStr] = m;
            const ctx = this._matchCtx.get(matchPda) ?? { players: [], mode: 0, wagerLamports: 0n, window: 0 };
            if (!ctx.players.includes(player)) ctx.players.push(player);
            this._matchCtx.set(matchPda, ctx);
            const status = parseInt(statusStr, 10);
            const playerCount = parseInt(countStr, 10);
            const required = parseInt(requiredStr, 10);
            console.log(`${TAG} JOIN_JOIN match=${matchPda.slice(0, 8)} player=${player.slice(0, 8)} count=${playerCount}/${required} status=${status}`);
            if (status === 1 /* Active */) {
                // Fan out match_started to ALL players in roster.
                const modeLabel = MODE_LABEL[ctx.mode] ?? `mode${ctx.mode}`;
                const windowLabel = WINDOW_LABEL[ctx.window] ?? '?';
                const wagerSol = Number(ctx.wagerLamports) / 1e9;
                for (const p of ctx.players) {
                    const isCreator = ctx.players[0] === p && p !== player;
                    this.opts.store.push({
                        id: `${isCreator ? 'filled' : 'started'}:${matchPda}:${p}`,
                        kind: (isCreator ? 'match_filled' : 'match_started') as NotificationKind,
                        player: p,
                        title: isCreator ? 'Lobby filled!' : 'Match starting!',
                        body: isCreator
                            ? `Your ${modeLabel} lobby just filled - race begins now (${windowLabel}, ${wagerSol.toFixed(3)} SOL).`
                            : `${modeLabel} · ${windowLabel} race · ${wagerSol.toFixed(3)} SOL · tap to spectate.`,
                        payload: { matchPda },
                    });
                }
            }
            return;
        }
        // CANCEL - refund landed.
        if ((m = CANCEL_RE.exec(line))) {
            const [, matchPda, refundLamports, recipient] = m;
            const sol = Number(BigInt(refundLamports)) / 1e9;
            console.log(`${TAG} CANCEL match=${matchPda.slice(0, 8)} refund=${refundLamports} to=${recipient.slice(0, 8)}`);
            this.opts.store.push({
                id: `cancelled:${matchPda}:${recipient}`,
                kind: 'lobby_cancelled',
                player: recipient,
                title: 'Lobby cancelled',
                body: `Refund of ${sol.toFixed(3)} SOL landed in your wallet.`,
                payload: { matchPda, lamports: refundLamports },
            });
            this._matchCtx.delete(matchPda);
            return;
        }
        // SETTLE - winner-take-all + per-player notify.
        let settleMatch: RegExpExecArray | null = null;
        if ((settleMatch = SETTLE_VERIFIED_RE.exec(line)) || (settleMatch = FORCE_SETTLE_RE.exec(line)) || (settleMatch = SETTLE_RE.exec(line))) {
            const [, matchPda, winner, rakeStr, potStr] = settleMatch;
            const pot = BigInt(potStr);
            const rake = BigInt(rakeStr);
            const distributable = pot > rake ? pot - rake : 0n;
            const ctx = this._matchCtx.get(matchPda);
            const players = ctx ? ctx.players : [winner]; // fallback: winner only
            const modeLabel = ctx ? (MODE_LABEL[ctx.mode] ?? `mode${ctx.mode}`) : 'Match';
            console.log(`${TAG} SETTLE match=${matchPda.slice(0, 8)} winner=${winner.slice(0, 8)} pot=${potStr} rake=${rakeStr} players=${players.length}`);
            for (const p of players) {
                const isWinner = p === winner;
                this.opts.store.push({
                    id: `settled:${matchPda}:${p}`,
                    kind: 'match_settled',
                    player: p,
                    title: isWinner ? 'You won!' : 'Match settled',
                    body: `${modeLabel} · ${isWinner ? 'top placement' : 'better luck next round'}.`,
                    payload: { matchPda, won: isWinner },
                });
            }
            // Winner gets a separate payout notification with the amount.
            // Top-1 takes (winner-bps × distributable / 10000) - for 1v1 that's 100% of distributable.
            // For multi-player modes, the listener can't know per-rank payout without
            // fetching the match account; emit total distributable as the upper bound.
            const sol = Number(distributable) / 1e9;
            if (sol > 0) {
                this.opts.store.push({
                    id: `payout:${matchPda}:${winner}`,
                    kind: 'payout',
                    player: winner,
                    title: `You won ${sol.toFixed(3)} SOL!`,
                    body: `${modeLabel} payout landed in your wallet.`,
                    payload: { matchPda, lamports: distributable.toString() },
                });
            }
            this._matchCtx.delete(matchPda);
            return;
        }
    }
}
