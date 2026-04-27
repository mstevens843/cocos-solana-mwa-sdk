/**
 * IconLibrary.ts — code-drawn icon registry for Token Duel UX overhaul.
 *
 * Phase 1: every icon is rendered procedurally via cc.Graphics so we can
 *          ship a polish jump with zero new asset dependencies.
 * Phase 3: drop a PNG into assets/demo/resources/icons/, call
 *          IconLibrary.register(name, spriteFrame) once at boot, and every
 *          subsequent IconLibrary.attach(node, name) attaches a cc.Sprite
 *          instead of drawing. Call sites do not change.
 *
 * Emoji-fallback: if a draw fails (or the user wants to rollback an icon),
 * the registry entry's `fallbackEmoji` is rendered as a cc.Label.
 */

import {
    Color,
    Graphics,
    Label,
    Node,
    Size,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec2,
} from 'cc';
import { Palette, colorFromHex } from './Theme';

const TAG = '[IconLibrary]';

export type IconName =
    | 'medalGold' | 'medalSilver' | 'medalBronze' | 'trophy'
    | 'flame' | 'bolt' | 'sword' | 'coin' | 'chart' | 'brain'
    | 'crown' | 'fire' | 'lightning' | 'target' | 'gem'
    | 'sparkle' | 'star' | 'starOutline' | 'circle' | 'triangle' | 'starBurst'
    | 'clock' | 'check' | 'cross' | 'arrowUp' | 'arrowDown'
    | 'plus' | 'eye' | 'lock' | 'wand' | 'trade'
    // Phase 2b additions — emoji replacements for scene chrome.
    | 'cog' | 'user' | 'book' | 'bulb' | 'robot' | 'trash' | 'save'
    | 'speaker' | 'speakerMuted' | 'vibration' | 'hand' | 'flag' | 'clipboard'
    // Phase N3 — Notification system
    | 'bell'
    // Phase N4 — Disconnect (Home wallet sign-out; Phase 3 PNG = disconnect.png)
    | 'disconnect';

export interface IconAttachOptions {
    /** Logical size in points; defaults to 32. */
    size?: number;
    /** Tint override (hex). Falls back to icon's palette tint if absent. */
    tintHex?: string;
    /** Emoji shown if procedural draw fails. */
    fallbackEmoji?: string;
}

type DrawFn = (g: Graphics, size: number, color: Color) => void;

interface IconDef {
    /** Procedural draw routine (Phase 1 default). */
    draw: DrawFn;
    /** Default tint for this icon, if no override given. */
    tintHex: string;
    /** Last-resort emoji glyph if draw throws. Also the Phase 0 baseline. */
    emoji: string;
    /** Phase 3: PNG SpriteFrame, if registered. When set, attach uses cc.Sprite. */
    sprite?: SpriteFrame;
}

const REG: Record<IconName, IconDef> = {} as Record<IconName, IconDef>;

/* ── Public API ───────────────────────────────────────────────────────── */

export class IconLibrary {
    /**
     * Attach the named icon to `node`. Adds (or reuses) a cc.Graphics or
     * cc.Sprite component. Caller owns positioning + scale via UITransform.
     */
    static attach(node: Node, name: IconName, opts: IconAttachOptions = {}): void {
        const def = REG[name];
        if (!def) {
            console.log(`${TAG} attach | UNKNOWN icon=${name}`);
            attachEmoji(node, opts.fallbackEmoji ?? '•', opts.size ?? 32);
            return;
        }
        const size = opts.size ?? 32;
        ensureUITransform(node, size);

        // Phase 3 path: real PNG registered → use cc.Sprite.
        if (def.sprite) {
            removeAll(node, [Graphics, Label]);
            const spr = node.getComponent(Sprite) ?? node.addComponent(Sprite);
            spr.spriteFrame = def.sprite;
            spr.color = opts.tintHex ? colorFromHex(opts.tintHex) : Color.WHITE;
            (node.getComponent(UITransform) as UITransform).contentSize = new Size(size, size);
            return;
        }

        // Phase 1 path: SKIP runtime-added cc.Graphics. Cocos 3.8.8 native
        // renderer SIGSEGVs at offset 0x28 in UIModelProxy::activeSubModels
        // when a Graphics is added to a Node at runtime and the first DRAW
        // walk hits it before the RenderEntity userData is populated. Phase 3
        // re-calls _attachStaticIconBadges once PNG SpriteFrames are loaded
        // (~100ms after launch); icons render via Sprite path then. Until
        // then, the badge node stays empty (no render component → no crash).
        console.log(`${TAG} attach | NO_PNG_YET icon=${name} — skipping Graphics fallback (Phase 3 will swap to Sprite)`);
    }

    /** Phase 3 hook: register a PNG sprite frame for `name`. */
    static register(name: IconName, frame: SpriteFrame): void {
        const def = REG[name];
        if (!def) {
            console.log(`${TAG} register | UNKNOWN icon=${name}`);
            return;
        }
        def.sprite = frame;
        console.log(`${TAG} register | icon=${name} → PNG`);
    }

    /** For rollback: force the emoji glyph regardless of draw availability. */
    static attachEmoji(node: Node, glyph: string, size = 32): void {
        attachEmoji(node, glyph, size);
    }

    /** Lookup the default emoji glyph (for code paths that still need a string). */
    static glyph(name: IconName): string {
        return REG[name]?.emoji ?? '•';
    }
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function ensureUITransform(node: Node, size: number): void {
    const ut = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    if (ut.width === 0 || ut.height === 0) ut.contentSize = new Size(size, size);
}

function removeAll(node: Node, types: Array<typeof Graphics | typeof Label | typeof Sprite>): void {
    for (const t of types) {
        const c = node.getComponent(t as any);
        if (c) node.removeComponent(c);
    }
}

function attachEmoji(node: Node, glyph: string, size: number): void {
    removeAll(node, [Graphics, Sprite]);
    ensureUITransform(node, size);
    const lbl = node.getComponent(Label) ?? node.addComponent(Label);
    lbl.string = glyph;
    lbl.fontSize = Math.round(size * 0.75);
    lbl.lineHeight = Math.round(size * 0.85);
    lbl.color = colorFromHex(Palette.text.hi);
}

/* ── Draw primitives ──────────────────────────────────────────────────── */

function setFill(g: Graphics, c: Color, lineW = 0): void {
    g.fillColor = c;
    if (lineW > 0) {
        g.strokeColor = c;
        g.lineWidth = lineW;
    }
}

function polygon(g: Graphics, pts: Array<[number, number]>): void {
    if (pts.length === 0) return;
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.close();
}

function nStarPoints(cx: number, cy: number, points: number, rOuter: number, rInner: number, rotateDeg = -90): Array<[number, number]> {
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

/* ── Per-icon draw routines ───────────────────────────────────────────── */

function drawMedal(g: Graphics, size: number, color: Color, ribbon: Color): void {
    const r = size * 0.36;
    // Ribbon (V-shape under medal)
    setFill(g, ribbon);
    polygon(g, [[-size * 0.30, size * 0.30], [-size * 0.10, -size * 0.40], [0, -size * 0.10], [size * 0.10, -size * 0.40], [size * 0.30, size * 0.30], [0, size * 0.05]]);
    g.fill();
    // Medal disc with inner ring
    setFill(g, color);
    g.circle(0, size * 0.05, r);
    g.fill();
    // Inner highlight ring (dimmer)
    const dim = new Color(Math.max(0, color.r - 60), Math.max(0, color.g - 60), Math.max(0, color.b - 60), 255);
    g.strokeColor = dim;
    g.lineWidth = Math.max(2, size * 0.06);
    g.circle(0, size * 0.05, r * 0.62);
    g.stroke();
}

function drawTrophy(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Cup body (rounded rect-ish via two arcs)
    polygon(g, [[-size * 0.32, size * 0.40], [-size * 0.32, -size * 0.05], [-size * 0.20, -size * 0.20], [size * 0.20, -size * 0.20], [size * 0.32, -size * 0.05], [size * 0.32, size * 0.40]]);
    g.fill();
    // Handles
    g.lineWidth = Math.max(3, size * 0.06);
    g.strokeColor = color;
    g.moveTo(-size * 0.32, size * 0.30); g.lineTo(-size * 0.45, size * 0.18); g.lineTo(-size * 0.45, size * 0.05); g.lineTo(-size * 0.32, -size * 0.05);
    g.stroke();
    g.moveTo(size * 0.32, size * 0.30); g.lineTo(size * 0.45, size * 0.18); g.lineTo(size * 0.45, size * 0.05); g.lineTo(size * 0.32, -size * 0.05);
    g.stroke();
    // Base
    setFill(g, color);
    polygon(g, [[-size * 0.18, -size * 0.20], [size * 0.18, -size * 0.20], [size * 0.10, -size * 0.32], [-size * 0.10, -size * 0.32]]);
    g.fill();
    polygon(g, [[-size * 0.30, -size * 0.32], [size * 0.30, -size * 0.32], [size * 0.30, -size * 0.42], [-size * 0.30, -size * 0.42]]);
    g.fill();
}

function drawFlame(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Outer flame outline (single closed bezier-ish silhouette via lineTo)
    g.moveTo(0, size * 0.45);
    g.lineTo(-size * 0.20, size * 0.10);
    g.lineTo(-size * 0.32, -size * 0.05);
    g.lineTo(-size * 0.28, -size * 0.28);
    g.lineTo(-size * 0.10, -size * 0.40);
    g.lineTo(0, -size * 0.46);
    g.lineTo(size * 0.10, -size * 0.40);
    g.lineTo(size * 0.28, -size * 0.28);
    g.lineTo(size * 0.32, -size * 0.05);
    g.lineTo(size * 0.20, size * 0.10);
    g.close();
    g.fill();
    // Inner brighter core
    const bright = new Color(255, Math.min(255, color.g + 80), 80, 255);
    setFill(g, bright);
    g.moveTo(0, size * 0.20);
    g.lineTo(-size * 0.10, -size * 0.05);
    g.lineTo(-size * 0.10, -size * 0.22);
    g.lineTo(0, -size * 0.30);
    g.lineTo(size * 0.10, -size * 0.22);
    g.lineTo(size * 0.10, -size * 0.05);
    g.close();
    g.fill();
}

function drawBolt(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    polygon(g, [[size * 0.10, size * 0.45], [-size * 0.20, size * 0.05], [size * 0.02, size * 0.05], [-size * 0.10, -size * 0.45], [size * 0.20, -size * 0.05], [-size * 0.02, -size * 0.05]]);
    g.fill();
}

function drawSword(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Blade (diagonal)
    polygon(g, [[size * 0.45, size * 0.45], [size * 0.30, size * 0.45], [-size * 0.20, -size * 0.05], [-size * 0.10, -size * 0.15]]);
    g.fill();
    // Crossguard
    polygon(g, [[-size * 0.30, -size * 0.05], [-size * 0.05, -size * 0.30], [-size * 0.20, -size * 0.40], [-size * 0.40, -size * 0.20]]);
    g.fill();
    // Pommel (small circle)
    g.circle(-size * 0.36, -size * 0.30, size * 0.06);
    g.fill();
    // Blade highlight
    const hi = new Color(Math.min(255, color.r + 60), Math.min(255, color.g + 60), Math.min(255, color.b + 60), 200);
    g.strokeColor = hi;
    g.lineWidth = Math.max(1, size * 0.02);
    g.moveTo(size * 0.40, size * 0.40); g.lineTo(-size * 0.15, -size * 0.10);
    g.stroke();
}

function drawCoin(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    g.circle(0, 0, size * 0.42);
    g.fill();
    const dim = new Color(Math.max(0, color.r - 50), Math.max(0, color.g - 50), Math.max(0, color.b - 50), 255);
    g.strokeColor = dim;
    g.lineWidth = Math.max(2, size * 0.05);
    g.circle(0, 0, size * 0.30);
    g.stroke();
    // "S" mark
    setFill(g, dim);
    g.moveTo(-size * 0.10, size * 0.14);
    g.lineTo(size * 0.10, size * 0.14);
    g.lineTo(size * 0.10, size * 0.02);
    g.lineTo(-size * 0.10, size * 0.02);
    g.lineTo(-size * 0.10, -size * 0.14);
    g.lineTo(size * 0.10, -size * 0.14);
    g.lineTo(size * 0.10, -size * 0.06);
    g.stroke();
}

function drawChart(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    const w = size * 0.18;
    const heights = [0.30, 0.50, 0.75];
    for (let i = 0; i < 3; i++) {
        const x = -size * 0.30 + i * size * 0.30;
        const h = size * heights[i];
        polygon(g, [[x - w / 2, -size * 0.40], [x + w / 2, -size * 0.40], [x + w / 2, -size * 0.40 + h], [x - w / 2, -size * 0.40 + h]]);
        g.fill();
    }
}

function drawBrain(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Two overlapping circles for the silhouette
    g.circle(-size * 0.18, 0, size * 0.30);
    g.fill();
    g.circle(size * 0.18, 0, size * 0.30);
    g.fill();
    // Center fold
    const dim = new Color(Math.max(0, color.r - 40), Math.max(0, color.g - 40), Math.max(0, color.b - 40), 255);
    g.strokeColor = dim;
    g.lineWidth = Math.max(2, size * 0.04);
    g.moveTo(0, size * 0.28); g.lineTo(0, -size * 0.28);
    g.stroke();
    // Squiggle grooves
    g.moveTo(-size * 0.30, size * 0.15); g.lineTo(-size * 0.10, size * 0.08); g.lineTo(-size * 0.20, -size * 0.05);
    g.stroke();
    g.moveTo(size * 0.30, size * 0.15); g.lineTo(size * 0.10, size * 0.08); g.lineTo(size * 0.20, -size * 0.05);
    g.stroke();
}

function drawCrown(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    polygon(g, [[-size * 0.40, -size * 0.20], [-size * 0.40, size * 0.10], [-size * 0.25, size * 0.30], [-size * 0.10, size * 0.05], [0, size * 0.40], [size * 0.10, size * 0.05], [size * 0.25, size * 0.30], [size * 0.40, size * 0.10], [size * 0.40, -size * 0.20]]);
    g.fill();
    // Base bar
    polygon(g, [[-size * 0.40, -size * 0.20], [size * 0.40, -size * 0.20], [size * 0.40, -size * 0.32], [-size * 0.40, -size * 0.32]]);
    g.fill();
    // Gem dots
    const gem = new Color(Math.min(255, color.r + 40), 80, 200, 255);
    setFill(g, gem);
    g.circle(-size * 0.25, size * 0.12, size * 0.05); g.fill();
    g.circle(0, size * 0.20, size * 0.06); g.fill();
    g.circle(size * 0.25, size * 0.12, size * 0.05); g.fill();
}

function drawTarget(g: Graphics, size: number, color: Color): void {
    g.strokeColor = color;
    g.lineWidth = Math.max(2, size * 0.06);
    g.circle(0, 0, size * 0.42); g.stroke();
    g.circle(0, 0, size * 0.28); g.stroke();
    setFill(g, color);
    g.circle(0, 0, size * 0.10); g.fill();
}

function drawGem(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    polygon(g, [[0, size * 0.45], [size * 0.40, size * 0.10], [size * 0.20, -size * 0.40], [-size * 0.20, -size * 0.40], [-size * 0.40, size * 0.10]]);
    g.fill();
    // Facet lines
    const hi = new Color(Math.min(255, color.r + 60), Math.min(255, color.g + 60), Math.min(255, color.b + 60), 220);
    g.strokeColor = hi;
    g.lineWidth = Math.max(1, size * 0.02);
    g.moveTo(-size * 0.40, size * 0.10); g.lineTo(0, size * 0.05); g.lineTo(size * 0.40, size * 0.10);
    g.moveTo(-size * 0.20, -size * 0.40); g.lineTo(0, size * 0.05); g.lineTo(size * 0.20, -size * 0.40);
    g.moveTo(0, size * 0.45); g.lineTo(0, size * 0.05);
    g.stroke();
}

function drawSparkle(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    polygon(g, nStarPoints(0, 0, 4, size * 0.45, size * 0.12));
    g.fill();
}

function drawStar(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    polygon(g, nStarPoints(0, 0, 5, size * 0.45, size * 0.20));
    g.fill();
}

function drawCircle(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    g.circle(0, 0, size * 0.42);
    g.fill();
}

function drawTriangle(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    polygon(g, [[0, size * 0.42], [size * 0.40, -size * 0.30], [-size * 0.40, -size * 0.30]]);
    g.fill();
}

function drawStarBurst(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    polygon(g, nStarPoints(0, 0, 8, size * 0.45, size * 0.10));
    g.fill();
}

function drawClock(g: Graphics, size: number, color: Color): void {
    g.strokeColor = color;
    g.lineWidth = Math.max(2, size * 0.06);
    g.circle(0, 0, size * 0.42); g.stroke();
    // Hands at 10:10
    g.moveTo(0, 0); g.lineTo(0, size * 0.30);
    g.moveTo(0, 0); g.lineTo(size * 0.22, size * 0.10);
    g.stroke();
    setFill(g, color);
    g.circle(0, 0, size * 0.05); g.fill();
}

function drawBell(g: Graphics, size: number, color: Color): void {
    // Phase N3 — bell with curved dome + flared lip + clapper.
    const lineW = Math.max(2, size * 0.06);
    g.strokeColor = color;
    g.lineWidth = lineW;
    setFill(g, color, 0.18);
    // Dome — wide arc that flares slightly at the bottom.
    const top = size * 0.34;
    const bottom = -size * 0.18;
    const halfWidth = size * 0.30;
    g.moveTo(-halfWidth, bottom);
    g.lineTo(-halfWidth, bottom + size * 0.08);
    g.bezierCurveTo(
        -halfWidth, top,
        halfWidth, top,
        halfWidth, bottom + size * 0.08,
    );
    g.lineTo(halfWidth, bottom);
    g.close();
    g.fill();
    g.stroke();
    // Lip — short rectangle below the dome.
    g.moveTo(-halfWidth - size * 0.06, bottom);
    g.lineTo(halfWidth + size * 0.06, bottom);
    g.lineTo(halfWidth + size * 0.06, bottom - size * 0.05);
    g.lineTo(-halfWidth - size * 0.06, bottom - size * 0.05);
    g.close();
    setFill(g, color);
    g.fill();
    // Clapper — small filled circle below the lip.
    g.circle(0, bottom - size * 0.13, size * 0.07);
    g.fill();
    // Top knob — single dot at the top.
    g.circle(0, top + size * 0.04, size * 0.05);
    g.fill();
}

function drawCheck(g: Graphics, size: number, color: Color): void {
    g.strokeColor = color;
    g.lineWidth = Math.max(3, size * 0.10);
    g.moveTo(-size * 0.30, 0); g.lineTo(-size * 0.05, -size * 0.25); g.lineTo(size * 0.35, size * 0.25);
    g.stroke();
}

function drawCross(g: Graphics, size: number, color: Color): void {
    g.strokeColor = color;
    g.lineWidth = Math.max(3, size * 0.10);
    g.moveTo(-size * 0.30, size * 0.30); g.lineTo(size * 0.30, -size * 0.30);
    g.moveTo(size * 0.30, size * 0.30); g.lineTo(-size * 0.30, -size * 0.30);
    g.stroke();
}

function drawArrow(g: Graphics, size: number, color: Color, up: boolean): void {
    setFill(g, color);
    const dy = up ? 1 : -1;
    polygon(g, [[0, size * 0.40 * dy], [size * 0.30, size * 0.05 * dy], [size * 0.12, size * 0.05 * dy], [size * 0.12, -size * 0.40 * dy], [-size * 0.12, -size * 0.40 * dy], [-size * 0.12, size * 0.05 * dy], [-size * 0.30, size * 0.05 * dy]]);
    g.fill();
}

function drawPlus(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    polygon(g, [[-size * 0.10, size * 0.40], [size * 0.10, size * 0.40], [size * 0.10, size * 0.10], [size * 0.40, size * 0.10], [size * 0.40, -size * 0.10], [size * 0.10, -size * 0.10], [size * 0.10, -size * 0.40], [-size * 0.10, -size * 0.40], [-size * 0.10, -size * 0.10], [-size * 0.40, -size * 0.10], [-size * 0.40, size * 0.10], [-size * 0.10, size * 0.10]]);
    g.fill();
}

function drawEye(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Outer eye almond
    g.moveTo(-size * 0.42, 0);
    g.lineTo(0, size * 0.25);
    g.lineTo(size * 0.42, 0);
    g.lineTo(0, -size * 0.25);
    g.close();
    g.fill();
    // Pupil
    setFill(g, new Color(Palette.bg.primary.length === 7 ? parseInt(Palette.bg.primary.slice(1, 3), 16) : 11, 14, 26, 255));
    g.circle(0, 0, size * 0.16); g.fill();
}

function drawLock(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Body
    polygon(g, [[-size * 0.30, -size * 0.35], [size * 0.30, -size * 0.35], [size * 0.30, size * 0.10], [-size * 0.30, size * 0.10]]);
    g.fill();
    // Shackle (stroke arc)
    g.strokeColor = color;
    g.lineWidth = Math.max(3, size * 0.08);
    g.arc(0, size * 0.10, size * 0.20, Math.PI, 0, true);
    g.stroke();
}

function drawWand(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Stick (rotated rect)
    polygon(g, [[-size * 0.42, size * 0.10], [-size * 0.30, size * 0.22], [size * 0.18, -size * 0.30], [size * 0.06, -size * 0.42]]);
    g.fill();
    // Star tip
    setFill(g, new Color(255, 220, 80, 255));
    polygon(g, nStarPoints(size * 0.28, size * 0.28, 5, size * 0.18, size * 0.08));
    g.fill();
}

function drawTrade(g: Graphics, size: number, color: Color): void {
    g.strokeColor = color;
    g.lineWidth = Math.max(2, size * 0.06);
    setFill(g, color);
    // Up-right arrow
    g.moveTo(-size * 0.30, -size * 0.20); g.lineTo(size * 0.30, -size * 0.20); g.lineTo(size * 0.10, -size * 0.40);
    g.stroke();
    g.moveTo(size * 0.30, -size * 0.20); g.lineTo(size * 0.10, 0); g.stroke();
    // Down-left arrow
    g.moveTo(size * 0.30, size * 0.20); g.lineTo(-size * 0.30, size * 0.20); g.lineTo(-size * 0.10, size * 0.40);
    g.stroke();
    g.moveTo(-size * 0.30, size * 0.20); g.lineTo(-size * 0.10, 0); g.stroke();
}

/* ── Phase 2b: emoji-replacement icons ────────────────────────────────── */

function drawCog(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // 8-tooth gear — alternate outer/inner vertex polygon
    const teeth = 8;
    const rOuter = size * 0.44;
    const rInner = size * 0.34;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? rOuter : rInner;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    polygon(g, pts);
    g.fill();
    // Inner ring cutout (drawn as bg-colored circle for visual hole; here stroke with dim color)
    const dim = new Color(Math.max(0, color.r - 40), Math.max(0, color.g - 40), Math.max(0, color.b - 40), 255);
    g.strokeColor = dim;
    g.lineWidth = Math.max(2, size * 0.05);
    g.circle(0, 0, size * 0.14); g.stroke();
}

function drawUser(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Head
    g.circle(0, size * 0.18, size * 0.18); g.fill();
    // Shoulders (trapezoidal bust)
    polygon(g, [
        [-size * 0.34, -size * 0.40],
        [size * 0.34, -size * 0.40],
        [size * 0.26, -size * 0.10],
        [-size * 0.26, -size * 0.10],
    ]);
    g.fill();
}

function drawBook(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Back book (offset up/right)
    polygon(g, [
        [-size * 0.26, size * 0.40],
        [size * 0.36, size * 0.40],
        [size * 0.36, -size * 0.20],
        [-size * 0.26, -size * 0.20],
    ]);
    g.fill();
    // Front book
    const dim = new Color(Math.max(0, color.r - 30), Math.max(0, color.g - 30), Math.max(0, color.b - 30), 255);
    setFill(g, dim);
    polygon(g, [
        [-size * 0.40, size * 0.26],
        [size * 0.22, size * 0.26],
        [size * 0.22, -size * 0.40],
        [-size * 0.40, -size * 0.40],
    ]);
    g.fill();
    // Spine line on front book
    const hi = new Color(Math.min(255, color.r + 30), Math.min(255, color.g + 30), Math.min(255, color.b + 30), 255);
    g.strokeColor = hi;
    g.lineWidth = Math.max(1, size * 0.03);
    g.moveTo(-size * 0.34, size * 0.26); g.lineTo(-size * 0.34, -size * 0.40);
    g.stroke();
}

function drawBulb(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Glass dome
    g.circle(0, size * 0.10, size * 0.30); g.fill();
    // Neck
    polygon(g, [
        [-size * 0.14, -size * 0.14],
        [size * 0.14, -size * 0.14],
        [size * 0.14, -size * 0.28],
        [-size * 0.14, -size * 0.28],
    ]);
    g.fill();
    // Base rings
    const dim = new Color(Math.max(0, color.r - 60), Math.max(0, color.g - 60), Math.max(0, color.b - 60), 255);
    g.strokeColor = dim;
    g.lineWidth = Math.max(1, size * 0.03);
    g.moveTo(-size * 0.14, -size * 0.20); g.lineTo(size * 0.14, -size * 0.20); g.stroke();
    g.moveTo(-size * 0.12, -size * 0.26); g.lineTo(size * 0.12, -size * 0.26); g.stroke();
    // Filament suggestion — small bright dot
    setFill(g, new Color(255, 255, 255, 220));
    g.circle(-size * 0.08, size * 0.16, size * 0.04); g.fill();
}

function drawRobot(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Head / body rounded square
    g.roundRect(-size * 0.36, -size * 0.34, size * 0.72, size * 0.68, size * 0.12);
    g.fill();
    // Antenna stalk + dot
    g.strokeColor = color;
    g.lineWidth = Math.max(1, size * 0.04);
    g.moveTo(0, size * 0.34); g.lineTo(0, size * 0.46); g.stroke();
    setFill(g, new Color(Math.min(255, color.r + 60), 100, 200, 255));
    g.circle(0, size * 0.48, size * 0.06); g.fill();
    // Eyes (square)
    const eye = new Color(20, 22, 36, 255);
    setFill(g, eye);
    g.rect(-size * 0.22, -size * 0.02, size * 0.14, size * 0.14); g.fill();
    g.rect(size * 0.08, -size * 0.02, size * 0.14, size * 0.14); g.fill();
    // Mouth (horizontal rect)
    setFill(g, eye);
    g.rect(-size * 0.16, -size * 0.22, size * 0.32, size * 0.06); g.fill();
}

function drawTrash(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Can body (wider at top)
    polygon(g, [
        [-size * 0.28, size * 0.20],
        [size * 0.28, size * 0.20],
        [size * 0.22, -size * 0.40],
        [-size * 0.22, -size * 0.40],
    ]);
    g.fill();
    // Lid (horizontal rect)
    g.rect(-size * 0.36, size * 0.20, size * 0.72, size * 0.08); g.fill();
    // Handle
    g.strokeColor = color;
    g.lineWidth = Math.max(2, size * 0.05);
    g.moveTo(-size * 0.10, size * 0.28); g.lineTo(-size * 0.10, size * 0.40);
    g.lineTo(size * 0.10, size * 0.40); g.lineTo(size * 0.10, size * 0.28);
    g.stroke();
    // Vertical grooves on body
    const dim = new Color(Math.max(0, color.r - 50), Math.max(0, color.g - 50), Math.max(0, color.b - 50), 255);
    g.strokeColor = dim;
    g.lineWidth = Math.max(1, size * 0.03);
    for (const x of [-size * 0.12, 0, size * 0.12]) {
        g.moveTo(x, size * 0.14); g.lineTo(x, -size * 0.34); g.stroke();
    }
}

function drawSave(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Body square with notched top-right corner
    g.moveTo(-size * 0.40, -size * 0.40);
    g.lineTo(size * 0.40, -size * 0.40);
    g.lineTo(size * 0.40, size * 0.28);
    g.lineTo(size * 0.28, size * 0.40);
    g.lineTo(-size * 0.40, size * 0.40);
    g.close();
    g.fill();
    // Inner label card (bottom half)
    const hi = new Color(Math.min(255, color.r + 30), Math.min(255, color.g + 30), Math.min(255, color.b + 30), 255);
    setFill(g, hi);
    g.rect(-size * 0.24, -size * 0.30, size * 0.48, size * 0.28); g.fill();
    // Top metal slot (shutter) rect
    const dim = new Color(Math.max(0, color.r - 40), Math.max(0, color.g - 40), Math.max(0, color.b - 40), 255);
    setFill(g, dim);
    g.rect(-size * 0.18, size * 0.14, size * 0.32, size * 0.22); g.fill();
    // Shutter stripe
    const hi2 = new Color(Math.min(255, color.r + 50), Math.min(255, color.g + 50), Math.min(255, color.b + 50), 255);
    setFill(g, hi2);
    g.rect(size * 0.02, size * 0.18, size * 0.10, size * 0.16); g.fill();
}

function drawSpeaker(g: Graphics, size: number, color: Color, muted: boolean): void {
    setFill(g, color);
    // Cone (trapezoid + back box)
    polygon(g, [
        [-size * 0.40, -size * 0.14],
        [-size * 0.14, -size * 0.14],
        [size * 0.08, -size * 0.30],
        [size * 0.08, size * 0.30],
        [-size * 0.14, size * 0.14],
        [-size * 0.40, size * 0.14],
    ]);
    g.fill();
    if (muted) {
        // X across right side
        const xc = new Color(255, 90, 120, 255);
        g.strokeColor = xc;
        g.lineWidth = Math.max(2, size * 0.07);
        g.moveTo(size * 0.18, -size * 0.20); g.lineTo(size * 0.40, size * 0.02); g.stroke();
        g.moveTo(size * 0.40, -size * 0.20); g.lineTo(size * 0.18, size * 0.02); g.stroke();
    } else {
        // Sound waves — 3 arcs to the right
        g.strokeColor = color;
        g.lineWidth = Math.max(2, size * 0.05);
        g.arc(size * 0.10, 0, size * 0.18, -Math.PI / 3, Math.PI / 3, false); g.stroke();
        g.arc(size * 0.10, 0, size * 0.28, -Math.PI / 3, Math.PI / 3, false); g.stroke();
        g.arc(size * 0.10, 0, size * 0.38, -Math.PI / 3, Math.PI / 3, false); g.stroke();
    }
}

function drawVibration(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Phone body
    g.roundRect(-size * 0.14, -size * 0.38, size * 0.28, size * 0.76, size * 0.05);
    g.fill();
    // Screen
    const dim = new Color(Math.max(0, color.r - 60), Math.max(0, color.g - 60), Math.max(0, color.b - 60), 255);
    setFill(g, dim);
    g.rect(-size * 0.10, -size * 0.28, size * 0.20, size * 0.48); g.fill();
    // Vibration waves (left + right)
    g.strokeColor = color;
    g.lineWidth = Math.max(2, size * 0.05);
    for (const side of [-1, 1]) {
        g.moveTo(side * size * 0.22, -size * 0.12);
        g.lineTo(side * size * 0.30, size * 0.00);
        g.lineTo(side * size * 0.22, size * 0.12);
        g.stroke();
        g.moveTo(side * size * 0.32, -size * 0.18);
        g.lineTo(side * size * 0.42, size * 0.00);
        g.lineTo(side * size * 0.32, size * 0.18);
        g.stroke();
    }
}

function drawHand(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Palm
    g.roundRect(-size * 0.26, -size * 0.36, size * 0.52, size * 0.48, size * 0.12);
    g.fill();
    // Fingers (4) + thumb (5th, angled)
    const fingerW = size * 0.10;
    const gap = size * 0.02;
    const fingerY = size * 0.12;
    const fingerH = size * 0.28;
    for (let i = 0; i < 4; i++) {
        const x = -size * 0.22 + i * (fingerW + gap);
        g.roundRect(x, fingerY, fingerW, fingerH, size * 0.04);
        g.fill();
    }
    // Thumb — angled left
    polygon(g, [
        [-size * 0.30, size * 0.02],
        [-size * 0.40, -size * 0.08],
        [-size * 0.32, -size * 0.18],
        [-size * 0.22, -size * 0.08],
    ]);
    g.fill();
}

function drawStarOutline(g: Graphics, size: number, color: Color): void {
    g.strokeColor = color;
    g.lineWidth = Math.max(2, size * 0.06);
    const pts = nStarPoints(0, 0, 5, size * 0.45, size * 0.20);
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.close();
    g.stroke();
}

function drawFlag(g: Graphics, size: number, color: Color): void {
    // Pole
    setFill(g, color);
    g.rect(-size * 0.26, -size * 0.42, size * 0.06, size * 0.84); g.fill();
    // Checkered flag — 4x2 grid
    const cellW = size * 0.12;
    const cellH = size * 0.12;
    const startX = -size * 0.20;
    const startY = size * 0.08;
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
            const filled = (row + col) % 2 === 0;
            if (filled) {
                setFill(g, color);
            } else {
                setFill(g, new Color(240, 240, 245, 255));
            }
            g.rect(startX + col * cellW, startY - row * cellH, cellW, cellH);
            g.fill();
        }
    }
}

function drawClipboard(g: Graphics, size: number, color: Color): void {
    setFill(g, color);
    // Board body
    g.roundRect(-size * 0.32, -size * 0.42, size * 0.64, size * 0.82, size * 0.06);
    g.fill();
    // Clip at top
    const dim = new Color(Math.max(0, color.r - 60), Math.max(0, color.g - 60), Math.max(0, color.b - 60), 255);
    setFill(g, dim);
    g.roundRect(-size * 0.14, size * 0.30, size * 0.28, size * 0.18, size * 0.04);
    g.fill();
    // Lines (content)
    const hi = new Color(Math.min(255, color.r + 50), Math.min(255, color.g + 50), Math.min(255, color.b + 50), 255);
    g.strokeColor = hi;
    g.lineWidth = Math.max(1, size * 0.04);
    for (const y of [size * 0.14, 0, -size * 0.14]) {
        g.moveTo(-size * 0.20, y); g.lineTo(size * 0.20, y); g.stroke();
    }
}

function drawDisconnect(g: Graphics, size: number, color: Color): void {
    g.strokeColor = color;
    g.lineWidth = Math.max(2, size * 0.10);
    // Open ring (IEC 60417-5009): start the arc just below 12 o'clock and
    // wrap ~330° so the vertical bar slots cleanly into the gap at the top.
    const r = size * 0.34;
    const startDeg = -75;
    const endDeg = 255;
    const steps = 32;
    const startRad = (startDeg * Math.PI) / 180;
    g.moveTo(Math.cos(startRad) * r, Math.sin(startRad) * r);
    for (let i = 1; i <= steps; i++) {
        const t = startDeg + ((endDeg - startDeg) * i) / steps;
        const rad = (t * Math.PI) / 180;
        g.lineTo(Math.cos(rad) * r, Math.sin(rad) * r);
    }
    g.stroke();
    // Vertical bar from center upward through the ring's gap.
    g.moveTo(0, size * 0.05);
    g.lineTo(0, size * 0.46);
    g.stroke();
}

/* ── Registry ─────────────────────────────────────────────────────────── */

REG.medalGold   = { draw: (g, s, c) => drawMedal(g, s, c, colorFromHex(Palette.accent.violet)),  tintHex: Palette.rank.gold,   emoji: '🥇' };
REG.medalSilver = { draw: (g, s, c) => drawMedal(g, s, c, colorFromHex(Palette.accent.violet)),  tintHex: Palette.rank.silver, emoji: '🥈' };
REG.medalBronze = { draw: (g, s, c) => drawMedal(g, s, c, colorFromHex(Palette.accent.violet)),  tintHex: Palette.rank.bronze, emoji: '🥉' };
REG.trophy      = { draw: drawTrophy,       tintHex: Palette.rank.gold,    emoji: '🏆' };
REG.flame       = { draw: drawFlame,        tintHex: Palette.accent.amber, emoji: '🔥' };
REG.fire        = { draw: drawFlame,        tintHex: Palette.accent.amber, emoji: '🔥' };
REG.bolt        = { draw: drawBolt,         tintHex: Palette.accent.amber, emoji: '⚡' };
REG.lightning   = { draw: drawBolt,         tintHex: Palette.accent.amber, emoji: '⚡' };
REG.sword       = { draw: drawSword,        tintHex: Palette.text.mid,     emoji: '⚔' };
REG.coin        = { draw: drawCoin,         tintHex: Palette.rank.gold,    emoji: '💰' };
REG.chart       = { draw: drawChart,        tintHex: Palette.accent.teal,  emoji: '📈' };
REG.brain       = { draw: drawBrain,        tintHex: Palette.accent.violet,emoji: '🧠' };
REG.crown       = { draw: drawCrown,        tintHex: Palette.rank.gold,    emoji: '👑' };
REG.target      = { draw: drawTarget,       tintHex: Palette.accent.rose,  emoji: '🎯' };
REG.gem         = { draw: drawGem,          tintHex: Palette.accent.violet,emoji: '💎' };
REG.sparkle     = { draw: drawSparkle,      tintHex: Palette.accent.amber, emoji: '✨' };
REG.star        = { draw: drawStar,         tintHex: Palette.accent.amber, emoji: '⭐' };
REG.starBurst   = { draw: drawStarBurst,    tintHex: Palette.accent.amber, emoji: '💫' };
REG.circle      = { draw: drawCircle,       tintHex: Palette.accent.teal,  emoji: '🟢' };
REG.triangle    = { draw: drawTriangle,     tintHex: Palette.accent.rose,  emoji: '🔺' };
REG.clock       = { draw: drawClock,        tintHex: Palette.text.mid,     emoji: '🕒' };
REG.check       = { draw: drawCheck,        tintHex: Palette.status.win,   emoji: '✅' };
REG.cross       = { draw: drawCross,        tintHex: Palette.status.loss,  emoji: '❌' };
REG.arrowUp     = { draw: (g, s, c) => drawArrow(g, s, c, true),  tintHex: Palette.status.win,  emoji: '⬆' };
REG.arrowDown   = { draw: (g, s, c) => drawArrow(g, s, c, false), tintHex: Palette.status.loss, emoji: '⬇' };
REG.plus        = { draw: drawPlus,         tintHex: Palette.text.hi,      emoji: '+' };
REG.eye         = { draw: drawEye,          tintHex: Palette.text.mid,     emoji: '👁' };
REG.lock        = { draw: drawLock,         tintHex: Palette.text.mid,     emoji: '🔒' };
REG.wand        = { draw: drawWand,         tintHex: Palette.accent.violet,emoji: '🪄' };
REG.trade       = { draw: drawTrade,        tintHex: Palette.accent.teal,  emoji: '🔁' };
// Phase 2b additions:
REG.cog         = { draw: drawCog,          tintHex: Palette.text.mid,     emoji: '⚙' };
REG.user        = { draw: drawUser,         tintHex: Palette.accent.violet,emoji: '👤' };
REG.book        = { draw: drawBook,         tintHex: Palette.accent.teal,  emoji: '📚' };
REG.bulb        = { draw: drawBulb,         tintHex: Palette.accent.amber, emoji: '💡' };
REG.robot       = { draw: drawRobot,        tintHex: Palette.text.mid,     emoji: '🤖' };
REG.trash       = { draw: drawTrash,        tintHex: Palette.status.loss,  emoji: '🗑' };
REG.save        = { draw: drawSave,         tintHex: Palette.accent.teal,  emoji: '💾' };
REG.speaker     = { draw: (g, s, c) => drawSpeaker(g, s, c, false), tintHex: Palette.accent.teal, emoji: '🔊' };
REG.speakerMuted= { draw: (g, s, c) => drawSpeaker(g, s, c, true),  tintHex: Palette.text.lo,     emoji: '🔈' };
REG.vibration   = { draw: drawVibration,    tintHex: Palette.accent.violet,emoji: '📳' };
REG.hand        = { draw: drawHand,         tintHex: Palette.text.lo,      emoji: '✋' };
REG.starOutline = { draw: drawStarOutline,  tintHex: Palette.text.mid,     emoji: '☆' };
REG.flag        = { draw: drawFlag,         tintHex: Palette.text.hi,      emoji: '🏁' };
REG.clipboard   = { draw: drawClipboard,    tintHex: Palette.text.mid,     emoji: '📋' };
// Phase N3 additions:
REG.bell        = { draw: drawBell,         tintHex: Palette.text.hi,      emoji: '🔔' };
// Phase N4 additions:
REG.disconnect  = { draw: drawDisconnect,   tintHex: Palette.status.loss,  emoji: '⏻' };
