/**
 * Matchmaker.ts — orchestrates match lifecycle.
 *
 * This session's MVP ships:
 *   - `runPaperBotMatch(...)` — immediate client-side bot match (paper track)
 *   - `tryFindRealMatch(...)` — SCAFFOLD, returns null until Part 3 wires the
 *     full getProgramAccounts discovery + 3s poll loop
 *
 * Part 3 will extend this with:
 *   - `joinOrCreateRealMatch(...)` — compose + sign + submit join_match tx
 *   - `waitForOpponent(matchPda, timeoutMs, onPoll)` — 3s poll until Active or timeout
 *   - `fallbackToBot(...)` — when real match times out, offer bot
 */

import { ModeId, MODES, WAGER_TIERS_LAMPORTS, MATCH_WAIT_TIMEOUT_MS } from './ModeDefs';
import { Stats } from './Stats';
import { TokenDuelRpc } from './TokenDuelRpc';
import { AnchorBackend } from './AnchorBackend';
import { findOpenMatches, getMatch, getMatchCounter, MatchState } from './MatchRpc';
import { computeModePayout, xpForPlacement } from './PayoutCalc';
import { encodeDeltaPct } from './ScoreEncoding';
import { sampleInstantBotOutcome, BotSquadEntry } from './SquadBot';
import { BotDifficulty, VettedMint } from './VettedMints';

const TAG = '[Matchmaker]';

export interface MatchOutcome {
    /** Player's own score (encoded u32 delta on betting-duel). */
    playerHeight: number;
    /** Best opponent score (encoded delta). */
    opponentHeight: number;
    /** All bot scores (N-1 long). Encoded deltas on betting-duel. */
    botHeights: number[];
    playerWon: boolean;
    /** 0-indexed placement (0 = 1st). */
    placement: number;
    /** Total players in the match (requiredPlayers). */
    totalPlayers: number;
    payoutLamports: number;
    xpGained: number;
    track: 'paper' | 'real';
    isBot: boolean;
    /** betting-duel: bot squads for PostMatchPanel reveal (optional — real matches won't populate). */
    botSquads?: BotSquadEntry[][];
}

/**
 * Run a paper bot match immediately — no chain interaction.
 *
 * betting-duel: samples N-1 bot squads via SquadBot.sampleInstantBotOutcome,
 * encodes each bot's portfolio delta, ranks player vs bots by delta, and
 * computes placement + payout via the shared computeModePayout helper.
 *
 * `opts.playerHeight` is the player's **encoded** score (u32 delta) from
 * PortfolioRace. Bot outputs are encoded identically so rank-by-height
 * matches rank-by-delta. Higher score = higher delta = better rank.
 *
 * `opts.leaderboardHeights` and `botGamesRemaining` are legacy stack-jump
 * params — unused on betting-duel (bot distribution isn't anchored to a
 * per-player leaderboard), but kept in the signature for call-site stability.
 */
export function runPaperBotMatch(opts: {
    mode: ModeId;
    wagerTierLamports: number;
    playerHeight: number;
    leaderboardHeights: number[];
    botGamesRemaining: number;
    /** betting-duel: window from ModePicker, drives bot delta magnitude. */
    windowMs?: number;
    /** Phase E — bot difficulty (default medium for back-compat). */
    difficulty?: BotDifficulty;
    /** Phase E — caller-supplied Birdeye gainers snapshot for Hard mode. */
    hardGainersSnapshot?: VettedMint[];
}): MatchOutcome {
    const mode = MODES[opts.mode];
    const n = mode.requiredPlayers;
    const windowMs = opts.windowMs && opts.windowMs > 0 ? opts.windowMs : 30_000;
    const difficulty: BotDifficulty = opts.difficulty ?? 'medium';
    const gainersSnapshot = opts.hardGainersSnapshot ?? [];
    console.log(`${TAG} runPaperBotMatch | START mode=${opts.mode} players=${n} wager=${opts.wagerTierLamports} player_score=${opts.playerHeight} windowMs=${windowMs} difficulty=${difficulty} gainers_snapshot=${gainersSnapshot.length}`);

    // Sample N-1 bot squads.
    const botSquads: BotSquadEntry[][] = [];
    const botHeights: number[] = [];
    for (let i = 0; i < n - 1; i++) {
        const outcome = sampleInstantBotOutcome(windowMs, difficulty, gainersSnapshot);
        const encoded = encodeDeltaPct(outcome.portfolioDeltaPct);
        botHeights.push(encoded);
        botSquads.push(outcome.squad);
    }

    const heights: number[] = [opts.playerHeight, ...botHeights];
    const pot = opts.wagerTierLamports * n;
    const breakdown = computeModePayout(opts.mode, pot, heights);
    const playerRankIdx = breakdown.sortedSlots.indexOf(0);
    const payoutLamports = playerRankIdx < breakdown.winnerLamports.length
        ? breakdown.winnerLamports[playerRankIdx]
        : 0;
    const xp = xpForPlacement(opts.mode, playerRankIdx);
    const pnl = payoutLamports - opts.wagerTierLamports;
    const playerWon = payoutLamports > 0;
    Stats.record('paper', playerWon, pnl);
    Stats.recordLastMatch({
        outcome: playerWon ? 'win' : 'loss',
        deltaSol: pnl / 1e9,
        modeLabel: mode.shortLabel,
        stakeSol: opts.wagerTierLamports / 1e9,
        atSec: Math.floor(Date.now() / 1000),
    });

    // Best opponent = highest-scoring bot (not the sorted-slot neighbor —
    // we want the strongest competitor for the reveal's BEST OPP card).
    const bestOpp = botHeights.reduce((a, b) => (b > a ? b : a), 0);

    console.log(`${TAG} runPaperBotMatch | DONE placement=${playerRankIdx + 1}/${n} player_score=${opts.playerHeight} bots=[${botHeights.join(',')}] best_opp=${bestOpp} won=${playerWon} payout=${payoutLamports} xp=${xp} pnl=${pnl}`);
    return {
        playerHeight: opts.playerHeight,
        opponentHeight: bestOpp,
        botHeights,
        playerWon,
        placement: playerRankIdx,
        totalPlayers: n,
        payoutLamports,
        xpGained: xp,
        track: 'paper',
        isBot: true,
        botSquads,
    };
}

// ═══════════════════════════════════════════════════════════════════
// Session D Part 3 — real-mode orchestration (tx builder + poll loop)
// AppUI owns MWA signing; Matchmaker supplies tx bytes + blockhash.
// ═══════════════════════════════════════════════════════════════════

export interface RealMatchResolution {
    /** 'create' → caller creates a fresh Match at seq; 'join' → caller joins existing match */
    action: 'create' | 'join';
    /** Match PDA the caller should operate on */
    matchPda: string;
    /** Seq used (only meaningful when action=create) */
    seq: bigint;
    /** Tx bytes ready to sign + send via MWA */
    txBytes: Uint8Array;
    /** Recent blockhash baked into the tx */
    blockhash: string;
}

/**
 * Decide whether to create or join a match, then build the corresponding tx.
 * Tie-breaking: if multiple open matches exist, pick the oldest (longest wait).
 *
 * Caller supplies `blockhash` (from SolanaRpc.getLatestBlockhash) since
 * TokenDuelRpc doesn't expose that method natively.
 */
export async function resolveRealMatchAction(opts: {
    rpc: TokenDuelRpc;
    playerPubkey: string;
    mode: ModeId;
    wagerTierIndex: number;
    xpBucket: number;
    /** Part 9: 0=1h, 1=24h, 2=3d, 3=7d. Filters matchmaking + stored on Match. */
    timeWindow: number;
    blockhash: string;
    /** Phase B: skip the search and always build a create tx (host flow). */
    forceCreate?: boolean;
    /** Phase A: build a join tx for this exact match PDA (browser explicit join).
     *  When set, `findOpenMatches` is bypassed and `forceCreate` is ignored. */
    explicitMatchPda?: string;
}): Promise<RealMatchResolution> {
    console.log(`${TAG} resolveRealMatchAction | START player=${opts.playerPubkey} mode=${opts.mode} tier=${opts.wagerTierIndex} xp_bucket=${opts.xpBucket} window=${opts.timeWindow} forceCreate=${opts.forceCreate ? 'yes' : 'no'} explicit=${opts.explicitMatchPda ?? 'none'}`);
    const modeDef = MODES[opts.mode];
    const modeU8 = modeDef.modeU8;

    if (opts.explicitMatchPda) {
        const tx = AnchorBackend.buildJoinMatchJoinTx(opts.playerPubkey, opts.explicitMatchPda, opts.blockhash);
        console.log(`${TAG} resolveRealMatchAction | JOIN_EXPLICIT match=${opts.explicitMatchPda}`);
        return { action: 'join', matchPda: opts.explicitMatchPda, seq: 0n, txBytes: tx, blockhash: opts.blockhash };
    }

    if (!opts.forceCreate) {
        const open = await findOpenMatches(opts.rpc, modeU8, opts.wagerTierIndex, opts.xpBucket, opts.timeWindow);
        const joinable = open.filter((m) => !m.players.includes(opts.playerPubkey));
        joinable.sort((a, b) => Number(a.createdAt - b.createdAt));

        if (joinable.length > 0) {
            const target = joinable[0];
            const tx = AnchorBackend.buildJoinMatchJoinTx(opts.playerPubkey, target.pda, opts.blockhash);
            console.log(`${TAG} resolveRealMatchAction | JOIN match=${target.pda} seq=${target.seq}`);
            return { action: 'join', matchPda: target.pda, seq: target.seq, txBytes: tx, blockhash: opts.blockhash };
        }
    }

    const counter = await getMatchCounter(opts.rpc);
    const seq = counter?.seq ?? 0n;
    const matchPda = AnchorBackend.deriveMatchPda(modeU8, opts.wagerTierIndex, seq);
    const tx = AnchorBackend.buildJoinMatchCreateTx(
        opts.playerPubkey, modeU8, opts.wagerTierIndex, opts.xpBucket, opts.timeWindow, seq, opts.blockhash,
    );
    console.log(`${TAG} resolveRealMatchAction | CREATE seq=${seq} match=${matchPda} forced=${opts.forceCreate ? 'yes' : 'no'}`);
    return { action: 'create', matchPda, seq, txBytes: tx, blockhash: opts.blockhash };
}

/**
 * Session D Part 8: retry wrapper around `resolveRealMatchAction`.
 *
 * Handles the `MatchCounter` race: client reads `counter.seq = N`, derives
 * matchPda_N, submits `join_match_create(seq=N)`. If a concurrent client
 * won the race, their tx landed first, counter is now N+1, matchPda_N
 * exists, and our tx fails with `AccountAlreadyInUse`. We catch that,
 * re-read the counter, re-derive, re-sign, retry.
 *
 * Non-race errors bubble up immediately. Throws `CounterRetryExhausted` if
 * `maxRetries` attempts all fail.
 */
export class CounterRetryExhausted extends Error {
    constructor(public attempts: number, public lastError: Error) {
        super(`joinOrCreateWithRetry exhausted after ${attempts} attempts: ${lastError.message}`);
        this.name = 'CounterRetryExhausted';
    }
}

export interface JoinOrCreateResult {
    action: 'create' | 'join';
    matchPda: string;
    seq: bigint;
    signature: string;
    attempts: number;
}

const RACE_MARKERS = [
    'already in use',
    'AccountAlreadyInUse',
    'custom program error: 0x0',
    '0x0',
];

function isCounterRace(err: any): boolean {
    const msg = (err?.message ?? String(err)).toLowerCase();
    return RACE_MARKERS.some((m) => msg.includes(m.toLowerCase()));
}

export async function joinOrCreateWithRetry(opts: {
    rpc: TokenDuelRpc;
    playerPubkey: string;
    mode: ModeId;
    wagerTierIndex: number;
    xpBucket: number;
    timeWindow: number;
    signAndSend: (txBytes: Uint8Array, blockhash: string) => Promise<string>;
    getBlockhash: () => Promise<string>;
    onRetry?: (attempt: number, max: number) => void;
    maxRetries?: number;
    /** Phase B: always create a fresh lobby (skip auto-search). */
    forceCreate?: boolean;
    /** Phase A: explicit-join from the FindMatchPanel browser. */
    explicitMatchPda?: string;
}): Promise<JoinOrCreateResult> {
    const maxRetries = opts.maxRetries ?? 3;
    let lastError: Error = new Error('no attempts');
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const blockhash = await opts.getBlockhash();
        const resolved = await resolveRealMatchAction({
            rpc: opts.rpc,
            playerPubkey: opts.playerPubkey,
            mode: opts.mode,
            wagerTierIndex: opts.wagerTierIndex,
            xpBucket: opts.xpBucket,
            timeWindow: opts.timeWindow,
            blockhash,
            forceCreate: opts.forceCreate,
            explicitMatchPda: opts.explicitMatchPda,
        });
        console.log(`${TAG} joinOrCreateWithRetry | attempt=${attempt} action=${resolved.action} seq=${resolved.seq} match=${resolved.matchPda}`);
        try {
            const signature = await opts.signAndSend(resolved.txBytes, blockhash);
            console.log(`${TAG} joinOrCreateWithRetry | SUCCESS attempt=${attempt} sig=${signature}`);
            return {
                action: resolved.action,
                matchPda: resolved.matchPda,
                seq: resolved.seq,
                signature,
                attempts: attempt,
            };
        } catch (e: any) {
            lastError = e instanceof Error ? e : new Error(String(e));
            if (!isCounterRace(e)) {
                console.log(`${TAG} joinOrCreateWithRetry | NON_RACE_ERROR attempt=${attempt} msg="${lastError.message}" — bubbling up`);
                throw lastError;
            }
            if (attempt >= maxRetries) {
                console.log(`${TAG} joinOrCreateWithRetry | RACE_EXHAUSTED attempts=${attempt} msg="${lastError.message}"`);
                break;
            }
            const backoffMs = 250 * Math.pow(2, attempt - 1); // 250ms, 500ms, 1000ms
            console.log(`${TAG} joinOrCreateWithRetry | RACE attempt=${attempt}/${maxRetries} msg="${lastError.message}" backoff=${backoffMs}ms`);
            try { opts.onRetry?.(attempt, maxRetries); } catch (_) { /* listener errors ignored */ }
            await new Promise((r) => setTimeout(r, backoffMs));
        }
    }
    throw new CounterRetryExhausted(maxRetries, lastError);
}

export interface WaitPollUpdate {
    elapsedMs: number;
    playerCount: number;
    requiredPlayers: number;
    status: number; // 0=Waiting 1=Active 2=Settled 3=Cancelled
    state: MatchState | null;
}

/**
 * Poll Match PDA every 3s until it's Active, Settled, Cancelled, or timeout.
 * Returns the final MatchState. Caller decides next action (start game, cancel, fallback).
 */
export async function waitForOpponent(
    rpc: TokenDuelRpc,
    matchPda: string,
    timeoutMs: number = MATCH_WAIT_TIMEOUT_MS,
    onPoll?: (u: WaitPollUpdate) => void,
): Promise<{ outcome: 'active' | 'settled' | 'cancelled' | 'timeout'; state: MatchState | null }> {
    const start = Date.now();
    // Phase D — stepped cadence: 3s for the first 2 min (typical match-fill
    // window) then 30s for the rest of the 24h lobby ttl. Saves RPC.
    const FAST_INTERVAL_MS = 3_000;
    const SLOW_INTERVAL_MS = 30_000;
    const FAST_WINDOW_MS = 120_000;
    console.log(`${TAG} waitForOpponent | START match=${matchPda} timeout=${timeoutMs}ms cadence=3s→30s@${FAST_WINDOW_MS}ms`);
    let polls = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        polls += 1;
        const elapsed = Date.now() - start;
        const state = await getMatch(rpc, matchPda);
        const update: WaitPollUpdate = {
            elapsedMs: elapsed,
            playerCount: state?.playerCount ?? 0,
            requiredPlayers: state?.requiredPlayers ?? 2,
            status: state?.status ?? 0,
            state,
        };
        console.log(`${TAG} waitForOpponent | POLL ${polls} status=${update.status} player_count=${update.playerCount}/${update.requiredPlayers} elapsed=${elapsed}ms`);
        try { onPoll?.(update); } catch (_) { /* ignore listener errors */ }
        if (state) {
            if (state.status === 1 /* Active */) return { outcome: 'active', state };
            if (state.status === 2 /* Settled */) return { outcome: 'settled', state };
            if (state.status === 3 /* Cancelled */) return { outcome: 'cancelled', state };
        }
        if (elapsed >= timeoutMs) {
            console.log(`${TAG} waitForOpponent | TIMEOUT after ${elapsed}ms polls=${polls}`);
            return { outcome: 'timeout', state };
        }
        const intervalMs = elapsed > FAST_WINDOW_MS ? SLOW_INTERVAL_MS : FAST_INTERVAL_MS;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
}

/**
 * Session D Part 6: mode-generic settle_match tx builder.
 *
 * Splits into partial-vs-final-settler logic:
 *
 *   - If this is NOT the last settler (settled_count + 1 < required): the
 *     program's final-settle branch doesn't run, so payout-recipient
 *     verification is skipped. We pass EMPTY payout recipients + all N
 *     stats accounts (they're not read in this branch either, but we
 *     include them for a consistent client shape).
 *
 *   - If this IS the last settler: project self-height into own slot, sort
 *     slots descending by height, and supply the top-K sorted pubkeys as
 *     payout recipients in rank order. Program verifies each against
 *     players[sorted_slot].
 *
 * Caller (AppUI) MUST fetch a fresh MatchState immediately before calling
 * so settled_count + heights[] reflect everyone's submissions.
 */
import { modeFromU8 } from './ModeDefs';

export function buildSettleMatchTxFor(opts: {
    matchState: MatchState;
    playerPubkey: string;
    height: number;
    blockhash: string;
}): Uint8Array {
    const { matchState } = opts;
    const required = matchState.requiredPlayers;
    const n = required;
    const allPlayers = matchState.players.slice(0, n);
    const mode = modeFromU8(matchState.mode);

    const isFinalSettler = matchState.settledCount + 1 >= required;
    let payoutRecipients: string[] = [];

    if (isFinalSettler) {
        // Project own height into own slot.
        let mySlot = -1;
        for (let i = 0; i < n; i++) {
            if (matchState.players[i] === opts.playerPubkey) { mySlot = i; break; }
        }
        if (mySlot < 0) {
            console.log(`${TAG} buildSettleMatchTxFor | WARN self not in match players`);
        }
        const heights = matchState.heights.slice(0, n);
        if (mySlot >= 0) heights[mySlot] = opts.height;
        const pot = Number(matchState.wagerLamports) * required;
        const breakdown = computeModePayout(mode.id, pot, heights);
        payoutRecipients = breakdown.winnerSlots.map((slot) => allPlayers[slot]);
        console.log(`${TAG} buildSettleMatchTxFor | FINAL mode=${mode.id} sorted_slots=[${breakdown.sortedSlots.join(',')}] winner_slots=[${breakdown.winnerSlots.join(',')}]`);
    } else {
        console.log(`${TAG} buildSettleMatchTxFor | PARTIAL settled_count=${matchState.settledCount}/${required}`);
    }

    console.log(`${TAG} buildSettleMatchTxFor | match=${matchState.pda} mode=${matchState.mode} self=${opts.playerPubkey} height=${opts.height} n=${n} k=${payoutRecipients.length}`);
    return AnchorBackend.buildSettleMatchTx(
        opts.playerPubkey,
        matchState.pda,
        matchState.mode,
        allPlayers,
        payoutRecipients,
        opts.height,
        opts.blockhash,
    );
}

/**
 * Poll Match PDA after a player submitted `settle_match`. Resolves when
 * status becomes Settled OR the cap elapses. Used by AppUI's real-mode
 * game-over flow to show the PostMatchPanel once final settlement lands.
 *
 * Shorter cadence than waitForOpponent (1s vs 3s) because settlement is
 * typically seconds away after both players have submitted their height.
 */
/**
 * Part 9: build a force_settle tx for an Active match that's past its AFK
 * timeout. Mirrors the final-settler path of buildSettleMatchTxFor but
 * normalizes u32::MAX height slots to 0 before ranking — on-chain, the
 * program does the same before reusing compute_mode_payout.
 */
export function buildForceSettleTxFor(opts: {
    matchState: MatchState;
    callerPubkey: string;
    blockhash: string;
}): Uint8Array {
    const { matchState } = opts;
    const n = matchState.requiredPlayers;
    const allPlayers = matchState.players.slice(0, n);
    const mode = modeFromU8(matchState.mode);

    // AFK players have u32::MAX — treat them as 0 for ranking (u32::MAX would
    // sort to top if left alone). This mirrors force_settle.rs scope 1.
    const heights = matchState.heights.slice(0, n).map((h) => (h === 0xffffffff ? 0 : h));
    const pot = Number(matchState.wagerLamports) * n;
    const breakdown = computeModePayout(mode.id, pot, heights);
    const payoutRecipients = breakdown.winnerSlots.map((slot) => allPlayers[slot]);
    console.log(`${TAG} buildForceSettleTxFor | mode=${mode.id} match=${matchState.pda} caller=${opts.callerPubkey} n=${n} k=${payoutRecipients.length} sorted_slots=[${breakdown.sortedSlots.join(',')}] winner_slots=[${breakdown.winnerSlots.join(',')}]`);
    return AnchorBackend.buildForceSettleTx(
        opts.callerPubkey,
        matchState.pda,
        matchState.mode,
        allPlayers,
        payoutRecipients,
        opts.blockhash,
    );
}

export async function waitForSettlement(
    rpc: TokenDuelRpc,
    matchPda: string,
    timeoutMs: number = 30_000,
): Promise<{ outcome: 'settled' | 'timeout'; state: MatchState | null }> {
    const start = Date.now();
    const intervalMs = 1000;
    console.log(`${TAG} waitForSettlement | START match=${matchPda} timeout=${timeoutMs}ms`);
    let polls = 0;
    while (true) {
        polls += 1;
        const elapsed = Date.now() - start;
        const state = await getMatch(rpc, matchPda);
        if (state?.status === 2 /* Settled */) {
            console.log(`${TAG} waitForSettlement | SETTLED polls=${polls} elapsed=${elapsed}ms`);
            return { outcome: 'settled', state };
        }
        if (elapsed >= timeoutMs) {
            console.log(`${TAG} waitForSettlement | TIMEOUT polls=${polls} status=${state?.status ?? '?'}`);
            return { outcome: 'timeout', state };
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
}

export { WAGER_TIERS_LAMPORTS, MATCH_WAIT_TIMEOUT_MS };
