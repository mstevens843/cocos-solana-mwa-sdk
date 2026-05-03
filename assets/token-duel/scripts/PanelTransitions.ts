/**
 * PanelTransitions.ts - fade+scale panel swap helper.
 *
 * Replaces the instant `node.active = true/false` toggle in
 * AppUI._setActivePanel with a polished short transition. Drop a UIOpacity
 * onto the panel for the fade portion (added on first call if missing).
 *
 * Default sequence (~340ms total, with overlap):
 *   - outgoing: scale 1 → 0.96 + opacity 255 → 0 over Motion.fast (120ms)
 *   - incoming: scale 1.04 → 1 + opacity 0 → 255 over Motion.base (220ms)
 *
 * `swapPanel` is fire-and-forget for callers; it stops any in-flight tweens
 * on the target nodes first to avoid stacking.
 */

import { Node, tween, Tween, UIOpacity, Vec3 } from 'cc';
import { Motion } from './Theme';

const TAG = '[PanelTransitions]';

// Phase 18: slide-in distances. Subtle horizontal slide layered on top of
// existing fade+scale gives panel transitions a spatial direction (forward
// is right-to-left motion, back is left-to-right) without dragging out the duration.
const SLIDE_IN_DX  = 80;
const SLIDE_OUT_DX = 40;

export type PanelDir = 'forward' | 'back' | 'instant';

// 2026-04-29: capture each panel's intended resting position once on first
// activation. The generator sets _lpos to the panel's mount offset; this
// helper persists those values on the node so the slide tweens can return
// the panel to its intended Y instead of clobbering it to 0. Without this,
// every swap forced lpos to (0, 0, 0), erasing per-panel mount offsets and
// causing visible cross-panel top-of-page misalignment.
type PanelRest = { x: number; y: number };
function captureRest(node: Node): PanelRest {
    const data: any = (node as any).__panelData ?? ((node as any).__panelData = {});
    if (!data.__layoutRest__) {
        data.__layoutRest__ = { x: node.position.x, y: node.position.y };
    }
    return data.__layoutRest__;
}

export function swapPanel(out: Node | null, into: Node | null, dir: PanelDir = 'forward'): void {
    if (dir === 'instant') {
        if (out) out.active = false;
        if (into) {
            into.active = true;
            into.setScale(Vec3.ONE);
            const rest = captureRest(into);
            into.setPosition(new Vec3(rest.x, rest.y, 0));
            const op = into.getComponent(UIOpacity);
            if (op) op.opacity = 255;
        }
        return;
    }

    if (out && out.active) animateOut(out, dir);
    if (into) animateIn(into, dir);
}

function ensureOpacity(node: Node): UIOpacity {
    return node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
}

function animateOut(node: Node, dir: PanelDir = 'forward'): void {
    Tween.stopAllByTarget(node);
    const op = ensureOpacity(node);
    Tween.stopAllByTarget(op);
    const rest = captureRest(node);
    // Phase 18: outgoing slides opposite of incoming. Forward goes left, Back goes right.
    const slideOutSign = dir === 'back' ? 1 : -1;
    const endX = rest.x + slideOutSign * SLIDE_OUT_DX;
    tween(node)
        .to(Motion.fast, { scale: new Vec3(0.96, 0.96, 1) }, { easing: 'cubicIn' })
        .call(() => {
            node.active = false;
            node.setScale(Vec3.ONE);
            node.setPosition(new Vec3(rest.x, rest.y, 0)); // restore resting pos for next show
        })
        .start();
    tween(op)
        .to(Motion.fast, { opacity: 0 })
        .call(() => { op.opacity = 255; })
        .start();
    // Phase 18: x-axis slide as it fades.
    tween(node)
        .to(Motion.fast, { position: new Vec3(endX, rest.y, 0) }, { easing: 'cubicIn' })
        .start();
}

function animateIn(node: Node, dir: PanelDir): void {
    Tween.stopAllByTarget(node);
    const op = ensureOpacity(node);
    Tween.stopAllByTarget(op);
    const rest = captureRest(node);
    node.active = true;
    const startScale = dir === 'back' ? 0.96 : 1.04;
    node.setScale(new Vec3(startScale, startScale, 1));
    op.opacity = 0;
    // Phase 18: incoming starts off-center on x-axis. Forward starts at rest.x+80
    // (slides in from right). Back starts at rest.x-80 (slides in from left).
    const slideInSign = dir === 'back' ? -1 : 1;
    const startX = rest.x + slideInSign * SLIDE_IN_DX;
    node.setPosition(new Vec3(startX, rest.y, 0));
    tween(node)
        .to(Motion.base, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicOut' })
        .start();
    tween(op)
        .to(Motion.base, { opacity: 255 })
        .start();
    tween(node)
        .to(Motion.base, { position: new Vec3(rest.x, rest.y, 0) }, { easing: 'cubicOut' })
        .start();
}

/** Subtle "tap pop" - used on Squad slot select / button confirm.  */
export function popScale(node: Node, peak = 1.12): void {
    Tween.stopAllByTarget(node);
    tween(node)
        .to(Motion.fast, { scale: new Vec3(peak, peak, 1) }, { easing: 'cubicOut' })
        .to(Motion.fast, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicIn' })
        .start();
}

/** Brief shake on validation error / loss - ~12px horizontal jitter. */
export function shake(node: Node, amplitude = 12): void {
    const original = node.position.clone();
    Tween.stopAllByTarget(node);
    tween(node)
        .to(0.05, { position: new Vec3(original.x + amplitude, original.y, original.z) })
        .to(0.05, { position: new Vec3(original.x - amplitude, original.y, original.z) })
        .to(0.05, { position: new Vec3(original.x + amplitude * 0.6, original.y, original.z) })
        .to(0.05, { position: new Vec3(original.x - amplitude * 0.6, original.y, original.z) })
        .to(0.05, { position: original })
        .start();
}

/** One-time announce: fade-in from below by `dy` px. Used for toasts. */
export function fadeInFromBelow(node: Node, dy = 24): void {
    const op = ensureOpacity(node);
    const target = node.position.clone();
    Tween.stopAllByTarget(node);
    Tween.stopAllByTarget(op);
    op.opacity = 0;
    node.setPosition(new Vec3(target.x, target.y - dy, target.z));
    tween(node).to(Motion.base, { position: target }, { easing: 'cubicOut' }).start();
    tween(op).to(Motion.base, { opacity: 255 }).start();
}

export function logTransition(name: string, dir: PanelDir): void {
    console.log(`${TAG} ${name} dir=${dir}`);
}
