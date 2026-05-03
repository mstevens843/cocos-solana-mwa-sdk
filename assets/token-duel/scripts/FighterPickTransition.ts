/**
 * FighterPickTransition.ts - Tekken-style cinematic for squad token selection.
 *
 * Replaces the legacy 180ms ghost-fly (`AppUI._flyPickGhost`) on direct single
 * picks with a 5-phase morph: TAP -> LIFT -> HERO CARD -> HOLD -> SLOT ARC.
 * Total duration ~1100ms (compressed from the spec's 1700ms so 3 picks land
 * in under 3.5s without locking out the UI).
 *
 * Pattern source: EnterMatchTransition.ts (overlay parented to canvasNode,
 * world->local conversion, safeAddGraphics for SIGSEGV safety, promise resolves
 * at landing).
 *
 * Bulk pick-mode ( _squadPickChecked.size > 0 ) bypasses this module - the
 * caller falls back to _flyPickGhost so batched picks don't queue cinematics.
 */

import {
    Color,
    Graphics,
    Label,
    Node,
    Sprite,
    SpriteFrame,
    UIOpacity,
    UITransform,
    Vec3,
    tween,
    Tween,
} from 'cc';

import { enqueuePostDraw, safeAddGraphics } from './safeGraphics';
import { addFloat, stopFloat, addGlowPulse, installSoftGlow } from './LandingFX';
import { popScale, shake } from './PanelTransitions';
import { playSound } from './Sound';
import { Haptics, HapticType } from './Haptics';
import { themeColor } from './Theme';

const TAG = '[FighterPick]';

const HERO_WIDTH  = 504;
const HERO_HEIGHT = 200;

export interface FighterTokenData {
    symbol: string;
    changePct: number;
    liquidityUsd: number;
    volumeUsd: number;
    priceUsd: number;
    logoSpriteFrame: SpriteFrame | null;
}

interface RowSnapshot {
    node: Node;
    pos: Vec3;
    siblingIndex: number;
    scale: Vec3;
}

interface ActiveHandle {
    overlay: Node;
    cardNode: Node;
    glowNode: Node;
    rowSnapshot: RowSnapshot | null;
    rowOpacity: UIOpacity | null;
    rowOpacityBefore: number;
    timers: Array<ReturnType<typeof setTimeout>>;
    cancel(): void;
}

const _activeHandles = new Set<ActiveHandle>();

export function cancelAllFighterPicks(): void {
    for (const h of Array.from(_activeHandles)) {
        try { h.cancel(); } catch (_) { /* ignore */ }
    }
    _activeHandles.clear();
}

export interface FighterPickInOptions {
    canvasNode: Node;
    panelNode: Node;
    sourceRowNode: Node | null;
    targetSlotNode: Node | null;
    tokenData: FighterTokenData;
    onLanded?: () => void;
}

export interface FighterPickOutOptions {
    canvasNode: Node;
    panelNode: Node;
    sourceSlotNode: Node | null;
    targetRowNode: Node | null;
    tokenData: FighterTokenData;
    onLanded?: () => void;
}

export function runFighterPickIn(opts: FighterPickInOptions): Promise<void> {
    return new Promise<void>((resolve) => {
        const { canvasNode, panelNode, sourceRowNode, targetSlotNode, tokenData, onLanded } = opts;
        const canvasUT = canvasNode.getComponent(UITransform);
        if (!canvasUT) { onLanded?.(); resolve(); return; }

        const rowSnapshot = _captureRowSnapshot(sourceRowNode);
        const rowLocal = sourceRowNode && sourceRowNode.isValid
            ? canvasUT.convertToNodeSpaceAR(sourceRowNode.worldPosition.clone())
            : new Vec3(0, 0, 0);
        const slotLocal = targetSlotNode && targetSlotNode.isValid
            ? canvasUT.convertToNodeSpaceAR(targetSlotNode.worldPosition.clone())
            : new Vec3(0, -200, 0);
        const slotUT = targetSlotNode?.getComponent(UITransform) ?? null;
        const slotWidth = slotUT?.contentSize.width ?? 200;

        const overlay = new Node('FighterPickOverlay');
        canvasNode.addChild(overlay);
        const overlayUT = overlay.addComponent(UITransform);
        overlayUT.setContentSize(canvasUT.contentSize);
        overlay.setPosition(0, 0, 0);

        const { card, glow } = _buildHeroCard(overlay, tokenData);
        const initialScale = Math.max(0.18, (slotWidth / HERO_WIDTH) * 1.2);
        card.setPosition(rowLocal);
        card.setScale(initialScale, initialScale, 1);
        glow.setPosition(rowLocal);
        glow.setScale(initialScale * 0.9, initialScale * 0.9, 1);

        const cardOp = card.getComponent(UIOpacity)!;
        cardOp.opacity = 0;

        const handle: ActiveHandle = {
            overlay,
            cardNode: card,
            glowNode: glow,
            rowSnapshot,
            rowOpacity: null,
            rowOpacityBefore: 255,
            timers: [],
            cancel() { _cancelHandle(handle); },
        };
        _activeHandles.add(handle);

        // Phase 1 - TAP (0-60 ms): row scale dip-recover.
        if (rowSnapshot) {
            Tween.stopAllByTarget(rowSnapshot.node);
            tween(rowSnapshot.node)
                .to(0.03, { scale: new Vec3(0.97, 0.97, 1) }, { easing: 'cubicOut' })
                .to(0.03, { scale: rowSnapshot.scale }, { easing: 'cubicOut' })
                .start();
        }

        // Phase 2 - LIFT (60-260 ms): row floats up + fades, raised z-index.
        if (rowSnapshot) {
            const rowNode = rowSnapshot.node;
            try {
                const parent = rowNode.parent;
                if (parent) rowNode.setSiblingIndex(parent.children.length - 1);
            } catch (_) { /* ignore */ }
            const liftPos = new Vec3(rowSnapshot.pos.x, rowSnapshot.pos.y + 40, rowSnapshot.pos.z);
            const t1 = setTimeout(() => {
                if (!rowNode.isValid) return;
                tween(rowNode)
                    .to(0.20, { scale: new Vec3(1.08, 1.08, 1), position: liftPos }, { easing: 'backOut' })
                    .start();
                const op = rowNode.getComponent(UIOpacity) ?? rowNode.addComponent(UIOpacity);
                handle.rowOpacity = op;
                handle.rowOpacityBefore = op.opacity;
                Tween.stopAllByTarget(op);
                tween(op).delay(0.05).to(0.15, { opacity: 0 }, { easing: 'cubicIn' }).start();
            }, 60);
            handle.timers.push(t1);
            try { playSound('tap'); } catch (_) { /* asset may be missing */ }
        }

        // Phase 3 - HERO build + travel (260-610 ms): card flies to center, scales up.
        const t2 = setTimeout(() => {
            if (!card.isValid) return;
            tween(cardOp).to(0.20, { opacity: 255 }, { easing: 'cubicOut' }).start();
            tween(card)
                .to(0.30, { position: new Vec3(0, 0, 0), scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                .start();
            tween(glow)
                .to(0.30, { position: new Vec3(0, 0, 0), scale: new Vec3(1.1, 1.1, 1) }, { easing: 'cubicOut' })
                .start();
            installSoftGlow(glow, { color: themeColor.teal(), peakAlpha: 180, rings: 14 });
        }, 260);
        handle.timers.push(t2);

        // Phase 4 - HOLD (610-760 ms): subtle float + glow pulse.
        const t3 = setTimeout(() => {
            if (!card.isValid) return;
            try { addFloat(card, 4, 0.8); } catch (_) { /* ignore */ }
            try { addGlowPulse(glow, 180, 1.4); } catch (_) { /* ignore */ }
        }, 610);
        handle.timers.push(t3);

        // Phase 5 - SLOT arc (760-1110 ms): card arcs into slot, lands.
        const t4 = setTimeout(() => {
            if (!card.isValid) return;
            try { stopFloat(card); } catch (_) { /* ignore */ }
            Tween.stopAllByTarget(card);
            Tween.stopAllByTarget(glow);
            const finalScale = Math.max(0.2, slotWidth / HERO_WIDTH);
            const cardPos = card.position.clone();
            _arcTween(card, cardPos, slotLocal, 60, 0.35, 'cubicIn').start();
            tween(card).to(0.35, { scale: new Vec3(finalScale, finalScale, 1) }, { easing: 'cubicIn' }).start();
            _arcTween(glow, cardPos, slotLocal, 60, 0.35, 'cubicIn').start();
            const glowOp = glow.getComponent(UIOpacity);
            if (glowOp) tween(glowOp).to(0.35, { opacity: 0 }, { easing: 'cubicOut' }).start();
        }, 760);
        handle.timers.push(t4);

        // Phase 5 IMPACT (~1110 ms): slot pop + shake + particles + sound + haptic.
        const t5 = setTimeout(() => {
            if (targetSlotNode && targetSlotNode.isValid) {
                try { popScale(targetSlotNode, 1.10); } catch (_) { /* ignore */ }
            }
            if (panelNode && panelNode.isValid) {
                try { shake(panelNode, 2); } catch (_) { /* ignore */ }
            }
            _burstParticles(overlay, slotLocal, 10);
            try { playSound('stack'); } catch (_) { /* asset may be missing */ }
            try { Haptics.fire(HapticType.SOFT); } catch (_) { /* editor no-op */ }

            // Tear down + restore.
            const t6 = setTimeout(() => {
                _cleanupOverlay(handle);
                _restoreRow(handle);
                _activeHandles.delete(handle);
                try { onLanded?.(); } catch (e) { console.warn(`${TAG} onLanded threw:`, e); }
                console.log(`${TAG} runFighterPickIn | RESOLVE symbol=${tokenData.symbol}`);
                resolve();
            }, 60);
            handle.timers.push(t6);
        }, 1110);
        handle.timers.push(t5);
    });
}

export function runFighterPickOut(opts: FighterPickOutOptions): Promise<void> {
    return new Promise<void>((resolve) => {
        const { canvasNode, sourceSlotNode, targetRowNode, tokenData, onLanded } = opts;
        const canvasUT = canvasNode.getComponent(UITransform);
        if (!canvasUT || !sourceSlotNode || !sourceSlotNode.isValid) {
            try { onLanded?.(); } catch (_) { /* ignore */ }
            resolve();
            return;
        }

        const slotLocal = canvasUT.convertToNodeSpaceAR(sourceSlotNode.worldPosition.clone());
        const slotUT = sourceSlotNode.getComponent(UITransform);
        const slotWidth = slotUT?.contentSize.width ?? 200;
        const startScale = Math.max(0.2, slotWidth / HERO_WIDTH);
        const targetRowLocal = targetRowNode && targetRowNode.isValid
            ? canvasUT.convertToNodeSpaceAR(targetRowNode.worldPosition.clone())
            : null;

        const overlay = new Node('FighterPickOutOverlay');
        canvasNode.addChild(overlay);
        const overlayUT = overlay.addComponent(UITransform);
        overlayUT.setContentSize(canvasUT.contentSize);
        overlay.setPosition(0, 0, 0);

        const { card, glow } = _buildHeroCard(overlay, tokenData);
        card.setPosition(slotLocal);
        card.setScale(startScale, startScale, 1);
        glow.setPosition(slotLocal);
        glow.setScale(startScale * 0.9, startScale * 0.9, 1);
        const cardOp = card.getComponent(UIOpacity)!;
        cardOp.opacity = 0;

        const handle: ActiveHandle = {
            overlay,
            cardNode: card,
            glowNode: glow,
            rowSnapshot: null,
            rowOpacity: null,
            rowOpacityBefore: 255,
            timers: [],
            cancel() { _cancelHandle(handle); },
        };
        _activeHandles.add(handle);

        try { playSound('tap'); } catch (_) { /* asset may be missing */ }

        // Off-screen fallback: fade at slot, no fly.
        if (!targetRowLocal) {
            tween(cardOp)
                .to(0.10, { opacity: 200 }, { easing: 'cubicOut' })
                .to(0.20, { opacity: 0 }, { easing: 'cubicIn' })
                .start();
            tween(card).to(0.30, { scale: new Vec3(startScale * 1.15, startScale * 1.15, 1) }, { easing: 'cubicOut' }).start();
            const t = setTimeout(() => {
                _cleanupOverlay(handle);
                _activeHandles.delete(handle);
                try { onLanded?.(); } catch (e) { console.warn(`${TAG} onLanded threw:`, e); }
                resolve();
            }, 320);
            handle.timers.push(t);
            return;
        }

        // Detach: fade in card + grow to hero size at slot.
        tween(cardOp).to(0.18, { opacity: 255 }, { easing: 'cubicOut' }).start();
        tween(card)
            .to(0.20, { position: new Vec3(0, 0, 0), scale: new Vec3(0.85, 0.85, 1) }, { easing: 'cubicOut' })
            .start();
        tween(glow)
            .to(0.20, { position: new Vec3(0, 0, 0), scale: new Vec3(0.95, 0.95, 1) }, { easing: 'cubicOut' })
            .start();
        installSoftGlow(glow, { color: themeColor.teal(), peakAlpha: 140, rings: 12 });

        // Arc back to row, scale down, fade out.
        const t1 = setTimeout(() => {
            if (!card.isValid) return;
            Tween.stopAllByTarget(card);
            Tween.stopAllByTarget(glow);
            const cardPos = card.position.clone();
            const targetScale = Math.max(0.18, 140 / HERO_WIDTH);
            _arcTween(card, cardPos, targetRowLocal, 60, 0.30, 'cubicIn').start();
            tween(card).to(0.30, { scale: new Vec3(targetScale, targetScale, 1) }, { easing: 'cubicIn' }).start();
            _arcTween(glow, cardPos, targetRowLocal, 60, 0.30, 'cubicIn').start();
            const glowOp = glow.getComponent(UIOpacity);
            if (glowOp) tween(glowOp).to(0.30, { opacity: 0 }, { easing: 'cubicOut' }).start();
            tween(cardOp).delay(0.18).to(0.12, { opacity: 0 }, { easing: 'cubicIn' }).start();
        }, 220);
        handle.timers.push(t1);

        const t2 = setTimeout(() => {
            _cleanupOverlay(handle);
            _activeHandles.delete(handle);
            try { onLanded?.(); } catch (e) { console.warn(`${TAG} onLanded threw:`, e); }
            console.log(`${TAG} runFighterPickOut | RESOLVE symbol=${tokenData.symbol}`);
            resolve();
        }, 560);
        handle.timers.push(t2);
    });
}

function _captureRowSnapshot(row: Node | null): RowSnapshot | null {
    if (!row || !row.isValid) return null;
    return {
        node: row,
        pos: row.position.clone(),
        siblingIndex: row.getSiblingIndex(),
        scale: row.scale.clone(),
    };
}

function _restoreRow(handle: ActiveHandle): void {
    const snap = handle.rowSnapshot;
    if (!snap || !snap.node.isValid) return;
    Tween.stopAllByTarget(snap.node);
    snap.node.setPosition(snap.pos);
    snap.node.setScale(snap.scale);
    try { snap.node.setSiblingIndex(snap.siblingIndex); } catch (_) { /* ignore */ }
    if (handle.rowOpacity && handle.rowOpacity.node.isValid) {
        Tween.stopAllByTarget(handle.rowOpacity);
        handle.rowOpacity.opacity = handle.rowOpacityBefore;
    }
}

function _cleanupOverlay(handle: ActiveHandle): void {
    for (const t of handle.timers) { try { clearTimeout(t); } catch (_) { /* ignore */ } }
    handle.timers.length = 0;
    if (handle.cardNode && handle.cardNode.isValid) Tween.stopAllByTarget(handle.cardNode);
    if (handle.glowNode && handle.glowNode.isValid) Tween.stopAllByTarget(handle.glowNode);
    if (handle.overlay && handle.overlay.isValid) {
        try { handle.overlay.destroy(); } catch (_) { /* ignore */ }
    }
}

function _cancelHandle(handle: ActiveHandle): void {
    _cleanupOverlay(handle);
    _restoreRow(handle);
}

interface BuiltCard { card: Node; glow: Node }

function _buildHeroCard(parent: Node, token: FighterTokenData): BuiltCard {
    // Glow first (drawn behind card via sibling order).
    const glow = new Node('FighterGlow');
    parent.addChild(glow);
    const glowUT = glow.addComponent(UITransform);
    glowUT.setContentSize(HERO_WIDTH + 80, HERO_HEIGHT + 80);
    glow.addComponent(UIOpacity).opacity = 0;

    const card = new Node('FighterCard');
    parent.addChild(card);
    const cardUT = card.addComponent(UITransform);
    cardUT.setContentSize(HERO_WIDTH, HERO_HEIGHT);
    card.addComponent(UIOpacity);

    // Background - black glass with teal border. Routed through safeAddGraphics
    // (Cocos 3.8 Android SIGSEGV at 0x28 if Graphics attaches mid-tick).
    const bg = new Node('Background');
    card.addChild(bg);
    const bgUT = bg.addComponent(UITransform);
    bgUT.setContentSize(HERO_WIDTH, HERO_HEIGHT);
    bg.setPosition(0, 0, 0);
    safeAddGraphics(bg, (g: Graphics) => {
        const halfW = HERO_WIDTH / 2;
        const halfH = HERO_HEIGHT / 2;
        g.fillColor = new Color(10, 4, 16, 220);
        g.roundRect(-halfW, -halfH, HERO_WIDTH, HERO_HEIGHT, 16);
        g.fill();
        const teal = themeColor.teal();
        g.strokeColor = new Color(teal.r, teal.g, teal.b, 240);
        g.lineWidth = 2;
        g.roundRect(-halfW, -halfH, HERO_WIDTH, HERO_HEIGHT, 16);
        g.stroke();
    }, { tag: 'fighterCardBg' });

    // Logo (left, 128x128).
    const logoNode = new Node('Logo');
    card.addChild(logoNode);
    const logoUT = logoNode.addComponent(UITransform);
    logoUT.setContentSize(128, 128);
    logoNode.setPosition(-168, 0, 0);
    if (token.logoSpriteFrame) {
        const spr = logoNode.addComponent(Sprite);
        spr.spriteFrame = token.logoSpriteFrame;
        spr.color = new Color(255, 255, 255, 255);
    } else {
        // Violet placeholder square.
        safeAddGraphics(logoNode, (g: Graphics) => {
            g.fillColor = new Color(153, 69, 255, 180);
            g.rect(-64, -64, 128, 128);
            g.fill();
        }, { tag: 'fighterCardLogoFallback' });
    }

    // Symbol ($BONK).
    _addLabel(card, 'Symbol', `$${token.symbol || '?'}`, 28, themeColor.textHi(), 60, 60, 320, 36, true);

    // Change (+12.4%) - color reflects sign.
    const changeColor = token.changePct > 0
        ? themeColor.win()
        : token.changePct < 0 ? themeColor.loss() : themeColor.neutral();
    _addLabel(card, 'Change', _formatPct(token.changePct), 32, changeColor, 60, 18, 320, 40, true);

    // Liquidity / Volume row (left and right of the right column).
    _addLabel(card, 'Liquidity', `LIQ ${_formatUsdShort(token.liquidityUsd)}`, 16, themeColor.textMid(), -10, -22, 180, 24, false);
    _addLabel(card, 'Volume',    `VOL ${_formatUsdShort(token.volumeUsd)}`,    16, themeColor.textMid(), 170, -22, 180, 24, false);

    // Price.
    _addLabel(card, 'Price', _formatPrice(token.priceUsd), 18, themeColor.amber(), 60, -62, 320, 26, true);

    return { card, glow };
}

function _addLabel(
    parent: Node,
    name: string,
    text: string,
    fontSize: number,
    color: Color,
    x: number,
    y: number,
    w: number,
    h: number,
    bold: boolean,
): Label {
    const node = new Node(name);
    parent.addChild(node);
    const ut = node.addComponent(UITransform);
    ut.setContentSize(w, h);
    node.setPosition(x, y, 0);
    const lbl = node.addComponent(Label);
    lbl.string = text;
    lbl.fontSize = fontSize;
    lbl.lineHeight = fontSize + 4;
    lbl.color = color;
    lbl.isBold = bold;
    lbl.horizontalAlign = Label.HorizontalAlign.LEFT;
    lbl.verticalAlign = Label.VerticalAlign.CENTER;
    return lbl;
}

function _arcTween(node: Node, from: Vec3, to: Vec3, peakOffsetY: number, dur: number, exitEasing: any): Tween<Node> {
    const midX = (from.x + to.x) / 2;
    const midY = Math.max(from.y, to.y) + peakOffsetY;
    const peak = new Vec3(midX, midY, 0);
    return tween(node)
        .to(dur / 2, { position: peak }, { easing: 'cubicOut' })
        .to(dur / 2, { position: to.clone() }, { easing: exitEasing });
}

function _burstParticles(parent: Node, atLocalPos: Vec3, count: number): void {
    const tints: Array<[number, number, number]> = [
        [20, 241, 149],   // teal
        [153, 69, 255],   // violet
        [255, 255, 255],  // white
    ];
    for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        const dist = 80 + Math.random() * 80;
        const dx = atLocalPos.x + Math.cos(theta) * dist;
        const dy = atLocalPos.y + Math.sin(theta) * dist;
        const tint = tints[i % tints.length];
        const radius = 3 + Math.random() * 3;
        const idx = i;
        enqueuePostDraw(() => {
            if (!parent || !parent.isValid) return;
            const p = new Node(`FighterParticle_${idx}`);
            parent.addChild(p);
            const ut = p.addComponent(UITransform);
            ut.setContentSize(16, 16);
            const g = p.addComponent(Graphics);
            g.fillColor = new Color(tint[0], tint[1], tint[2], 255);
            g.circle(0, 0, radius);
            g.fill();
            const op = p.addComponent(UIOpacity);
            op.opacity = 230;
            p.setPosition(atLocalPos.x, atLocalPos.y, 0);
            tween(p)
                .to(0.30, { position: new Vec3(dx, dy, 0) }, { easing: 'quartOut' })
                .start();
            tween(op)
                .to(0.30, { opacity: 0 }, { easing: 'cubicOut' })
                .call(() => { try { p.destroy(); } catch (_) { /* already gone */ } })
                .start();
        });
    }
}

function _formatPct(n: number): string {
    if (!Number.isFinite(n)) return '-';
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(1)}%`;
}

function _formatUsdShort(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '-';
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
}

function _formatPrice(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '-';
    if (n >= 1) return `$${n.toFixed(2)}`;
    if (n >= 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toPrecision(3)}`;
}
