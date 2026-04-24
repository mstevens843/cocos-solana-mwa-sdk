/**
 * MascotController.ts — procedural Token Duel mascot.
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
 *   idle      — slow vertical bob + occasional wand twirl every ~6s
 *   celebrate — jump + 360° spin + sparkle burst (auto-returns to idle)
 *   think     — head tilt + question-mark overlay (held)
 *   lose      — slumped pose, dimmer tint (auto-returns to idle after 1.5s)
 *
 * Performance: Graphics is drawn once on attach; ALL animation is transform
 * tweens (position, scale, angle) so per-frame redraw cost is zero.
 */

import {
    Component,
    Graphics,
    Node,
    Sprite,
    SpriteFrame,
    Tween,
    UIOpacity,
    UITransform,
    Vec3,
    _decorator,
    tween,
} from 'cc';
import { Palette, colorFromHex, Motion } from './Theme';

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
    private _spriteSheet: SpriteFrame[] | null = null;

    onLoad(): void {
        this._buildMascot();
        this.setState('idle');
    }

    onDestroy(): void {
        this._stopAll();
    }

    update(dt: number): void {
        if (this._state !== 'idle' || this._useSpriteSheet) return;
        this._idleTimer += dt;
        this._idleWandCooldown -= dt;
        if (this._idleWandCooldown <= 0) {
            this._twirl(this._wandNode!, 1, 0.8);
            this._idleWandCooldown = 5 + Math.random() * 4;
        }
    }

    /** Switch state. Auto-returns to idle for celebrate/lose after their loop. */
    setState(s: MascotState): void {
        if (this._state === s) return;
        this._state = s;
        this._stopAll();
        console.log(`${TAG} setState | state=${s}`);
        switch (s) {
            case 'idle':      this._playIdle(); break;
            case 'celebrate': this._playCelebrate(); break;
            case 'think':     this._playThink(); break;
            case 'lose':      this._playLose(); break;
        }
    }

    /** Phase 3 swap: register a frame sequence to drive the body.
     *
     * For a static PNG, pass `[singleFrame]` — tween-driven idle/celebrate/
     * think/lose motion still works since it operates on node transform,
     * not frame-by-frame. For animated sprite sheets, pass `frames[]` and
     * a future impl will cycle them per state.
     */
    setSpriteSheet(frames: SpriteFrame[]): void {
        this._spriteSheet = frames;
        this._useSpriteSheet = frames.length > 0;
        console.log(`${TAG} setSpriteSheet | frames=${frames.length} → procedural=${!this._useSpriteSheet}`);
        if (this._useSpriteSheet) {
            // Hide all procedural children — the PNG replaces them.
            if (this._bodyNode) this._bodyNode.active = false;
            if (this._wandNode) this._wandNode.active = false;
            if (this._eyeL) this._eyeL.active = false;
            if (this._eyeR) this._eyeR.active = false;
            // Sparkle pool stays active — celebrate animation still uses it.
            // Attach the sprite to the root container. Mascot motion (bob,
            // spin, tilt, slump) happens on `this.node` transform, so the
            // sprite inherits all tweens automatically.
            const spr = this.node.getComponent(Sprite) ?? this.node.addComponent(Sprite);
            spr.spriteFrame = frames[0];
            spr.sizeMode = Sprite.SizeMode.CUSTOM;
        }
    }

    /* ── Build procedural mascot ──────────────────────────────────────── */

    private _buildMascot(): void {
        const root = this.node;
        const ut = root.getComponent(UITransform) ?? root.addComponent(UITransform);
        ut.contentSize.set(180, 220);

        this._bodyNode = this._mkChild('MascotBody', new Vec3(0, 0, 0));
        this._wandNode = this._mkChild('MascotWand', new Vec3(60, 30, 0));
        this._eyeL    = this._mkChild('MascotEyeL', new Vec3(-20, 30, 0));
        this._eyeR    = this._mkChild('MascotEyeR', new Vec3(20, 30, 0));

        this._drawBody(this._bodyNode);
        this._drawWand(this._wandNode);
        this._drawEye(this._eyeL);
        this._drawEye(this._eyeR);

        // Sparkle pool (8 nodes for celebrate burst, hidden by default).
        for (let i = 0; i < 8; i++) {
            const s = this._mkChild(`MascotSparkle_${i}`, new Vec3(0, 0, 0));
            this._drawSparkle(s);
            s.active = false;
            this._sparkleNodes.push(s);
        }
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
        const g = n.addComponent(Graphics);
        const violet = colorFromHex(Palette.accent.violet);
        const teal   = colorFromHex(Palette.accent.teal);
        // Body — rounded square (head)
        g.fillColor = violet;
        g.roundRect(-50, -50, 100, 100, 26);
        g.fill();
        // Cheek glow
        g.fillColor = colorFromHex(Palette.accent.violetDim);
        g.circle(-25, -10, 8); g.fill();
        g.circle(25, -10, 8); g.fill();
        // Mouth — small smile arc
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
        const g = n.addComponent(Graphics);
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
        const g = n.addComponent(Graphics);
        g.fillColor = colorFromHex(Palette.bg.primary);
        g.circle(0, 0, 8); g.fill();
        g.fillColor = colorFromHex(Palette.text.hi);
        g.circle(2, 2, 3); g.fill();
    }

    private _drawSparkle(n: Node): void {
        const g = n.addComponent(Graphics);
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
        // Jump + spin
        tween(body)
            .to(0.20, { position: new Vec3(body.position.x, baseY + 60, body.position.z), angle: 180 }, { easing: 'cubicOut' })
            .to(0.30, { position: new Vec3(body.position.x, baseY, body.position.z), angle: 360 }, { easing: 'cubicIn' })
            .call(() => { body.angle = 0; this.setState('idle'); })
            .start();
        // Sparkle burst — 8 nodes outward
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
        // Head tilt left ↔ right, slow
        tween(body)
            .to(0.6, { angle: -10 }, { easing: 'sineInOut' })
            .to(0.6, { angle: 10 }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    private _playLose(): void {
        const body = this.node;
        const baseY = body.position.y;
        // Slump down, slight tilt
        tween(body)
            .to(0.30, { position: new Vec3(body.position.x, baseY - 12, body.position.z), angle: -8 }, { easing: 'cubicOut' })
            .delay(1.2)
            .call(() => { this.setState('idle'); })
            .start();
    }

    private _twirl(n: Node, turns: number, dur: number): void {
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
