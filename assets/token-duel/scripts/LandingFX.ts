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

import { Color, Graphics, Node, UIOpacity, UITransform, tween, Tween, Vec3 } from 'cc';

const TAG = '[LandingFX]';

const floatSet = new WeakSet<Node>();
const pulseSet = new WeakSet<Node>();
const driftSet = new WeakSet<Node>();

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

/**
 * 2026-04-28 hackathon UX — drifting particle layer behind the mascot for
 * "alive arena" feel. Spawns `count` small Graphics-drawn dots inside
 * `parent`, each tweening bottom→top with randomized X jitter, opacity,
 * scale, and start phase. All Graphics components are added in a single
 * synchronous pass before any tween starts (mirrors the confetti
 * pre-allocation pattern in AppUI._bindPostMatchConfetti — Cocos 3.8
 * Android can SIGSEGV when many Graphics components attach mid-tween).
 *
 * Idempotent per-parent. Loops with `.repeatForever()`. No-op if `parent`
 * is null or already has particles.
 *
 * Visual: 4-6px violet/teal dots, alpha 80-180, drift bottom (-440) →
 * top (+560) over 6-10s with phase delays so they don't all start
 * together. Renders as the FIRST child of `parent` so it sits behind
 * everything else (including mascot glow).
 */
export function addParticleDrift(parent: Node, count = 8, opts: { densityCurve?: 'uniform' | 'topHeavy' } = {}): void {
    if (!parent || driftSet.has(parent)) return;
    driftSet.add(parent);

    const densityCurve = opts.densityCurve ?? 'uniform';

    // Bottom-of-canvas / top-of-canvas anchors. Landing canvas is 1280h
    // centered at 0; particles travel from y=-440 (well below CTA card)
    // up to y=+560 (above the title). The wide travel makes the drift
    // feel continuous rather than start/stop.
    //
    // 2026-04-28 home UX — `densityCurve='topHeavy'` shifts the spawn band
    // upward and shortens the fade tail so the home panel reads as
    // "energy flowing into actions" near the top, fading out before
    // reaching the cards stacked at the bottom.
    const Y_START = densityCurve === 'topHeavy' ? -120 : -440;
    const Y_END   = densityCurve === 'topHeavy' ?  640 :  560;

    // Violet (#9945FF) and teal (#14F195) — Theme.accent.violet/teal.
    const tints: [number, number, number][] = [
        [153,  69, 255],  // violet
        [ 20, 241, 149],  // teal
    ];

    // Build all Graphics + UIOpacity components in one synchronous pass
    // before kicking off any tween (Cocos 3.8 Android renderer crash
    // safeguard — see _bindPostMatchConfetti header).
    type Particle = { node: Node; op: UIOpacity; periodSec: number; delaySec: number; xJitter: number };
    const particles: Particle[] = [];

    for (let i = 0; i < count; i++) {
        const p = new Node(`LandingParticle_${i}`);
        parent.addChild(p);
        const ut = p.addComponent(UITransform);
        ut.setContentSize(12, 12);
        const g = p.addComponent(Graphics);
        const tint = tints[i % tints.length];
        const radius = 3 + Math.random() * 3;  // 3-6 px
        g.fillColor = new Color(tint[0], tint[1], tint[2], 255);
        g.circle(0, 0, radius);
        g.fill();
        const op = p.addComponent(UIOpacity);
        op.opacity = 0;  // start hidden until first tween cycle ramps it in

        const periodSec = 6 + Math.random() * 4;          // 6-10s
        const delaySec  = (i / count) * periodSec * 0.8;  // staggered start
        const xJitter   = (Math.random() - 0.5) * 380;    // ±190 px

        // Initial position: somewhere between Y_START and Y_END.
        // 'uniform' biases toward the bottom (200px wave from start) so the
        // first wave drifts up. 'topHeavy' biases upward (70% in upper half
        // of the spawn band) so density visibly clusters near top of panel.
        const Y_SPREAD = Y_END - Y_START;
        const startY = densityCurve === 'topHeavy'
            ? Y_START + Y_SPREAD * (0.3 + Math.random() * 0.7)  // 30-100% (top-biased)
            : Y_START + Math.random() * 200;                     // legacy: bottom-biased
        p.setPosition(xJitter, startY, 0);

        particles.push({ node: p, op, periodSec, delaySec, xJitter });
    }

    // Now start tweens — Graphics already attached.
    for (const { node, op, periodSec, delaySec, xJitter } of particles) {
        const peakAlpha = 80 + Math.round(Math.random() * 100);  // 80-180

        // Position drift: y -440 → +560 with side-to-side sway via x jitter
        // delta. Linear easing — gentle, ambient, no bounce.
        tween(node)
            .delay(delaySec)
            .to(periodSec, { position: new Vec3(xJitter + (Math.random() - 0.5) * 60, Y_END, 0) }, { easing: 'linear' })
            .call(() => {
                const newX = (Math.random() - 0.5) * 380;
                node.setPosition(newX, Y_START, 0);
            })
            .union()
            .repeatForever()
            .start();

        // Opacity envelope: ramp in over first 20%, hold, fade out over
        // last 20%. Manual three-step tween rather than sine so the
        // particle visibly *enters* and *leaves* the screen rather than
        // popping at the edges.
        const fade = periodSec * 0.2;
        const hold = periodSec * 0.6;
        tween(op)
            .delay(delaySec)
            .to(fade, { opacity: peakAlpha }, { easing: 'sineOut' })
            .to(hold, { opacity: peakAlpha }, { easing: 'linear' })
            .to(fade, { opacity: 0 },         { easing: 'sineIn' })
            .union()
            .repeatForever()
            .start();
    }

    console.log(`${TAG} addParticleDrift | parent=${parent.name} count=${count}`);
}

/**
 * Re-spawnable variant of `addParticleDrift`. Tears down any existing particle
 * children (named `LandingParticle_*`) and their tweens, drops `parent` from
 * the per-parent WeakSet, then re-runs `addParticleDrift` to spawn a fresh
 * layer.
 *
 * Use this on every panel-show path where the particles must be visible on
 * re-entry (Landing after disconnect, Home after navigating away). Cocos 3.8
 * doesn't reliably retain Graphics buffers across `node.active = false` →
 * `true` cycles when the parent's UIOpacity cross-fades, so persisting the
 * old children isn't enough.
 *
 * No-op if `parent` is null. Safe to call repeatedly.
 */
export function ensureParticleDrift(parent: Node, count = 8, opts: { densityCurve?: 'uniform' | 'topHeavy' } = {}): void {
    if (!parent) return;

    const stale = parent.children.filter((c) => c.name.startsWith('LandingParticle_'));
    for (const node of stale) {
        const op = node.getComponent(UIOpacity);
        Tween.stopAllByTarget(node);
        if (op) Tween.stopAllByTarget(op);
        node.destroy();
    }
    driftSet.delete(parent);

    addParticleDrift(parent, count, opts);
}

/**
 * 2026-04-28 home UX polish — portal-style micro-transition for hero CTA
 * destinations (Find Match / Start Match). Run *after* the panel is set
 * active. Three layered effects:
 *
 *   1. Panel root: scale 0.96 → 1.0 + opacity 0 → 255 over 220ms (backOut).
 *      Reads as "the panel arriving from a deeper layer."
 *   2. One-shot radial glow sprite: centered, scale 0.4 → 2.6 + alpha
 *      180 → 0 over 320ms in `accentColor`. Auto-destroys when tween
 *      completes.
 *
 * No-op if `panelRoot` is null. Safe to call even when the panel was
 * already visible — the scale tween will run again, which still reads
 * as a small "re-affirmation" flash.
 */
export function panelEnterFlourish(panelRoot: Node | null, accentColor: Color): void {
    if (!panelRoot) return;

    // Step 1 — panel scale + opacity entrance.
    panelRoot.setScale(0.96, 0.96, 1);
    const panelOp = panelRoot.getComponent(UIOpacity) ?? panelRoot.addComponent(UIOpacity);
    panelOp.opacity = 0;
    Tween.stopAllByTarget(panelRoot);
    Tween.stopAllByTarget(panelOp);
    tween(panelRoot)
        .to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
        .start();
    tween(panelOp)
        .to(0.22, { opacity: 255 }, { easing: 'sineOut' })
        .start();

    // Step 2 — one-shot radial glow burst at panel center. Uses Graphics
    // (filled circle) rather than Sprite to avoid needing a SpriteFrame
    // UUID — same pattern as addParticleDrift's drifting dots.
    const burst = new Node('PanelEnterFlourish');
    panelRoot.addChild(burst);
    const ut = burst.addComponent(UITransform);
    ut.setContentSize(420, 420);
    const g = burst.addComponent(Graphics);
    g.fillColor = new Color(accentColor.r, accentColor.g, accentColor.b, 255);
    g.circle(0, 0, 80);
    g.fill();
    burst.setScale(0.4, 0.4, 1);
    burst.setPosition(0, 0, 0);
    const burstOp = burst.addComponent(UIOpacity);
    burstOp.opacity = 180;
    tween(burst)
        .to(0.32, { scale: new Vec3(2.6, 2.6, 1) }, { easing: 'cubicOut' })
        .start();
    tween(burstOp)
        .to(0.32, { opacity: 0 }, { easing: 'cubicOut' })
        .call(() => { try { burst.destroy(); } catch (_) { /* already destroyed */ } })
        .start();

    console.log(`${TAG} panelEnterFlourish | ${panelRoot.name} accent=(${accentColor.r},${accentColor.g},${accentColor.b})`);
}

