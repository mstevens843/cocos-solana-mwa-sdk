/**
 * LandingFX.ts — landing-screen ambient animations.
 *
 * Layer-compatible with ButtonFX (which already runs idle-pulse + press-pop on
 * landing CTAs) and AppUI._initStarfieldTwinkle (which already cycles 1-in-4
 * stars). All loops are `.repeatForever()` and idempotent via per-target
 * WeakSets so re-application is a no-op.
 *
 *   addFloat(node)     — Y-axis sine oscillation around the node's current
 *                        position. Drives the mascot's "alive" presence.
 *
 *   addGlowPulse(node) — opacity sine on a UIOpacity component. Drives the
 *                        breathing on glow halos (TitleGlow, MascotGlow,
 *                        BtnGlow_ConnectButton).
 *
 * Patterns mirror ButtonFX.ts (sineInOut, .union().repeatForever()).
 */

import { Node, UIOpacity, tween, Tween, Vec3 } from 'cc';

const TAG = '[LandingFX]';

const floatSet = new WeakSet<Node>();
const pulseSet = new WeakSet<Node>();

/**
 * Y-axis sine oscillation around the node's current position. Cancelable via
 * stopFloat(). Idempotent.
 */
export function addFloat(node: Node, ampPx = 10, periodSec = 3.2): void {
    if (floatSet.has(node)) return;
    floatSet.add(node);
    const base = node.position.clone();
    const up   = new Vec3(base.x, base.y + ampPx, base.z);
    const down = new Vec3(base.x, base.y - ampPx, base.z);
    tween(node)
        .to(periodSec / 2, { position: up   }, { easing: 'sineInOut' })
        .to(periodSec / 2, { position: down }, { easing: 'sineInOut' })
        .union()
        .repeatForever()
        .start();
    console.log(`${TAG} addFloat | ${node.name} amp=${ampPx} period=${periodSec}`);
}

export function stopFloat(node: Node): void {
    if (!floatSet.has(node)) return;
    floatSet.delete(node);
    Tween.stopAllByTarget(node);
}

/**
 * Opacity sine on a UIOpacity component. Adds the component if missing.
 * `peakAlpha` is the bright end; the dim end is `peakAlpha * 0.55`. Idempotent.
 */
export function addGlowPulse(node: Node, peakAlpha = 130, periodSec = 2.6): void {
    if (pulseSet.has(node)) return;
    pulseSet.add(node);
    const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    const dim = Math.round(peakAlpha * 0.55);
    op.opacity = peakAlpha;
    tween(op)
        .to(periodSec / 2, { opacity: dim },       { easing: 'sineInOut' })
        .to(periodSec / 2, { opacity: peakAlpha }, { easing: 'sineInOut' })
        .union()
        .repeatForever()
        .start();
    console.log(`${TAG} addGlowPulse | ${node.name} peak=${peakAlpha} period=${periodSec}`);
}

