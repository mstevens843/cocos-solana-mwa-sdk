#!/usr/bin/env node
/**
 * build-lucide-icons.mjs
 *
 * Render six Lucide SVG icons into white-on-transparent PNGs that the
 * Cocos `resources` bundle can load via `IconLibrary.register`. The runtime
 * tint via `IconLibrary.attach({ tintHex })` paints the white pixels to the
 * target color, so one PNG per icon covers any future tint change.
 *
 * Usage: `npm run build:icons`. Re-run any time the source list or size
 * changes; output is committed to assets/demo/resources/icons/.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'assets', 'demo', 'resources', 'icons');
const SVG_PIXEL_SIZE = 192;

// Map: IconName slot in IconLibrary -> Lucide SVG basename.
// Output filename = `<IconName>.png` so Cocos resolves
// `resources.load('icons/<IconName>/spriteFrame', ...)`.
const ICONS = [
    { name: 'lucideSparkles',   svg: 'sparkles' },
    { name: 'lucideFlame',      svg: 'flame' },
    { name: 'lucideTrendingUp', svg: 'trending-up' },
    { name: 'lucideBarChart',   svg: 'chart-column' },
    { name: 'lucideGlobe',      svg: 'globe' },
    { name: 'lucideStar',       svg: 'star' },
];

function loadSvg(svgName) {
    const candidates = [
        join(REPO_ROOT, 'node_modules', 'lucide-static', 'icons', `${svgName}.svg`),
    ];
    for (const p of candidates) {
        if (existsSync(p)) return readFileSync(p, 'utf8');
    }
    throw new Error(`lucide-static SVG not found: ${svgName}.svg (tried ${candidates.join(', ')})`);
}

function tintWhite(svgString) {
    return svgString
        .replace(/stroke="currentColor"/g, 'stroke="#FFFFFF"')
        .replace(/fill="currentColor"/g, 'fill="#FFFFFF"');
}

function renderToPng(svg, outPath) {
    const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: SVG_PIXEL_SIZE },
        background: 'rgba(0,0,0,0)',
        font: { loadSystemFonts: false },
    });
    const png = resvg.render().asPng();
    writeFileSync(outPath, png);
}

function main() {
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    let ok = 0;
    for (const { name, svg } of ICONS) {
        try {
            const raw = loadSvg(svg);
            const tinted = tintWhite(raw);
            const outPath = join(OUT_DIR, `${name}.png`);
            renderToPng(tinted, outPath);
            console.log(`[build-icons] ${name} -> ${outPath} (${SVG_PIXEL_SIZE}px)`);
            ok++;
        } catch (err) {
            console.error(`[build-icons] FAIL ${name}: ${err.message}`);
        }
    }
    console.log(`[build-icons] DONE ${ok}/${ICONS.length}`);
    if (ok !== ICONS.length) process.exit(1);
}

main();
