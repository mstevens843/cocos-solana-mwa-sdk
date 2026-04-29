#!/usr/bin/env node
// 2026-04-29 (Prompt 1) — generate the 9-slice rounded-rect SpriteFrame used
// by every card in the app. Zero deps; emits a valid RGBA PNG with crisp
// 1-px anti-aliased corners. Re-run any time you want to tweak the radius.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function arg(name, fallback) {
    const m = process.argv.find(a => a.startsWith(`--${name}=`));
    return m ? Number(m.split('=')[1]) : fallback;
}
function argStr(name, fallback) {
    const m = process.argv.find(a => a.startsWith(`--${name}=`));
    return m ? m.split('=').slice(1).join('=') : fallback;
}

const SIZE = arg('size', 64);              // 64 px square — see plan
const R    = arg('r',    16);              // corner radius
const NAME = argStr('name', `card_bg_r${R}`);
const OUT  = path.resolve(__dirname, '..',
    `assets/demo/resources/ui/${NAME}.png`);

if (R * 2 > SIZE) {
    console.error(`R (${R}) cannot exceed SIZE/2 (${SIZE / 2})`);
    process.exit(1);
}

// ── Build raw RGBA buffer ────────────────────────────────────────────────
// Inside the rounded silhouette: opaque white (#FFFFFF α=255) so the body
// can be tinted at runtime by cardBodySpr (Palette.bg.card #1E2438 @ 230).
// Outside (corners): fully transparent. 1-px AA on the curve keeps edges
// crisp at 9-slice scale.
const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
        // Nearest pixel inside the corner-center: clamp x,y to [R, SIZE-1-R].
        const cx = x < R ? R : (x > SIZE - 1 - R ? SIZE - 1 - R : x);
        const cy = y < R ? R : (y > SIZE - 1 - R ? SIZE - 1 - R : y);
        const dx = x - cx, dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);

        let a;
        if (d <= R - 1)       a = 255;
        else if (d >= R)      a = 0;
        else                  a = Math.round(255 * (R - d));

        const i = (y * SIZE + x) * 4;
        rgba[i]     = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        rgba[i + 3] = a;
    }
}

// ── PNG encode (IHDR + IDAT + IEND) ──────────────────────────────────────
// Per PNG spec § 11. Each scanline starts with a filter byte (0 = none).
const STRIDE = SIZE * 4;
const filtered = Buffer.alloc(SIZE * (1 + STRIDE));
for (let y = 0; y < SIZE; y++) {
    filtered[y * (1 + STRIDE)] = 0;
    rgba.copy(filtered, y * (1 + STRIDE) + 1, y * STRIDE, (y + 1) * STRIDE);
}
const idat = zlib.deflateSync(filtered, { level: 9 });

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8]  = 8;   // bit depth per channel
ihdr[9]  = 6;   // color type: RGBA
ihdr[10] = 0;   // compression
ihdr[11] = 0;   // filter
ihdr[12] = 0;   // interlace

const png = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${png.length} bytes, ${SIZE}x${SIZE} RGBA, R=${R})`);
