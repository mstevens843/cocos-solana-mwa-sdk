/**
 * LandingFX.ts - landing-screen ambient animations.
 *
 * Layer-compatible with ButtonFX (which already runs idle-pulse + press-pop on
 * landing CTAs) and AppUI._initStarfieldTwinkle (which already cycles 1-in-4
 * stars). All loops are `.repeatForever()` and idempotent via per-target
 * WeakSets so re-application is a no-op.
 *
 *   addFloat(node)     - Y-axis sine oscillation around the node's current
 *                        position. Drives the mascot's "alive" presence.
 *
 *   addGlowPulse(node) - opacity sine on a UIOpacity component. Drives the
 *                        breathing on glow halos (TitleGlow, MascotGlow,
 *                        BtnGlow_ConnectButton).
 *
 * Patterns mirror ButtonFX.ts (sineInOut, .union().repeatForever()).
 */

import { Color, Graphics, Node, Sprite, UIOpacity, UITransform, tween, Tween, Vec3 } from 'cc';
import { enqueuePostDraw } from './safeGraphics';

const TAG = '[LandingFX]';

const floatSet      = new WeakSet<Node>();
const pulseSet      = new WeakSet<Node>();
const driftSet      = new WeakSet<Node>();
const softGlowSet   = new WeakSet<Node>();
const softEllipseSet = new WeakSet<Node>();
const vignetteSet   = new WeakSet<Node>();

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
 * 2026-04-28 hackathon UX - drifting particle layer behind the mascot for
 * "alive arena" feel. Spawns `count` small Graphics-drawn dots inside
 * `parent`, each tweening bottom→top with randomized X jitter, opacity,
 * scale, and start phase. All Graphics components are added in a single
 * synchronous pass before any tween starts (mirrors the confetti
 * pre-allocation pattern in AppUI._bindPostMatchConfetti - Cocos 3.8
 * Android can SIGSEGV when many Graphics components attach mid-tween).
 *
 * Idempotent per-parent. Loops with `.repeatForever()`. No-op if `parent`
 * is null or already has particles.
 *
 * Visual: 4-6px violet/teal dots, alpha 80-180, drift bottom edge
 * (y=-560) → top edge (y=+560 or +640 for topHeavy) over 6-10s with
 * phase delays so they don't all start together. Renders as the FIRST
 * child of `parent` so it sits behind everything else (including mascot
 * glow).
 */
export function addParticleDrift(parent: Node, count = 8, opts: { densityCurve?: 'uniform' | 'topHeavy' } = {}): void {
    if (!parent || driftSet.has(parent)) return;
    driftSet.add(parent);

    // 2026-04-29 - route Node + Graphics allocation through the budgeted
    // post-draw queue. Each particle becomes one queued work unit so the
    // queue spreads them across multiple AFTER_DRAW ticks (engine SIGSEGVs
    // at 0x28 in js_cc_UIModelProxy_activeSubModels when too many
    // addComponent(Graphics) land in a single tick - empirical ceiling ~20).

    const densityCurve = opts.densityCurve ?? 'uniform';

    // Bottom-of-canvas / top-of-canvas anchors. Landing canvas is 1280h
    // centered at 0 (-640 → +640 visible). Particles always spawn just
    // below the bottom edge and travel up past the top edge so the drift
    // reads as "rising from below" rather than appearing mid-screen.
    //
    // `densityCurve='topHeavy'` only extends the upper travel a bit further
    // (Y_END=640 vs 560) - both modes still spawn from the bottom.
    const Y_START = -560;
    const Y_END   = densityCurve === 'topHeavy' ? 640 : 560;

    // Violet (#9945FF) and teal (#14F195) - Theme.accent.violet/teal.
    const tints: [number, number, number][] = [
        [153,  69, 255],  // violet
        [ 20, 241, 149],  // teal
    ];

    for (let i = 0; i < count; i++) {
        // Capture loop-local randoms outside the closure so each particle's
        // visual params stay deterministic regardless of when the queue pumps.
        const tint = tints[i % tints.length];
        const radius = 3 + Math.random() * 3;             // 3-6 px
        const periodSec = 6 + Math.random() * 4;          // 6-10s
        const delaySec  = (i / count) * periodSec * 0.8;  // staggered start
        const xJitter   = (Math.random() - 0.5) * 380;    // ±190 px
        const startY    = Y_START + Math.random() * 200;
        const peakAlpha = 80 + Math.round(Math.random() * 100);  // 80-180
        const driftEndX = xJitter + (Math.random() - 0.5) * 60;
        const particleIndex = i;

        enqueuePostDraw(() => {
            if (!parent.isValid) return;
            const p = new Node(`LandingParticle_${particleIndex}`);
            parent.addChild(p);
            const ut = p.addComponent(UITransform);
            ut.setContentSize(12, 12);
            const g = p.addComponent(Graphics);
            g.fillColor = new Color(tint[0], tint[1], tint[2], 255);
            g.circle(0, 0, radius);
            g.fill();
            const op = p.addComponent(UIOpacity);
            op.opacity = 0;  // start hidden until first tween cycle ramps it in
            p.setPosition(xJitter, startY, 0);

            // Position drift: linear easing, side-to-side sway via x jitter.
            tween(p)
                .delay(delaySec)
                .to(periodSec, { position: new Vec3(driftEndX, Y_END, 0) }, { easing: 'linear' })
                .call(() => {
                    const newX = (Math.random() - 0.5) * 380;
                    p.setPosition(newX, Y_START, 0);
                })
                .union()
                .repeatForever()
                .start();

            // Opacity envelope: ramp in 20%, hold 60%, fade out 20%.
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
        });
    }

    console.log(`${TAG} addParticleDrift | parent=${parent.name} count=${count} (queued)`);
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
 * 2026-04-28 home UX polish - portal-style micro-transition for hero CTA
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
 * already visible - the scale tween will run again, which still reads
 * as a small "re-affirmation" flash.
 */
export function panelEnterFlourish(panelRoot: Node | null, accentColor: Color): void {
    if (!panelRoot) return;

    // Step 1 - panel scale + opacity entrance.
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

    // Step 2 - one-shot radial glow burst at panel center. Uses Graphics
    // (filled circle) rather than Sprite to avoid needing a SpriteFrame
    // UUID - same pattern as addParticleDrift's drifting dots.
    // Routed through the budgeted post-draw queue (UIModelProxy SIGSEGV at
    // 0x28). See safeGraphics.enqueuePostDraw.
    enqueuePostDraw(() => {
        if (!panelRoot.isValid) return;
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
    });
}

/**
 * 2026-04-29 landing UX - replace a hard-edged white-square Sprite halo with a
 * Graphics-drawn radial. Cocos Sprite has no soft-edge primitive, so the
 * "halo" sprites in the scene render as literal rectangles; on the Landing
 * panel (where nothing covers them) the artifact is glaringly visible.
 *
 * We strip the Sprite component and draw `rings` concentric filled circles
 * with quadratic alpha falloff (bright center → transparent edge), faking
 * a smooth radial gradient. The node's existing UIOpacity is preserved so
 * `addGlowPulse` continues to breathe the alpha.
 *
 * Idempotent per-node. No-op if `node` is null.
 */
export function installSoftGlow(node: Node | null, opts: { color: Color; peakAlpha?: number; rings?: number; force?: boolean }): void {
    if (!node) return;
    if (softGlowSet.has(node)) {
        if (!opts.force) return;
        // Re-color path: clear cached entry + destroy the existing Graphics so
        // the redraw below uses the new color.
        softGlowSet.delete(node);
        const existing = node.getComponent(Graphics);
        if (existing) existing.destroy();
    }
    softGlowSet.add(node);

    const peakAlpha = opts.peakAlpha ?? 130;
    const rings     = opts.rings ?? 14;

    // 2026-04-29 - defer Graphics allocation past the first DRAW via the
    // budgeted post-draw queue. Engine SIGSEGVs at 0x28 in
    // js_cc_UIModelProxy_activeSubModels when too many addComponent(Graphics)
    // land in a single AFTER_DRAW tick (empirical ceiling ~20).
    enqueuePostDraw(() => {
        if (!node.isValid) return;
    // Strip the rectangular Sprite frame - that's the artifact source.
    const oldSprite = node.getComponent(Sprite);
    if (oldSprite) oldSprite.destroy();

    const ut = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const maxR = Math.min(ut.contentSize.width, ut.contentSize.height) / 2;

    const g = node.addComponent(Graphics);
    // Outermost-first so inner (brighter) rings paint over outer (dimmer) ones.
    for (let i = 0; i < rings; i++) {
        const t = (i + 1) / rings;          // 1/N → 1
        const r = maxR * (1 - i / rings);   // descending radius
        const alpha = Math.round(peakAlpha * t * t); // quadratic falloff
        g.fillColor = new Color(opts.color.r, opts.color.g, opts.color.b, alpha);
        g.circle(0, 0, r);
        g.fill();
    }

    // Preserve / install UIOpacity so addGlowPulse can animate the breathing.
    if (!node.getComponent(UIOpacity)) node.addComponent(UIOpacity);

        console.log(`${TAG} installSoftGlow | ${node.name} peak=${peakAlpha} rings=${rings} maxR=${maxR}`);
    });
}

/**
 * 2026-04-29 landing UX - soft drop-shadow ellipse for under the mascot.
 * Same idea as installSoftGlow but draws scaled circles to fake an ellipse
 * (Cocos Graphics has g.ellipse, but stacking multiple filled ellipses with
 * fading alpha gives the cleanest soft edge).
 *
 * Idempotent per-node. No-op if `node` is null.
 */
export function installSoftEllipse(node: Node | null, opts: { color: Color; peakAlpha?: number; rings?: number }): void {
    if (!node || softEllipseSet.has(node)) return;
    softEllipseSet.add(node);

    const peakAlpha = opts.peakAlpha ?? 80;
    const rings     = opts.rings ?? 8;

    // 2026-04-29 - defer Graphics allocation via the budgeted post-draw queue
    // (UIModelProxy SIGSEGV at 0x28). See safeGraphics.enqueuePostDraw.
    enqueuePostDraw(() => {
        if (!node.isValid) return;
    const oldSprite = node.getComponent(Sprite);
    if (oldSprite) oldSprite.destroy();

    const ut = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const maxW = ut.contentSize.width  / 2;
    const maxH = ut.contentSize.height / 2;

    const g = node.addComponent(Graphics);
    for (let i = 0; i < rings; i++) {
        const t = (i + 1) / rings;
        const w = maxW * (1 - i / rings);
        const h = maxH * (1 - i / rings);
        const alpha = Math.round(peakAlpha * t * t);
        g.fillColor = new Color(opts.color.r, opts.color.g, opts.color.b, alpha);
        g.ellipse(0, 0, w, h);
        g.fill();
    }

    if (!node.getComponent(UIOpacity)) node.addComponent(UIOpacity);

        console.log(`${TAG} installSoftEllipse | ${node.name} peak=${peakAlpha} rings=${rings}`);
    });
}

/**
 * 2026-04-29 landing UX - landing-only edge vignette overlay. Adds a
 * `LandingVignetteOverlay` child Node above the bg gradient stack but
 * below content (sibling index 6 - directly after the 6 BgGradient*
 * sprites). Subtle corner darken to focus the eye on center hero,
 * unify color tone, and hide the seams between gradient bands.
 *
 * Drawn as concentric translucent rings stroked from the panel edges
 * toward center - outer rings darker, inner rings transparent. Same
 * Graphics primitives as installSoftGlow, just inverted (dark, edge-out).
 *
 * Idempotent per-panel. No-op if `panel` is null.
 */
export function installLandingVignette(panel: Node | null): void {
    if (!panel || vignetteSet.has(panel)) return;
    if (panel.getChildByName('LandingVignetteOverlay')) {
        vignetteSet.add(panel);
        return;
    }
    vignetteSet.add(panel);

    // 2026-04-29 - defer Node + Graphics allocation via the budgeted post-draw
    // queue (UIModelProxy SIGSEGV at 0x28). See safeGraphics.enqueuePostDraw.
    enqueuePostDraw(() => {
        if (!panel.isValid) return;
    const panelUT = panel.getComponent(UITransform);
    const w = panelUT?.contentSize.width  ?? 720;
    const h = panelUT?.contentSize.height ?? 1280;

    const overlay = new Node('LandingVignetteOverlay');
    panel.addChild(overlay);
    const ut = overlay.addComponent(UITransform);
    ut.setContentSize(w, h);
    overlay.setPosition(0, 0, 0);

    const g = overlay.addComponent(Graphics);

    // Stroked rings from outer (dark) to inner (clear). lineWidth large
    // so the bands overlap and read as a smooth radial darken. Centered
    // on (0,0); panel anchor is mid-mid in this scene.
    const rings = 6;
    const maxR  = Math.max(w, h) * 0.62; // reach past the corners
    for (let i = 0; i < rings; i++) {
        const t = i / (rings - 1);                 // 0 → 1 (outer → inner)
        const r = maxR - (maxR * 0.45) * t;
        const alpha = Math.round(38 * (1 - t));    // 38 → 0
        g.lineWidth   = 110;
        g.strokeColor = new Color(0, 0, 0, alpha);
        g.circle(0, 0, r);
        g.stroke();
    }

    // After bg gradients (index 0-5), before TitleGlow.
    overlay.setSiblingIndex(6);

        console.log(`${TAG} installLandingVignette | ${panel.name} size=${w}x${h}`);
    });
}

