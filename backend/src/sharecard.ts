/**
 * sharecard.ts — Part 11 Bundle A.
 *
 * Renders a 1200×630 PNG (Twitter card dimensions) summarizing a single
 * settled match. Used by the `/sharecard/:matchPda.png` route to produce
 * a shareable image X unfurls when a tweet embeds the URL.
 *
 * betting-duel: `MatchSummary.height` is an **encoded portfolio delta
 * score** (ScoreEncoding: `score = (deltaPct * 100) + 1_000_000`). This
 * renderer decodes it to a % and draws a horizontal delta bar instead of
 * the stack-jump tower. Positive delta = green bar growing right, negative
 * = red bar growing left.
 *
 * Layout (left to right):
 *   - Left half: horizontal portfolio-delta bar with % label + squad chips
 *   - Right half: placement trophy + payout amount (gold) + mode/window badges
 *   - Footer: "Token Duel · Portfolio Race on Solana" + truncated match PDA
 *
 * The file uses @napi-rs/canvas — native bindings, no headless Chromium.
 */

/** Score encoding (mirrors client-side `ScoreEncoding.ts`). */
const SCORE_BIAS = 1_000_000;
const DELTA_SCALE = 100;
function decodeScore(score: number): number {
    if (!Number.isFinite(score)) return 0;
    return (score - SCORE_BIAS) / DELTA_SCALE;
}

import { createCanvas, Canvas, SKRSContext2D as Ctx } from '@napi-rs/canvas';
import { drawRankIcon, drawCheck } from './iconDraw';

const TAG = '[sharecard]';

export interface MatchSummary {
    matchPda: string;
    playerPubkey: string;
    playerShortName: string;   // "mstevens.eth" or "A1b2...C9d0" fallback
    placement: number;          // 0-indexed
    requiredPlayers: number;
    height: number;
    payoutLamports: bigint;     // net lamports to the player (can be 0)
    wagerLamports: bigint;
    modeLabel: string;          // "1v1 Duel", "4p Pot", ...
    timeWindowLabel: string;    // "1h", "24h", "3d", "7d"
    track: 'paper' | 'real';
    squadSymbols: [string, string, string];
    squadDeltas: [number, number, number]; // % change per token
    verified: boolean;          // true if receipt-backed settle
}

const WIDTH = 1200;
const HEIGHT = 630;

export function renderSharecard(m: MatchSummary): Buffer {
    const canvas: Canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    drawBackground(ctx);
    drawTower(ctx, m);
    drawResultPanel(ctx, m);
    drawFooter(ctx, m);

    console.log(`${TAG} render | match=${m.matchPda.slice(0, 8)}... placement=${m.placement + 1}/${m.requiredPlayers} h=${m.height} payout=${m.payoutLamports}`);
    return canvas.toBuffer('image/png');
}

function drawBackground(ctx: Ctx): void {
    // Vertical gradient: dark navy → black, with subtle purple glow top-right.
    const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    grad.addColorStop(0, '#0f1420');
    grad.addColorStop(1, '#05070e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const glow = ctx.createRadialGradient(WIDTH * 0.85, 80, 20, WIDTH * 0.85, 80, 400);
    glow.addColorStop(0, 'rgba(120, 80, 220, 0.35)');
    glow.addColorStop(1, 'rgba(120, 80, 220, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawTower(ctx: Ctx, m: MatchSummary): void {
    // betting-duel: horizontal portfolio delta bar. Decode encoded score
    // into a % and render a bar growing from center-zero toward the direction
    // of the delta. Bar width scales with |delta| up to ±50% clamp.
    const pct = decodeScore(m.height);
    const panelCenterX = 280;
    const panelCenterY = 260;
    const panelW = 460;
    const panelH = 140;

    // Panel background (subtle card).
    ctx.fillStyle = 'rgba(22, 28, 42, 0.7)';
    ctx.fillRect(panelCenterX - panelW / 2, panelCenterY - panelH / 2, panelW, panelH);

    // Center zero tick.
    ctx.strokeStyle = '#3a4258';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(panelCenterX, panelCenterY - panelH / 2 + 10);
    ctx.lineTo(panelCenterX, panelCenterY - panelH / 2 + panelH - 56);
    ctx.stroke();

    // Delta bar. Width = |pct| / 50 * half-panel.
    const clamped = Math.max(-50, Math.min(50, pct));
    const barHalfMax = (panelW - 40) / 2;
    const barW = (Math.abs(clamped) / 50) * barHalfMax;
    const barH = 48;
    const barY = panelCenterY - barH / 2 - 18;
    ctx.fillStyle = pct >= 0 ? '#30cc97' : '#d65656';
    if (pct >= 0) {
        ctx.fillRect(panelCenterX, barY, barW, barH);
    } else {
        ctx.fillRect(panelCenterX - barW, barY, barW, barH);
    }

    // % label big, colored.
    ctx.fillStyle = pct >= 0 ? '#30cc97' : '#d65656';
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const sign = pct >= 0 ? '+' : '';
    ctx.fillText(`${sign}${pct.toFixed(2)}%`, panelCenterX, panelCenterY + 52);

    // "Portfolio change" caption.
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillStyle = '#8892a6';
    ctx.fillText('Portfolio change', panelCenterX, panelCenterY - 48);

    // Squad row under the bar.
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillStyle = '#b0b8c8';
    const symbolText = m.squadSymbols.map((s, i) => `${s} ${fmtPct(m.squadDeltas[i])}`).join('  ·  ');
    ctx.fillText(symbolText, panelCenterX, HEIGHT - 40);
}

function deltaToWidth(deltaPct: number, base: number): number {
    let mult: number;
    if (deltaPct >= 5) mult = 1.0;
    else if (deltaPct >= 0) mult = 0.8;
    else if (deltaPct >= -5) mult = 0.6;
    else mult = 0.4;
    return base * mult;
}

function deltaToColor(deltaPct: number): string {
    if (deltaPct >= 5) return '#30cc97';       // strong green
    if (deltaPct >= 0) return '#6db6a0';       // muted green
    if (deltaPct >= -5) return '#c0885a';      // muted orange
    return '#d65656';                           // red
}

function drawResultPanel(ctx: Ctx, m: MatchSummary): void {
    const panelX = 640;
    const panelY = 80;

    // UX Phase 2c: procedural rank icon (drawn) replaces the emoji glyph so
    // the card renders identically across all platforms (no emoji-font drift).
    if (m.placement <= 2) {
        drawRankIcon(ctx, panelX + 65, panelY + 90, 130, m.placement);
    } else {
        ctx.fillStyle = '#5a6478';
        ctx.font = '110px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('·', panelX, panelY + 130);
    }

    // Placement text.
    ctx.fillStyle = '#e0a020';
    ctx.font = 'bold 48px system-ui, sans-serif';
    const place = ordinalAt(m.placement + 1);
    ctx.fillText(`${place} of ${m.requiredPlayers}`, panelX + 150, panelY + 100);

    // Payout (gold when won, gray when lost).
    const net = Number(m.payoutLamports - m.wagerLamports) / 1e9;
    const payoutStr = net > 0 ? `+${net.toFixed(3)} SOL` : `${net.toFixed(3)} SOL`;
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.fillStyle = net > 0 ? '#30cc97' : '#8892a6';
    ctx.fillText(payoutStr, panelX + 150, panelY + 180);

    // Mode + window + track badges.
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillStyle = '#b0b8c8';
    ctx.fillText(`${m.modeLabel} · ${m.timeWindowLabel} · ${m.track === 'real' ? 'Real' : 'Paper'}`, panelX + 150, panelY + 220);

    // Verified badge if applicable. UX Phase 2c: procedural check glyph.
    if (m.verified) {
        drawCheck(ctx, panelX + 160, panelY + 244, 16, '#7ac4ff');
        ctx.fillStyle = '#7ac4ff';
        ctx.font = '20px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Verified on-chain', panelX + 176, panelY + 252);
    }
}

function drawFooter(ctx: Ctx, m: MatchSummary): void {
    // Branded footer bar at y=HEIGHT-12.
    ctx.fillStyle = '#e0a020';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Token Duel · Portfolio Race on Solana', WIDTH - 40, HEIGHT - 20);

    // Match PDA short hash.
    ctx.fillStyle = '#5a6478';
    ctx.font = '16px monospace';
    ctx.fillText(`match: ${m.matchPda.slice(0, 6)}…${m.matchPda.slice(-4)}`, WIDTH - 40, HEIGHT - 44);
}

function ordinalAt(n: number): string {
    if (n === 1) return '1st';
    if (n === 2) return '2nd';
    if (n === 3) return '3rd';
    return `${n}th`;
}

function fmtPct(pct: number): string {
    const rounded = Math.round(pct * 10) / 10;
    const sign = rounded >= 0 ? '+' : '';
    return `${sign}${rounded}%`;
}
