/**
 * EnterMatchTransition.ts — cinematic morph from "Configure Your Duel"
 * setup screen into the race arena.
 *
 * Phases (timings relative to the start of runEnterMatchCinematic):
 *   t=0..350ms     setup-panel children fade + slide down 28px
 *   t=50..600ms    button-origin orb travels to canvas center, glow halo follows
 *   t=600..1200ms  orb pulses (scale 1.0 ↔ 1.05) and color-cycles
 *                  blue → teal → green; halo expands and fades
 *   resolve at 1200ms → caller fires _showCountdown
 *
 * Then on countdown completion, runEnterMatchImpact fires:
 *   particle burst (24 dots radial), orb dissolve (scale 1.0 → 1.6, opacity → 0),
 *   canvas-root scale punch (1.00 → 1.05 → 1.00 over 320ms),
 *   overlay destroyed at 400ms → caller fires _playRaceStartCinematic.
 *
 * All Graphics components are added through safeGraphics' post-DRAW queue so
 * the engine never SIGSEGVs at 0x28 in js_cc_UIModelProxy_activeSubModels
 * (Cocos 3.8 native render-pipeline bug — see safeGraphics.ts header).
 */

import { Color, Graphics, Node, UIOpacity, UITransform, Vec3, tween, Tween } from 'cc';
import { enqueuePostDraw, safeAddGraphics } from './safeGraphics';

const TAG = '[EnterMatch]';

interface PanelChildSnapshot {
    node: Node;
    op: UIOpacity;
    opacityBefore: number;
    positionBefore: Vec3;
}

interface SourceButtonSnapshot {
    button: Node;
    op: UIOpacity;
    opacityBefore: number;
}

export interface EnterMatchHandle {
    overlay: Node;
    orbNode: Node;
    glowNode: Node;
    canvasRoot: Node;
    // Snapshots captured before runEnterMatchCinematic mutated UIOpacity /
    // position of panelToCollapse's children + the source button. Restored
    // by runEnterMatchImpact / destroyEnterMatchOverlay so a second visit to
    // the picker does not find every child stuck at opacity 0 and y -= 28.
    panelSnapshots: PanelChildSnapshot[];
    sourceButtonSnapshot: SourceButtonSnapshot | null;
}

function restoreCollapsedPanel(handle: EnterMatchHandle | null): void {
    if (!handle) return;
    for (const s of handle.panelSnapshots) {
        if (!s.node.isValid) continue;
        Tween.stopAllByTarget(s.op);
        Tween.stopAllByTarget(s.node);
        s.op.opacity = s.opacityBefore;
        s.node.setPosition(s.positionBefore);
    }
    handle.panelSnapshots.length = 0;
    const sb = handle.sourceButtonSnapshot;
    if (sb && sb.button.isValid) {
        Tween.stopAllByTarget(sb.op);
        sb.op.opacity = sb.opacityBefore;
    }
    handle.sourceButtonSnapshot = null;
}

export interface EnterMatchOptions {
    /** Button the user just tapped. Used as the origin of the morph. */
    sourceButton: Node | null;
    /** Setup panel whose children fade + slide down. */
    panelToCollapse: Node | null;
    /** Canvas node (AppUI.this.node). The overlay parents to this. */
    canvasNode: Node;
}

/**
 * Phases 2 + 3. Resolves with a handle to the overlay so the caller can
 * pass it into runEnterMatchImpact when the countdown completes.
 *
 * Idempotent guard: caller is responsible for not stacking calls; this module
 * doesn't track state across invocations.
 */
export function runEnterMatchCinematic(opts: EnterMatchOptions): Promise<EnterMatchHandle> {
    return new Promise<EnterMatchHandle>((resolve) => {
        const { sourceButton, panelToCollapse, canvasNode } = opts;

        const overlay = new Node('EnterMatchOverlay');
        canvasNode.addChild(overlay);
        const overlayUT = overlay.addComponent(UITransform);
        const canvasUT = canvasNode.getComponent(UITransform);
        if (canvasUT) overlayUT.setContentSize(canvasUT.contentSize);
        overlay.setPosition(0, 0, 0);

        let originX = 0;
        let originY = 0;
        if (sourceButton && sourceButton.isValid && canvasUT) {
            const w = sourceButton.worldPosition.clone();
            const local = canvasUT.convertToNodeSpaceAR(w);
            originX = local.x;
            originY = local.y;
        }

        const panelSnapshots: PanelChildSnapshot[] = [];
        if (panelToCollapse && panelToCollapse.isValid) {
            const children = panelToCollapse.children.slice();
            for (const child of children) {
                if (!child || !child.isValid) continue;
                if (sourceButton && child === sourceButton) continue;
                if (!child.active) continue;
                const op = child.getComponent(UIOpacity) ?? child.addComponent(UIOpacity);
                const start = child.position.clone();
                panelSnapshots.push({
                    node: child,
                    op,
                    opacityBefore: op.opacity,
                    positionBefore: start,
                });
                Tween.stopAllByTarget(op);
                tween(op)
                    .to(0.35, { opacity: 0 }, { easing: 'cubicIn' })
                    .start();
                Tween.stopAllByTarget(child);
                tween(child)
                    .to(0.35, { position: new Vec3(start.x, start.y - 28, start.z) }, { easing: 'cubicIn' })
                    .start();
            }
        }

        const orb = new Node('EnterMatchOrb');
        overlay.addChild(orb);
        const orbUT = orb.addComponent(UITransform);
        orbUT.setContentSize(180, 180);
        orb.setPosition(originX, originY, 0);
        const orbOp = orb.addComponent(UIOpacity);
        orbOp.opacity = 0;

        const orbColor = { r: 52, g: 138, b: 230 };
        let orbGraphics: Graphics | null = null;
        const drawOrb = (g: Graphics): void => {
            g.clear();
            g.fillColor = new Color(orbColor.r, orbColor.g, orbColor.b, 30);
            g.circle(0, 0, 80);
            g.fill();
            g.fillColor = new Color(orbColor.r, orbColor.g, orbColor.b, 80);
            g.circle(0, 0, 56);
            g.fill();
            g.fillColor = new Color(orbColor.r, orbColor.g, orbColor.b, 200);
            g.circle(0, 0, 32);
            g.fill();
        };
        safeAddGraphics(orb, (g) => {
            orbGraphics = g;
            drawOrb(g);
        }, { tag: 'enterMatchOrb' });

        const glow = new Node('EnterMatchGlow');
        overlay.addChild(glow);
        glow.setSiblingIndex(0);
        const glowUT = glow.addComponent(UITransform);
        glowUT.setContentSize(360, 360);
        glow.setPosition(originX, originY, 0);
        glow.setScale(0.4, 0.4, 1);
        const glowOp = glow.addComponent(UIOpacity);
        glowOp.opacity = 0;
        safeAddGraphics(glow, (g) => {
            const rings = 10;
            const peakAlpha = 200;
            for (let i = 0; i < rings; i++) {
                const t = (i + 1) / rings;
                const r = 180 * (1 - i / rings);
                const alpha = Math.round(peakAlpha * t * t);
                g.fillColor = new Color(orbColor.r, orbColor.g, orbColor.b, alpha);
                g.circle(0, 0, r);
                g.fill();
            }
        }, { tag: 'enterMatchGlow' });

        tween(orbOp).to(0.20, { opacity: 255 }, { easing: 'cubicOut' }).start();
        tween(glowOp).to(0.20, { opacity: 220 }, { easing: 'cubicOut' }).start();

        tween(orb)
            .delay(0.05)
            .to(0.55, { position: new Vec3(0, 0, 0) }, { easing: 'cubicOut' })
            .start();
        tween(glow)
            .delay(0.05)
            .to(0.55, { position: new Vec3(0, 0, 0), scale: new Vec3(1.2, 1.2, 1) }, { easing: 'cubicOut' })
            .start();

        let sourceButtonSnapshot: SourceButtonSnapshot | null = null;
        if (sourceButton && sourceButton.isValid) {
            const btnOp = sourceButton.getComponent(UIOpacity) ?? sourceButton.addComponent(UIOpacity);
            sourceButtonSnapshot = {
                button: sourceButton,
                op: btnOp,
                opacityBefore: btnOp.opacity,
            };
            Tween.stopAllByTarget(btnOp);
            tween(btnOp).to(0.20, { opacity: 0 }, { easing: 'cubicIn' }).start();
        }

        setTimeout(() => {
            if (!orb.isValid) return;

            tween(orb)
                .to(0.30, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
                .to(0.30, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
                .union()
                .repeat(2)
                .start();

            const carrier = { r: orbColor.r, g: orbColor.g, b: orbColor.b };
            Tween.stopAllByTarget(carrier);
            tween(carrier)
                .to(0.30, { r: 48, g: 198, b: 155 }, {
                    onUpdate: () => {
                        orbColor.r = Math.round(carrier.r);
                        orbColor.g = Math.round(carrier.g);
                        orbColor.b = Math.round(carrier.b);
                        if (orbGraphics) drawOrb(orbGraphics);
                    },
                })
                .to(0.30, { r: 96, g: 220, b: 88 }, {
                    onUpdate: () => {
                        orbColor.r = Math.round(carrier.r);
                        orbColor.g = Math.round(carrier.g);
                        orbColor.b = Math.round(carrier.b);
                        if (orbGraphics) drawOrb(orbGraphics);
                    },
                })
                .start();

            tween(glow)
                .to(0.60, { scale: new Vec3(2.4, 2.4, 1) }, { easing: 'quartOut' })
                .start();
            tween(glowOp)
                .to(0.60, { opacity: 0 }, { easing: 'quartOut' })
                .start();
        }, 600);

        setTimeout(() => {
            console.log(`${TAG} runEnterMatchCinematic | RESOLVE origin=(${originX.toFixed(0)},${originY.toFixed(0)})`);
            resolve({
                overlay,
                orbNode: orb,
                glowNode: glow,
                canvasRoot: canvasNode,
                panelSnapshots,
                sourceButtonSnapshot,
            });
        }, 1200);
    });
}

/**
 * Phase 5 — particle burst from the orb's resting center, canvas-scale punch,
 * orb dissolve. Destroys the overlay before resolving so the caller can
 * immediately reveal the race UI underneath.
 */
export function runEnterMatchImpact(handle: EnterMatchHandle | null): Promise<void> {
    return new Promise<void>((resolve) => {
        if (!handle || !handle.overlay || !handle.overlay.isValid) {
            resolve();
            return;
        }
        const { overlay, orbNode, canvasRoot } = handle;

        const particleCount = 24;
        const tints: [number, number, number][] = [
            [255, 255, 255],
            [96,  220, 88],
            [48,  198, 155],
        ];
        for (let i = 0; i < particleCount; i++) {
            const theta = (i / particleCount) * Math.PI * 2;
            const dist = 320 + Math.random() * 200;
            const dx = Math.cos(theta) * dist;
            const dy = Math.sin(theta) * dist;
            const tint = tints[i % tints.length];
            const radius = 4 + Math.random() * 4;
            const idx = i;
            enqueuePostDraw(() => {
                if (!overlay.isValid) return;
                const p = new Node(`EnterMatchParticle_${idx}`);
                overlay.addChild(p);
                const ut = p.addComponent(UITransform);
                ut.setContentSize(20, 20);
                const g = p.addComponent(Graphics);
                g.fillColor = new Color(tint[0], tint[1], tint[2], 255);
                g.circle(0, 0, radius);
                g.fill();
                const op = p.addComponent(UIOpacity);
                op.opacity = 255;
                p.setPosition(0, 0, 0);
                tween(p)
                    .to(0.35, { position: new Vec3(dx, dy, 0) }, { easing: 'quartOut' })
                    .start();
                tween(op)
                    .to(0.35, { opacity: 0 }, { easing: 'cubicOut' })
                    .call(() => { try { p.destroy(); } catch (_) { /* already gone */ } })
                    .start();
            });
        }

        if (orbNode && orbNode.isValid) {
            const orbOp = orbNode.getComponent(UIOpacity);
            Tween.stopAllByTarget(orbNode);
            if (orbOp) Tween.stopAllByTarget(orbOp);
            tween(orbNode).to(0.30, { scale: new Vec3(1.6, 1.6, 1) }, { easing: 'cubicOut' }).start();
            if (orbOp) tween(orbOp).to(0.30, { opacity: 0 }, { easing: 'cubicOut' }).start();
        }

        try {
            if (canvasRoot && canvasRoot.isValid) {
                Tween.stopAllByTarget(canvasRoot);
                tween(canvasRoot)
                    .to(0.12, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'cubicOut' })
                    .to(0.20, { scale: new Vec3(1.00, 1.00, 1) }, { easing: 'cubicOut' })
                    .start();
            }
        } catch (e) {
            console.log(`${TAG} runEnterMatchImpact | canvas punch skipped err=${e}`);
        }

        setTimeout(() => {
            try { overlay.destroy(); } catch (_) { /* already gone */ }
            restoreCollapsedPanel(handle);
            console.log(`${TAG} runEnterMatchImpact | RESOLVE`);
            resolve();
        }, 400);
    });
}

/**
 * Tear-down for forfeit-during-cinematic and re-entry paths. Safe to call
 * with a null handle or already-destroyed overlay.
 */
export function destroyEnterMatchOverlay(handle: EnterMatchHandle | null): void {
    if (!handle) return;
    try {
        if (handle.overlay && handle.overlay.isValid) handle.overlay.destroy();
    } catch (_) { /* already gone */ }
    restoreCollapsedPanel(handle);
}
