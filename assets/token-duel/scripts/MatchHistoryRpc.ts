/**
 * MatchHistoryRpc.ts — Part 9 paginated match-history fetcher.
 *
 * Data flow:
 *   1. Derive the caller's UserStats PDA (seeds: [b"userstats", player]).
 *   2. `getSignaturesForAddress(pda, { limit, before })` — every settle_match
 *      tx touches the caller's UserStats account, so its signature log is
 *      the authoritative per-user match index.
 *   3. For each signature, fetch the transaction's logMessages and decode
 *      any `MatchSettled` / `MatchForceSettled` `Program data:` lines.
 *   4. For each decoded event, enrich with the Match account data (mode,
 *      time_window, wager_lamports, full player list) so the UI can show
 *      mode, window, and the caller's placement.
 *
 * Match-account fetches are memoized in a caller-provided cache map so
 * Load-More doesn't re-fetch the same account when events are grouped.
 */

import { AnchorBackend } from './AnchorBackend';
import { TokenDuelRpc } from './TokenDuelRpc';
import { decodeMatchEventLogs, MatchSettledEvent, MatchForceSettledEvent } from './EventDecoder';
import { getMatch, MatchState } from './MatchRpc';

const TAG = '[MatchHistoryRpc]';

export interface MatchHistoryEntry {
    /** Tx signature (canonical id + deterministic sort key). */
    sig: string;
    /** Unix seconds, from the event payload (Clock::get().unix_timestamp). */
    at: number;
    /** 0=1v1 / 1=4p / 2=8p / 3=BR10. */
    mode: number;
    /** 0=1h / 1=24h / 2=3d / 3=7d. */
    timeWindow: number;
    /** Wager each player put in. */
    wagerLamports: bigint;
    /** Total pot (wager × required_players). */
    pot: bigint;
    /** 0-indexed placement for the caller. `-1` if we can't resolve. */
    placement: number;
    requiredPlayers: number;
    /** Payout lamports to the caller (0 if unranked). */
    payoutLamports: bigint;
    winnerPubkey: string;
    matchPda: string;
    /** True when this came from force_settle (AFK reclaim), not normal settle. */
    wasForceSettled: boolean;
}

export interface MatchHistoryPage {
    entries: MatchHistoryEntry[];
    /** Cursor for the next page (pass as `beforeSig` to fetch older). */
    nextCursor: string | null;
}

/**
 * Fetch one page of history, newest-first. Pass `beforeSig` to continue
 * pagination. `matchCache` memoizes Match-account RPC responses across
 * pages — populate the same Map on every call.
 */
export async function fetchMatchHistoryPage(opts: {
    rpc: TokenDuelRpc;
    userPubkey: string;
    beforeSig?: string;
    limit?: number;
    matchCache: Map<string, MatchState | null>;
}): Promise<MatchHistoryPage> {
    const limit = opts.limit ?? 30;
    const userStatsPda = AnchorBackend.deriveUserStatsPda(opts.userPubkey);
    console.log(`${TAG} fetchMatchHistoryPage | START user=${opts.userPubkey.substring(0, 8)}... pda=${userStatsPda.substring(0, 8)}... before=${opts.beforeSig ?? '-'} limit=${limit}`);

    const sigs = await opts.rpc.getSignaturesForAddress(userStatsPda, { limit, before: opts.beforeSig });
    if (sigs.length === 0) {
        console.log(`${TAG} fetchMatchHistoryPage | EMPTY user=${opts.userPubkey.substring(0, 8)}...`);
        return { entries: [], nextCursor: null };
    }

    const entries: MatchHistoryEntry[] = [];
    let seenEvents = 0;
    for (const sigRec of sigs) {
        if (sigRec.err) continue;
        const tx = await opts.rpc.getTransaction(sigRec.signature);
        const logs = tx?.meta?.logMessages ?? null;
        const events = decodeMatchEventLogs(logs);
        if (events.length === 0) continue;
        seenEvents += events.length;

        // Group by matchPda: a single tx typically emits at most one
        // MatchSettled + one MatchForceSettled (from the force_settle path).
        const settledByPda = new Map<string, MatchSettledEvent>();
        const forcedByPda = new Map<string, MatchForceSettledEvent>();
        for (const ev of events) {
            if (ev.kind === 'MatchSettled') settledByPda.set(ev.matchPda, ev);
            else forcedByPda.set(ev.matchPda, ev);
        }

        for (const [pda, ev] of settledByPda) {
            const entry = await buildEntry(opts.rpc, opts.userPubkey, opts.matchCache, sigRec.signature, ev, forcedByPda.has(pda));
            if (entry) entries.push(entry);
        }
    }

    const nextCursor = sigs.length >= limit ? sigs[sigs.length - 1].signature : null;
    console.log(`${TAG} fetchMatchHistoryPage | DONE sigs=${sigs.length} events=${seenEvents} entries=${entries.length} next=${nextCursor ? nextCursor.substring(0, 16) + '...' : '-'}`);
    return { entries, nextCursor };
}

async function buildEntry(
    rpc: TokenDuelRpc,
    userPubkey: string,
    cache: Map<string, MatchState | null>,
    sig: string,
    ev: MatchSettledEvent,
    wasForceSettled: boolean,
): Promise<MatchHistoryEntry | null> {
    let match = cache.get(ev.matchPda);
    if (match === undefined) {
        match = await getMatch(rpc, ev.matchPda);
        cache.set(ev.matchPda, match);
    }
    if (!match) {
        console.log(`${TAG} buildEntry | MATCH_GONE pda=${ev.matchPda.substring(0, 8)}... — falling back to event-only`);
        return {
            sig,
            at: Number(ev.at),
            mode: 0,
            timeWindow: 0,
            wagerLamports: 0n,
            pot: ev.pot,
            placement: -1,
            requiredPlayers: ev.settledCount,
            payoutLamports: 0n,
            winnerPubkey: ev.winner,
            matchPda: ev.matchPda,
            wasForceSettled,
        };
    }

    const n = match.requiredPlayers;
    const players = match.players.slice(0, n);
    const heights = match.heights.slice(0, n).map((h) => (h === 0xffffffff ? 0 : h));
    const mySlot = players.indexOf(userPubkey);

    // Recompute placement the same way the program does: sort by height desc,
    // the caller's rank in the sorted array is their placement.
    const indexed = heights.map((h, i) => ({ slot: i, h }))
        .sort((a, b) => b.h - a.h);
    const placement = mySlot >= 0 ? indexed.findIndex((x) => x.slot === mySlot) : -1;

    // Payout: distributable × payoutBps[rank] / 10_000 when rank < K.
    // We already have `pot` + `rake` from the event, so distributable is
    // (pot - rake) and we just need the payout table.
    const distributable = ev.pot - ev.rake;
    const payoutBps = payoutTableForMode(match.mode);
    let payoutLamports = 0n;
    if (placement >= 0 && placement < payoutBps.length) {
        const bps = BigInt(payoutBps[placement]);
        payoutLamports = (distributable * bps) / 10_000n;
    }

    return {
        sig,
        at: Number(ev.at),
        mode: match.mode,
        timeWindow: match.timeWindow,
        wagerLamports: match.wagerLamports,
        pot: ev.pot,
        placement,
        requiredPlayers: n,
        payoutLamports,
        winnerPubkey: ev.winner,
        matchPda: ev.matchPda,
        wasForceSettled,
    };
}

/** Mirrors `GameMode::payout_table()` in state.rs. */
function payoutTableForMode(modeU8: number): number[] {
    if (modeU8 === 0) return [10_000];
    if (modeU8 === 1) return [7_000, 3_000];
    if (modeU8 === 2) return [5_000, 3_000, 2_000];
    if (modeU8 === 3) return [5_000, 2_500, 1_500, 1_000];
    return [];
}
