/**
 * MascotController.ts - procedural Token Duel mascot.
 *
 * Phase 2: builds a vector mascot (body + eyes + wand + sparkles) entirely
 *          from cc.Graphics + cc.tween. Lives on a MascotContainer node
 *          parented under HomePanel.
 *
 * Phase 3: drop a sprite-sheet via setSpriteSheet() and the procedural draw
 *          is hidden in favor of cc.Animation playback. Call sites (setState)
 *          do not change.
 *
 * State machine:
 *   idle      - slow vertical bob + occasional wand twirl every ~6s
 *   celebrate - jump + 360° spin + sparkle burst (auto-returns to idle)
 *   think     - head tilt + question-mark overlay (held)
 *   lose      - slumped pose, dimmer tint (auto-returns to idle after 1.5s)
 *
 * Performance: Graphics is drawn once on attach; ALL animation is transform
 * tweens (position, scale, angle) so per-frame redraw cost is zero.
 */

import {
    Component,
    Director,
    Graphics,
    Node,
    Sprite,
    SpriteFrame,
    Tween,
    UIOpacity,
    UITransform,
    Vec3,
    _decorator,
    director,
    tween,
} from 'cc';
import { Palette, colorFromHex, Motion } from './Theme';
import { enqueuePostDraw } from './safeGraphics';

const { ccclass } = _decorator;
const TAG = '[Mascot]';

export type MascotState = 'idle' | 'celebrate' | 'think' | 'lose';

@ccclass('MascotController')
export class MascotController extends Component {
    private _state: MascotState = 'idle';
    private _bodyNode: Node | null = null;
    private _wandNode: Node | null = null;
    private _eyeL: Node | null = null;
    private _eyeR: Node | null = null;
    private _sparkleNodes: Node[] = [];
    private _idleTimer = 0;
    private _idleWandCooldown = 0;
    private _useSpriteSheet = false;
    private _framesByState: Partial<Record<MascotState, SpriteFrame[]>> = {};
    private _currentFrame = 0;
    private _frameAccumulator = 0;
    // Per-state playback fps. Loops run at 12 to halve asset footprint;
    // one-shots run at 24 for full motion fidelity.
    private _stateFps: Record<MascotState, number> = {
        idle: 12,
        celebrate: 24,
        think: 12,
        lose: 24,
    };

    onLoad(): void {
        console.log(`${TAG} onLoad | ENTRY node=${this.node?.name ?? '?'} - deferring _buildMascot to AFTER_DRAW`);
        // FIX: defer runtime Node + Graphics creation off the first-frame draw
        // walk. If we addComponent(Graphics) on dynamically-created Nodes inside
        // onLoad, the engine's render-entity (UIModelProxy._renderDrawInfos)
        // may not be fully initialized when the first DRAW phase walks the
        // scene. Crash signature: SIGSEGV at offset 0x28 in
        // std::vector<RenderDrawInfo*>::size() called from
        // js_cc_UIModelProxy_activeSubModels (jsb_2d_auto.cpp:2923).
        //
        // 2026-04-29 - `scheduleOnce(0)` was NOT enough. It fires in the next
        // tick's UPDATE phase, before that tick's DRAW; the engine still walked
        // the half-attached render entities and SIGSEGV'd. `director.once(
        // EVENT_AFTER_DRAW)` fires at the end of the just-completed draw walk,
        // when the entity tree is stable. Same pattern that fixed LandingFX.
        director.once(Director.EVENT_AFTER_DRAW, () => {
            if (!this.node?.isValid) return;
            console.log(`${TAG} onLoad | DEFERRED_BUILD start`);
            this._buildMascot();
            console.log(`${TAG} onLoad | AFTER_buildMascot body=${!!this._bodyNode} wand=${!!this._wandNode} eyeL=${!!this._eyeL} eyeR=${!!this._eyeR}`);
            // Do NOT call setState('idle') here. _state is already 'idle' from
            // field init, and panels that start inactive (PostMatchPanel,
            // RacePanel) hold this defer paused until they activate - by then
            // AppUI may have already set the outcome state on the same frame,
            // and a deferred reset to 'idle' on the next tick would clobber it
            // (the bug that pinned the Game Results mascot to idle).
            console.log(`${TAG} onLoad | DEFERRED_BUILD done`);
        });
    }

    onDestroy(): void {
        this._stopAll();
    }

    update(dt: number): void {
        // 2026-05-01 - wrap entire body so a single throw (e.g. assigning
        // spriteFrame on a destroyed Sprite, or _twirl on a stale wand node)
        // can't escalate to a 60 fps JSB error storm that starves input
        // dispatch. AppUI keys the post-game-over storm investigation on this
        // exact pattern. Throttle log to 1/sec/state to avoid self-spam.
        try {
            // PROBE: confirm MascotController.update is reached after start.
            const TAG_LOCAL = '[Mascot:update]';
            if (((this as any)._frameNum = (((this as any)._frameNum ?? 0) + 1)) <= 3) {
                console.log(`${TAG_LOCAL} n=${(this as any)._frameNum} state=${this._state} useSheet=${this._useSpriteSheet}`);
            }
            if (this._useSpriteSheet) {
                this._cycleFrames(dt);
                return;
            }
            if (this._state !== 'idle') return;
            // The deferred _buildMascot (scheduleOnce in onLoad) hasn't fired on
            // tick 1 yet, so the body/wand refs are still null. Bail until built -
            // otherwise _twirl reads `null.angle` and throws every frame.
            if (!this._wandNode || !this._wandNode.isValid) return;
            this._idleTimer += dt;
            this._idleWandCooldown -= dt;
            if (this._idleWandCooldown <= 0) {
                this._twirl(this._wandNode, 1, 0.8);
                this._idleWandCooldown = 5 + Math.random() * 4;
            }
        } catch (e: any) {
            const now = Date.now();
            const last = (this as any)._lastUpdateErrAt ?? 0;
            if (now - last >= 1000) {
                (this as any)._lastUpdateErrAt = now;
                const stack = (e?.stack ?? '').split('\n').slice(0, 3).join(' | ');
                console.log(`[TickErr] name=mascot state=${this._state} msg=${e?.message ?? e} stack=${stack}`);
            }
        }
    }

    private _cycleFrames(dt: number): void {
        const frames = this._framesByState[this._state];
        if (!frames || frames.length === 0) return;
        const fps = this._stateFps[this._state];
        const interval = 1 / fps;
        this._frameAccumulator += dt;
        while (this._frameAccumulator >= interval) {
            this._frameAccumulator -= interval;
            this._currentFrame++;
            const isLoop = this._state === 'idle' || this._state === 'think';
            if (this._currentFrame >= frames.length) {
                this._currentFrame = isLoop ? 0 : frames.length - 1;
            }
        }
        // Defensive null-guard - a partial import (some PNGs missing .meta) can
        // leave undefined slots in the array; assigning null to spriteFrame is a
        // SIGSEGV in libcocos.so at offset 0x28. Skip the slot if missing.
        const next = frames[this._currentFrame];
        if (!next) return;
        const spr = this.node.getComponent(Sprite);
        if (spr && spr.spriteFrame !== next) {
            const tex: any = (next as any).texture;
            console.log(`${TAG} _cycleFrames | ASSIGN state=${this._state} idx=${this._currentFrame}/${frames.length} hasTex=${!!tex} texW=${tex?.width ?? -1} texH=${tex?.height ?? -1} name=${next.name}`);
            spr.spriteFrame = next;
        }
    }

    /** Switch state. Auto-returns to idle for celebrate/lose after their loop.
     *  `force=true` re-triggers the animation even when already in state `s`
     *  (used by PostMatch on consecutive identical outcomes - second 'lose'
     *  must replay the slump from frame 0 instead of staying clamped at the
     *  end of the previous one-shot). */
    setState(s: MascotState, force = false): void {
        if (!force && this._state === s) return;
        this._state = s;
        this._currentFrame = 0;
        this._frameAccumulator = 0;
        this._stopAll();
        console.log(`${TAG} setState | state=${s}`);
        if (this._useSpriteSheet) {
            const spr = this.node.getComponent(Sprite);
            const frames = this._framesByState[s];
            if (spr && frames && frames.length > 0) spr.spriteFrame = frames[0];
        }
        switch (s) {
            case 'idle':      this._playIdle(); break;
            case 'celebrate': this._playCelebrate(); break;
            case 'think':     this._playThink(); break;
            case 'lose':      this._playLose(); break;
        }
    }

    /** Phase 3 swap: register per-state frame sequences to drive the body.
     *
     * Pass `{ idle: [f1, f2, ...], celebrate: [...], ... }` - each state's
     * frames are cycled at its configured fps (see `_stateFps`). Loops
     * (idle, think) wrap; one-shots (celebrate, lose) clamp to last frame.
     *
     * Backwards-compat: if any state has just `[singleFrame]`, that frame
     * is shown statically. Procedural body/eyes/wand are hidden whenever
     * any state has frames; transform tweens (bob/spin/tilt/slump) still
     * compose on top of the per-frame sprite swap.
     */
    /** 2026-05-02 attempt 9 rev 2 - expose the loaded sprite sheet so a
     *  fresh MascotController instance (e.g. PostMatchPanelV2's mascot) can
     *  re-use the same animated frames without reloading from disk. */
    getFramesByState(): Partial<Record<MascotState, SpriteFrame[]>> {
        return this._framesByState;
    }

    setSpriteSheet(framesByState: Partial<Record<MascotState, SpriteFrame[]>>): void {
        console.log(`${TAG} setSpriteSheet | ENTRY node=${this.node?.name ?? '?'}`);
        // Filter null/undefined entries AND any frame missing a backing texture -
        // the latter is the libcocos.so SIGSEGV at offset 0x28 vector.
        const cleaned: Partial<Record<MascotState, SpriteFrame[]>> = {};
        let droppedNulls = 0;
        let droppedNoTex = 0;
        for (const state of Object.keys(framesByState) as MascotState[]) {
            const arr = framesByState[state];
            if (!arr) continue;
            const valid: SpriteFrame[] = [];
            for (const f of arr) {
                if (!f) { droppedNulls++; continue; }
                if (!(f as any).texture) { droppedNoTex++; continue; }
                valid.push(f);
            }
            if (valid.length > 0) cleaned[state] = valid;
        }
        if (droppedNulls > 0 || droppedNoTex > 0) {
            console.log(`${TAG} setSpriteSheet | DROPPED null=${droppedNulls} no_tex=${droppedNoTex}`);
        }
        this._framesByState = cleaned;
        const totalFrames = Object.values(cleaned).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);
        this._useSpriteSheet = totalFrames > 0;
        framesByState = cleaned;
        console.log(`${TAG} setSpriteSheet | clean total=${totalFrames}`);
        const counts = (['idle', 'celebrate', 'think', 'lose'] as MascotState[])
            .map(s => `${s}=${framesByState[s]?.length ?? 0}`).join(' ');
        console.log(`${TAG} setSpriteSheet | ${counts} total=${totalFrames}`);
        if (this._useSpriteSheet) {
            if (this._bodyNode) this._bodyNode.active = false;
            if (this._wandNode) this._wandNode.active = false;
            if (this._eyeL) this._eyeL.active = false;
            if (this._eyeR) this._eyeR.active = false;
            const spr = this.node.getComponent(Sprite) ?? this.node.addComponent(Sprite);
            spr.sizeMode = Sprite.SizeMode.CUSTOM;
            const initial = framesByState[this._state]?.[0]
                ?? framesByState.idle?.[0]
                ?? Object.values(framesByState).find(arr => arr && arr.length > 0)?.[0];
            if (initial) spr.spriteFrame = initial;
            this._currentFrame = 0;
            this._frameAccumulator = 0;
        }
    }

    /* ── Build procedural mascot ──────────────────────────────────────── */

    private _buildMascot(): void {
        const root = this.node;
        const ut = root.getComponent(UITransform) ?? root.addComponent(UITransform);
        ut.contentSize.set(180, 220);

        // FIX 10C - each work unit creates Node + UITransform + Graphics
        // ATOMICALLY in the same enqueuePostDraw tick. Previously Fix 10B
        // split Node creation (synchronous) from Graphics attachment (queued
        // for later ticks), leaving 12 bare Node+UITransform children in the
        // tree at end of tick 1 AFTER_DRAW. Tick 2 DRAW walked the tree, hit
        // a half-initialised render entity, dereferenced offset 0x28 in
        // js_cc_UIModelProxy_activeSubModels → SIGSEGV. The atomic pattern
        // matches Fix 10A's working behaviour (Node+Graphics together) while
        // still respecting the queue's PER_TICK_BUDGET so the total tick-1
        // load stays well under the engine's ~20-entity ceiling.
        enqueuePostDraw(() => {
            if (!root.isValid) return;
            this._bodyNode = this._mkChild('MascotBody', new Vec3(0, 0, 0));
            this._drawBody(this._bodyNode);
            this._bodyNode.active = false;
        });
        enqueuePostDraw(() => {
            if (!root.isValid) return;
            this._wandNode = this._mkChild('MascotWand', new Vec3(60, 30, 0));
            this._drawWand(this._wandNode);
            this._wandNode.active = false;
        });
        enqueuePostDraw(() => {
            if (!root.isValid) return;
            this._eyeL = this._mkChild('MascotEyeL', new Vec3(-20, 30, 0));
            this._drawEye(this._eyeL);
            this._eyeL.active = false;
        });
        enqueuePostDraw(() => {
            if (!root.isValid) return;
            this._eyeR = this._mkChild('MascotEyeR', new Vec3(20, 30, 0));
            this._drawEye(this._eyeR);
            this._eyeR.active = false;
        });

        // Sparkle pool (8 nodes for celebrate burst, hidden by default).
        for (let i = 0; i < 8; i++) {
            const idx = i;
            enqueuePostDraw(() => {
                if (!root.isValid) return;
                const s = this._mkChild(`MascotSparkle_${idx}`, new Vec3(0, 0, 0));
                this._drawSparkle(s);
                s.active = false;
                this._sparkleNodes.push(s);
            });
        }
    }

    /**
     * Activate the procedural body/wand/eyes. Called only as a fallback when
     * Seedance frame loading fails (or the frames/ folder is empty). No-op if
     * the sprite-sheet path is already engaged.
     */
    showProceduralFallback(): void {
        if (this._useSpriteSheet) return;
        if (this._bodyNode) this._bodyNode.active = true;
        if (this._wandNode) this._wandNode.active = true;
        if (this._eyeL) this._eyeL.active = true;
        if (this._eyeR) this._eyeR.active = true;
        console.log(`${TAG} showProceduralFallback | activating procedural body`);
        // Re-run the current state's tween player so animations restart on the
        // newly-visible body.
        const s = this._state;
        this._state = ('__force__' as any);
        this.setState(s);
    }

    private _mkChild(name: string, pos: Vec3): Node {
        const n = new Node(name);
        n.parent = this.node;
        n.setPosition(pos);
        const ut = n.addComponent(UITransform);
        ut.contentSize.set(60, 60);
        return n;
    }

    private _drawBody(n: Node): void {
        const g = n.addComponent(Graphics); // safe: called from enqueuePostDraw queue work unit (one Graphics per tick budget slot)
        const violet = colorFromHex(Palette.accent.violet);
        const teal   = colorFromHex(Palette.accent.teal);
        // Body - rounded square (head)
        g.fillColor = violet;
        g.roundRect(-50, -50, 100, 100, 26);
        g.fill();
        // Cheek glow
        g.fillColor = colorFromHex(Palette.accent.violetDim);
        g.circle(-25, -10, 8); g.fill();
        g.circle(25, -10, 8); g.fill();
        // Mouth - small smile arc
        g.strokeColor = teal;
        g.lineWidth = 4;
        g.moveTo(-12, -22); g.lineTo(0, -28); g.lineTo(12, -22);
        g.stroke();
        // Top antenna with bulb
        g.strokeColor = violet;
        g.lineWidth = 4;
        g.moveTo(0, 50); g.lineTo(0, 68);
        g.stroke();
        g.fillColor = teal;
        g.circle(0, 74, 8); g.fill();
    }

    private _drawWand(n: Node): void {
        const g = n.addComponent(Graphics); // safe: called from enqueuePostDraw queue work unit (one Graphics per tick budget slot)
        g.fillColor = colorFromHex(Palette.text.hi);
        // Stick (rotated rect)
        g.moveTo(-26, 6); g.lineTo(-20, 12); g.lineTo(20, -28); g.lineTo(14, -34); g.close();
        g.fill();
        // Star tip
        g.fillColor = colorFromHex(Palette.rank.gold);
        const pts = nStar(20, 20, 5, 14, 6, -90);
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.close();
        g.fill();
    }

    private _drawEye(n: Node): void {
        const g = n.addComponent(Graphics); // safe: called from enqueuePostDraw queue work unit (one Graphics per tick budget slot)
        g.fillColor = colorFromHex(Palette.bg.primary);
        g.circle(0, 0, 8); g.fill();
        g.fillColor = colorFromHex(Palette.text.hi);
        g.circle(2, 2, 3); g.fill();
    }

    private _drawSparkle(n: Node): void {
        const g = n.addComponent(Graphics); // safe: called from enqueuePostDraw queue work unit (one Graphics per tick budget slot)
        g.fillColor = colorFromHex(Palette.accent.amber);
        const pts = nStar(0, 0, 4, 12, 3, -90);
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.close();
        g.fill();
    }

    /* ── State players ────────────────────────────────────────────────── */

    private _playIdle(): void {
        const body = this.node;
        body.angle = 0;
        body.setScale(1, 1, 1);
        body.setPosition(body.position.x, body.position.y, body.position.z);
        // Bob loop
        const baseY = body.position.y;
        tween(body)
            .to(1.2, { position: new Vec3(body.position.x, baseY + 8, body.position.z) }, { easing: 'sineInOut' })
            .to(1.2, { position: new Vec3(body.position.x, baseY, body.position.z) }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    private _playCelebrate(): void {
        const body = this.node;
        const baseY = body.position.y;
        const baseX = body.position.x;
        const baseZ = body.position.z;
        // Jump + spin. Bigger amplitude (60→90) so the bounce reads on the
        // PostMatch screen even at a glance. Looped float keeps motion alive
        // after the initial spin lands; auto-return to idle only when running
        // the procedural body - the Seedance celebrate sequence is ~4s long
        // and clamps to its last frame.
        tween(body)
            .to(0.20, { position: new Vec3(baseX, baseY + 90, baseZ), angle: 180 }, { easing: 'cubicOut' })
            .to(0.30, { position: new Vec3(baseX, baseY,      baseZ), angle: 360 }, { easing: 'cubicIn' })
            .call(() => {
                body.angle = 0;
                if (this._useSpriteSheet) {
                    // Continue with a gentle upward float so the win mascot
                    // stays visibly alive instead of freezing on the last frame.
                    tween(body)
                        .to(0.9, { position: new Vec3(baseX, baseY + 14, baseZ) }, { easing: 'sineInOut' })
                        .to(0.9, { position: new Vec3(baseX, baseY,      baseZ) }, { easing: 'sineInOut' })
                        .union()
                        .repeatForever()
                        .start();
                } else {
                    this.setState('idle');
                }
            })
            .start();
        // Sparkle burst - 8 nodes outward
        const cx = 0, cy = 0;
        this._sparkleNodes.forEach((s, i) => {
            s.active = true;
            s.setPosition(cx, cy, 0);
            s.setScale(0.2, 0.2, 1);
            const op = s.getComponent(UIOpacity) ?? s.addComponent(UIOpacity);
            op.opacity = 255;
            const angle = (i / this._sparkleNodes.length) * Math.PI * 2;
            const rx = Math.cos(angle) * 110;
            const ry = Math.sin(angle) * 110;
            tween(s)
                .to(0.50, { position: new Vec3(rx, ry, 0), scale: new Vec3(1.2, 1.2, 1) }, { easing: 'cubicOut' })
                .start();
            tween(op)
                .delay(0.30)
                .to(0.30, { opacity: 0 })
                .call(() => { s.active = false; })
                .start();
        });
    }

    private _playThink(): void {
        const body = this.node;
        const baseX = body.position.x;
        const baseY = body.position.y;
        const baseZ = body.position.z;
        // Head tilt left ↔ right + small vertical bob, slow. Tilt amplitude
        // bumped 10°→14° so the "thinking" pose reads at-a-glance on PostMatch.
        tween(body)
            .to(0.6, { angle: -14, position: new Vec3(baseX, baseY + 6, baseZ) }, { easing: 'sineInOut' })
            .to(0.6, { angle:  14, position: new Vec3(baseX, baseY - 6, baseZ) }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    private _playLose(): void {
        const body = this.node;
        const baseY = body.position.y;
        const baseX = body.position.x;
        const baseZ = body.position.z;
        // Slumped, looping bounce-down - replaces the one-shot slump so the
        // "deflated" mood reads continuously. Slow rocking tilt cross-loops
        // with the bounce. Auto-return to idle only on procedural body.
        tween(body)
            .to(0.25, { position: new Vec3(baseX, baseY - 14, baseZ), angle: -8 }, { easing: 'cubicOut' })
            .start();
        if (this._useSpriteSheet) {
            this.scheduleOnce(() => {
                tween(body)
                    .to(0.55, { position: new Vec3(baseX, baseY - 8,  baseZ), angle: 2  }, { easing: 'sineInOut' })
                    .to(0.55, { position: new Vec3(baseX, baseY - 16, baseZ), angle: -8 }, { easing: 'sineInOut' })
                    .union()
                    .repeatForever()
                    .start();
            }, 0.30);
        } else {
            tween(body).delay(1.2).call(() => this.setState('idle')).start();
        }
    }

    private _twirl(n: Node | null, turns: number, dur: number): void {
        if (!n || !n.isValid) return;
        const startAngle = n.angle;
        tween(n)
            .by(dur, { angle: -360 * turns }, { easing: 'cubicInOut' })
            .call(() => { n.angle = startAngle; })
            .start();
    }

    private _stopAll(): void {
        Tween.stopAllByTarget(this.node);
        if (this._bodyNode) Tween.stopAllByTarget(this._bodyNode);
        if (this._wandNode) Tween.stopAllByTarget(this._wandNode);
        for (const s of this._sparkleNodes) {
            Tween.stopAllByTarget(s);
            const op = s.getComponent(UIOpacity);
            if (op) Tween.stopAllByTarget(op);
            s.active = false;
        }
    }
}

function nStar(cx: number, cy: number, points: number, rOuter: number, rInner: number, rotateDeg = -90): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const step = Math.PI / points;
    let a = (rotateDeg * Math.PI) / 180;
    for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? rOuter : rInner;
        out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        a += step;
    }
    return out;
}
