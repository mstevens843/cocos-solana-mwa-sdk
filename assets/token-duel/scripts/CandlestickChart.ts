/**
 * CandlestickChart.ts - native Cocos candlestick renderer.
 *
 * Ported semantics from solpulse's `BirdeyeChart.jsx` (which uses TradingView's
 * lightweight-charts). We draw with `cc.Graphics` directly - no external libs.
 *
 * API:
 *   CandlestickChart.render(graphics, candles, area, opts)
 *
 * Draws:
 *   - High→low wick per candle (thin vertical line)
 *   - Open→close body per candle (rectangle) - emerald if close≥open, rose otherwise
 *   - Volume histogram along the bottom 20% of the chart area
 *
 * Deliberately simple: no crosshair, no zoom, no tooltip. Those can layer later.
 */

import { Color, Graphics } from 'cc';
import { Candle, OhlcvType } from './birdeye/types';

const TAG = '[CandlestickChart]';

export interface ChartArea {
    /** Width in px of the drawable zone. */
    width: number;
    /** Height in px of the drawable zone. */
    height: number;
    /** Top padding (leave room for price axis labels if any). */
    paddingTop?: number;
    /** Bottom padding (histogram area). Default 20% of height. */
    paddingBottom?: number;
    /** Left/right padding. */
    paddingX?: number;
}

export interface ChartRenderOpts {
    timeframe?: OhlcvType;
    /** 'USD' (default) or 'SOL' - display-only label; we don't rescale y. */
    denom?: 'USD' | 'SOL';
    /** If true, draws 'price' (candles on price axis); if 'mcap' caller must pre-scale. */
    mode?: 'price' | 'mcap';
    /** SOL price in USD (for denom=SOL transform). */
    solPriceUsd?: number;
    /** Total supply (for mode=mcap transform). */
    totalSupply?: number;
}

const COLOR_UP     = new Color(48, 198, 155, 255);
const COLOR_DOWN   = new Color(236, 88, 122, 255);
const COLOR_VOL_UP = new Color(48, 198, 155, 70);
const COLOR_VOL_DN = new Color(236, 88, 122, 70);
const COLOR_GRID   = new Color(255, 255, 255, 18);
const COLOR_PV_DIV = new Color(255, 255, 255, 32);

/**
 * Render the full chart into the provided Graphics node.
 * Clears any prior drawing first.
 */
export function renderCandles(
    g: Graphics | null,
    candles: Candle[],
    area: ChartArea,
    opts: ChartRenderOpts = {},
): void {
    if (!g) {
        console.log(`${TAG} RENDER | SKIP graphics=null`);
        return;
    }
    const t0 = Date.now();
    g.clear();

    if (!candles || candles.length === 0) {
        console.log(`${TAG} RENDER | EMPTY candles=0 timeframe=${opts.timeframe ?? '?'}`);
        return;
    }

    const padTop = area.paddingTop ?? 8;
    const padBot = area.paddingBottom ?? Math.max(48, area.height * 0.18);
    const padX   = area.paddingX   ?? 6;
    // Drawing area is centered on (0,0) because the Graphics node is anchored
    // at center. Left edge = -halfW, right edge = +halfW, etc.
    const halfW = area.width  / 2;
    const halfH = area.height / 2;
    const priceTop    = halfH - padTop;
    const priceBottom = -halfH + padBot;
    const priceH      = priceTop - priceBottom;
    const plotLeft    = -halfW + padX;
    const plotRight   =  halfW - padX;
    const plotW       = plotRight - plotLeft;

    // Compute price range + volume max.
    const transform = (raw: number): number => {
        let v = raw;
        if (opts.mode === 'mcap' && opts.totalSupply && opts.totalSupply > 0) v = v * opts.totalSupply;
        if (opts.denom === 'SOL' && opts.solPriceUsd && opts.solPriceUsd > 0) v = v / opts.solPriceUsd;
        return v;
    };

    let hiPrice = -Infinity, loPrice = Infinity, maxVol = 0;
    for (const c of candles) {
        const h = transform(c.h);
        const l = transform(c.l);
        if (h > hiPrice) hiPrice = h;
        if (l < loPrice) loPrice = l;
        if (c.v > maxVol) maxVol = c.v;
    }
    if (!Number.isFinite(hiPrice) || !Number.isFinite(loPrice) || hiPrice <= loPrice) {
        console.log(`${TAG} RENDER | FLAT_RANGE hi=${hiPrice} lo=${loPrice} - fallback render`);
        hiPrice = loPrice * 1.1 || 1;
    }
    // Inject 2% headroom top/bottom so candles don't touch edges.
    const pad = (hiPrice - loPrice) * 0.03;
    hiPrice += pad; loPrice -= pad;
    if (loPrice < 0) loPrice = 0;
    const priceRange = hiPrice - loPrice || 1;

    // Grid: 4 horizontal lines.
    g.strokeColor = COLOR_GRID;
    g.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
        const y = priceBottom + (priceH * i) / 5;
        g.moveTo(plotLeft, y);
        g.lineTo(plotRight, y);
    }
    g.stroke();

    // Bar geometry.
    const n = candles.length;
    const slot = plotW / Math.max(1, n);
    const bodyW = Math.max(1.5, slot * 0.72);

    // Volume histogram (bottom strip).
    const volBottom = -halfH + 4;
    const volTop    = priceBottom - 6;
    const volH      = volTop - volBottom;
    if (volH > 0 && maxVol > 0) {
        for (let i = 0; i < n; i++) {
            const c = candles[i];
            const x = plotLeft + slot * i + slot / 2;
            const h = (c.v / maxVol) * volH;
            const up = c.c >= c.o;
            g.fillColor = up ? COLOR_VOL_UP : COLOR_VOL_DN;
            g.rect(x - bodyW / 2, volBottom, bodyW, h);
            g.fill();
        }
        // Hairline between price band and volume band so volume reads as an
        // intentional sub-layer, not bleed.
        g.strokeColor = COLOR_PV_DIV;
        g.lineWidth = 1;
        g.moveTo(plotLeft, priceBottom - 3);
        g.lineTo(plotRight, priceBottom - 3);
        g.stroke();
    }

    // Candle wicks + bodies.
    for (let i = 0; i < n; i++) {
        const c = candles[i];
        const x = plotLeft + slot * i + slot / 2;
        const h = transform(c.h);
        const l = transform(c.l);
        const o = transform(c.o);
        const cl = transform(c.c);
        const yH = priceBottom + ((h - loPrice) / priceRange) * priceH;
        const yL = priceBottom + ((l - loPrice) / priceRange) * priceH;
        const yO = priceBottom + ((o - loPrice) / priceRange) * priceH;
        const yC = priceBottom + ((cl - loPrice) / priceRange) * priceH;
        const up = cl >= o;
        const color = up ? COLOR_UP : COLOR_DOWN;
        // Wick (thin vertical line).
        g.strokeColor = color;
        g.lineWidth = 1;
        g.moveTo(x, yL);
        g.lineTo(x, yH);
        g.stroke();
        // Body (rectangle). For flat bars, draw a 1px horizontal line.
        const bodyTop = Math.max(yO, yC);
        const bodyBot = Math.min(yO, yC);
        const bodyH = Math.max(1, bodyTop - bodyBot);
        g.fillColor = color;
        g.rect(x - bodyW / 2, bodyBot, bodyW, bodyH);
        g.fill();
    }

    const drawMs = Date.now() - t0;
    console.log(`${TAG} RENDER | DONE candles=${n} hi=${hiPrice.toPrecision(4)} lo=${loPrice.toPrecision(4)} vol_max=${maxVol.toPrecision(3)} timeframe=${opts.timeframe ?? '?'} denom=${opts.denom ?? 'USD'} mode=${opts.mode ?? 'price'} draw_ms=${drawMs}`);
}

/**
 * Lookback-seconds table per timeframe. Matches solpulse's `INTERVALS` array
 * at `BirdeyeChart.jsx:8-15`. Caller does `toSec - lookback = fromSec`.
 */
export function lookbackFor(tf: OhlcvType): number {
    switch (tf) {
        case '1m':  return 3600;
        case '5m':  return 14400;
        case '15m': return 86400;
        case '1H':  return 259200;
        case '4H':  return 604800;
        case '1D':  return 2592000;
        default:    return 86400;
    }
}
