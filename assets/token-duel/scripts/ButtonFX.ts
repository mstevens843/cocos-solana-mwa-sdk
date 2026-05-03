/**
 * ButtonFX.ts - tactile feedback helpers for primary CTA buttons.
 *
 * Three effects, layer-compatible:
 *
 *   addIdlePulse(node)  - subtle breathing scale loop (1.0 ↔ 1.03, sineInOut,
 *                         1.5s). Draws the eye to the action without noise.
 *                         Cancelable via stopPulse().
 *
 *   addPressPop(button) - on CLICK, plays a subtle scale dip (1.0 → 0.97 →
 *                         1.0 over ~140ms, cubicIn/backOut) plus a brief
 *                         flash of the sibling BtnGlow_<name> halo. No
 *                         overshoot - the dip + flash combo reads as
 *                         "intentional press" without competing with idle
 *                         pulses. Also brightens the base sprite by ~+28
 *                         on each channel for 100ms.
 *
 *   setStrongPress(btn) - one-shot: bumps cc.Button._zoomScale to 1.08 (from
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

import { Button, Color, Node, Sprite, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { ButtonTier, ButtonTierSpec, Palette } from './Theme';

const TAG = '[ButtonFX]';

/** Registry of active pulse tweens so we can cancel/resume on tap. */
const pulseSet = new WeakSet<Node>();

/**
 * Start a subtle scale-pulse loop on the node. Cancelable via stopPulse().
 * Idempotent - double-starts are no-ops.
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

/**
 * Subtler pulse for the "almost ready" state (squad 2/3). Smaller scale band
 * (1.0 ↔ 1.015) and slower cycle (2.5s) so it reads as anticipation rather
 * than a call-to-action. Same registry as addIdlePulse - only one pulse can
 * be active at a time.
 */
export function addAlmostReadyPulse(node: Node): void {
    if (pulseSet.has(node)) return;
    pulseSet.add(node);
    tween(node)
        .to(1.25, { scale: new Vec3(1.015, 1.015, 1) }, { easing: 'sineInOut' })
        .to(1.25, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
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
 * Hook a one-shot scale dip + glow flash to the button's CLICK event. Cancels
 * any active idle-pulse for the duration of the press, then restarts it.
 *
 * 2026-04-28 home-UX polish: replaced the previous overshoot pop
 * (1.0 → 1.12 → 1.0) with a subtle dip (1.0 → 0.97 → 1.0) per spec. The
 * dip + glow flash combo reads as "intentional press" without competing
 * with idle pulses or shimmer sweeps. Affects every CTA app-wide for
 * cohesion (Find Match, Start Match, Trade, Settings, etc.).
 *
 * Press sequence:
 *   1. Pulse (if running) is halted and scale reset.
 *   2. Scale tweens 1.0 → 0.97 (cubicIn, 70ms) → 1.0 (backOut, 70ms).
 *   3. Sibling BtnGlow_<name> (if present) UIOpacity briefly raised
 *      +60 over 90ms, faded back over 220ms.
 *   4. Base sprite color briefly brightens +28 (~30% softer than the
 *      old +40) for 100ms so it doesn't overshadow the glow flash.
 *   5. After 400ms, idle pulse is resumed if it was active before.
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

        // Scale dip - subtle inward press, no overshoot.
        tween(node)
            .to(0.07, { scale: new Vec3(0.97, 0.97, 1) }, { easing: 'cubicIn' })
            .to(0.07, { scale: new Vec3(1, 1, 1) },       { easing: 'backOut' })
            .call(() => {
                if (wasPulsing) {
                    setTimeout(() => addIdlePulse(node), 400);
                }
            })
            .start();

        // Glow flash on sibling BtnGlow_<name> halo (created by mkBtnHero).
        // Silent no-op for ghost buttons that have no halo.
        const halo = node.parent ? node.parent.getChildByName(`BtnGlow_${node.name}`) : null;
        if (halo) {
            const haloOp = halo.getComponent(UIOpacity) ?? halo.addComponent(UIOpacity);
            const baseOpacity = haloOp.opacity;
            const peakOpacity = Math.min(255, baseOpacity + 60);
            Tween.stopAllByTarget(haloOp);
            tween(haloOp)
                .to(0.09, { opacity: peakOpacity }, { easing: 'cubicOut' })
                .to(0.22, { opacity: baseOpacity }, { easing: 'cubicIn' })
                .start();
        }

        // Color flash on the base sprite - softer than before so it layers
        // under the glow flash rather than competing with it.
        const spr = node.getComponent(Sprite);
        if (spr) {
            const orig = spr.color.clone();
            const brighter = new Color(
                Math.min(255, orig.r + 28),
                Math.min(255, orig.g + 28),
                Math.min(255, orig.b + 28),
                orig.a,
            );
            spr.color = brighter;
            setTimeout(() => { spr.color = orig; }, 100);
        }
    }, null);
}

/** Bump the button's native _zoomScale so tap-down feedback is stronger. */
export function setStrongPress(button: Button, zoom = 1.08): void {
    (button as any).zoomScale = zoom;
}

/**
 * Phase 18 - ripple-on-click for hero CTAs.
 *
 * Looks for a `Ripple_<button.name>` child sprite created by mkBtnHero at
 * scene-gen time. On CLICK: activates it, scales 0.4× → 2.5× + opacity
 * 100 → 0 over 400ms, then deactivates. Layers atop press-pop + idle-pulse.
 *
 * Silent no-op if the button isn't a hero (no Ripple_ child). Safe to call
 * on any Button.
 */
export function addRipple(button: Button): void {
    const node = button.node;
    const ripple = node.getChildByName(`Ripple_${node.name}`);
    if (!ripple) return; // not a hero button - silent skip
    button.node.on(Button.EventType.CLICK, () => {
        ripple.active = true;
        Tween.stopAllByTarget(ripple);
        const op = ripple.getComponent(UIOpacity) ?? ripple.addComponent(UIOpacity);
        Tween.stopAllByTarget(op);
        op.opacity = 100;
        ripple.setScale(0.4, 0.4, 1);
        tween(ripple)
            .to(0.40, { scale: new Vec3(2.5, 2.5, 1) }, { easing: 'cubicOut' })
            .start();
        tween(op)
            .to(0.40, { opacity: 0 }, { easing: 'cubicOut' })
            .call(() => { ripple.active = false; })
            .start();
    });
}

/** Registry of active shimmer tweens - keyed by the Shimmer_ child node. */
const shimmerSet = new WeakSet<Node>();

/**
 * 2026-04-28 polish - periodic shimmer pass across a hero CTA. Looks for a
 * `Shimmer_<button.name>` child sprite (90px-wide vertical band, additive
 * blend) created by mkBtnHeroLayered. Tweens it from off-button-left to
 * off-button-right over `sweepSec`, idles for `idleSec`, repeats forever.
 *
 * Idempotent. Silent no-op if no Shimmer_ child exists. Layers atop
 * idle-pulse + glow-pulse without competing for the eye - the band is
 * white-alpha 80 and only crosses the button briefly.
 */
export function addShimmerSweep(node: Node | null, sweepSec = 0.9, idleSec = 3.5): void {
    if (!node) return;
    const shimmer = node.getChildByName(`Shimmer_${node.name}`);
    if (!shimmer) return;
    if (shimmerSet.has(shimmer)) return;
    shimmerSet.add(shimmer);

    const btnUT = node.getComponent(UITransform);
    const shimmerUT = shimmer.getComponent(UITransform);
    if (!btnUT || !shimmerUT) return;

    const startX = -(btnUT.width / 2 + shimmerUT.width / 2);
    const endX   =  (btnUT.width / 2 + shimmerUT.width / 2);

    shimmer.active = true;
    shimmer.setPosition(startX, 0, 0);

    tween(shimmer)
        .delay(idleSec)
        .call(() => shimmer.setPosition(startX, 0, 0))
        .to(sweepSec, { position: new Vec3(endX, 0, 0) }, { easing: 'sineInOut' })
        .union()
        .repeatForever()
        .start();
}

/** Registry of active signal-flicker tweens - keyed by the flickering node. */
const flickerSet = new WeakSet<Node>();

/**
 * 2026-04-28 home UX polish - slow opacity flicker on the FindMatch live-
 * count badge so it reads as a "signal pulse" rather than a static chip.
 * Idempotent. Apply when the badge is visible (count > 0); leave alone
 * when hidden.
 *
 * Cycle: brief dim to `dimAlpha` (180ms) → restore to 255 (180ms) → hold
 * `holdSec` seconds → repeat. Total period is `holdSec + 0.36`. Use a
 * `holdSec` of ~2.4s so the flicker reads as ambient, not nervous.
 */
export function addSignalFlicker(node: Node | null, dimAlpha = 200, holdSec = 2.4): void {
    if (!node) return;
    if (flickerSet.has(node)) return;
    flickerSet.add(node);
    const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    const peak = op.opacity || 255;
    tween(op)
        .to(0.18, { opacity: dimAlpha }, { easing: 'sineInOut' })
        .to(0.18, { opacity: peak },     { easing: 'sineInOut' })
        .delay(holdSec)
        .union()
        .repeatForever()
        .start();
}

/** Convenience: apply all four effects to a button. */
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
    addRipple(btn);  // Phase 18 - ripple on hero CTAs (silent no-op if no Ripple_ child)
    console.log(`${TAG} enhancePrimaryCTA | applied to ${node.name}`);
}

/**
 * 2026-04-29 (Prompt 1) - global button-hierarchy dispatcher.
 *
 * Applies the right effect bundle for a tier:
 *   primary    → idle pulse + press dip + strong press + ripple (full hero treatment).
 *   secondary  → press dip + strong press only (no idle pulse, no ripple).
 *   tertiary   → press dip only - no zoom bump, no glow flash.
 *   danger     → press dip with rose-tint override on the glow flash; no idle pulse.
 *
 * Replaces the per-call hand-wiring of addIdlePulse / addPressPop / addRipple
 * scattered through AppUI.start(). Call once per button at start time:
 *
 *   applyButtonTier(this._homePanel.getChildByName('FindMatchButton'), 'primary');
 *
 * Silent no-op when node is null or has no Button component.
 */
export function applyButtonTier(node: Node | null, tier: ButtonTier): void {
    if (!node) return;
    const btn = node.getComponent(Button);
    if (!btn) {
        console.log(`${TAG} applyButtonTier(${tier}) | no Button on ${node?.name ?? '<null>'}`);
        return;
    }
    const spec = ButtonTierSpec[tier];
    if (!spec) {
        console.log(`${TAG} applyButtonTier | unknown tier "${tier}"`);
        return;
    }
    if (spec.idlePulse)   addIdlePulse(node);
    if (spec.pressPop) {
        if (tier === 'danger') addDangerPressPop(btn);
        else                   addPressPop(btn);
    }
    if (spec.strongPress) setStrongPress(btn);
    if (spec.ripple)      addRipple(btn);
    console.log(`${TAG} applyButtonTier(${tier}) | applied to ${node.name}`);
}

/**
 * Danger-tier press feedback - same scale dip as addPressPop but the glow
 * flash uses rose (#FF4D4D from Palette.accent.rose) so destructive presses
 * read as a tinted consequence cue rather than a neutral confirmation.
 */
function addDangerPressPop(button: Button): void {
    const node = button.node;
    button.node.on(Button.EventType.CLICK, () => {
        const wasPulsing = pulseSet.has(node);
        if (wasPulsing) {
            pulseSet.delete(node);
            Tween.stopAllByTarget(node);
        }
        node.setScale(1, 1, 1);

        tween(node)
            .to(0.07, { scale: new Vec3(0.97, 0.97, 1) }, { easing: 'cubicIn' })
            .to(0.07, { scale: new Vec3(1, 1, 1) },       { easing: 'backOut' })
            .start();

        // Rose-tinted halo flash on optional sibling BtnGlow_<name>.
        const halo = node.parent ? node.parent.getChildByName(`BtnGlow_${node.name}`) : null;
        if (halo) {
            const haloOp = halo.getComponent(UIOpacity) ?? halo.addComponent(UIOpacity);
            const baseOpacity = haloOp.opacity;
            const peakOpacity = Math.min(255, baseOpacity + 80);
            Tween.stopAllByTarget(haloOp);
            tween(haloOp)
                .to(0.09, { opacity: peakOpacity }, { easing: 'cubicOut' })
                .to(0.22, { opacity: baseOpacity }, { easing: 'cubicIn' })
                .start();
        }

        // Sprite color flash - shift toward rose for ~120ms, then restore.
        const spr = node.getComponent(Sprite);
        if (spr) {
            const orig = spr.color.clone();
            spr.color = new Color(255, 77, 77, orig.a);  // Palette.accent.rose
            setTimeout(() => { spr.color = orig; }, 120);
        }
    }, null);
}
