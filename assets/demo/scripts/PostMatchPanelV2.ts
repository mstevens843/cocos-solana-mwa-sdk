/**
 * PostMatchPanelV2.ts — code-built game-over panel.
 *
 * Built from scratch to bypass the broken Button.CLICK pipeline on the
 * scene-baked PostMatchPanel. Every node is constructed at runtime, parented
 * to the Canvas root, with explicit `node.layer = canvas.layer`. CTAs use
 * raw `Node.EventType.TOUCH_END` (NOT Button.CLICK), which fires regardless
 * of any swallow-touch sibling or broken Button component.
 *
 * Visual fidelity matches the existing PostMatchPanel: title, track label,
 * mascot with glow, payout count-up, scoreboard cards (opp / you / xp / lvl),
 * two primary CTAs (PICK NEW SQUAD + HOME). Colors from Theme.Palette.
 *
 * Lifecycle: instantiate once at AppUI.start(); call show(outcome, callbacks)
 * from _showPostMatchPanel; call hide() from _onPostMatchBack/_onPostMatchAgain.
 */

import {
    Node, Label, UITransform, UIOpacity, Color, Vec3,
    tween, Tween, EventTouch, HorizontalTextAlignment, VerticalTextAlignment,
} from 'cc';
import { Palette, colorFromHex } from '../../token-duel/scripts/Theme';
import { safeAddGraphics } from '../../token-duel/scripts/safeGraphics';
import { MascotController, MascotState } from '../../token-duel/scripts/MascotController';
import { playSound } from '../../token-duel/scripts/Sound';

const TAG = '[PostMatchPanelV2]';

export interface PostMatchOutcome {
    won: boolean;
    tie?: boolean;
    playerHeight: number;
    opponentHeight: number;
    xpGained: number;
    newLevel: number;
    payoutLamports: number;
    track: 'paper' | 'real';
    previousLevel?: number;
    totalXp?: number;
    placement?: number;
    totalPlayers?: number;
    modeLabel?: string;
    playerDeltaPct?: number;
    opponentDeltaPct?: number;
    perTokenBreakdown?: string;
}

export interface PostMatchCallbacks {
    onBack: () => void;
    onAgain: () => void;
    onShare?: () => void;
}

export class PostMatchPanelV2 {
    private _canvasRoot: Node;
    private _root: Node | null = null;
    private _title: Label | null = null;
    private _track: Label | null = null;
    private _earned: Label | null = null;
    private _payout: Label | null = null;
    private _subtitle: Label | null = null;
    private _breakdown: Label | null = null;
    private _bgGfxNode: Node | null = null;
    private _mascotNode: Node | null = null;
    private _mascotGlowNode: Node | null = null;
    private _cardValues: Map<string, Label> = new Map();
    private _cardSubs: Map<string, Label> = new Map();
    private _ctaNewSquad: Node | null = null;
    private _ctaHome: Node | null = null;
    private _xpBarFillNode: Node | null = null;
    private _timers: number[] = [];
    private _activeTweens: Tween<any>[] = [];
    private _visible = false;
    private _onCallbacks: PostMatchCallbacks | null = null;
    private _bgPulseTween: Tween<UIOpacity> | null = null;

    constructor(canvasRoot: Node) {
        this._canvasRoot = canvasRoot;
    }

    isVisible(): boolean {
        return this._visible;
    }

    /** Build root + all children. Idempotent. */
    private _build(): void {
        if (this._root) return;
        const canvas = this._canvasRoot;
        const canvasUT = canvas.getComponent(UITransform);
        const cw = canvasUT?.contentSize.width ?? 720;
        const ch = canvasUT?.contentSize.height ?? 1602;

        const root = new Node('PostMatchPanelV2_Root');
        root.layer = canvas.layer;
        const rootUT = root.addComponent(UITransform);
        rootUT.setContentSize(cw, ch);
        rootUT.setAnchorPoint(0.5, 0.5);
        canvas.addChild(root);
        root.setPosition(new Vec3(0, 0, 0));
        root.setSiblingIndex(canvas.children.length - 1);
        const rootOpacity = root.addComponent(UIOpacity);
        rootOpacity.opacity = 0;
        this._root = root;

        // Background: dark base + concentric glow rings + corner vignette.
        this._buildBackground(root, cw, ch);

        // Title: "YOU WON" / "YOU LOST" / "TIE"
        this._title = this._addLabel(root, 'V2_Title', '', 36, Palette.text.hi, 0, ch / 2 - 200, cw - 80, 56);
        if (this._title) {
            (this._title as any)._enableBold = true;
        }

        // Track label: "Paper · 1v1 Duel"
        this._track = this._addLabel(root, 'V2_Track', '', 18, Palette.text.mid, 0, ch / 2 - 250, cw - 80, 26);

        // Mascot glow + container (mid panel).
        const mascotY = 0;
        this._buildMascotGlow(root, 0, mascotY);
        this._buildMascotContainer(root, 0, mascotY);

        // Earned + payout (just above mascot? or below — match existing: above the cards).
        this._earned = this._addLabel(root, 'V2_Earned', 'YOU EARNED', 16, Palette.status.win, 0, ch / 2 - 320, cw - 80, 24);
        this._payout = this._addLabel(root, 'V2_Payout', '+0.000 SOL', 56, Palette.status.win, 0, ch / 2 - 380, cw - 80, 80);

        // Subtitle + breakdown (just under payout).
        this._subtitle = this._addLabel(root, 'V2_Subtitle', '', 16, Palette.text.mid, 0, ch / 2 - 440, cw - 80, 22);
        this._breakdown = this._addLabel(root, 'V2_Breakdown', '', 14, Palette.text.lo, 0, ch / 2 - 470, cw - 80, 22);

        // Stat cards: 2x2 grid below mascot.
        const cardY = -ch / 2 + 360;
        const cardW = (cw - 60) / 2 - 10;
        const cardH = 110;
        const cardGapX = 20;
        const cardGapY = 12;
        const colLeftX = -cardW / 2 - cardGapX / 2;
        const colRightX = +cardW / 2 + cardGapX / 2;
        this._buildStatCard(root, 'opp', 'BEST OPP', '', colLeftX, cardY + cardH + cardGapY, cardW, cardH);
        this._buildStatCard(root, 'you', 'YOUR DELTA', '', colRightX, cardY + cardH + cardGapY, cardW, cardH);
        this._buildStatCard(root, 'xp', 'XP EARNED', '', colLeftX, cardY, cardW, cardH);
        this._buildStatCard(root, 'lvl', 'LEVEL', '', colRightX, cardY, cardW, cardH);

        // XP bar (below cards).
        this._buildXPBar(root, 0, -ch / 2 + 240, cw - 80, 22);

        // CTAs at bottom of panel.
        const ctaY = -ch / 2 + 152;
        const ctaW = 340;
        const ctaH = 96;
        const ctaGap = 22;
        const ctaLeftX = -ctaW / 2 - ctaGap / 2;
        const ctaRightX = +ctaW / 2 + ctaGap / 2;
        this._ctaNewSquad = this._buildCTA(root, 'newSquad', 'PICK NEW SQUAD', 'Try a different lineup', ctaLeftX, ctaY, ctaW, ctaH, true);
        this._ctaHome = this._buildCTA(root, 'home', 'HOME', 'Back to main menu', ctaRightX, ctaY, ctaW, ctaH, false);

        // Skip-tap on root: tapping outside CTAs jumps cascade to terminal frame.
        root.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
            try {
                const touchLoc = ev.getUILocation();
                const inLeft = this._tapInside(this._ctaNewSquad, touchLoc.x, touchLoc.y);
                const inRight = this._tapInside(this._ctaHome, touchLoc.x, touchLoc.y);
                if (!inLeft && !inRight) {
                    this._snapAllToFinal();
                }
            } catch (_) { /* no-op */ }
        }, this);

        console.log(`${TAG} _build | DONE root=${root.name} children=${root.children.length} cw=${cw} ch=${ch}`);
    }

    private _tapInside(node: Node | null, ux: number, uy: number): boolean {
        if (!node) return false;
        const ut = node.getComponent(UITransform);
        if (!ut) return false;
        const r = ut.getBoundingBoxToWorld();
        return ux >= r.x && ux <= r.x + r.width && uy >= r.y && uy <= r.y + r.height;
    }

    private _addLabel(parent: Node, name: string, text: string, fontSize: number, hex: string, x: number, y: number, w: number, h: number): Label {
        const node = new Node(name);
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);
        parent.addChild(node);
        node.setPosition(new Vec3(x, y, 0));
        const lbl = node.addComponent(Label);
        lbl.string = text;
        lbl.fontSize = fontSize;
        lbl.lineHeight = Math.round(fontSize * 1.2);
        lbl.color = colorFromHex(hex);
        lbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        lbl.verticalAlign = VerticalTextAlignment.CENTER;
        return lbl;
    }

    private _buildBackground(parent: Node, cw: number, ch: number): void {
        const bg = new Node('V2_Bg');
        bg.layer = parent.layer;
        const ut = bg.addComponent(UITransform);
        ut.setContentSize(cw, ch);
        parent.addChild(bg);
        bg.setPosition(new Vec3(0, 0, 0));
        bg.setSiblingIndex(0); // behind everything
        const op = bg.addComponent(UIOpacity);
        op.opacity = 230;
        safeAddGraphics(bg, (g) => {
            // Dark base rect, full panel.
            g.fillColor = colorFromHex(Palette.bg.primary);
            g.rect(-cw / 2, -ch / 2, cw, ch);
            g.fill();
        });
        // Concentric glow rings (12 circles), color depends on outcome — drawn in show().
        const glow = new Node('V2_BgGlow');
        glow.layer = parent.layer;
        const glowUT = glow.addComponent(UITransform);
        glowUT.setContentSize(cw, ch);
        bg.addChild(glow);
        glow.setPosition(new Vec3(0, 0, 0));
        const glowOp = glow.addComponent(UIOpacity);
        glowOp.opacity = 130;
        this._bgGfxNode = glow;
    }

    private _drawBgGlow(winColor: boolean): void {
        if (!this._bgGfxNode) return;
        const hex = winColor ? Palette.status.win : Palette.status.loss;
        const c = colorFromHex(hex);
        safeAddGraphics(this._bgGfxNode, (g) => {
            g.clear();
            const radii = [70, 100, 132, 162, 190, 216, 240, 260, 274, 282, 286, 290];
            const alphas = [23, 20, 17, 14, 11, 9, 7, 5, 4, 3, 2, 1];
            for (let i = 0; i < radii.length; i++) {
                g.fillColor = new Color(c.r, c.g, c.b, alphas[i]);
                g.circle(0, 0, radii[i]);
                g.fill();
            }
        });
    }

    private _buildMascotGlow(parent: Node, x: number, y: number): void {
        const node = new Node('V2_MascotGlow');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(440, 440);
        parent.addChild(node);
        node.setPosition(new Vec3(x, y, 0));
        const op = node.addComponent(UIOpacity);
        op.opacity = 0;
        this._mascotGlowNode = node;
    }

    private _drawMascotGlow(winColor: boolean): void {
        if (!this._mascotGlowNode) return;
        const hex = winColor ? Palette.status.win : Palette.status.loss;
        const c = colorFromHex(hex);
        safeAddGraphics(this._mascotGlowNode, (g) => {
            g.clear();
            // Floor shadow ellipse.
            g.fillColor = new Color(0, 0, 0, 110);
            g.ellipse(0, -110, 110, 22);
            g.fill();
            // Glow disc.
            g.fillColor = new Color(c.r, c.g, c.b, 115);
            g.circle(0, 0, 200);
            g.fill();
        });
    }

    private _buildMascotContainer(parent: Node, x: number, y: number): void {
        const node = new Node('V2_MascotContainer');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(220, 220);
        parent.addChild(node);
        node.setPosition(new Vec3(x, y, 0));
        const op = node.addComponent(UIOpacity);
        op.opacity = 0;
        // MascotController will be attached lazily in show() once we know
        // the outcome (which determines initial state).
        this._mascotNode = node;
    }

    private _buildStatCard(parent: Node, key: string, eyebrow: string, value: string, x: number, y: number, w: number, h: number): void {
        const card = new Node(`V2_Card_${key}`);
        card.layer = parent.layer;
        const ut = card.addComponent(UITransform);
        ut.setContentSize(w, h);
        parent.addChild(card);
        card.setPosition(new Vec3(x, y, 0));
        const op = card.addComponent(UIOpacity);
        op.opacity = 0;
        // Card background: rounded-ish rect using safeAddGraphics.
        safeAddGraphics(card, (g) => {
            g.fillColor = colorFromHex(Palette.bg.card);
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
            // Top edge accent bar (1px tall).
            g.fillColor = new Color(255, 255, 255, 30);
            g.rect(-w / 2, h / 2 - 2, w, 2);
            g.fill();
        });
        // Eyebrow label
        const eyebrowNode = new Node('eyebrow');
        eyebrowNode.layer = card.layer;
        const ebUT = eyebrowNode.addComponent(UITransform);
        ebUT.setContentSize(w - 16, 18);
        card.addChild(eyebrowNode);
        eyebrowNode.setPosition(new Vec3(0, h / 2 - 22, 0));
        const ebLbl = eyebrowNode.addComponent(Label);
        ebLbl.string = eyebrow;
        ebLbl.fontSize = 12;
        ebLbl.lineHeight = 16;
        ebLbl.color = colorFromHex(Palette.text.mid);
        ebLbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        ebLbl.verticalAlign = VerticalTextAlignment.CENTER;
        // Value label (large)
        const valNode = new Node('Value');
        valNode.layer = card.layer;
        const valUT = valNode.addComponent(UITransform);
        valUT.setContentSize(w - 16, 40);
        card.addChild(valNode);
        valNode.setPosition(new Vec3(0, -6, 0));
        const valLbl = valNode.addComponent(Label);
        valLbl.string = value;
        valLbl.fontSize = 28;
        valLbl.lineHeight = 36;
        valLbl.color = colorFromHex(Palette.text.hi);
        valLbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        valLbl.verticalAlign = VerticalTextAlignment.CENTER;
        this._cardValues.set(key, valLbl);
        // Sub label (small, below value)
        const subNode = new Node('ValueSub');
        subNode.layer = card.layer;
        const subUT = subNode.addComponent(UITransform);
        subUT.setContentSize(w - 16, 16);
        card.addChild(subNode);
        subNode.setPosition(new Vec3(0, -h / 2 + 16, 0));
        const subLbl = subNode.addComponent(Label);
        subLbl.string = '';
        subLbl.fontSize = 11;
        subLbl.lineHeight = 14;
        subLbl.color = colorFromHex(Palette.text.lo);
        subLbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        subLbl.verticalAlign = VerticalTextAlignment.CENTER;
        this._cardSubs.set(key, subLbl);
    }

    private _buildXPBar(parent: Node, x: number, y: number, w: number, h: number): void {
        const node = new Node('V2_XPBar');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);
        parent.addChild(node);
        node.setPosition(new Vec3(x, y, 0));
        safeAddGraphics(node, (g) => {
            g.fillColor = new Color(255, 255, 255, 30);
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
        });
        const fill = new Node('V2_XPBarFill');
        fill.layer = parent.layer;
        const fillUT = fill.addComponent(UITransform);
        fillUT.setContentSize(w, h);
        node.addChild(fill);
        fill.setPosition(new Vec3(0, 0, 0));
        this._xpBarFillNode = fill;
    }

    private _setXPBarFill(pct: number, color: string): void {
        if (!this._xpBarFillNode) return;
        const ut = this._xpBarFillNode.parent?.getComponent(UITransform);
        if (!ut) return;
        const w = ut.contentSize.width;
        const h = ut.contentSize.height;
        const fillW = Math.max(0, Math.min(1, pct)) * w;
        safeAddGraphics(this._xpBarFillNode, (g) => {
            g.clear();
            g.fillColor = colorFromHex(color);
            g.rect(-w / 2, -h / 2, fillW, h);
            g.fill();
        });
    }

    private _buildCTA(parent: Node, key: string, label: string, sublabel: string, x: number, y: number, w: number, h: number, primary: boolean): Node {
        const node = new Node(`V2_CTA_${key}`);
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);
        ut.setAnchorPoint(0.5, 0.5);
        parent.addChild(node);
        node.setPosition(new Vec3(x, y, 0));
        node.setSiblingIndex(parent.children.length - 1); // topmost
        const op = node.addComponent(UIOpacity);
        op.opacity = 255;
        // Background fill.
        const bgHex = primary ? Palette.accent.teal : Palette.bg.card;
        const borderHex = primary ? Palette.accent.tealDim : Palette.text.lo;
        safeAddGraphics(node, (g) => {
            g.fillColor = colorFromHex(bgHex);
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
            g.lineWidth = 2;
            g.strokeColor = colorFromHex(borderHex);
            g.rect(-w / 2, -h / 2, w, h);
            g.stroke();
        });
        // Main label
        const mainNode = new Node('cta_label');
        mainNode.layer = node.layer;
        const mUT = mainNode.addComponent(UITransform);
        mUT.setContentSize(w - 16, 32);
        node.addChild(mainNode);
        mainNode.setPosition(new Vec3(0, 8, 0));
        const mLbl = mainNode.addComponent(Label);
        mLbl.string = label;
        mLbl.fontSize = 22;
        mLbl.lineHeight = 28;
        mLbl.color = colorFromHex(primary ? Palette.text.inverse : Palette.text.hi);
        mLbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        mLbl.verticalAlign = VerticalTextAlignment.CENTER;
        // Sublabel
        const subNode = new Node('cta_sub');
        subNode.layer = node.layer;
        const sUT = subNode.addComponent(UITransform);
        sUT.setContentSize(w - 16, 18);
        node.addChild(subNode);
        subNode.setPosition(new Vec3(0, -18, 0));
        const sLbl = subNode.addComponent(Label);
        sLbl.string = sublabel;
        sLbl.fontSize = 13;
        sLbl.lineHeight = 16;
        sLbl.color = colorFromHex(primary ? Palette.text.inverse : Palette.text.mid);
        sLbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        sLbl.verticalAlign = VerticalTextAlignment.CENTER;
        // The actual fix: raw TOUCH_END handler.
        node.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
            console.log(`${TAG} CTA_TOUCH_END label=${key}`);
            try {
                ev.propagationStopped = true;
            } catch (_) { /* no-op */ }
            this._fireCallback(key);
        }, this);
        // Optional pressed-state visual (color shift on touch_start).
        node.on(Node.EventType.TOUCH_START, () => {
            console.log(`${TAG} CTA_TOUCH_START label=${key}`);
        }, this);
        console.log(`${TAG} _buildCTA | label=${key} pos=(${x.toFixed(1)},${y.toFixed(1)}) size=${w}x${h} primary=${primary} layer=${node.layer}`);
        return node;
    }

    private _fireCallback(key: string): void {
        if (!this._onCallbacks) {
            console.log(`${TAG} _fireCallback | NO_CALLBACKS key=${key}`);
            return;
        }
        try {
            if (key === 'newSquad' && this._onCallbacks.onAgain) this._onCallbacks.onAgain();
            else if (key === 'home' && this._onCallbacks.onBack) this._onCallbacks.onBack();
            else if (key === 'share' && this._onCallbacks.onShare) this._onCallbacks.onShare();
        } catch (e: any) {
            console.log(`${TAG} _fireCallback threw key=${key} err=${e?.message ?? e}`);
        }
    }

    /** Show the panel with the given outcome data + callback wiring. */
    show(outcome: PostMatchOutcome, callbacks: PostMatchCallbacks): void {
        this._build();
        this._onCallbacks = callbacks;
        if (!this._root) return;
        this._root.active = true;
        this._root.setSiblingIndex(this._canvasRoot.children.length - 1);
        this._visible = true;

        const won = !!outcome.won && !outcome.tie;
        const tie = !!outcome.tie;

        // Fill text fields.
        if (this._title) {
            this._title.string = tie ? 'TIE' : (won ? 'YOU WON' : 'YOU LOST');
            this._title.color = colorFromHex(won ? Palette.status.win : (tie ? Palette.text.hi : Palette.status.loss));
        }
        if (this._track) {
            const mode = outcome.modeLabel ?? '1v1 Duel';
            this._track.string = `${outcome.track === 'paper' ? 'Paper' : 'Real'} · ${mode}`;
        }
        if (this._earned) {
            this._earned.string = won ? 'YOU EARNED' : (tie ? 'PUSH' : 'BETTER LUCK');
            this._earned.color = colorFromHex(won ? Palette.status.win : Palette.text.mid);
        }
        const sol = (outcome.payoutLamports ?? 0) / 1_000_000_000;
        if (this._payout) {
            this._payout.string = won ? `+${sol.toFixed(3)} SOL` : `+0.000 SOL`;
            this._payout.color = colorFromHex(won ? Palette.status.win : Palette.text.lo);
        }
        if (this._subtitle) {
            const diff = ((outcome.playerDeltaPct ?? 0) - (outcome.opponentDeltaPct ?? 0));
            this._subtitle.string = won ? `Won by ${Math.abs(diff).toFixed(2)}%` : (tie ? 'Tied' : `Lost by ${Math.abs(diff).toFixed(2)}%`);
        }
        if (this._breakdown && outcome.perTokenBreakdown) {
            this._breakdown.string = outcome.perTokenBreakdown;
        }
        const youValueLbl = this._cardValues.get('you');
        if (youValueLbl) {
            const pct = outcome.playerDeltaPct ?? 0;
            youValueLbl.string = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
            youValueLbl.color = colorFromHex(pct >= 0 ? Palette.status.win : Palette.status.loss);
        }
        const oppValueLbl = this._cardValues.get('opp');
        if (oppValueLbl) {
            const pct = outcome.opponentDeltaPct ?? 0;
            oppValueLbl.string = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
            oppValueLbl.color = colorFromHex(pct >= 0 ? Palette.status.win : Palette.status.loss);
        }
        const xpValueLbl = this._cardValues.get('xp');
        if (xpValueLbl) {
            xpValueLbl.string = `+${outcome.xpGained ?? 0}`;
            xpValueLbl.color = colorFromHex(Palette.accent.amber);
        }
        const lvlValueLbl = this._cardValues.get('lvl');
        if (lvlValueLbl) {
            lvlValueLbl.string = `${outcome.newLevel ?? 1}`;
            lvlValueLbl.color = colorFromHex(Palette.text.hi);
        }
        const lvlSubLbl = this._cardSubs.get('lvl');
        if (lvlSubLbl && outcome.previousLevel !== undefined && outcome.previousLevel !== outcome.newLevel) {
            lvlSubLbl.string = `Lv ${outcome.previousLevel} → Lv ${outcome.newLevel}`;
        }

        // Background glow color.
        this._drawBgGlow(won);
        this._drawMascotGlow(won);

        // Mascot: attach + setState on show.
        this._setupMascot(won, tie);

        // XP bar fill: simple proportional based on xpGained.
        const xpPct = Math.min(1, (outcome.xpGained ?? 0) / 200);
        this._setXPBarFill(xpPct, Palette.accent.amber);

        // Animations.
        this._runCascade(won, sol);

        console.log(`${TAG} show | won=${won} tie=${tie} sol=${sol.toFixed(3)} player=${outcome.playerDeltaPct ?? '?'} opp=${outcome.opponentDeltaPct ?? '?'} xp=${outcome.xpGained ?? '?'}`);
    }

    private _setupMascot(won: boolean, tie: boolean): void {
        const node = this._mascotNode;
        if (!node) return;
        let mc = node.getComponent(MascotController);
        if (!mc) {
            mc = node.addComponent(MascotController);
        }
        const targetState: MascotState = tie ? 'think' : (won ? 'celebrate' : 'lose');
        try {
            mc.setState(targetState, true);
        } catch (e: any) {
            console.log(`${TAG} _setupMascot | setState threw: ${e?.message ?? e}`);
        }
    }

    private _runCascade(won: boolean, payoutSol: number): void {
        const root = this._root;
        if (!root) return;
        const rootOp = root.getComponent(UIOpacity);
        if (rootOp) {
            rootOp.opacity = 0;
            const t = tween(rootOp).to(0.22, { opacity: 255 }, { easing: 'sineOut' });
            this._activeTweens.push(t);
            t.start();
        }
        // Stagger card fade-ins.
        const cardKeys = ['opp', 'you', 'xp', 'lvl'];
        cardKeys.forEach((key, i) => {
            const t = setTimeout(() => {
                const lbl = this._cardValues.get(key);
                const cardNode = lbl?.node?.parent;
                if (!cardNode) return;
                const op = cardNode.getComponent(UIOpacity) ?? cardNode.addComponent(UIOpacity);
                op.opacity = 0;
                const tw = tween(op).to(0.28, { opacity: 255 }, { easing: 'sineOut' });
                this._activeTweens.push(tw);
                tw.start();
            }, 600 + i * 120) as unknown as number;
            this._timers.push(t);
        });
        // Mascot + glow fade.
        const mascotT = setTimeout(() => {
            const op = this._mascotNode?.getComponent(UIOpacity);
            const glowOp = this._mascotGlowNode?.getComponent(UIOpacity);
            if (op) {
                const t = tween(op).to(0.4, { opacity: 255 }, { easing: 'sineOut' });
                this._activeTweens.push(t);
                t.start();
            }
            if (glowOp) {
                const t = tween(glowOp).to(0.4, { opacity: 200 }, { easing: 'sineOut' });
                this._activeTweens.push(t);
                t.start();
            }
        }, 300) as unknown as number;
        this._timers.push(mascotT);
        // Payout count-up ticker.
        const tickerT = setTimeout(() => {
            this._runPayoutTicker(payoutSol, 0.7);
        }, 500) as unknown as number;
        this._timers.push(tickerT);
        // Victory sound on win.
        if (won) {
            try { playSound('victory'); } catch (_) { /* no-op */ }
        }
    }

    private _runPayoutTicker(toSol: number, durationS: number): void {
        if (!this._payout) return;
        const lbl = this._payout;
        const start = Date.now();
        let lastSoundAt = 0;
        const tick = () => {
            if (!this._visible) return;
            const elapsed = (Date.now() - start) / 1000;
            const t = Math.min(1, elapsed / durationS);
            const eased = 1 - (1 - t) * (1 - t); // quadOut
            const v = toSol * eased;
            lbl.string = `+${v.toFixed(3)} SOL`;
            if (Date.now() - lastSoundAt > 300 && t < 1) {
                try { playSound('stack'); } catch (_) { /* no-op */ }
                lastSoundAt = Date.now();
            }
            if (t < 1) {
                const id = setTimeout(tick, 33) as unknown as number;
                this._timers.push(id);
            } else {
                lbl.string = `+${toSol.toFixed(3)} SOL`;
            }
        };
        tick();
    }

    private _snapAllToFinal(): void {
        // Cancel pending animations + jump to terminal frame.
        for (const t of this._activeTweens) {
            try { t.stop(); } catch (_) { /* no-op */ }
        }
        this._activeTweens.length = 0;
        for (const id of this._timers) {
            clearTimeout(id);
        }
        this._timers.length = 0;
        const root = this._root;
        if (!root) return;
        const rootOp = root.getComponent(UIOpacity);
        if (rootOp) rootOp.opacity = 255;
        const mOp = this._mascotNode?.getComponent(UIOpacity);
        if (mOp) mOp.opacity = 255;
        const gOp = this._mascotGlowNode?.getComponent(UIOpacity);
        if (gOp) gOp.opacity = 200;
        const cardKeys = ['opp', 'you', 'xp', 'lvl'];
        for (const key of cardKeys) {
            const lbl = this._cardValues.get(key);
            const cardNode = lbl?.node?.parent;
            const op = cardNode?.getComponent(UIOpacity);
            if (op) op.opacity = 255;
        }
        console.log(`${TAG} _snapAllToFinal | DONE`);
    }

    /** Hide and reset state. Idempotent. */
    hide(): void {
        if (!this._root) return;
        this._snapAllToFinal();
        this._root.active = false;
        this._visible = false;
        this._onCallbacks = null;
        if (this._bgPulseTween) {
            try { this._bgPulseTween.stop(); } catch (_) {}
            this._bgPulseTween = null;
        }
        console.log(`${TAG} hide | DONE`);
    }

    destroy(): void {
        this.hide();
        if (this._root) {
            try { this._root.destroy(); } catch (_) { /* no-op */ }
            this._root = null;
        }
    }
}
