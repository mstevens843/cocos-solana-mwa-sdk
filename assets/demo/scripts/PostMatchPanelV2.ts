/**
 * PostMatchPanelV2.ts - code-built game-over panel.
 *
 * Bypasses the broken Button.CLICK pipeline on the scene-baked PostMatchPanel.
 * Built from scratch as a fresh tree of Nodes parented to the Canvas root,
 * with explicit `node.layer = canvas.layer` everywhere, and CTAs that use
 * raw `Node.EventType.TOUCH_END` (NOT Button.CLICK).
 *
 * Visual parity target: the existing post-match design (mascot with
 * concentric outcome-color glow ring, stroked title, breakdown pill,
 * scoreboard cards with triangle indicators + accent stripes, coral primary
 * CTA with halo, slate secondary CTA).
 */

import {
    Node, Label, UITransform, UIOpacity, Color, Vec3,
    tween, Tween, EventTouch, HorizontalTextAlignment, VerticalTextAlignment,
    SpriteFrame,
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
    rakeLabel?: string;
}

export interface PostMatchCallbacks {
    onBack: () => void;
    onAgain: () => void;
    onShare?: () => void;
}

type SpriteSheetGetter = () => Partial<Record<MascotState, SpriteFrame[]>> | null | undefined;

export class PostMatchPanelV2 {
    private _canvasRoot: Node;
    private _spriteSheetGetter: SpriteSheetGetter;
    private _root: Node | null = null;
    private _bgNode: Node | null = null;
    private _bgGlowNode: Node | null = null;
    private _bgPulseTween: Tween<UIOpacity> | null = null;
    private _title: Label | null = null;
    private _track: Label | null = null;
    private _earned: Label | null = null;
    private _payout: Label | null = null;
    private _breakdownPillNode: Node | null = null;
    private _breakdownLabel: Label | null = null;
    private _subtitle: Label | null = null;
    private _rakeLabel: Label | null = null;
    private _mascotNode: Node | null = null;
    private _mascotGlowNode: Node | null = null;
    private _cardNodes: Map<string, Node> = new Map();
    private _cardValueLabels: Map<string, Label> = new Map();
    private _cardSubLabels: Map<string, Label> = new Map();
    private _cardEyebrowLabels: Map<string, Label> = new Map();
    private _cardTriangleNodes: Map<string, Node> = new Map();
    private _cardAccentNodes: Map<string, Node> = new Map();
    private _xpBarFillNode: Node | null = null;
    private _xpBarFillW: number = 0;
    private _xpBarH: number = 0;
    private _ctaNewSquad: Node | null = null;
    private _ctaHome: Node | null = null;
    private _ctaNewSquadGlow: Node | null = null;
    private _timers: number[] = [];
    private _activeTweens: Tween<any>[] = [];
    private _visible = false;
    private _onCallbacks: PostMatchCallbacks | null = null;

    constructor(canvasRoot: Node, spriteSheetGetter?: SpriteSheetGetter) {
        this._canvasRoot = canvasRoot;
        this._spriteSheetGetter = spriteSheetGetter ?? (() => null);
    }

    isVisible(): boolean {
        return this._visible;
    }

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

        // Layout zones (Image #2 reference, designResolution 720x1602):
        //   y=691  top edge (used by topAnchor)
        //   y= 480 title
        //   y= 410 track label
        //   y= 360 earned eyebrow
        //   y= 290 payout big number
        //   y= 220 breakdown pill center
        //   y= 175 subtitle
        //   y=   0 mascot center, glow ring r~286
        //   y=-280 rake label
        //   y=-380 cards row 1 (BEST OPP / YOUR DELTA OR YOUR DELTA / BEST OPP)
        //   y=-510 cards row 2 (XP / LEVEL)
        //   y=-590 XP bar
        //   y=-705 CTAs (botAnchor)

        this._buildBackground(root, cw, ch);
        this._title = this._addStrokedLabel(root, 'V2_Title', '', 56, Palette.text.hi, '#1FE0A5', 4, 0, 480, cw - 80, 80);
        this._track = this._addLabel(root, 'V2_Track', '', 22, Palette.text.mid, 0, 410, cw - 80, 30);
        this._earned = this._addLabel(root, 'V2_Earned', 'YOU EARNED', 14, Palette.status.win, 0, 360, cw - 80, 22);
        this._payout = this._addStrokedLabel(root, 'V2_Payout', '+0.000 SOL', 64, Palette.text.hi, '#1FE0A5', 5, 0, 290, cw - 80, 96);
        this._buildBreakdownPill(root, 0, 220, cw - 120, 38);
        this._subtitle = this._addLabel(root, 'V2_Subtitle', '', 18, Palette.text.hi, 0, 175, cw - 80, 26);
        this._buildMascotGlow(root, 0, 0);
        this._buildMascotContainer(root, 0, 0);
        this._rakeLabel = this._addLabel(root, 'V2_Rake', '', 12, Palette.text.lo, 0, -280, cw - 120, 18);
        // Scoreboard 2x2.
        const cardW = (cw - 80) / 2 - 8;
        const cardH = 120;
        const colLeft = -cardW / 2 - 8;
        const colRight = +cardW / 2 + 8;
        const row1Y = -380;
        const row2Y = -380 - cardH - 12;
        this._buildStatCard(root, 'you', 'YOUR DELTA', colLeft, row1Y, cardW, cardH);
        this._buildStatCard(root, 'opp', 'BEST OPP', colRight, row1Y, cardW, cardH);
        this._buildStatCard(root, 'xp', 'XP EARNED', colLeft, row2Y, cardW, cardH);
        this._buildStatCard(root, 'lvl', 'LEVEL', colRight, row2Y, cardW, cardH);
        // XP bar row.
        this._buildXPBar(root, 0, row2Y - cardH / 2 - 30, cw - 100, 14);
        // CTAs.
        const ctaY = -705;
        const ctaW = 320;
        const ctaH = 96;
        const ctaGap = 24;
        this._ctaNewSquad = this._buildCTA(root, 'newSquad', 'PICK NEW SQUAD', 'Try a different lineup', -ctaW / 2 - ctaGap / 2, ctaY, ctaW, ctaH, true);
        this._ctaHome = this._buildCTA(root, 'home', 'HOME', 'Back to main menu', +ctaW / 2 + ctaGap / 2, ctaY, ctaW, ctaH, false);

        // Skip-tap on root: outside CTAs jumps cascade to terminal.
        root.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
            try {
                const ui = ev.getUILocation();
                if (!this._tapInside(this._ctaNewSquad, ui.x, ui.y) && !this._tapInside(this._ctaHome, ui.x, ui.y)) {
                    this._snapAllToFinal();
                }
            } catch (_) { /* no-op */ }
        }, this);
        console.log(`${TAG} _build | DONE cw=${cw} ch=${ch}`);
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
        lbl.lineHeight = Math.round(fontSize * 1.15);
        lbl.color = colorFromHex(hex);
        lbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        lbl.verticalAlign = VerticalTextAlignment.CENTER;
        node.addComponent(UIOpacity);
        return lbl;
    }

    private _addStrokedLabel(parent: Node, name: string, text: string, fontSize: number, fillHex: string, strokeHex: string, strokeWidth: number, x: number, y: number, w: number, h: number): Label {
        const lbl = this._addLabel(parent, name, text, fontSize, fillHex, x, y, w, h);
        (lbl as any).enableOutline = true;
        (lbl as any).outlineColor = colorFromHex(strokeHex);
        (lbl as any).outlineWidth = strokeWidth;
        (lbl as any).enableBold = true;
        return lbl;
    }

    private _buildBackground(parent: Node, cw: number, ch: number): void {
        const bg = new Node('V2_Bg');
        bg.layer = parent.layer;
        const ut = bg.addComponent(UITransform);
        ut.setContentSize(cw, ch);
        parent.addChild(bg);
        bg.setPosition(new Vec3(0, 0, 0));
        bg.setSiblingIndex(0);
        const op = bg.addComponent(UIOpacity);
        op.opacity = 235;
        safeAddGraphics(bg, (g) => {
            g.fillColor = colorFromHex(Palette.bg.primary);
            g.rect(-cw / 2, -ch / 2, cw, ch);
            g.fill();
            // Corner vignette: 4 nested transparent rects with growing alpha.
            const alphas = [30, 60, 90, 120];
            const insets = [120, 80, 40, 0];
            for (let i = 0; i < 4; i++) {
                g.fillColor = new Color(0, 0, 0, alphas[i]);
                g.rect(-cw / 2 + insets[i], -ch / 2 + insets[i], cw - insets[i] * 2, ch - insets[i] * 2);
                g.fill();
            }
        });
        this._bgNode = bg;
        // Outcome glow rings node (on top of bg, behind content).
        const glow = new Node('V2_BgGlow');
        glow.layer = parent.layer;
        const glowUT = glow.addComponent(UITransform);
        glowUT.setContentSize(cw, ch);
        bg.addChild(glow);
        glow.setPosition(new Vec3(0, 0, 0));
        const glowOp = glow.addComponent(UIOpacity);
        glowOp.opacity = 130;
        this._bgGlowNode = glow;
    }

    private _drawBgGlow(winColor: boolean): void {
        if (!this._bgGlowNode) return;
        const hex = winColor ? Palette.status.win : Palette.status.loss;
        const c = colorFromHex(hex);
        safeAddGraphics(this._bgGlowNode, (g) => {
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

    private _buildBreakdownPill(parent: Node, x: number, y: number, w: number, h: number): void {
        const pill = new Node('V2_BreakdownPill');
        pill.layer = parent.layer;
        const ut = pill.addComponent(UITransform);
        ut.setContentSize(w, h);
        parent.addChild(pill);
        pill.setPosition(new Vec3(x, y, 0));
        const op = pill.addComponent(UIOpacity);
        op.opacity = 0;
        const lblNode = new Node('label');
        lblNode.layer = pill.layer;
        const lblUT = lblNode.addComponent(UITransform);
        lblUT.setContentSize(w - 20, h - 6);
        pill.addChild(lblNode);
        lblNode.setPosition(new Vec3(0, 0, 0));
        const lbl = lblNode.addComponent(Label);
        lbl.string = '';
        lbl.fontSize = 16;
        lbl.lineHeight = 20;
        lbl.color = colorFromHex(Palette.text.mid);
        lbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        lbl.verticalAlign = VerticalTextAlignment.CENTER;
        this._breakdownPillNode = pill;
        this._breakdownLabel = lbl;
    }

    private _drawBreakdownPill(winColor: boolean): void {
        const pill = this._breakdownPillNode;
        if (!pill) return;
        const ut = pill.getComponent(UITransform);
        if (!ut) return;
        const w = ut.contentSize.width;
        const h = ut.contentSize.height;
        const hex = winColor ? Palette.status.win : Palette.status.loss;
        const c = colorFromHex(hex);
        safeAddGraphics(pill, (g) => {
            g.clear();
            g.fillColor = new Color(c.r, c.g, c.b, 25);
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
            g.lineWidth = 1;
            g.strokeColor = new Color(c.r, c.g, c.b, 80);
            g.rect(-w / 2, -h / 2, w, h);
            g.stroke();
        });
    }

    private _buildMascotGlow(parent: Node, x: number, y: number): void {
        const node = new Node('V2_MascotGlow');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(620, 620);
        parent.addChild(node);
        node.setPosition(new Vec3(x, y, 0));
        const op = node.addComponent(UIOpacity);
        op.opacity = 0;
        this._mascotGlowNode = node;
    }

    private _drawMascotGlow(winColor: boolean): void {
        const n = this._mascotGlowNode;
        if (!n) return;
        const hex = winColor ? Palette.status.win : Palette.status.loss;
        const c = colorFromHex(hex);
        safeAddGraphics(n, (g) => {
            g.clear();
            // Floor shadow ellipse below mascot.
            g.fillColor = new Color(0, 0, 0, 110);
            g.ellipse(0, -130, 130, 26);
            g.fill();
            // Outer glow disc, very faint.
            g.fillColor = new Color(c.r, c.g, c.b, 80);
            g.circle(0, 0, 240);
            g.fill();
            // Inner glow disc, brighter.
            g.fillColor = new Color(c.r, c.g, c.b, 140);
            g.circle(0, 0, 170);
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
        this._mascotNode = node;
    }

    private _setupMascot(won: boolean, tie: boolean): void {
        const n = this._mascotNode;
        if (!n) return;
        let mc = n.getComponent(MascotController);
        if (!mc) {
            mc = n.addComponent(MascotController);
        }
        // Copy sprite sheet from the existing scene mascot if available.
        try {
            const frames = this._spriteSheetGetter();
            if (frames && Object.keys(frames).length > 0) {
                mc.setSpriteSheet(frames);
            }
        } catch (e: any) {
            console.log(`${TAG} _setupMascot | setSpriteSheet threw: ${e?.message ?? e}`);
        }
        const target: MascotState = tie ? 'think' : (won ? 'celebrate' : 'lose');
        try {
            mc.setState(target, true);
        } catch (e: any) {
            console.log(`${TAG} _setupMascot | setState threw: ${e?.message ?? e}`);
        }
    }

    private _buildStatCard(parent: Node, key: string, eyebrow: string, x: number, y: number, w: number, h: number): void {
        const card = new Node(`V2_Card_${key}`);
        card.layer = parent.layer;
        const ut = card.addComponent(UITransform);
        ut.setContentSize(w, h);
        parent.addChild(card);
        card.setPosition(new Vec3(x, y, 0));
        const op = card.addComponent(UIOpacity);
        op.opacity = 0;
        // Background.
        safeAddGraphics(card, (g) => {
            g.fillColor = colorFromHex(Palette.bg.card);
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
        });
        // Top accent stripe (color set in _drawCardAccent).
        const accent = new Node('accent');
        accent.layer = card.layer;
        const accentUT = accent.addComponent(UITransform);
        accentUT.setContentSize(w, 2);
        card.addChild(accent);
        accent.setPosition(new Vec3(0, h / 2 - 1, 0));
        this._cardAccentNodes.set(key, accent);
        // Indicator triangle (top-left).
        const tri = new Node('triangle');
        tri.layer = card.layer;
        const triUT = tri.addComponent(UITransform);
        triUT.setContentSize(16, 16);
        card.addChild(tri);
        tri.setPosition(new Vec3(-w / 2 + 18, h / 2 - 24, 0));
        this._cardTriangleNodes.set(key, tri);
        // Eyebrow label (top-center).
        const eb = new Node('eyebrow');
        eb.layer = card.layer;
        const ebUT = eb.addComponent(UITransform);
        ebUT.setContentSize(w - 40, 16);
        card.addChild(eb);
        eb.setPosition(new Vec3(0, h / 2 - 22, 0));
        const ebLbl = eb.addComponent(Label);
        ebLbl.string = eyebrow;
        ebLbl.fontSize = 12;
        ebLbl.lineHeight = 16;
        ebLbl.color = colorFromHex(Palette.text.mid);
        ebLbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        ebLbl.verticalAlign = VerticalTextAlignment.CENTER;
        this._cardEyebrowLabels.set(key, ebLbl);
        // Big value (center).
        const val = new Node('value');
        val.layer = card.layer;
        const valUT = val.addComponent(UITransform);
        valUT.setContentSize(w - 16, 44);
        card.addChild(val);
        val.setPosition(new Vec3(0, -2, 0));
        const valLbl = val.addComponent(Label);
        valLbl.string = '';
        valLbl.fontSize = 32;
        valLbl.lineHeight = 40;
        valLbl.color = colorFromHex(Palette.text.hi);
        (valLbl as any).enableBold = true;
        valLbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        valLbl.verticalAlign = VerticalTextAlignment.CENTER;
        this._cardValueLabels.set(key, valLbl);
        // Sub label (below value).
        const sub = new Node('sub');
        sub.layer = card.layer;
        const subUT = sub.addComponent(UITransform);
        subUT.setContentSize(w - 16, 14);
        card.addChild(sub);
        sub.setPosition(new Vec3(0, -h / 2 + 14, 0));
        const subLbl = sub.addComponent(Label);
        subLbl.string = '';
        subLbl.fontSize = 11;
        subLbl.lineHeight = 14;
        subLbl.color = colorFromHex(Palette.text.lo);
        subLbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        subLbl.verticalAlign = VerticalTextAlignment.CENTER;
        this._cardSubLabels.set(key, subLbl);
        this._cardNodes.set(key, card);
    }

    private _drawCardAccent(key: string, hex: string): void {
        const accent = this._cardAccentNodes.get(key);
        if (!accent) return;
        const ut = accent.getComponent(UITransform);
        if (!ut) return;
        const w = ut.contentSize.width;
        safeAddGraphics(accent, (g) => {
            g.clear();
            g.fillColor = colorFromHex(hex);
            g.rect(-w / 2, -1, w, 2);
            g.fill();
        });
    }

    private _drawCardTriangle(key: string, hex: string, up: boolean): void {
        const tri = this._cardTriangleNodes.get(key);
        if (!tri) return;
        safeAddGraphics(tri, (g) => {
            g.clear();
            g.fillColor = colorFromHex(hex);
            const r = 7;
            if (up) {
                g.moveTo(0, r);
                g.lineTo(-r, -r);
                g.lineTo(r, -r);
            } else {
                g.moveTo(0, -r);
                g.lineTo(-r, r);
                g.lineTo(r, r);
            }
            g.close();
            g.fill();
        });
    }

    private _buildXPBar(parent: Node, x: number, y: number, w: number, h: number): void {
        const bar = new Node('V2_XPBar');
        bar.layer = parent.layer;
        const ut = bar.addComponent(UITransform);
        ut.setContentSize(w, h);
        parent.addChild(bar);
        bar.setPosition(new Vec3(x, y, 0));
        const op = bar.addComponent(UIOpacity);
        op.opacity = 0;
        safeAddGraphics(bar, (g) => {
            g.fillColor = new Color(255, 255, 255, 30);
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
        });
        const fill = new Node('XPBarFill');
        fill.layer = parent.layer;
        const fillUT = fill.addComponent(UITransform);
        fillUT.setContentSize(w, h);
        bar.addChild(fill);
        fill.setPosition(new Vec3(0, 0, 0));
        this._xpBarFillNode = fill;
        this._xpBarFillW = w;
        this._xpBarH = h;
    }

    private _setXPBarFill(pct: number, hex: string): void {
        if (!this._xpBarFillNode) return;
        const w = this._xpBarFillW;
        const h = this._xpBarH;
        const fillW = Math.max(0, Math.min(1, pct)) * w;
        safeAddGraphics(this._xpBarFillNode, (g) => {
            g.clear();
            g.fillColor = colorFromHex(hex);
            g.rect(-w / 2, -h / 2, fillW, h);
            g.fill();
        });
    }

    private _buildCTA(parent: Node, key: string, label: string, sublabel: string, x: number, y: number, w: number, h: number, primary: boolean): Node {
        // Outer glow halo for primary CTA - drawn as a sibling node behind.
        if (primary) {
            const halo = new Node(`V2_CTA_${key}_glow`);
            halo.layer = parent.layer;
            const haloUT = halo.addComponent(UITransform);
            haloUT.setContentSize(w + 24, h + 24);
            parent.addChild(halo);
            halo.setPosition(new Vec3(x, y, 0));
            const haloOp = halo.addComponent(UIOpacity);
            haloOp.opacity = 0;
            safeAddGraphics(halo, (g) => {
                const c = colorFromHex(Palette.accent.rose);
                // Layered translucent rects to fake a glow.
                const passes = [{ a: 28, p: 12 }, { a: 50, p: 8 }, { a: 80, p: 4 }];
                for (const pass of passes) {
                    g.fillColor = new Color(c.r, c.g, c.b, pass.a);
                    g.rect(-(w + pass.p * 2) / 2, -(h + pass.p * 2) / 2, w + pass.p * 2, h + pass.p * 2);
                    g.fill();
                }
            });
            this._ctaNewSquadGlow = halo;
        }
        const node = new Node(`V2_CTA_${key}`);
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);
        ut.setAnchorPoint(0.5, 0.5);
        parent.addChild(node);
        node.setPosition(new Vec3(x, y, 0));
        node.setSiblingIndex(parent.children.length - 1);
        const op = node.addComponent(UIOpacity);
        op.opacity = 0;
        const fillHex = primary ? Palette.accent.rose : Palette.bg.surface;
        const borderHex = primary ? Palette.accent.roseDim : Palette.text.lo;
        safeAddGraphics(node, (g) => {
            g.fillColor = colorFromHex(fillHex);
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
            g.lineWidth = 2;
            g.strokeColor = colorFromHex(borderHex);
            g.rect(-w / 2, -h / 2, w, h);
            g.stroke();
        });
        // Main label.
        const main = new Node('cta_main');
        main.layer = node.layer;
        const mUT = main.addComponent(UITransform);
        mUT.setContentSize(w - 16, 32);
        node.addChild(main);
        main.setPosition(new Vec3(0, 10, 0));
        const mLbl = main.addComponent(Label);
        mLbl.string = label;
        mLbl.fontSize = 22;
        mLbl.lineHeight = 28;
        (mLbl as any).enableBold = true;
        mLbl.color = colorFromHex(Palette.text.hi);
        mLbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        mLbl.verticalAlign = VerticalTextAlignment.CENTER;
        // Sublabel.
        const sub = new Node('cta_sub');
        sub.layer = node.layer;
        const sUT = sub.addComponent(UITransform);
        sUT.setContentSize(w - 16, 18);
        node.addChild(sub);
        sub.setPosition(new Vec3(0, -16, 0));
        const sLbl = sub.addComponent(Label);
        sLbl.string = sublabel;
        sLbl.fontSize = 13;
        sLbl.lineHeight = 16;
        sLbl.color = primary ? colorFromHex(Palette.text.hi) : colorFromHex(Palette.text.mid);
        sLbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        sLbl.verticalAlign = VerticalTextAlignment.CENTER;
        // Tap pipeline.
        node.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
            console.log(`${TAG} CTA_TOUCH_END label=${key}`);
            try { ev.propagationStopped = true; } catch (_) {}
            // Restore opacity.
            op.opacity = 255;
            this._fireCallback(key);
        }, this);
        node.on(Node.EventType.TOUCH_START, () => {
            console.log(`${TAG} CTA_TOUCH_START label=${key}`);
            op.opacity = 200; // pressed-state dim
        }, this);
        node.on(Node.EventType.TOUCH_CANCEL, () => {
            op.opacity = 255;
        }, this);
        console.log(`${TAG} _buildCTA | label=${key} pos=(${x.toFixed(1)},${y.toFixed(1)}) size=${w}x${h} primary=${primary}`);
        return node;
    }

    private _fireCallback(key: string): void {
        if (!this._onCallbacks) return;
        try {
            if (key === 'newSquad') this._onCallbacks.onAgain();
            else if (key === 'home') this._onCallbacks.onBack();
            else if (key === 'share' && this._onCallbacks.onShare) this._onCallbacks.onShare();
        } catch (e: any) {
            console.log(`${TAG} _fireCallback threw key=${key} err=${e?.message ?? e}`);
        }
    }

    show(outcome: PostMatchOutcome, callbacks: PostMatchCallbacks): void {
        this._build();
        if (!this._root) return;
        this._onCallbacks = callbacks;
        this._root.active = true;
        this._root.setSiblingIndex(this._canvasRoot.children.length - 1);
        this._visible = true;
        const won = !!outcome.won && !outcome.tie;
        const tie = !!outcome.tie;
        const winColor = won;
        const colorHex = winColor ? Palette.status.win : Palette.status.loss;

        // Title text + outline color.
        if (this._title) {
            this._title.string = tie ? 'TIE' : (won ? 'YOU WON' : 'SO CLOSE...');
            this._title.color = colorFromHex(Palette.text.hi);
            (this._title as any).outlineColor = colorFromHex(colorHex);
        }
        if (this._track) {
            const mode = outcome.modeLabel ?? '1v1 Duel';
            this._track.string = `${outcome.track === 'paper' ? 'Paper' : 'Real'} · ${mode}`;
        }
        if (this._earned) {
            this._earned.string = won ? 'YOU EARNED' : (tie ? 'PUSH' : 'YOU LOST');
            this._earned.color = colorFromHex(winColor ? Palette.status.win : Palette.status.loss);
        }
        const sol = (outcome.payoutLamports ?? 0) / 1_000_000_000;
        if (this._payout) {
            const sign = won ? '+' : (tie ? '+' : '-');
            this._payout.string = won ? `+${sol.toFixed(3)} SOL` : (tie ? '+0.000 SOL' : `-${Math.abs(sol).toFixed(3)} SOL`);
            this._payout.color = colorFromHex(Palette.text.hi);
            (this._payout as any).outlineColor = colorFromHex(colorHex);
        }
        if (this._breakdownLabel && outcome.perTokenBreakdown) {
            this._breakdownLabel.string = outcome.perTokenBreakdown;
        }
        this._drawBreakdownPill(winColor);
        if (this._subtitle) {
            const diff = ((outcome.playerDeltaPct ?? 0) - (outcome.opponentDeltaPct ?? 0));
            this._subtitle.string = won ? `Won by ${Math.abs(diff).toFixed(2)}%` : (tie ? 'Tied' : `Lost by ${Math.abs(diff).toFixed(2)}%`);
        }
        if (this._rakeLabel) {
            this._rakeLabel.string = outcome.rakeLabel ?? `Rake paid: ${(sol * 0.05).toFixed(4)} SOL (500 bps)`;
        }
        // Cards.
        const playerPct = outcome.playerDeltaPct ?? 0;
        const oppPct = outcome.opponentDeltaPct ?? 0;
        const youLbl = this._cardValueLabels.get('you');
        if (youLbl) {
            youLbl.string = `${playerPct >= 0 ? '+' : ''}${playerPct.toFixed(2)}%`;
            youLbl.color = colorFromHex(playerPct >= 0 ? Palette.status.win : Palette.status.loss);
        }
        const oppLbl = this._cardValueLabels.get('opp');
        if (oppLbl) {
            oppLbl.string = `${oppPct >= 0 ? '+' : ''}${oppPct.toFixed(2)}%`;
            oppLbl.color = colorFromHex(oppPct >= 0 ? Palette.status.win : Palette.status.loss);
        }
        const xpLbl = this._cardValueLabels.get('xp');
        if (xpLbl) {
            xpLbl.string = `+${outcome.xpGained ?? 0}`;
            xpLbl.color = colorFromHex(Palette.accent.amber);
        }
        const xpSub = this._cardSubLabels.get('xp');
        if (xpSub && outcome.totalXp !== undefined) {
            const nextLevelXp = (outcome.newLevel + 1) * 100;
            const pct = Math.round(((outcome.totalXp ?? 0) % 100));
            xpSub.string = `${outcome.totalXp ?? 0} · ${pct}%→L${(outcome.newLevel ?? 1) + 1}`;
        }
        const lvlLbl = this._cardValueLabels.get('lvl');
        if (lvlLbl) {
            lvlLbl.string = `${outcome.newLevel ?? 1}`;
            lvlLbl.color = colorFromHex(Palette.text.hi);
        }
        const lvlSub = this._cardSubLabels.get('lvl');
        if (lvlSub && outcome.previousLevel !== undefined && outcome.previousLevel !== outcome.newLevel) {
            lvlSub.string = `Lv ${outcome.previousLevel} → Lv ${outcome.newLevel}`;
        } else if (lvlSub) {
            lvlSub.string = '';
        }
        // Card accents + triangles per delta sign.
        this._drawCardAccent('you', playerPct >= 0 ? Palette.status.win : Palette.status.loss);
        this._drawCardTriangle('you', playerPct >= 0 ? Palette.status.win : Palette.status.loss, playerPct >= 0);
        this._drawCardAccent('opp', oppPct >= 0 ? Palette.status.win : Palette.status.loss);
        this._drawCardTriangle('opp', oppPct >= 0 ? Palette.status.win : Palette.status.loss, oppPct >= 0);
        this._drawCardAccent('xp', Palette.accent.amber);
        this._drawCardTriangle('xp', Palette.accent.amber, true);
        this._drawCardAccent('lvl', Palette.text.lo);
        this._drawCardTriangle('lvl', Palette.text.lo, true);
        // Background + mascot glow + mascot itself.
        this._drawBgGlow(winColor);
        this._drawMascotGlow(winColor);
        this._setupMascot(won, tie);
        // XP bar.
        const xpPct = Math.min(1, ((outcome.xpGained ?? 0) / 200));
        this._setXPBarFill(xpPct, Palette.accent.amber);
        // Cascade.
        this._runCascade(won, sol);
        console.log(`${TAG} show | won=${won} tie=${tie} sol=${sol.toFixed(3)}`);
    }

    private _runCascade(won: boolean, payoutSol: number): void {
        const root = this._root;
        if (!root) return;
        // Initial state: everything except root opacity invisible.
        const setOp = (n: Node | null, v: number) => {
            if (!n) return;
            const op = n.getComponent(UIOpacity);
            if (op) op.opacity = v;
        };
        setOp(this._title?.node ?? null, 0);
        setOp(this._track?.node ?? null, 0);
        setOp(this._earned?.node ?? null, 0);
        setOp(this._payout?.node ?? null, 0);
        setOp(this._breakdownPillNode, 0);
        setOp(this._subtitle?.node ?? null, 0);
        setOp(this._rakeLabel?.node ?? null, 0);
        setOp(this._mascotNode, 0);
        setOp(this._mascotGlowNode, 0);
        for (const card of this._cardNodes.values()) setOp(card, 0);
        setOp(this._ctaNewSquad, 0);
        setOp(this._ctaHome, 0);
        setOp(this._ctaNewSquadGlow, 0);
        // Root fade-in.
        const rootOp = root.getComponent(UIOpacity);
        if (rootOp) {
            rootOp.opacity = 0;
            const t = tween(rootOp).to(0.18, { opacity: 255 }, { easing: 'sineOut' });
            this._activeTweens.push(t);
            t.start();
        }
        const fadeIn = (n: Node | null, dur: number, delay: number) => {
            if (!n) return;
            const op = n.getComponent(UIOpacity);
            if (!op) return;
            const id = setTimeout(() => {
                const t = tween(op).to(dur, { opacity: 255 }, { easing: 'sineOut' });
                this._activeTweens.push(t);
                t.start();
            }, delay) as unknown as number;
            this._timers.push(id);
        };
        // Beat 0: title.
        fadeIn(this._title?.node ?? null, 0.22, 0);
        // Beat 1: track + earned.
        fadeIn(this._track?.node ?? null, 0.16, 180);
        fadeIn(this._earned?.node ?? null, 0.16, 280);
        // Beat 2: payout (with count-up ticker).
        fadeIn(this._payout?.node ?? null, 0.22, 320);
        const tickerT = setTimeout(() => this._runPayoutTicker(payoutSol, 0.7, won), 540) as unknown as number;
        this._timers.push(tickerT);
        // Beat 3: mascot + glow.
        fadeIn(this._mascotNode, 0.4, 1100);
        fadeIn(this._mascotGlowNode, 0.4, 1100);
        // Beat 4: subtitle + breakdown pill + rake.
        fadeIn(this._subtitle?.node ?? null, 0.18, 1450);
        fadeIn(this._breakdownPillNode, 0.18, 1500);
        fadeIn(this._rakeLabel?.node ?? null, 0.18, 1600);
        // Beat 5: cards staggered.
        const cardKeys = ['you', 'opp', 'xp', 'lvl'];
        cardKeys.forEach((k, i) => {
            fadeIn(this._cardNodes.get(k) ?? null, 0.28, 1700 + i * 180);
        });
        // Beat 7: CTAs + glow halo.
        fadeIn(this._ctaNewSquadGlow, 0.22, 2700);
        fadeIn(this._ctaNewSquad, 0.22, 2700);
        fadeIn(this._ctaHome, 0.22, 2750);
        // Idle pulse on primary CTA glow halo.
        const haloOp = this._ctaNewSquadGlow?.getComponent(UIOpacity);
        if (haloOp) {
            const id2 = setTimeout(() => {
                const t = tween(haloOp).repeatForever(
                    tween(haloOp)
                        .to(1.4, { opacity: 90 }, { easing: 'sineInOut' })
                        .to(1.4, { opacity: 200 }, { easing: 'sineInOut' })
                );
                this._activeTweens.push(t);
                t.start();
            }, 3200) as unknown as number;
            this._timers.push(id2);
        }
        // Background glow idle pulse.
        const bgOp = this._bgGlowNode?.getComponent(UIOpacity);
        if (bgOp) {
            const t = tween(bgOp).repeatForever(
                tween(bgOp)
                    .to(1.6, { opacity: 110 }, { easing: 'sineInOut' })
                    .to(1.6, { opacity: 140 }, { easing: 'sineInOut' })
            );
            this._activeTweens.push(t);
            t.start();
            this._bgPulseTween = t;
        }
        if (won) {
            try { playSound('victory'); } catch (_) {}
        }
    }

    private _runPayoutTicker(toSol: number, durationS: number, isWin: boolean): void {
        if (!this._payout) return;
        const lbl = this._payout;
        const start = Date.now();
        let lastSoundAt = 0;
        const sign = isWin ? '+' : (toSol === 0 ? '+' : '-');
        const target = Math.abs(toSol);
        const tick = () => {
            if (!this._visible) return;
            const elapsed = (Date.now() - start) / 1000;
            const t = Math.min(1, elapsed / durationS);
            const eased = 1 - (1 - t) * (1 - t);
            const v = target * eased;
            lbl.string = `${sign}${v.toFixed(3)} SOL`;
            if (Date.now() - lastSoundAt > 300 && t < 1) {
                try { playSound('stack'); } catch (_) {}
                lastSoundAt = Date.now();
            }
            if (t < 1) {
                const id = setTimeout(tick, 33) as unknown as number;
                this._timers.push(id);
            } else {
                lbl.string = `${sign}${target.toFixed(3)} SOL`;
            }
        };
        tick();
    }

    private _snapAllToFinal(): void {
        for (const t of this._activeTweens) {
            try { t.stop(); } catch (_) {}
        }
        this._activeTweens.length = 0;
        for (const id of this._timers) clearTimeout(id);
        this._timers.length = 0;
        const setOp = (n: Node | null, v: number) => {
            if (!n) return;
            const op = n.getComponent(UIOpacity);
            if (op) op.opacity = v;
        };
        if (this._root) setOp(this._root, 255);
        setOp(this._title?.node ?? null, 255);
        setOp(this._track?.node ?? null, 255);
        setOp(this._earned?.node ?? null, 255);
        setOp(this._payout?.node ?? null, 255);
        setOp(this._breakdownPillNode, 255);
        setOp(this._subtitle?.node ?? null, 255);
        setOp(this._rakeLabel?.node ?? null, 255);
        setOp(this._mascotNode, 255);
        setOp(this._mascotGlowNode, 200);
        for (const card of this._cardNodes.values()) setOp(card, 255);
        setOp(this._ctaNewSquad, 255);
        setOp(this._ctaHome, 255);
        setOp(this._ctaNewSquadGlow, 140);
    }

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
            try { this._root.destroy(); } catch (_) {}
            this._root = null;
        }
    }
}
