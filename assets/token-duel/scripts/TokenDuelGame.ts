/**
 * TokenDuelGame.ts — Stack-Jump-style tap game.
 *
 * Plain TypeScript class (NOT a Cocos Component) so it doesn't need a class
 * UUID. AppUI instantiates it with scene refs + holdings, calls start(),
 * forwards taps via onTap(), and listens for the onGameOver callback.
 *
 * Block flow:
 *   - Base block placed at game start at y = TOP_Y_FIXED (center top of tower).
 *   - Active block oscillates horizontally above the tower at y = ACTIVE_Y.
 *   - On tap: overlap math → if miss, active falls off-screen → game over.
 *     If hit, active shrinks to overlap width, drops to TOP_Y_FIXED, every
 *     pre-existing tower block shifts down by BLOCK_HEIGHT so the new top
 *     always sits at the same screen y.
 *   - Older blocks drift off-screen naturally as the tower grows.
 *
 * Width modifier per block is driven by a (mocked) 24h price delta for the
 * token that block represents. Higher delta = wider block = easier to stack.
 */

import { Color, Label, Node, Sprite, SpriteFrame, Tween, UITransform, Vec3, tween } from 'cc';
import { Holding } from './TokenDuelRpc';
import { PriceFeed } from './PriceFeed';
import { PriceFeedMock } from './PriceFeedMock';
import { Haptics, HapticType } from './Haptics';
import { playSound } from './Sound';

const TAG = '[TokenDuelGame]';

export interface TokenDuelGameOptions {
    gameArea: Node;              // container Node; children of this get added/removed
    blockTemplate: Sprite;       // hidden sprite; source of the default spriteFrame
    heightLabel: Label;
    tokenBadgeLabel: Label;
    holdings: Holding[];         // length 3 — v1 wallet-read OR v2 squad picks
    onGameOver: (height: number, deltas: Record<string, number>) => void;
    /**
     * v2 Birdeye-backed price feed. When provided, `start()` awaits a live
     * `/defi/price_volume/multi` call to pick 24h deltas. When omitted, falls
     * back to the deterministic `PriceFeedMock` — same behavior as v1 so
     * existing smoke tests and offline recording still work.
     */
    priceFeed?: PriceFeed;
    /**
     * Part 9: optional async hook invoked after deltas resolve but before
     * the first active block spawns. AppUI uses it to display the first-run
     * tutorial overlay and await the user's dismissal before play begins.
     */
    onBeforeFirstBlock?: () => Promise<void>;
    /**
     * Part 10 Bundle 1: fired on every block drop so the backend can
     * validate physics in real time. Must be synchronous / fire-and-forget
     * — tap latency is user-visible. On miss this fires once with
     * outcome:'miss' before `onGameOver`.
     */
    onBlockDrop?: (ev: {
        blockIdx: number;
        tsMs: number;
        xPos: number;
        width: number;
        outcome: 'ok' | 'miss';
    }) => void;
}

interface TowerBlock {
    x: number;
    width: number;
    node: Node;
}

interface ActiveBlock {
    node: Node;
    width: number;
    tokenSymbol: string;
}

export class TokenDuelGame {
    private _opts: TokenDuelGameOptions;
    private _deltas: Record<string, number> = {};
    private _tower: TowerBlock[] = [];
    private _active: ActiveBlock | null = null;
    private _spriteFrame: SpriteFrame | null = null;
    private _running = false;

    private readonly BASE_WIDTH = 220;
    private readonly BLOCK_HEIGHT = 60;
    private readonly ACTIVE_Y = 300;                    // where active oscillates
    private readonly TOP_Y_FIXED = this.ACTIVE_Y - 60;  // where tower-top always sits after a placement
    private readonly OSC_DISTANCE = 280;
    private readonly OSC_PERIOD = 0.8;                  // seconds per half-cycle
    private readonly DROP_DURATION = 0.25;
    private readonly SHIFT_DURATION = 0.15;
    private readonly MAX_HEIGHT = 50;
    private readonly COLORS: Array<[number, number, number]> = [
        [51, 153, 255],
        [255, 180, 60],
        [102, 204, 128],
        [204, 102, 204],
        [255, 102, 102],
        [128, 204, 255],
    ];
    private readonly BASE_COLOR: [number, number, number] = [120, 120, 140];

    constructor(opts: TokenDuelGameOptions) {
        this._opts = opts;
    }

    async start(): Promise<void> {
        if (this._running) return;

        // 1. Compute per-session deltas. Keyed by `mint || symbol` so squad
        //    tokens from Birdeye route through their mint and native SOL
        //    (empty mint) falls back to its symbol. This is the key the
        //    `_spawnActive` lookup uses too — they must agree exactly.
        const keys = this._deltaKeys();
        this._deltas = await this._computeDeltas(keys);
        console.log(`${TAG} start | deltas_resolved keys=${JSON.stringify(keys)} deltas=${JSON.stringify(this._deltas)}`);

        // 2. Borrow a spriteFrame from the hidden BlockTemplate sprite so
        //    dynamically spawned blocks actually render. See memory note
        //    `feedback_styling.md` — Sprites without _spriteFrame render all-black.
        this._spriteFrame = this._opts.blockTemplate.spriteFrame;
        if (!this._spriteFrame) {
            console.log(`${TAG} start | FAIL no spriteFrame on BlockTemplate — blocks will not render`);
            return;
        }

        // 3. Place the base block at TOP_Y_FIXED. Not part of the scored tower
        //    height — it's just the foundation the player must stack on.
        const base = this._makeBlockNode(0, this.TOP_Y_FIXED, this.BASE_WIDTH, this.BLOCK_HEIGHT, this.BASE_COLOR);
        this._tower.push({ x: 0, width: this.BASE_WIDTH, node: base });

        // 4. HUD initial state.
        this._opts.heightLabel.string = 'Height: 0';

        // Part 9: optional first-run tutorial hook. AppUI resolves this
        // Promise when the player dismisses the tutorial overlay. If the
        // hook throws, we still start the game — the tutorial is a
        // nice-to-have, never a blocker.
        if (this._opts.onBeforeFirstBlock) {
            try {
                console.log(`${TAG} start | AWAIT onBeforeFirstBlock`);
                await this._opts.onBeforeFirstBlock();
                console.log(`${TAG} start | onBeforeFirstBlock resolved`);
            } catch (e) {
                console.log(`${TAG} start | onBeforeFirstBlock ERROR ${e}`);
            }
        }

        // 5. Spawn first active block + start oscillating.
        this._running = true;
        this._spawnActive();

        console.log(`${TAG} start | DONE base placed, active spawned`);
    }

    /** Per-holding key used for delta lookups. Mint if present; symbol otherwise. */
    private _deltaKeys(): string[] {
        return this._opts.holdings.map((h) => h.mint || h.symbol || '---');
    }

    /**
     * Pick deltas from live Birdeye when a `priceFeed` is wired, otherwise
     * from the deterministic mock. Mint-bearing keys that come back empty
     * (e.g. SOL native, which isn't tradeable on DEXes) get mock-filled so
     * every holding has some difficulty value.
     */
    private async _computeDeltas(keys: string[]): Promise<Record<string, number>> {
        if (keys.length === 0) {
            console.log(`${TAG} _computeDeltas | EMPTY_KEYS — no holdings to feed`);
            return {};
        }
        if (this._opts.priceFeed) {
            // Feed only Solana mints (base58, 32–44 chars) to Birdeye; for
            // the rest (e.g. 'SOL', '---') we mock-fill after.
            const mintKeys = keys.filter((k) => this._looksLikeMint(k));
            const nonMintKeys = keys.filter((k) => !this._looksLikeMint(k));
            let live: Record<string, number> = {};
            try {
                live = mintKeys.length > 0
                    ? await this._opts.priceFeed.getSessionDeltas(mintKeys)
                    : {};
            } catch (e) {
                // PriceFeed already has its own fallback to mock, but a thrown
                // error (e.g. aborted fetch on scene teardown) would otherwise
                // propagate into TokenDuelGame.start() and kill the game.
                console.log(`${TAG} _computeDeltas | PRICE_FEED_THROW error=${e} — falling back to mock for all keys`);
                return PriceFeedMock.getSessionDeltas(keys);
            }
            const mock = nonMintKeys.length > 0
                ? PriceFeedMock.getSessionDeltas(nonMintKeys)
                : {};
            const merged: Record<string, number> = { ...mock, ...live };
            let filled = 0;
            for (const k of keys) {
                if (!(k in merged)) {
                    console.log(`${TAG} _computeDeltas | MISSING_KEY key="${k}" — defaulting to 0`);
                    merged[k] = 0;
                    filled++;
                }
            }
            console.log(`${TAG} _computeDeltas | DONE via=priceFeed mint_keys=${mintKeys.length} non_mint=${nonMintKeys.length} live=${Object.keys(live).length} defaulted=${filled}`);
            return merged;
        }
        const mock = PriceFeedMock.getSessionDeltas(keys);
        console.log(`${TAG} _computeDeltas | DONE via=mock keys=${keys.length}`);
        return mock;
    }

    private _looksLikeMint(s: string): boolean {
        if (s.length < 32 || s.length > 44) return false;
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            const isBase58 = (c >= 49 && c <= 57 && c !== 48) // 1-9 (no 0)
                || (c >= 65 && c <= 90 && c !== 73 && c !== 79) // A-Z (no I, O)
                || (c >= 97 && c <= 122 && c !== 108); // a-z (no l)
            if (!isBase58) return false;
        }
        return true;
    }

    onTap(): void {
        if (!this._running || !this._active) return;

        // Stop oscillation.
        const activeNode = this._active.node;
        Tween.stopAllByTarget(activeNode);

        const prev = this._tower[this._tower.length - 1];
        const activeX = activeNode.getPosition().x;
        const activeW = this._active.width;

        const left = Math.max(prev.x - prev.width / 2, activeX - activeW / 2);
        const right = Math.min(prev.x + prev.width / 2, activeX + activeW / 2);
        const overlapW = right - left;

        // Miss — active falls off-screen, then game over.
        if (overlapW <= 0) {
            console.log(`${TAG} onTap | MISS activeX=${activeX.toFixed(1)} prevX=${prev.x.toFixed(1)} overlapW=${overlapW.toFixed(1)}`);
            // Part 10 Bundle 1: notify backend of the miss before the
            // fall animation so the receipt-signer sees game-over events
            // in real time.
            try {
                this._opts.onBlockDrop?.({
                    blockIdx: this._tower.length - 1,
                    tsMs: Date.now(),
                    xPos: activeX,
                    width: activeW,
                    outcome: 'miss',
                });
            } catch (e) { console.log(`${TAG} onTap | onBlockDrop(miss) ERROR ${e}`); }
            // Part 11 C: miss feedback.
            Haptics.fire(HapticType.HEAVY);
            playSound('miss');
            this._running = false;
            this._active = null;
            tween(activeNode)
                .to(0.5, { position: new Vec3(activeX, this.ACTIVE_Y - 1200, 0) })
                .call(() => {
                    activeNode.destroy();
                    this._endGame();
                })
                .start();
            return;
        }

        const overlapCx = (left + right) / 2;
        console.log(`${TAG} onTap | HIT overlapCx=${overlapCx.toFixed(1)} overlapW=${overlapW.toFixed(1)}`);

        // Part 10 Bundle 1: notify backend of the successful drop. We
        // fire BEFORE the drop animation tween so the wire event ordering
        // is consistent with the game's block_idx counter.
        try {
            this._opts.onBlockDrop?.({
                blockIdx: this._tower.length - 1,
                tsMs: Date.now(),
                xPos: overlapCx,
                width: overlapW,
                outcome: 'ok',
            });
        } catch (e) { console.log(`${TAG} onTap | onBlockDrop(ok) ERROR ${e}`); }
        // Part 11 C: successful-stack feedback.
        Haptics.fire(HapticType.MEDIUM);
        playSound('stack');

        // Shrink active to overlap width and drop to fixed top-of-tower Y.
        const ut = activeNode.getComponent(UITransform);
        if (ut) ut.setContentSize(overlapW, this.BLOCK_HEIGHT);

        // Shift every existing tower block down by BLOCK_HEIGHT so the new
        // block lands at the same fixed screen Y as the previous top did.
        for (const b of this._tower) {
            const p = b.node.getPosition();
            tween(b.node)
                .to(this.SHIFT_DURATION, { position: new Vec3(p.x, p.y - this.BLOCK_HEIGHT, 0) })
                .start();
        }

        // Drop active to TOP_Y_FIXED at overlapCx, then push onto tower and
        // spawn the next active.
        tween(activeNode)
            .to(this.DROP_DURATION, { position: new Vec3(overlapCx, this.TOP_Y_FIXED, 0) })
            .call(() => {
                this._tower.push({ x: overlapCx, width: overlapW, node: activeNode });
                this._active = null;
                this._opts.heightLabel.string = `Height: ${this._tower.length - 1}`;

                if (this._tower.length - 1 >= this.MAX_HEIGHT) {
                    console.log(`${TAG} onTap | MAX_HEIGHT reached — ending game`);
                    this._running = false;
                    this._endGame();
                    return;
                }
                this._spawnActive();
            })
            .start();
    }

    destroy(): void {
        this._running = false;
        if (this._active) {
            Tween.stopAllByTarget(this._active.node);
            this._active.node.destroy();
            this._active = null;
        }
        for (const b of this._tower) {
            Tween.stopAllByTarget(b.node);
            b.node.destroy();
        }
        this._tower = [];
        console.log(`${TAG} destroy | cleanup done`);
    }

    // ─── internals ────────────────────────────────────────────────────────

    private _spawnActive(): void {
        // blockIndex counts placed blocks excluding base. Token cycles through holdings.
        const blockIndex = this._tower.length - 1; // first active spawns when tower = [base]
        const tokenIdx = ((blockIndex % 3) + 3) % 3;
        const holding = this._opts.holdings[tokenIdx];
        const symbol = (holding && holding.symbol) || '---';
        // Delta key mirrors `_deltaKeys()`: mint if present, else symbol.
        const deltaKey = (holding && (holding.mint || holding.symbol)) || '---';
        const delta = this._deltas[deltaKey] ?? 0;
        const modifier = this._widthModifier(delta);
        const width = Math.max(40, this.BASE_WIDTH * modifier);
        // CP2: deterministic symbol→color so BONK is always BONK-colored.
        const color = this._colorForSymbol(symbol);
        console.log(`${TAG} _spawnActive | START blockIndex=${blockIndex} tokenIdx=${tokenIdx} symbol="${symbol}" delta=${delta} modifier=${modifier.toFixed(2)} width=${width.toFixed(1)} rgb=${color.join(',')} tower_len=${this._tower.length}`);

        const node = this._makeBlockNode(
            -this.OSC_DISTANCE,
            this.ACTIVE_Y,
            width,
            this.BLOCK_HEIGHT,
            color,
            symbol
        );
        this._active = { node, width, tokenSymbol: symbol };

        const sign = delta > 0 ? '+' : '';
        this._opts.tokenBadgeLabel.string = `${symbol} (${sign}${delta}%)`;

        // CI3: Oscillation speeds up as the tower grows — classic Stack-Jump
        // ramp. 10% faster every 5 blocks, floor at 50% of the starting speed.
        const period = this._currentOscPeriod();
        tween(node)
            .to(period, { position: new Vec3(this.OSC_DISTANCE, this.ACTIVE_Y, 0) })
            .to(period, { position: new Vec3(-this.OSC_DISTANCE, this.ACTIVE_Y, 0) })
            .union()
            .repeatForever()
            .start();
        console.log(`${TAG} _spawnActive | DONE osc_period=${period.toFixed(2)}s badge="${symbol} (${sign}${delta}%)"`);
    }

    private _widthModifier(delta: number): number {
        let mod: number;
        let tier: string;
        if (delta >= 5)       { mod = 1.0; tier = 'wide'; }
        else if (delta >= 0)  { mod = 0.8; tier = 'medium_wide'; }
        else if (delta >= -5) { mod = 0.6; tier = 'medium_narrow'; }
        else                  { mod = 0.4; tier = 'narrow'; }
        console.log(`${TAG} _widthModifier | DONE delta=${delta} modifier=${mod} tier=${tier}`);
        return mod;
    }

    /** Deterministic `symbol → color`. Stable across runs so BONK is always the same color. */
    private _colorForSymbol(symbol: string): [number, number, number] {
        let h = 0;
        for (let i = 0; i < symbol.length; i++) {
            h = ((h << 5) - h + symbol.charCodeAt(i)) | 0;
        }
        const idx = Math.abs(h) % this.COLORS.length;
        const rgb = this.COLORS[idx];
        console.log(`${TAG} _colorForSymbol | DONE symbol="${symbol}" hash=${h} idx=${idx} rgb=${rgb.join(',')}`);
        return rgb;
    }

    /** Oscillation period — shrinks as the tower grows (difficulty ramp, CI3). */
    private _currentOscPeriod(): number {
        const placed = Math.max(0, this._tower.length - 1); // exclude base
        const factor = Math.max(0.5, 1 - 0.1 * Math.floor(placed / 5));
        const period = this.OSC_PERIOD * factor;
        console.log(`${TAG} _currentOscPeriod | DONE placed=${placed} factor=${factor.toFixed(2)} period=${period.toFixed(3)}s base=${this.OSC_PERIOD}`);
        return period;
    }

    /**
     * Build a Cocos Node shaped like a colored rectangle. If `symbol` is
     * provided, adds a Label child inside the block (CI1) so the tower reads
     * as "SOL / BONK / WIF" instead of anonymous rectangles.
     */
    private _makeBlockNode(
        x: number,
        y: number,
        width: number,
        height: number,
        rgb: [number, number, number],
        symbol?: string
    ): Node {
        const name = `Block_${this._tower.length}`;
        const node = new Node(name);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(width, height);
        const sprite = node.addComponent(Sprite);
        sprite.spriteFrame = this._spriteFrame!;
        sprite.color = new Color(rgb[0], rgb[1], rgb[2], 255);
        this._opts.gameArea.addChild(node);
        node.setPosition(x, y, 0);

        const hasLabel = !!(symbol && symbol !== '---');
        let fontSize = 0;
        if (hasLabel) {
            const labelNode = new Node('Symbol');
            const lut = labelNode.addComponent(UITransform);
            lut.setContentSize(width, height);
            const label = labelNode.addComponent(Label);
            label.string = symbol!;
            fontSize = Math.max(14, Math.min(22, Math.floor(width / 4)));
            label.fontSize = fontSize;
            label.color = new Color(255, 255, 255, 255);
            node.addChild(labelNode);
            labelNode.setPosition(0, 0, 0);
        }
        console.log(`${TAG} _makeBlockNode | DONE name=${name} x=${x.toFixed(1)} y=${y.toFixed(1)} w=${width.toFixed(1)} h=${height} rgb=${rgb.join(',')} symbol="${symbol ?? '(none)'}" label_added=${hasLabel} font_size=${fontSize} sprite_frame_ok=${!!this._spriteFrame}`);
        return node;
    }

    private _endGame(): void {
        const height = Math.max(0, this._tower.length - 1);
        console.log(`${TAG} _endGame | START height=${height} tower_len=${this._tower.length} deltas=${JSON.stringify(this._deltas)} timer_ms=250`);
        // Small delay so the miss-fall animation is visible before the overlay appears.
        setTimeout(() => {
            console.log(`${TAG} _endGame | FIRING onGameOver height=${height}`);
            this._opts.onGameOver(height, this._deltas);
        }, 250);
    }
}
