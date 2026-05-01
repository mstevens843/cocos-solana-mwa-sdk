/**
 * SquadBot.ts — synthesizes a bot opponent for Paper-mode betting-duel matches.
 *
 * The stack-jump era used `BotOpponent.ts` (sampled tower heights from a
 * leaderboard-anchored distribution). Betting-duel needs a competitor whose
 * outcome is a portfolio-delta %, so this module builds a bot squad (3
 * vetted mints) and produces a plausible delta for them over a given
 * window.
 *
 * Two modes of sampling, picked based on how long the caller wants to wait:
 *
 *   1. **Live** — fetch entry prices now, wait windowMs, fetch again,
 *      compute real delta. Used when PortfolioRace is already waiting.
 *
 *   2. **Synthetic** — don't wait. Use each token's 24h change as a noise
 *      seed to generate a plausible delta over `windowMs`. Used for the
 *      Paper-bot-match fast path where we don't want an extra N-second wait
 *      after the player's race ends.
 *
 * Determinism: both paths are seeded by (mintList, windowMs, floor(now/windowMs))
 * so rapidly-repeated paper matches don't return identical bot outcomes,
 * but a specific tick of a specific match is replayable.
 *
 * Intentional anti-troll: picks are limited to VETTED_MINTS so the bot's
 * portfolio doesn't include the obviously-rugged tokens in the live feed.
 */

import { PriceFeed } from './PriceFeed';
import { VETTED_MINTS, VettedMint, randomVettedTrio, randomTrioForDifficulty, BotDifficulty } from './VettedMints';
import { BOT_DIFFICULTY_MULTIPLIERS } from './ModeDefs';
import { DEMO_FAKE_PRICES } from './DemoFlags';

const TAG = '[SquadBot]';

// TODO: when DEMO_FAKE_PRICES === false, wire LiveSquadBot to poll real
// Birdeye prices (mirroring PortfolioRace's live mode) so player + bot stay
// symmetric. Today the bot is synthetic in both branches; the player honors
// the flag, but the bot keeps its existing eased random walk regardless.
// See assets/token-duel/scripts/DemoFlags.ts.

export type { BotDifficulty } from './VettedMints';

export interface BotSquadEntry {
    mint: string;
    symbol: string;
    /** 24h delta reported by Birdeye at squad-pick time, used as volatility seed. */
    seedVolatility: number;
    /** The bot's current delta for this token at the most-recent sample tick. */
    deltaPct: number;
}

export interface BotRaceOutcome {
    /** Equal-weighted portfolio delta %. Matches how the player's race is scored. */
    portfolioDeltaPct: number;
    /** Per-token breakdown for the reveal UI. */
    squad: BotSquadEntry[];
    /** Encoded score for feeding into runPaperBotMatch → computeModePayout. */
    encodedScore: number;
}

/**
 * Live in-race bot tracker. Instantiate once at race start; call
 * `deltaAt(elapsedMs)` each tick to get the bot's current portfolio delta
 * without hitting Birdeye on every tick. The bot's "live" path resolves
 * entry prices up-front then interpolates a seeded random walk that
 * converges to the final Birdeye-observed delta at windowMs.
 */
export class LiveSquadBot {
    private _squad: BotSquadEntry[] = [];
    private _windowMs: number;
    private _startedAt = 0;
    /** Each token's final delta at t=windowMs, pre-computed once at start. */
    private _finalDeltas: Map<string, number> = new Map();
    private _difficulty: BotDifficulty = 'medium';
    private _gainersSnapshot: VettedMint[] = [];

    constructor(windowMs: number, difficulty: BotDifficulty = 'medium', gainersSnapshot: VettedMint[] = []) {
        this._windowMs = Math.max(1, windowMs);
        this._difficulty = difficulty;
        this._gainersSnapshot = gainersSnapshot;
    }

    /**
     * Pick 3 vetted mints + fetch their entry prices + seed a random walk
     * that will converge to a synthetic final delta at windowMs.
     *
     * Called at race start; AppUI gets a usable `deltaAt(0) == 0` immediately.
     */
    async start(priceFeed: PriceFeed): Promise<void> {
        const picks = randomTrioForDifficulty(this._difficulty, this._gainersSnapshot);
        this._squad = picks.map((p) => ({
            mint: p.mint,
            symbol: p.symbol,
            seedVolatility: 0,
            deltaPct: 0,
        }));

        // Seed each token's synthetic final delta. We use the 24h change as
        // a volatility proxy: tokens that moved big in 24h are more likely
        // to move big in a short window too. Fetch prices + 24h-deltas via
        // existing priceMulti (which returns change24hPct alongside price).
        const mints = this._squad.map((s) => s.mint);
        const live = await priceFeed.getSessionDeltas(mints); // {} on Birdeye failure; handled below
        const diffMul = BOT_DIFFICULTY_MULTIPLIERS[this._difficulty] ?? 1.0;
        for (const s of this._squad) {
            const delta24h = Number.isFinite(live[s.mint]) ? live[s.mint] : 0;
            s.seedVolatility = delta24h;
            // Synthetic final delta: bounded random walk scaled by volatility.
            // For a 30s window, typical final delta is 0-2% for low-vol tokens,
            // 0-8% for high-vol. Uses a seeded PRNG so match is deterministic.
            const seed = this._deterministicSeed(s.mint, this._windowMs);
            const prng = this._mulberry32(seed);
            const baseMagnitude = Math.min(10, Math.abs(delta24h) * 0.15 + 0.5);
            const direction = prng() > 0.5 ? 1 : -1;
            this._finalDeltas.set(s.mint, direction * baseMagnitude * prng() * diffMul);
        }

        this._startedAt = Date.now();
        console.log(`${TAG} start | fake_prices=${DEMO_FAKE_PRICES} difficulty=${this._difficulty} mul=${diffMul.toFixed(2)} squad=[${this._squad.map((s) => `${s.symbol}(${s.seedVolatility.toFixed(1)}%→${(this._finalDeltas.get(s.mint) ?? 0).toFixed(2)}%)`).join(',')}] windowMs=${this._windowMs}`);
    }

    /**
     * Portfolio delta at a given elapsed time. Interpolates from 0 at t=0 to
     * the pre-computed `_finalDeltas` at t=windowMs. Adds minor tick-level
     * jitter (seeded) so the number doesn't look robotically linear.
     */
    deltaAt(elapsedMs: number): { portfolioDeltaPct: number; perTokenDeltas: Record<string, number> } {
        const progress = Math.max(0, Math.min(1, elapsedMs / this._windowMs));
        const perTokenDeltas: Record<string, number> = {};
        let sum = 0;
        let count = 0;
        for (const s of this._squad) {
            const final = this._finalDeltas.get(s.mint) ?? 0;
            // Eased: slight S-curve so the race has a visible acceleration mid-way.
            const eased = progress * progress * (3 - 2 * progress);
            // Jitter: ±0.2% noise scaled by volatility.
            const jitterSeed = this._deterministicSeed(s.mint, Math.floor(elapsedMs / 100));
            const jitter = (this._mulberry32(jitterSeed)() - 0.5) * 0.4 * (Math.abs(s.seedVolatility) / 50 + 1);
            const current = final * eased + jitter;
            s.deltaPct = current;
            perTokenDeltas[s.mint] = current;
            sum += current;
            count += 1;
        }
        const portfolioDeltaPct = count > 0 ? sum / count : 0;
        return { portfolioDeltaPct, perTokenDeltas };
    }

    /** Final outcome to feed into runPaperBotMatch result ranking. */
    finalOutcome(encodedScore: number): BotRaceOutcome {
        return {
            portfolioDeltaPct: Array.from(this._finalDeltas.values()).reduce((a, b) => a + b, 0) / Math.max(1, this._finalDeltas.size),
            squad: this._squad.slice(),
            encodedScore,
        };
    }

    /** For UI label rendering. */
    getSquad(): BotSquadEntry[] { return this._squad; }

    // ── PRNG helpers ────────────────────────────────────────────────

    private _deterministicSeed(mint: string, bucket: number): number {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < mint.length; i++) {
            h = (h ^ mint.charCodeAt(i)) >>> 0;
            h = Math.imul(h, 16777619) >>> 0;
        }
        h = (h ^ bucket) >>> 0;
        h = Math.imul(h, 16777619) >>> 0;
        return h;
    }

    private _mulberry32(seed: number): () => number {
        let t = seed >>> 0;
        return () => {
            t = (t + 0x6D2B79F5) | 0;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    }
}

/**
 * Instant synthetic outcome for the paper-bot-match post-race ranking.
 * Does NOT fetch prices or wait — seeded purely by current time bucket so
 * two paper matches in quick succession feel different.
 *
 * Phase E: difficulty drives both the token universe and a height
 * multiplier. Easy → stables/bluechips × 0.7. Medium → vetted × 1.0.
 * Hard → live Birdeye gainers (caller-supplied snapshot) × 1.15.
 */
export function sampleInstantBotOutcome(
    windowMs: number,
    difficulty: BotDifficulty = 'medium',
    gainersSnapshot: VettedMint[] = [],
): { portfolioDeltaPct: number; squad: BotSquadEntry[] } {
    const picks = randomTrioForDifficulty(difficulty, gainersSnapshot);
    const bucket = Math.floor(Date.now() / Math.max(1000, windowMs));
    const diffMul = BOT_DIFFICULTY_MULTIPLIERS[difficulty] ?? 1.0;
    const squad: BotSquadEntry[] = [];
    let sum = 0;
    for (const p of picks) {
        const seed = (() => {
            let h = 2166136261 >>> 0;
            for (let i = 0; i < p.mint.length; i++) {
                h = (h ^ p.mint.charCodeAt(i)) >>> 0;
                h = Math.imul(h, 16777619) >>> 0;
            }
            h = (h ^ bucket) >>> 0;
            return h;
        })();
        let t = seed >>> 0;
        const prng = () => {
            t = (t + 0x6D2B79F5) | 0;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
        const magnitude = prng() * 6;   // 0-6% typical
        const direction = prng() > 0.5 ? 1 : -1;
        const delta = direction * magnitude * diffMul;
        squad.push({ mint: p.mint, symbol: p.symbol, seedVolatility: 0, deltaPct: delta });
        sum += delta;
    }
    const portfolioDeltaPct = sum / squad.length;
    console.log(`${TAG} sampleInstantBotOutcome | difficulty=${difficulty} mul=${diffMul.toFixed(2)} squad=[${squad.map((s) => `${s.symbol}(${s.deltaPct.toFixed(2)}%)`).join(',')}] portfolio=${portfolioDeltaPct.toFixed(2)}% bucket=${bucket}`);
    return { portfolioDeltaPct, squad };
}
