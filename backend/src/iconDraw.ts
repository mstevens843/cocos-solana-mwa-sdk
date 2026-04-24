/**
 * iconDraw.ts — node-canvas procedural icon drawings for sharecard rendering.
 *
 * Mirrors a subset of the client's IconLibrary (assets/token-duel/scripts/
 * IconLibrary.ts) on the backend Path2D/CanvasRenderingContext2D API. Used by
 * sharecard.ts to replace emoji glyphs (🏆🥈🥉✓) with consistent procedural
 * icons that look identical on any share platform, independent of emoji font.
 *
 * All draws position icons centered at (cx, cy) with a size-normalized bounding
 * box of [-size/2, +size/2]^2.
 */

import { SKRSContext2D as Ctx } from '@napi-rs/canvas';

const GOLD   = '#FFD24A';
const SILVER = '#D8DDF0';
const BRONZE = '#E08A4A';
const VIOLET = '#9945FF';
const TEAL   = '#14F195';

function setFill(ctx: Ctx, color: string) { ctx.fillStyle = color; }
function setStroke(ctx: Ctx, color: string, w: number) { ctx.strokeStyle = color; ctx.lineWidth = w; }

function polygon(ctx: Ctx, pts: Array<[number, number]>) {
    if (pts.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
}

/** Dim a hex color toward black by `amt` (0..1). Used for inner rings / accents. */
function dim(hex: string, amt: number): string {
    const h = hex.replace('#', '');
    const r = Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) - 255 * amt));
    const g = Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) - 255 * amt));
    const b = Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) - 255 * amt));
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Draw a cup-silhouette trophy centered at (cx, cy) of diagonal `size`.
 * Y-axis convention: canvas y increases downward (standard 2D), so "top of
 * trophy" is negative y offsets from center.
 */
export function drawTrophy(ctx: Ctx, cx: number, cy: number, size: number, color = GOLD): void {
    ctx.save();
    ctx.translate(cx, cy);
    setFill(ctx, color);
    // Cup body (6-sided silhouette, y inverted vs client-side IconLibrary)
    polygon(ctx, [
        [-size * 0.32, -size * 0.40], [-size * 0.32, size * 0.05],
        [-size * 0.20, size * 0.20],  [size * 0.20, size * 0.20],
        [size * 0.32, size * 0.05],   [size * 0.32, -size * 0.40],
    ]);
    ctx.fill();
    // Handles (strokes)
    setStroke(ctx, color, Math.max(3, size * 0.06));
    ctx.beginPath();
    ctx.moveTo(-size * 0.32, -size * 0.30);
    ctx.lineTo(-size * 0.45, -size * 0.18);
    ctx.lineTo(-size * 0.45, -size * 0.05);
    ctx.lineTo(-size * 0.32, size * 0.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size * 0.32, -size * 0.30);
    ctx.lineTo(size * 0.45, -size * 0.18);
    ctx.lineTo(size * 0.45, -size * 0.05);
    ctx.lineTo(size * 0.32, size * 0.05);
    ctx.stroke();
    // Stem + base
    setFill(ctx, color);
    polygon(ctx, [
        [-size * 0.18, size * 0.20],  [size * 0.18, size * 0.20],
        [size * 0.10, size * 0.32],   [-size * 0.10, size * 0.32],
    ]);
    ctx.fill();
    polygon(ctx, [
        [-size * 0.30, size * 0.32], [size * 0.30, size * 0.32],
        [size * 0.30, size * 0.42],  [-size * 0.30, size * 0.42],
    ]);
    ctx.fill();
    ctx.restore();
}

/** Draw a ribboned medal disc (gold/silver/bronze) centered at (cx, cy). */
export function drawMedal(ctx: Ctx, cx: number, cy: number, size: number, color: string): void {
    ctx.save();
    ctx.translate(cx, cy);
    const r = size * 0.36;
    // Ribbon V-shape behind disc
    setFill(ctx, VIOLET);
    polygon(ctx, [
        [-size * 0.30, -size * 0.30], [-size * 0.10, size * 0.40],
        [0, size * 0.10],             [size * 0.10, size * 0.40],
        [size * 0.30, -size * 0.30],  [0, -size * 0.05],
    ]);
    ctx.fill();
    // Medal disc
    setFill(ctx, color);
    ctx.beginPath();
    ctx.arc(0, -size * 0.05, r, 0, Math.PI * 2);
    ctx.fill();
    // Inner highlight ring
    setStroke(ctx, dim(color, 0.25), Math.max(2, size * 0.06));
    ctx.beginPath();
    ctx.arc(0, -size * 0.05, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

/** Dispatcher for placement rank: 0=trophy, 1=silver, 2=bronze, otherwise no-op. */
export function drawRankIcon(ctx: Ctx, cx: number, cy: number, size: number, placement: number): void {
    if (placement === 0) drawTrophy(ctx, cx, cy, size, GOLD);
    else if (placement === 1) drawMedal(ctx, cx, cy, size, SILVER);
    else if (placement === 2) drawMedal(ctx, cx, cy, size, BRONZE);
    // 3+ : caller renders '·' or skips
}

/** Draw a checkmark (for the Verified-on-chain badge). */
export function drawCheck(ctx: Ctx, cx: number, cy: number, size: number, color = TEAL): void {
    ctx.save();
    ctx.translate(cx, cy);
    setStroke(ctx, color, Math.max(3, size * 0.16));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-size * 0.30, 0);
    ctx.lineTo(-size * 0.05, size * 0.25);
    ctx.lineTo(size * 0.35, -size * 0.25);
    ctx.stroke();
    ctx.restore();
}
