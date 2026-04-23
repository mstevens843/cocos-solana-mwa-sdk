/**
 * sharecard.ts — Part 11 Bundle A.
 *
 * Renders a 1200×630 PNG (Twitter card dimensions) summarizing a single
 * settled match. Used by the `/sharecard/:matchPda.png` route to produce
 * a shareable image X unfurls when a tweet embeds the URL.
 *
 * Layout (left to right):
 *   - Left half: stylized stacked-block tower (count = final height, color by squad)
 *   - Right half: placement trophy + payout amount (gold) + squad symbols + time-window badge
 *   - Footer: "Token Duel · Stack-Jump on Solana" + truncated match PDA
 *
 * The file uses @napi-rs/canvas — native bindings, no headless Chromium.
 * Docker base image needs libc6-compat on alpine; the project's Dockerfile
 * inherits that.
 */

import { createCanvas, Canvas, SKRSContext2D as Ctx } from '@napi-rs/canvas';

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
    // Left-half stylized tower. Block i uses squad[i % 3]'s color tint keyed
    // to its 24h delta — green tints for pumps, red for dumps.
    const maxBlocks = Math.min(m.height, 20); // cap visual density
    const towerX = 180;
    const towerBaseY = HEIGHT - 110;
    const blockH = 20;
    const baseWidth = 260;

    for (let i = 0; i < maxBlocks; i++) {
        const tokenIdx = i % 3;
        const delta = m.squadDeltas[tokenIdx];
        const width = deltaToWidth(delta, baseWidth);
        const y = towerBaseY - (i + 1) * (blockH + 2);
        ctx.fillStyle = deltaToColor(delta);
        ctx.fillRect(towerX - width / 2, y, width, blockH);
        // subtle inner shadow
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(towerX - width / 2, y + blockH - 4, width, 4);
    }

    // "Height: NN" label under tower.
    ctx.fillStyle = '#d0d5e0';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Height: ${m.height}`, towerX, HEIGHT - 60);

    // Squad symbols row.
    ctx.font = '18px system-ui, sans-serif';
    const symbolText = m.squadSymbols.map((s, i) => `${s} ${fmtPct(m.squadDeltas[i])}`).join('  ·  ');
    ctx.fillStyle = '#8892a6';
    ctx.fillText(symbolText, towerX, HEIGHT - 30);
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

    // Trophy emoji by placement.
    const trophy = m.placement === 0 ? '🏆' : m.placement === 1 ? '🥈' : m.placement === 2 ? '🥉' : '·';
    ctx.fillStyle = '#ffffff';
    ctx.font = '130px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(trophy, panelX, panelY + 130);

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

    // Verified badge if applicable.
    if (m.verified) {
        ctx.fillStyle = '#7ac4ff';
        ctx.font = '20px system-ui, sans-serif';
        ctx.fillText('✓ Verified on-chain', panelX + 150, panelY + 252);
    }
}

function drawFooter(ctx: Ctx, m: MatchSummary): void {
    // Branded footer bar at y=HEIGHT-12.
    ctx.fillStyle = '#e0a020';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Token Duel · Stack-Jump on Solana', WIDTH - 40, HEIGHT - 20);

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
