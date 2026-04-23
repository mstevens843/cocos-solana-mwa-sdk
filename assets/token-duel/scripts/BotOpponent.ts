/**
 * BotOpponent.ts — simulated opponent for:
 *   (a) Paper mode (never touches chain)
 *   (b) Real-mode fallback when matchmaking times out
 *
 * Bot height is log-normal-sampled around the leaderboard mean.
 * First-5-games handicap: bot's sampled height multiplied by 0.7 to give the
 * new player a confident early-game feel. Survives device changes via the
 * on-chain UserStats.bot_games_remaining field (paper stats stay client-side).
 *
 * Deterministic-logging contract preserved with the `[BotOpponent]` tag.
 */

import { BOT_HANDICAP_GAMES, BOT_HANDICAP_MULTIPLIER } from './ModeDefs';

const TAG = '[BotOpponent]';

export interface BotSampleInput {
    /** Top-10 heights observed on-chain. Used to build the distribution. */
    leaderboardHeights: number[];
    /** Remaining handicap games (0 = no more handicap). */
    botGamesRemaining: number;
    /** Minimum height so we don't return negative / zero. */
    floor?: number;
    /** Maximum height (matches Stack-Jump's practical ceiling). */
    ceiling?: number;
}

export interface BotSampleResult {
    rawSampled: number;
    appliedMultiplier: number;
    botHeight: number;
    handicapActive: boolean;
    mu: number;
    sigma: number;
}

/** log-normal sampler based on Box-Muller. Returns >=0 always. */
function sampleLogNormal(mu: number, sigma: number): number {
    // Box-Muller: N(0,1) → N(mu, sigma) → exp
    const u1 = Math.max(1e-9, Math.random());
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.exp(mu + sigma * z);
}

/**
 * Sample a bot height given the leaderboard distribution.
 * Handicap rule: first `BOT_HANDICAP_GAMES` games get `raw × BOT_HANDICAP_MULTIPLIER`.
 */
export function sampleBotHeight(input: BotSampleInput): BotSampleResult {
    const heights = (input.leaderboardHeights ?? []).filter((h) => h > 0);
    const floor = input.floor ?? 5;
    const ceiling = input.ceiling ?? 100;

    // Fit log-normal: mu = mean of log(h), sigma = std of log(h). Fall back to
    // fixed parameters if the board is sparse.
    let mu = Math.log(25);
    let sigma = 0.6;
    if (heights.length >= 3) {
        const logs = heights.map((h) => Math.log(h));
        const sum = logs.reduce((a, b) => a + b, 0);
        mu = sum / logs.length;
        const varr = logs.map((l) => (l - mu) ** 2).reduce((a, b) => a + b, 0) / logs.length;
        sigma = Math.max(0.2, Math.min(1.2, Math.sqrt(varr)));
    }

    const raw = sampleLogNormal(mu, sigma);
    const rawClamped = Math.max(floor, Math.min(ceiling, Math.round(raw)));

    const handicapActive = input.botGamesRemaining > 0;
    const multiplier = handicapActive ? BOT_HANDICAP_MULTIPLIER : 1;
    const bot = Math.max(floor, Math.min(ceiling, Math.round(rawClamped * multiplier)));

    console.log(`${TAG} sampleBotHeight | DONE raw=${rawClamped} mul=${multiplier} bot_height=${bot} handicap=${handicapActive} remaining=${input.botGamesRemaining} mu=${mu.toFixed(2)} sigma=${sigma.toFixed(2)} lb_n=${heights.length}`);

    return {
        rawSampled: rawClamped,
        appliedMultiplier: multiplier,
        botHeight: bot,
        handicapActive,
        mu,
        sigma,
    };
}

/**
 * Decide winner for a bot match without touching chain.
 * Ties go to the player — small UX favor on same-height draws.
 */
export function resolveBotMatch(playerHeight: number, botHeight: number): {
    playerWon: boolean;
    marginHeight: number;
} {
    const playerWon = playerHeight >= botHeight;
    const margin = Math.abs(playerHeight - botHeight);
    console.log(`${TAG} resolveBotMatch | DONE player=${playerHeight} bot=${botHeight} player_won=${playerWon} margin=${margin}`);
    return { playerWon, marginHeight: margin };
}

/**
 * Sample N bot heights at once for multi-player paper-bot matches.
 * Uses the same log-normal fit + handicap as `sampleBotHeight`, but returns
 * N independent samples (N = requiredPlayers − 1).
 */
export function sampleBotHeights(n: number, input: BotSampleInput): BotSampleResult[] {
    const out: BotSampleResult[] = [];
    for (let i = 0; i < n; i++) out.push(sampleBotHeight(input));
    console.log(`${TAG} sampleBotHeights | DONE n=${n} heights=[${out.map((x) => x.botHeight).join(',')}]`);
    return out;
}

/**
 * Compute the player's placement (0-indexed rank) given their height and an
 * array of bot heights. Ties with bots favor the player (higher rank).
 */
export function placementAmong(playerHeight: number, botHeights: number[]): number {
    let rank = 0;
    for (const b of botHeights) {
        if (b > playerHeight) rank += 1; // strict beat-the-player only
    }
    return rank;
}

export { BOT_HANDICAP_GAMES };
