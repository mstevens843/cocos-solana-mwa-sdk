/**
 * TokenDuelGame.ts - compatibility shim on `betting-duel` branch.
 *
 * The stack-jump implementation has been replaced. This class now wraps
 * `PortfolioRace` so AppUI can continue using the `TokenDuelGame` ctor
 * shape unchanged through Phases 2-4; Phase 5 (ModePicker updates)
 * renames things end-to-end and retires this shim.
 *
 * On `onComplete(deltaPct)` we encode the portfolio % into the u32 score
 * expected by the on-chain `settle_match` and fire the existing
 * `onGameOver(score, {})` callback. Downstream AppUI logic continues to
 * treat that integer as "height" - it is now an encoded delta bias.
 */

import { Label, Node, Sprite } from 'cc';

import { Holding } from './TokenDuelRpc';
import { PriceFeed } from './PriceFeed';
import { PortfolioRace, RaceSnapshot } from './PortfolioRace';
import { encodeDeltaPct } from './ScoreEncoding';

export type { RaceSnapshot } from './PortfolioRace';

const TAG = '[TokenDuelGame:shim]';

/**
 * Default race window while ModePicker hasn't yet been wired to pass
 * an explicit duration (Phase 5 work). Intentionally short so the
 * existing stack-jump scene UI degrades to a "waiting for window" hold
 * rather than feeling dead.
 */
const DEFAULT_WINDOW_MS = 30_000;

export interface TokenDuelGameOptions {
    gameArea: Node;
    blockTemplate: Sprite;
    heightLabel: Label;
    tokenBadgeLabel: Label;
    holdings: Holding[];
    priceFeed?: PriceFeed;
    /** Match duration in ms. If omitted, defaults to DEFAULT_WINDOW_MS. */
    windowMs?: number;
    /**
     * Optional pre-resolved entry prices keyed by mint. AppUI passes the
     * squad's cached prices from the trending feed - so races can start
     * even when Birdeye's multi_price endpoint doesn't index the mint.
     */
    fallbackEntryPrices?: Record<string, number>;
    onBeforeFirstBlock?: () => Promise<void>;
    /** Retained for contract parity - PortfolioRace has no block-drop stream. */
    onBlockDrop?: (ev: {
        blockIdx: number;
        tsMs: number;
        xPos: number;
        width: number;
        outcome: 'ok' | 'miss';
    }) => void;
    /** Fires on each PortfolioRace poll; drives the live RacePanel UI. */
    onRaceTick?: (snap: RaceSnapshot) => void;
    onGameOver: (height: number, deltas: Record<string, number>) => void;
    /** Phase F5/F6 - forwarded from PortfolioRace. */
    onPriceFallback?: (mint: string, fallbackEntry: number) => void;
    onStalePrice?: (mint: string, missingTicks: number) => void;
    onPriceRecovered?: (mint: string) => void;
    onConnectionState?: (state: 'ok' | 'degraded' | 'lost') => void;
}

export class TokenDuelGame {
    private _opts: TokenDuelGameOptions;
    private _race: PortfolioRace | null = null;
    private _latestSnapshot: RaceSnapshot | null = null;
    private _done = false;

    constructor(opts: TokenDuelGameOptions) {
        this._opts = opts;
        console.log(`${TAG} ctor | holdings=${opts.holdings?.length ?? 0} windowMs=${opts.windowMs ?? DEFAULT_WINDOW_MS}`);
    }

    async start(): Promise<void> {
        if (!this._opts.priceFeed) {
            console.log(`${TAG} start | NO_PRICE_FEED - completing immediately with score=0`);
            this._complete(0, {});
            return;
        }
        let windowMs: number;
        if (this._opts.windowMs && this._opts.windowMs > 0) {
            windowMs = this._opts.windowMs;
        } else {
            console.log(`${TAG} start | WINDOW_MS_FALLBACK supplied=${this._opts.windowMs} used=${DEFAULT_WINDOW_MS}`);
            windowMs = DEFAULT_WINDOW_MS;
        }
        this._race = new PortfolioRace({
            tokens: this._opts.holdings,
            windowMs,
            priceFeed: this._opts.priceFeed,
            fallbackEntryPrices: this._opts.fallbackEntryPrices,
            onBeforeStart: this._opts.onBeforeFirstBlock,
            onPriceFallback: this._opts.onPriceFallback,
            onStalePrice: this._opts.onStalePrice,
            onPriceRecovered: this._opts.onPriceRecovered,
            onConnectionState: this._opts.onConnectionState,
            onTick: (snap) => {
                this._latestSnapshot = snap;
                if (this._opts.heightLabel) {
                    const sign = snap.portfolioDeltaPct >= 0 ? '+' : '';
                    this._opts.heightLabel.string = `${sign}${snap.portfolioDeltaPct.toFixed(2)}%  ·  ${Math.ceil(snap.remainingMs / 1000)}s`;
                }
                if (this._opts.onRaceTick) {
                    try { this._opts.onRaceTick(snap); } catch (e) { console.log(`${TAG} onRaceTick_forwarding_error ${e}`); }
                }
            },
            onComplete: (finalPct) => {
                const deltas: Record<string, number> = {};
                if (this._latestSnapshot) {
                    for (const [mint, info] of Object.entries(this._latestSnapshot.perToken)) {
                        deltas[mint] = info.deltaPct;
                    }
                }
                this._complete(finalPct, deltas);
            },
        });
        try {
            await this._race.start();
        } catch (e: any) {
            console.log(`${TAG} start | RACE_START_ERROR windowMs=${windowMs} holdings=${this._opts.holdings?.length ?? 0} error=${e?.message ?? e} - completing with score=0`);
            this._complete(0, {});
        }
    }

    onTap(): void {
        this._race?.onTap();
    }

    destroy(): void {
        this._done = true;
        this._race?.destroy();
        this._race = null;
    }

    private _complete(deltaPct: number, deltas: Record<string, number>): void {
        if (this._done) {
            console.log(`${TAG} complete | DOUBLE_COMPLETE_IGNORED deltaPct=${deltaPct.toFixed(2)}% - first call already fired onGameOver`);
            return;
        }
        this._done = true;
        const score = encodeDeltaPct(deltaPct);
        console.log(`${TAG} complete | deltaPct=${deltaPct.toFixed(2)}% encoded_score=${score} deltas_count=${Object.keys(deltas).length}`);
        this._opts.onGameOver(score, deltas);
    }
}
