/**
 * ButtonFX.ts — tactile feedback helpers for primary CTA buttons.
 *
 * Three effects, layer-compatible:
 *
 *   addIdlePulse(node)  — subtle breathing scale loop (1.0 ↔ 1.03, sineInOut,
 *                         1.5s). Draws the eye to the action without noise.
 *                         Cancelable via stopPulse().
 *
 *   addPressPop(button) — on CLICK, plays a scale pop (1.0 → 1.12 → 1.0 over
 *                         0.2s, backOut/cubicIn). Layers atop cc.Button's
 *                         _zoomScale for a meatier "thunk" tactile response.
 *                         Also briefly brightens the base Sprite color.
 *
 *   setStrongPress(btn) — one-shot: bumps cc.Button._zoomScale to 1.08 (from
 *                         the default 1.05) so tap-down feedback is
 *                         more noticeable.
 *
 * Usage pattern in AppUI.start():
 *     const qp = this._homePanel.getChildByName('QuickPlayButton');
 *     if (qp) {
 *         addIdlePulse(qp);
 *         const btn = qp.getComponent(Button);
 *         if (btn) { addPressPop(btn); setStrongPress(btn); }
 *     }
 */

import { Button, Color, Node, Sprite, tween, Tween, Vec3 } from 'cc';

const TAG = '[ButtonFX]';

/** Registry of active pulse tweens so we can cancel/resume on tap. */
const pulseSet = new WeakSet<Node>();

/**
 * Start a subtle scale-pulse loop on the node. Cancelable via stopPulse().
 * Idempotent — double-starts are no-ops.
 */
export function addIdlePulse(node: Node, peak = 1.03, durationSec = 1.5): void {
    if (pulseSet.has(node)) return;
    pulseSet.add(node);
    // Kick off a forever-repeat scale loop.
    tween(node)
        .to(durationSec / 2, { scale: new Vec3(peak, peak, 1) }, { easing: 'sineInOut' })
        .to(durationSec / 2, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
        .union()
        .repeatForever()
        .start();
}

/** Stop any active pulse on the node and reset scale to 1. */
export function stopPulse(node: Node): void {
    if (!pulseSet.has(node)) return;
    pulseSet.delete(node);
    Tween.stopAllByTarget(node);
    node.setScale(1, 1, 1);
}

/**
 * Hook a one-shot scale+color pop to the button's CLICK event. Cancels any
 * active idle-pulse for the duration of the pop, then restarts it.
 *
 * Press sequence:
 *   1. Pulse (if running) is halted and scale reset.
 *   2. Scale tweens 1.0 → 1.12 (backOut, 100ms) → 1.0 (cubicIn, 100ms).
 *   3. Base sprite color briefly brightens +40 on each channel for 150ms.
 *   4. After 500ms, idle pulse is resumed if it was active before.
 */
export function addPressPop(button: Button): void {
    const node = button.node;
    button.node.on(Button.EventType.CLICK, () => {
        const wasPulsing = pulseSet.has(node);
        if (wasPulsing) {
            pulseSet.delete(node);
            Tween.stopAllByTarget(node);
        }
        node.setScale(1, 1, 1);

        // Scale pop
        tween(node)
            .to(0.10, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'backOut' })
            .to(0.10, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicIn' })
            .call(() => {
                if (wasPulsing) {
                    // Resume pulse after a brief settle.
                    setTimeout(() => addIdlePulse(node), 400);
                }
            })
            .start();

        // Color flash on the base sprite (not children — keep it simple).
        const spr = node.getComponent(Sprite);
        if (spr) {
            const orig = spr.color.clone();
            const brighter = new Color(
                Math.min(255, orig.r + 40),
                Math.min(255, orig.g + 40),
                Math.min(255, orig.b + 40),
                orig.a,
            );
            // Direct color flash — no tween on Sprite.color because Cocos
            // doesn't interpolate it reliably via tween. Simple setTimeout flicker.
            spr.color = brighter;
            setTimeout(() => { spr.color = orig; }, 150);
        }
    }, null);
}

/** Bump the button's native _zoomScale so tap-down feedback is stronger. */
export function setStrongPress(button: Button, zoom = 1.08): void {
    (button as any).zoomScale = zoom;
}

/** Convenience: apply all three effects to a button. */
export function enhancePrimaryCTA(node: Node | null): void {
    if (!node) return;
    const btn = node.getComponent(Button);
    if (!btn) {
        console.log(`${TAG} enhancePrimaryCTA | no Button on ${node.name}`);
        return;
    }
    addIdlePulse(node);
    addPressPop(btn);
    setStrongPress(btn);
    console.log(`${TAG} enhancePrimaryCTA | applied to ${node.name}`);
}
