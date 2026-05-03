/**
 * LevelUpOverlay.ts - cinematic centered level-up overlay.
 *
 * Replaces the scene-baked LevelUpOverlay (5 labels + Button under Canvas).
 * Built procedurally at runtime, parented to Canvas root, hoisted to highest
 * sibling on every show so it sits above PostMatchPanel, MIP, MatchBrowser,
 * and toasts. Fires from AppUI._enqueueLevelUp regardless of which UI panel
 * the user is on, since matches resolve in the background.
 *
 * Visual: dark translucent backdrop + centered card with mascot-celebrate
 * badge, "LEVEL UP" title (gold), Lv prev → Lv new transition, XP bar with
 * real numbers, reward microcopy, Continue button. Auto-dismiss at 2.8s.
 *
 * States:
 *   Normal       LEVEL UP / Lv 2 → Lv 3 / Your duel rank increased.
 *   Multi-level  LEVEL UP / Lv 2 → Lv 4 / Massive XP gain.
 *   Max          MAX LEVEL / Lv 10 / You reached the top rank.
 *
 * Reduced motion: localStorage 'tokenduel:reducedMotion' = 'true' → no
 * sparkle burst, instant level swap, plain fade. Sound still fires.
 *
 * All Graphics route through safeAddGraphics per the Cocos 3.8 SIGSEGV
 * fix (see safeGraphics.ts).
 */

import {
    Node, Label, UITransform, UIOpacity, Color, Vec3,
    Sprite, SpriteFrame, resources, ImageAsset, Texture2D,
    tween, Tween, EventTouch, HorizontalTextAlignment, VerticalTextAlignment,
} from 'cc';
import { Palette, colorFromHex, Motion } from './Theme';
import { safeAddGraphics } from './safeGraphics';
import { MascotController, MascotState } from './MascotController';
import { xpForLevel, levelProgress } from './PayoutCalc';
import { playSound } from './Sound';
import { Haptics, HapticType } from './Haptics';

const TAG = '[LevelUpOverlay]';

export interface LevelUpPayload {
    previousLevel: number;
    newLevel: number;
    /** Total XP (onchain + paper) immediately before settlement. Optional - omit to hide bar. */
    xpBefore?: number;
    /** Total XP (onchain + paper) immediately after settlement. Optional - omit to hide bar. */
    xpAfter?: number;
}

export interface LevelUpCallbacks {
    onClose?: () => void;
}

type SpriteSheetGetter = () => Partial<Record<MascotState, SpriteFrame[]>> | null | undefined;

const MAX_LEVEL = 10; // matches RAKE_BPS_MIN cap in PayoutCalc.ts

const CARD_W = 480;
const CARD_H = 540;
const BADGE_SIZE = 144;
const XPBAR_W = 320;
const XPBAR_H = 8;
const CTA_W = 160;
const CTA_H = 48;

function isReducedMotion(): boolean {
    try {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return ls?.getItem?.('tokenduel:reducedMotion') === 'true';
    } catch { return false; }
}

export class LevelUpOverlay {
    private _canvasRoot: Node;
    private _spriteSheetGetter: SpriteSheetGetter;
    private _root: Node | null = null;
    private _backdropNode: Node | null = null;
    private _cardNode: Node | null = null;
    private _badgeContainer: Node | null = null;
    private _badgeGlowNode: Node | null = null;
    private _mascotNode: Node | null = null;
    private _crownSprite: Sprite | null = null;
    private _crownNode: Node | null = null;
    private _titleLabel: Label | null = null;
    private _levelRowNode: Node | null = null;
    private _prevLevelLabel: Label | null = null;
    private _arrowLabel: Label | null = null;
    private _newLevelLabel: Label | null = null;
    private _maxLevelLabel: Label | null = null;
    private _xpBarTrackNode: Node | null = null;
    private _xpBarFillNode: Node | null = null;
    private _xpNumLabel: Label | null = null;
    private _microLabel: Label | null = null;
    private _ctaNode: Node | null = null;
    private _ctaHaloNode: Node | null = null;
    private _activeTweens: Tween<any>[] = [];
    private _timers: number[] = [];
    private _visible = false;
    private _onCallbacks: LevelUpCallbacks | null = null;
    private _showStartedAt = 0;
    private _exitFired = false;
    private _crownTextureLoaded = false;

    constructor(canvasRoot: Node, spriteSheetGetter?: SpriteSheetGetter) {
        this._canvasRoot = canvasRoot;
        this._spriteSheetGetter = spriteSheetGetter ?? (() => null);
    }

    isVisible(): boolean { return this._visible; }

    private _build(): void {
        if (this._root) return;
        const canvas = this._canvasRoot;
        const canvasUT = canvas.getComponent(UITransform);
        const cw = canvasUT?.contentSize.width ?? 720;
        const ch = canvasUT?.contentSize.height ?? 1280;

        const root = new Node('LevelUpOverlay_Root');
        root.layer = canvas.layer;
        const rootUT = root.addComponent(UITransform);
        rootUT.setContentSize(cw, ch);
        rootUT.setAnchorPoint(0.5, 0.5);
        canvas.addChild(root);
        root.setPosition(new Vec3(0, 0, 0));
        const rootOp = root.addComponent(UIOpacity);
        rootOp.opacity = 0;
        this._root = root;

        this._buildBackdrop(root, cw, ch);
        this._buildCard(root);
        this._buildBadge(this._cardNode!);
        this._buildTitle(this._cardNode!);
        this._buildLevelRow(this._cardNode!);
        this._buildXPBar(this._cardNode!);
        this._buildMicrocopy(this._cardNode!);
        this._buildCTA(this._cardNode!);

        // Skip-tap on root: outside the card and after a 1s grace, dismiss.
        root.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
            try {
                const elapsed = Date.now() - this._showStartedAt;
                if (elapsed < 1000) return; // grace window: don't snap-dismiss the moment
                const ui = ev.getUILocation();
                if (this._tapInside(this._ctaNode, ui.x, ui.y)) return; // CTA handles its own
                if (this._tapInside(this._cardNode, ui.x, ui.y)) return; // tapping the card body is a no-op
                this._dismiss(false);
            } catch (_) { /* no-op */ }
        }, this);

        console.log(`${TAG} _build | DONE cw=${cw} ch=${ch}`);
    }

    private _buildBackdrop(parent: Node, cw: number, ch: number): void {
        const bg = new Node('LU_Backdrop');
        bg.layer = parent.layer;
        const ut = bg.addComponent(UITransform);
        ut.setContentSize(cw, ch);
        parent.addChild(bg);
        bg.setPosition(new Vec3(0, 0, 0));
        const op = bg.addComponent(UIOpacity);
        op.opacity = 180;
        safeAddGraphics(bg, (g) => {
            const c = colorFromHex(Palette.bg.primary);
            g.fillColor = new Color(c.r, c.g, c.b, 235);
            g.rect(-cw / 2, -ch / 2, cw, ch);
            g.fill();
        });
        this._backdropNode = bg;
    }

    private _buildCard(parent: Node): void {
        const card = new Node('LU_Card');
        card.layer = parent.layer;
        const ut = card.addComponent(UITransform);
        ut.setContentSize(CARD_W, CARD_H);
        parent.addChild(card);
        card.setPosition(new Vec3(0, 0, 0));
        const op = card.addComponent(UIOpacity);
        op.opacity = 0;
        safeAddGraphics(card, (g) => {
            const fill = colorFromHex(Palette.bg.surface);
            g.fillColor = new Color(fill.r, fill.g, fill.b, 240);
            g.rect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H);
            g.fill();
            const stroke = colorFromHex(Palette.rank.gold);
            g.lineWidth = 1;
            g.strokeColor = new Color(stroke.r, stroke.g, stroke.b, 80);
            g.rect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H);
            g.stroke();
        });
        this._cardNode = card;
    }

    private _buildBadge(parent: Node): void {
        // Badge container, top of card.
        const container = new Node('LU_BadgeContainer');
        container.layer = parent.layer;
        const ut = container.addComponent(UITransform);
        ut.setContentSize(BADGE_SIZE, BADGE_SIZE);
        parent.addChild(container);
        container.setPosition(new Vec3(0, CARD_H / 2 - BADGE_SIZE / 2 - 32, 0));
        const op = container.addComponent(UIOpacity);
        op.opacity = 0;
        this._badgeContainer = container;

        // Glow ring behind mascot.
        const glow = new Node('LU_BadgeGlow');
        glow.layer = parent.layer;
        const glowUT = glow.addComponent(UITransform);
        glowUT.setContentSize(BADGE_SIZE * 2, BADGE_SIZE * 2);
        container.addChild(glow);
        glow.setPosition(new Vec3(0, 0, 0));
        const glowOp = glow.addComponent(UIOpacity);
        glowOp.opacity = 0;
        this._badgeGlowNode = glow;

        // Mascot host (celebrate frames).
        const mascot = new Node('LU_Mascot');
        mascot.layer = parent.layer;
        const mUT = mascot.addComponent(UITransform);
        mUT.setContentSize(BADGE_SIZE, BADGE_SIZE);
        container.addChild(mascot);
        mascot.setPosition(new Vec3(0, 0, 0));
        mascot.addComponent(UIOpacity);
        this._mascotNode = mascot;

        // Crown sprite, hidden by default; shown only on MAX LEVEL.
        const crown = new Node('LU_Crown');
        crown.layer = parent.layer;
        const cUT = crown.addComponent(UITransform);
        cUT.setContentSize(40, 40);
        container.addChild(crown);
        crown.setPosition(new Vec3(0, BADGE_SIZE / 2 + 8, 0));
        const sp = crown.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;
        crown.active = false;
        this._crownSprite = sp;
        this._crownNode = crown;
    }

    private _drawBadgeGlow(rings: number): void {
        const n = this._badgeGlowNode;
        if (!n) return;
        const c = colorFromHex(Palette.rank.gold);
        safeAddGraphics(n, (g) => {
            g.clear();
            // Concentric gold rings, bright at center, fading out. Mirrors
            // PostMatchPanelV2._drawMascotGlow but tighter and gold instead of
            // win/loss color.
            const radii =  [60, 80, 100, 120, 140, 160];
            const alphas = [120, 90, 64, 40, 22, 10];
            for (let i = 0; i < radii.length; i++) {
                g.fillColor = new Color(c.r, c.g, c.b, alphas[i]);
                g.circle(0, 0, radii[i]);
                g.fill();
            }
            // Second halo for MAX LEVEL emphasis.
            if (rings >= 2) {
                for (let i = 0; i < 4; i++) {
                    g.fillColor = new Color(c.r, c.g, c.b, 40 - i * 8);
                    g.circle(0, 0, 180 + i * 12);
                    g.fill();
                }
            }
        });
    }

    private _buildTitle(parent: Node): void {
        const node = new Node('LU_Title');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(CARD_W - 40, 56);
        parent.addChild(node);
        node.setPosition(new Vec3(0, 64, 0));
        const lbl = node.addComponent(Label);
        lbl.string = 'LEVEL UP';
        lbl.fontSize = 36;
        lbl.lineHeight = 44;
        (lbl as any).enableBold = true;
        lbl.color = colorFromHex(Palette.rank.gold);
        lbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        lbl.verticalAlign = VerticalTextAlignment.CENTER;
        node.addComponent(UIOpacity);
        this._titleLabel = lbl;
    }

    private _buildLevelRow(parent: Node): void {
        const row = new Node('LU_LevelRow');
        row.layer = parent.layer;
        const ut = row.addComponent(UITransform);
        ut.setContentSize(CARD_W - 40, 48);
        parent.addChild(row);
        row.setPosition(new Vec3(0, 8, 0));
        row.addComponent(UIOpacity);
        this._levelRowNode = row;

        this._prevLevelLabel = this._addRowLabel(row, 'LU_Prev', 'Lv ?', 24, Palette.text.mid, -64, 0, 100, 36);
        this._arrowLabel     = this._addRowLabel(row, 'LU_Arrow', '→',   24, Palette.text.mid,   0, 0,  40, 36);
        this._newLevelLabel  = this._addRowLabel(row, 'LU_New',  'Lv ?', 28, Palette.rank.gold,  64, 0, 100, 36);
        (this._newLevelLabel as any).enableBold = true;

        this._maxLevelLabel = this._addRowLabel(row, 'LU_Max', 'Lv 10', 32, Palette.rank.gold, 0, 0, 200, 40);
        (this._maxLevelLabel as any).enableBold = true;
        this._maxLevelLabel.node.active = false;
    }

    private _addRowLabel(parent: Node, name: string, text: string, fontSize: number, hex: string, x: number, y: number, w: number, h: number): Label {
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

    private _buildXPBar(parent: Node): void {
        const track = new Node('LU_XPTrack');
        track.layer = parent.layer;
        const ut = track.addComponent(UITransform);
        ut.setContentSize(XPBAR_W, XPBAR_H);
        parent.addChild(track);
        track.setPosition(new Vec3(0, -52, 0));
        const op = track.addComponent(UIOpacity);
        op.opacity = 0;
        safeAddGraphics(track, (g) => {
            const c = colorFromHex(Palette.rank.gold);
            g.fillColor = new Color(c.r, c.g, c.b, 40);
            g.rect(-XPBAR_W / 2, -XPBAR_H / 2, XPBAR_W, XPBAR_H);
            g.fill();
        });
        this._xpBarTrackNode = track;

        const fill = new Node('LU_XPFill');
        fill.layer = parent.layer;
        const fillUT = fill.addComponent(UITransform);
        fillUT.setContentSize(XPBAR_W, XPBAR_H);
        track.addChild(fill);
        fill.setPosition(new Vec3(0, 0, 0));
        this._xpBarFillNode = fill;

        const num = new Node('LU_XPNum');
        num.layer = parent.layer;
        const numUT = num.addComponent(UITransform);
        numUT.setContentSize(XPBAR_W, 18);
        parent.addChild(num);
        num.setPosition(new Vec3(0, -76, 0));
        const numLbl = num.addComponent(Label);
        numLbl.string = '';
        numLbl.fontSize = 12;
        numLbl.lineHeight = 16;
        numLbl.color = colorFromHex(Palette.text.lo);
        numLbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        numLbl.verticalAlign = VerticalTextAlignment.CENTER;
        num.addComponent(UIOpacity).opacity = 0;
        this._xpNumLabel = numLbl;
    }

    private _setXPFill(pct: number): void {
        const fill = this._xpBarFillNode;
        if (!fill) return;
        const w = Math.max(0, Math.min(1, pct)) * XPBAR_W;
        safeAddGraphics(fill, (g) => {
            g.clear();
            g.fillColor = colorFromHex(Palette.rank.gold);
            g.rect(-XPBAR_W / 2, -XPBAR_H / 2, w, XPBAR_H);
            g.fill();
        });
    }

    private _buildMicrocopy(parent: Node): void {
        const node = new Node('LU_Micro');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(CARD_W - 40, 24);
        parent.addChild(node);
        node.setPosition(new Vec3(0, -120, 0));
        const lbl = node.addComponent(Label);
        lbl.string = 'Your duel rank increased.';
        lbl.fontSize = 14;
        lbl.lineHeight = 20;
        lbl.color = colorFromHex(Palette.text.mid);
        lbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        lbl.verticalAlign = VerticalTextAlignment.CENTER;
        node.addComponent(UIOpacity).opacity = 0;
        this._microLabel = lbl;
    }

    private _buildCTA(parent: Node): void {
        // Halo behind CTA for the gentle idle pulse.
        const halo = new Node('LU_CTA_Halo');
        halo.layer = parent.layer;
        const haloUT = halo.addComponent(UITransform);
        haloUT.setContentSize(CTA_W + 16, CTA_H + 16);
        parent.addChild(halo);
        halo.setPosition(new Vec3(0, -CARD_H / 2 + CTA_H / 2 + 28, 0));
        const haloOp = halo.addComponent(UIOpacity);
        haloOp.opacity = 0;
        safeAddGraphics(halo, (g) => {
            const c = colorFromHex(Palette.rank.gold);
            g.fillColor = new Color(c.r, c.g, c.b, 50);
            g.rect(-(CTA_W + 16) / 2, -(CTA_H + 16) / 2, CTA_W + 16, CTA_H + 16);
            g.fill();
        });
        this._ctaHaloNode = halo;

        const node = new Node('LU_CTA');
        node.layer = parent.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(CTA_W, CTA_H);
        ut.setAnchorPoint(0.5, 0.5);
        parent.addChild(node);
        node.setPosition(new Vec3(0, -CARD_H / 2 + CTA_H / 2 + 28, 0));
        const op = node.addComponent(UIOpacity);
        op.opacity = 0;
        safeAddGraphics(node, (g) => {
            g.fillColor = colorFromHex(Palette.rank.gold);
            g.rect(-CTA_W / 2, -CTA_H / 2, CTA_W, CTA_H);
            g.fill();
            const stroke = colorFromHex(Palette.bg.primary);
            g.lineWidth = 1;
            g.strokeColor = new Color(stroke.r, stroke.g, stroke.b, 120);
            g.rect(-CTA_W / 2, -CTA_H / 2, CTA_W, CTA_H);
            g.stroke();
        });

        const lblNode = new Node('LU_CTA_Label');
        lblNode.layer = node.layer;
        const lblUT = lblNode.addComponent(UITransform);
        lblUT.setContentSize(CTA_W - 16, CTA_H - 8);
        node.addChild(lblNode);
        lblNode.setPosition(new Vec3(0, 0, 0));
        const lbl = lblNode.addComponent(Label);
        lbl.string = 'Continue';
        lbl.fontSize = 14;
        lbl.lineHeight = 18;
        (lbl as any).enableBold = true;
        lbl.color = colorFromHex(Palette.bg.primary);
        lbl.horizontalAlign = HorizontalTextAlignment.CENTER;
        lbl.verticalAlign = VerticalTextAlignment.CENTER;

        node.on(Node.EventType.TOUCH_START, () => { op.opacity = 200; }, this);
        node.on(Node.EventType.TOUCH_CANCEL, () => { op.opacity = 255; }, this);
        node.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
            try { ev.propagationStopped = true; } catch (_) { /* no-op */ }
            op.opacity = 255;
            try { playSound('tap'); } catch (_) { /* no-op */ }
            this._dismiss(false);
        }, this);
        this._ctaNode = node;
    }

    private _tapInside(node: Node | null, ux: number, uy: number): boolean {
        if (!node) return false;
        const ut = node.getComponent(UITransform);
        if (!ut) return false;
        const r = ut.getBoundingBoxToWorld();
        return ux >= r.x && ux <= r.x + r.width && uy >= r.y && uy <= r.y + r.height;
    }

    private _setupMascot(): void {
        const n = this._mascotNode;
        if (!n) return;
        let mc = n.getComponent(MascotController);
        if (!mc) mc = n.addComponent(MascotController);
        try {
            const frames = this._spriteSheetGetter();
            if (frames && Object.keys(frames).length > 0) {
                mc.setSpriteSheet(frames);
            }
        } catch (e: any) {
            console.log(`${TAG} _setupMascot | setSpriteSheet threw: ${e?.message ?? e}`);
        }
        try {
            mc.setState('celebrate', true);
        } catch (e: any) {
            console.log(`${TAG} _setupMascot | setState threw: ${e?.message ?? e}`);
        }
    }

    private _setupMascotIdle(): void {
        // Reduced motion: idle frame, no celebrate burst.
        const n = this._mascotNode;
        if (!n) return;
        let mc = n.getComponent(MascotController);
        if (!mc) mc = n.addComponent(MascotController);
        try {
            const frames = this._spriteSheetGetter();
            if (frames && Object.keys(frames).length > 0) mc.setSpriteSheet(frames);
        } catch (_) { /* no-op */ }
        try { mc.setState('idle', true); } catch (_) { /* no-op */ }
    }

    private _loadCrown(): void {
        if (this._crownTextureLoaded) return;
        const sp = this._crownSprite;
        if (!sp) return;
        resources.load('icons/crown/spriteFrame', SpriteFrame, (err, frame) => {
            if (err || !frame) {
                // Fall back: load via texture path. Crown PNG lives at
                // assets/demo/resources/icons/crown.png; the resources.load
                // path is 'icons/crown'. If the sprite-frame variant fails
                // (no .meta sub-asset), build one from the ImageAsset.
                resources.load('icons/crown', ImageAsset, (e2, img) => {
                    if (e2 || !img) {
                        console.log(`${TAG} _loadCrown | MISSING crown.png (${e2?.message ?? 'no asset'})`);
                        return;
                    }
                    const tex = new Texture2D();
                    tex.image = img;
                    const fr = new SpriteFrame();
                    fr.texture = tex;
                    sp.spriteFrame = fr;
                    this._crownTextureLoaded = true;
                });
                return;
            }
            sp.spriteFrame = frame;
            this._crownTextureLoaded = true;
        });
    }

    show(payload: LevelUpPayload, callbacks: LevelUpCallbacks): void {
        this._build();
        if (!this._root) return;
        this._stopAll();
        this._exitFired = false;
        this._onCallbacks = callbacks;
        this._root.active = true;
        this._root.setSiblingIndex(this._canvasRoot.children.length - 1);
        this._visible = true;
        this._showStartedAt = Date.now();

        const reduced = isReducedMotion();
        const isMax = payload.newLevel >= MAX_LEVEL;
        const isMulti = !isMax && (payload.newLevel - payload.previousLevel) >= 2;

        // Title.
        if (this._titleLabel) this._titleLabel.string = isMax ? 'MAX LEVEL' : 'LEVEL UP';

        // Level row layout: max state shows single label; otherwise 3-label row.
        if (this._prevLevelLabel) this._prevLevelLabel.string = `Lv ${payload.previousLevel}`;
        if (this._newLevelLabel) this._newLevelLabel.string = `Lv ${payload.newLevel}`;
        const showMaxRow = isMax;
        if (this._prevLevelLabel) this._prevLevelLabel.node.active = !showMaxRow;
        if (this._arrowLabel) this._arrowLabel.node.active = !showMaxRow;
        if (this._newLevelLabel) this._newLevelLabel.node.active = !showMaxRow;
        if (this._maxLevelLabel) {
            this._maxLevelLabel.string = `Lv ${payload.newLevel}`;
            this._maxLevelLabel.node.active = showMaxRow;
        }

        // Microcopy.
        if (this._microLabel) {
            this._microLabel.string = isMax
                ? 'You reached the top rank.'
                : (isMulti ? 'Massive XP gain.' : 'Your duel rank increased.');
        }

        // XP bar visibility + numbers.
        const haveXp = !isMax && typeof payload.xpBefore === 'number' && typeof payload.xpAfter === 'number';
        if (this._xpBarTrackNode) this._xpBarTrackNode.active = haveXp;
        if (this._xpNumLabel) this._xpNumLabel.node.active = haveXp;
        if (haveXp && this._xpNumLabel) {
            const after = payload.xpAfter as number;
            const lp = levelProgress(after);
            const xpAtLevel = xpForLevel(lp.level);
            const xpForNext = xpForLevel(lp.level + 1);
            const into = Math.max(0, after - xpAtLevel);
            const need = Math.max(1, xpForNext - xpAtLevel);
            this._xpNumLabel.string = `${into} / ${need} XP`;
        }

        // Glow rings (max gets second halo).
        this._drawBadgeGlow(isMax ? 2 : 1);

        // Crown for max state.
        if (this._crownNode) this._crownNode.active = isMax;
        if (isMax) this._loadCrown();

        // Reset visual state, then run the timeline.
        this._resetForCascade();
        if (reduced) this._runReducedMotion(payload, isMax, haveXp);
        else this._runFullMotion(payload, isMax, haveXp);

        try { playSound('level_up'); } catch (_) { /* no-op */ }
        try { Haptics.fire(reduced ? HapticType.SOFT : HapticType.HEAVY); } catch (_) { /* no-op */ }

        // Auto-dismiss at 2.8s.
        const id = setTimeout(() => this._dismiss(true), 2800) as unknown as number;
        this._timers.push(id);

        console.log(`${TAG} show | prev=${payload.previousLevel} new=${payload.newLevel} max=${isMax} multi=${isMulti} reduced=${reduced} xp_bar=${haveXp}`);
    }

    private _resetForCascade(): void {
        const setOp = (n: Node | null, v: number): void => {
            if (!n) return;
            const op = n.getComponent(UIOpacity);
            if (op) op.opacity = v;
        };
        setOp(this._cardNode, 0);
        setOp(this._badgeContainer, 0);
        setOp(this._badgeGlowNode, 0);
        setOp(this._titleLabel?.node ?? null, 0);
        setOp(this._levelRowNode, 0);
        setOp(this._xpBarTrackNode, 0);
        setOp(this._xpNumLabel?.node ?? null, 0);
        setOp(this._microLabel?.node ?? null, 0);
        setOp(this._ctaNode, 0);
        setOp(this._ctaHaloNode, 0);
        setOp(this._backdropNode, 0);
        if (this._cardNode) this._cardNode.setScale(new Vec3(0.92, 0.92, 1));
        if (this._badgeContainer) this._badgeContainer.setScale(new Vec3(0.75, 0.75, 1));
        if (this._newLevelLabel) this._newLevelLabel.node.setScale(new Vec3(1.2, 1.2, 1));
        if (this._ctaNode) this._ctaNode.setScale(new Vec3(0.85, 0.85, 1));
    }

    private _runFullMotion(payload: LevelUpPayload, isMax: boolean, haveXp: boolean): void {
        // 0.00 - root + backdrop + card scale-in.
        const rootOp = this._root?.getComponent(UIOpacity);
        if (rootOp) {
            rootOp.opacity = 0;
            const t = tween(rootOp).to(Motion.base, { opacity: 255 }, { easing: 'cubicOut' });
            this._activeTweens.push(t); t.start();
        }
        const bgOp = this._backdropNode?.getComponent(UIOpacity);
        if (bgOp) {
            const t = tween(bgOp).to(Motion.base, { opacity: 235 }, { easing: 'cubicOut' });
            this._activeTweens.push(t); t.start();
        }
        const cardOp = this._cardNode?.getComponent(UIOpacity);
        if (cardOp) {
            const t = tween(cardOp).to(Motion.base, { opacity: 255 }, { easing: 'cubicOut' });
            this._activeTweens.push(t); t.start();
        }
        if (this._cardNode) {
            const t = tween(this._cardNode).to(Motion.base, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicOut' });
            this._activeTweens.push(t); t.start();
        }

        // 0.10 - badge impact: scale 0.75 → 1.08 → 1.0, glow fades in, mascot celebrate.
        this._scheduleAt(100, () => {
            const op = this._badgeContainer?.getComponent(UIOpacity);
            if (op) {
                const t = tween(op).to(0.20, { opacity: 255 }, { easing: 'cubicOut' });
                this._activeTweens.push(t); t.start();
            }
            if (this._badgeContainer) {
                const tA = tween(this._badgeContainer)
                    .to(0.18, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'cubicOut' })
                    .to(0.14, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'cubicOut' });
                this._activeTweens.push(tA); tA.start();
            }
            const glowOp = this._badgeGlowNode?.getComponent(UIOpacity);
            if (glowOp) {
                const t = tween(glowOp).to(0.24, { opacity: 220 }, { easing: 'cubicOut' });
                this._activeTweens.push(t); t.start();
            }
            this._setupMascot();
        });

        // 0.25 - title fade + slide.
        this._scheduleAt(250, () => {
            const titleNode = this._titleLabel?.node;
            const op = titleNode?.getComponent(UIOpacity);
            if (titleNode && op) {
                titleNode.setPosition(new Vec3(0, 64 - 8, 0));
                const tP = tween(titleNode).to(0.20, { position: new Vec3(0, 64, 0) }, { easing: 'cubicOut' });
                const tO = tween(op).to(0.20, { opacity: 255 }, { easing: 'cubicOut' });
                this._activeTweens.push(tP, tO); tP.start(); tO.start();
            }
        });

        // 0.40 - level row reveal + new-level pop.
        this._scheduleAt(400, () => {
            const op = this._levelRowNode?.getComponent(UIOpacity);
            if (op) {
                const t = tween(op).to(0.20, { opacity: 255 }, { easing: 'cubicOut' });
                this._activeTweens.push(t); t.start();
            }
            const newLbl = this._newLevelLabel?.node;
            if (newLbl && !isMax) {
                const t = tween(newLbl).to(0.24, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicOut' });
                this._activeTweens.push(t); t.start();
            }
        });

        // 0.60 - XP bar fill (only when we have real numbers).
        if (haveXp) {
            this._scheduleAt(600, () => {
                const op = this._xpBarTrackNode?.getComponent(UIOpacity);
                if (op) {
                    const t = tween(op).to(0.18, { opacity: 255 }, { easing: 'cubicOut' });
                    this._activeTweens.push(t); t.start();
                }
                const numOp = this._xpNumLabel?.node.getComponent(UIOpacity);
                if (numOp) {
                    const t = tween(numOp).to(0.18, { opacity: 200 }, { easing: 'cubicOut' });
                    this._activeTweens.push(t); t.start();
                }
                this._animateXpBar(payload);
            });
        }

        // 0.85 - microcopy.
        this._scheduleAt(850, () => {
            const microNode = this._microLabel?.node;
            const op = microNode?.getComponent(UIOpacity);
            if (microNode && op) {
                microNode.setPosition(new Vec3(0, -120 + 6, 0));
                const tP = tween(microNode).to(0.20, { position: new Vec3(0, -120, 0) }, { easing: 'cubicOut' });
                const tO = tween(op).to(0.20, { opacity: 200 }, { easing: 'cubicOut' });
                this._activeTweens.push(tP, tO); tP.start(); tO.start();
            }
        });

        // 1.10 - Continue button + halo idle pulse.
        this._scheduleAt(1100, () => {
            const op = this._ctaNode?.getComponent(UIOpacity);
            if (op) {
                const t = tween(op).to(0.20, { opacity: 255 }, { easing: 'backOut' });
                this._activeTweens.push(t); t.start();
            }
            if (this._ctaNode) {
                const t = tween(this._ctaNode).to(0.20, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' });
                this._activeTweens.push(t); t.start();
            }
            const haloOp = this._ctaHaloNode?.getComponent(UIOpacity);
            if (haloOp) {
                const tIn = tween(haloOp).to(0.20, { opacity: 90 }, { easing: 'cubicOut' });
                this._activeTweens.push(tIn); tIn.start();
                const tPulse = tween(haloOp).repeatForever(
                    tween(haloOp)
                        .to(1.6, { opacity: 60 }, { easing: 'sineInOut' })
                        .to(1.6, { opacity: 130 }, { easing: 'sineInOut' }),
                );
                this._activeTweens.push(tPulse); tPulse.start();
            }
        });
    }

    private _runReducedMotion(payload: LevelUpPayload, isMax: boolean, haveXp: boolean): void {
        const setOp = (n: Node | null, v: number): void => {
            if (!n) return;
            const op = n.getComponent(UIOpacity);
            if (op) op.opacity = v;
        };
        // Snap scales to final.
        if (this._cardNode) this._cardNode.setScale(new Vec3(1, 1, 1));
        if (this._badgeContainer) this._badgeContainer.setScale(new Vec3(1, 1, 1));
        if (this._newLevelLabel) this._newLevelLabel.node.setScale(new Vec3(1, 1, 1));
        if (this._ctaNode) this._ctaNode.setScale(new Vec3(1, 1, 1));
        // Plain fade-in for all elements together.
        const rootOp = this._root?.getComponent(UIOpacity);
        if (rootOp) {
            const t = tween(rootOp).to(Motion.base, { opacity: 255 }, { easing: 'cubicOut' });
            this._activeTweens.push(t); t.start();
        }
        setOp(this._backdropNode, 235);
        setOp(this._cardNode, 255);
        setOp(this._badgeContainer, 255);
        setOp(this._badgeGlowNode, 180);
        setOp(this._titleLabel?.node ?? null, 255);
        setOp(this._levelRowNode, 255);
        setOp(this._xpBarTrackNode, haveXp ? 255 : 0);
        setOp(this._xpNumLabel?.node ?? null, haveXp ? 200 : 0);
        setOp(this._microLabel?.node ?? null, 200);
        setOp(this._ctaNode, 255);
        setOp(this._ctaHaloNode, 0);
        // Idle mascot, no sparkle burst.
        this._setupMascotIdle();
        // XP bar at final progress, no flash.
        if (haveXp) {
            const after = payload.xpAfter as number;
            const lp = levelProgress(after);
            this._setXPFill(lp.progress);
        }
    }

    private _animateXpBar(payload: LevelUpPayload): void {
        // Two-phase fill: starting progress → 100% → flash → reset → final progress.
        // Driven manually via setTimeout so the safeAddGraphics redraw budgets cleanly.
        const before = payload.xpBefore ?? 0;
        const after = payload.xpAfter ?? before;
        const startProgress = levelProgress(before).progress;
        const endProgress = levelProgress(after).progress;
        // Phase 1: start → 1.0 over 280ms.
        const PHASE1_MS = 280;
        const PHASE1_FLASH_MS = 80;
        const PHASE2_MS = 240;
        const t0 = Date.now();
        const phase1 = (): void => {
            if (!this._visible || this._exitFired) return;
            const dt = Date.now() - t0;
            const k = Math.min(1, dt / PHASE1_MS);
            // sineInOut ease.
            const eased = -(Math.cos(Math.PI * k) - 1) / 2;
            const v = startProgress + (1 - startProgress) * eased;
            this._setXPFill(v);
            if (k < 1) {
                const id = setTimeout(phase1, 33) as unknown as number;
                this._timers.push(id);
            } else {
                // Flash + reset to 0.
                const id = setTimeout(() => {
                    if (!this._visible || this._exitFired) return;
                    this._setXPFill(0);
                    const t1 = Date.now();
                    const phase2 = (): void => {
                        if (!this._visible || this._exitFired) return;
                        const dt2 = Date.now() - t1;
                        const k2 = Math.min(1, dt2 / PHASE2_MS);
                        const eased2 = -(Math.cos(Math.PI * k2) - 1) / 2;
                        const v2 = endProgress * eased2;
                        this._setXPFill(v2);
                        if (k2 < 1) {
                            const id3 = setTimeout(phase2, 33) as unknown as number;
                            this._timers.push(id3);
                        }
                    };
                    phase2();
                }, PHASE1_FLASH_MS) as unknown as number;
                this._timers.push(id);
            }
        };
        phase1();
    }

    private _scheduleAt(ms: number, fn: () => void): void {
        const id = setTimeout(() => {
            if (!this._visible || this._exitFired) return;
            try { fn(); } catch (e: any) {
                console.log(`${TAG} _scheduleAt | beat threw at ${ms}ms: ${e?.message ?? e}`);
            }
        }, ms) as unknown as number;
        this._timers.push(id);
    }

    private _dismiss(auto: boolean): void {
        if (!this._visible || this._exitFired) return;
        this._exitFired = true;
        const rootOp = this._root?.getComponent(UIOpacity);
        const cardScaleEnd = new Vec3(0.96, 0.96, 1);
        if (this._cardNode) {
            const t = tween(this._cardNode).to(0.22, { scale: cardScaleEnd }, { easing: 'cubicIn' });
            this._activeTweens.push(t); t.start();
        }
        if (rootOp) {
            const t = tween(rootOp)
                .to(0.22, { opacity: 0 }, { easing: 'cubicIn' })
                .call(() => this._finalizeHide());
            this._activeTweens.push(t); t.start();
        } else {
            this._finalizeHide();
        }
        console.log(`${TAG} _dismiss | auto=${auto}`);
    }

    private _finalizeHide(): void {
        this._stopAll();
        if (this._root) this._root.active = false;
        this._visible = false;
        const cb = this._onCallbacks?.onClose;
        this._onCallbacks = null;
        if (cb) {
            try { cb(); } catch (e: any) {
                console.log(`${TAG} _finalizeHide | onClose threw: ${e?.message ?? e}`);
            }
        }
    }

    private _stopAll(): void {
        for (const t of this._activeTweens) {
            try { (t as Tween<any>).stop(); } catch (_) { /* no-op */ }
        }
        this._activeTweens.length = 0;
        for (const id of this._timers) clearTimeout(id);
        this._timers.length = 0;
        // Stop any pulse tween still running on the halo.
        if (this._ctaHaloNode) {
            try { Tween.stopAllByTarget(this._ctaHaloNode.getComponent(UIOpacity)); } catch (_) { /* no-op */ }
        }
    }

    hide(immediate = false): void {
        if (!this._visible) return;
        if (immediate) {
            this._stopAll();
            this._exitFired = true;
            if (this._root) this._root.active = false;
            this._visible = false;
            this._onCallbacks = null;
            return;
        }
        this._dismiss(false);
    }

    destroy(): void {
        this.hide(true);
        if (this._root) {
            try { this._root.destroy(); } catch (_) { /* no-op */ }
            this._root = null;
        }
    }
}
