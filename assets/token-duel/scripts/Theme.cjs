/**
 * Theme.cjs — CommonJS twin of Theme.ts, consumed by generate-scenes.js.
 *
 * KEEP IN SYNC with Theme.ts. If you change a value here, change it there too.
 * (The two are intentionally not generated from each other — a generator was
 * overkill for a flat constants table. Eyeball drift on PR review.)
 *
 * Helpers convert hex → {r,g,b,a} so the scene generator can pass tuples
 * directly into cl(r,g,b,a).
 */

const Palette = {
    bg: {
        primary:   '#0B0E1A',
        surface:   '#151929',
        card:      '#1E2438',
        cardHover: '#252B42',
    },
    accent: {
        violet:    '#9945FF',
        violetDim: '#6E2DC9',
        teal:      '#14F195',
        tealDim:   '#0DAA68',
        amber:     '#FFB454',
        amberDim:  '#C8842F',
        rose:      '#FF5C8A',
        roseDim:   '#C13B6A',
    },
    text: {
        hi:      '#F4F5F9',
        mid:     '#A8AEC9',
        lo:      '#5D6485',
        inverse: '#0B0E1A',
    },
    status: {
        win:     '#14F195',
        loss:    '#FF5C8A',
        neutral: '#A8AEC9',
        warn:    '#FFB454',
    },
    rank: {
        gold:   '#FFD24A',
        silver: '#D8DDF0',
        bronze: '#E08A4A',
        slate:  '#5D6485',
    },
    // Phase 14 (B4) — card edge-accent palette. Each card gets a 4-px
    // brand-color strip at its top edge that signals semantic role.
    cardEdge: {
        amber:    [255, 210, 74],   // warm achievement (gold/amber)
        amberW:   [255, 180, 84],   // warmer amber (action)
        teal:     [20, 241, 149],   // status / progress (Solana teal)
        violet:   [153, 69, 255],   // brand / identity
        gold:     [255, 210, 74],   // rank
        blue:     [56, 148, 252],   // data / price
        slate:    [93, 100, 133],   // utility / muted
        edgeAlpha:        255,
        edgeThicknessPx:  4,
    },
    // Phase 13 (B3) — premium button bevel + halo alphas.
    btn: {
        bevelTopAlpha:    52,   // top highlight strip — was a flat 36 in Phase 2c
        bevelBottomAlpha: 46,   // bottom shadow strip — black, new in B3
        glowAlpha:        80,   // hero halo alpha
        glowPaddingPx:    12,   // halo extends 12 px on every side
    },
    // Phase 12 (B1+B2) — neon-trading background polish. Halos sit between
    // the canvas-level black plate and panel content; alpha is intentionally
    // low so corners breathe brand color while center stays dark.
    glow: {
        violet:   '#9945FF3C',  // 60 alpha — top-left halo
        teal:     '#14F19532',  // 50 alpha — bottom-right halo
        amber:    '#FFB45416',  // 22 alpha — center accent spot
        starFar:  '#FFFFFF40',  // 64 alpha — faintest dust tier
        starMid:  '#FFFFFF96',  // 150 alpha — mid tier
        starNear: '#FFFFFFC8',  // 200 alpha — brightest sparks
    },
};

const Spacing = { xs: 4, sm: 8, md: 12, lg: 20, xl: 32, xxl: 48 };
const Radius  = { sm: 6, md: 12, lg: 20, pill: 999 };
const FontSize = { h1: 48, h2: 36, h3: 28, h4: 22, body: 18, small: 14, micro: 11, button: 26, badge: 16 };
const Motion = { fast: 0.12, base: 0.22, slow: 0.40, bg: 0.60 };

/** "#RRGGBB" or "#RRGGBBAA" → {r,g,b,a}. */
function rgba(hex) {
    const h = hex.replace('#', '');
    return {
        r: parseInt(h.substring(0, 2), 16),
        g: parseInt(h.substring(2, 4), 16),
        b: parseInt(h.substring(4, 6), 16),
        a: h.length >= 8 ? parseInt(h.substring(6, 8), 16) : 255,
    };
}

/** Adjust HSL lightness by delta (-1..+1). Used for hover/pressed variants. */
function shift(hex, delta) {
    const { r, g, b, a } = rgba(hex);
    const adj = (c) => Math.max(0, Math.min(255, Math.round(c + delta * 255)));
    return { r: adj(r), g: adj(g), b: adj(b), a };
}

/**
 * Button variant → 4-color tuple {normal, hover, pressed, disabled}.
 * generate-scenes.js btn() consumes these directly.
 */
const ButtonVariants = {
    primary: {
        normal:   rgba(Palette.accent.violet),
        hover:    shift(Palette.accent.violet, 0.08),
        pressed:  shift(Palette.accent.violet, -0.10),
        disabled: { r: 100, g: 100, b: 110, a: 180 },
        textHex:  Palette.text.hi,
    },
    secondary: {
        normal:   rgba(Palette.bg.cardHover),
        hover:    shift(Palette.bg.cardHover, 0.06),
        pressed:  shift(Palette.bg.cardHover, -0.08),
        disabled: { r: 70, g: 70, b: 80, a: 180 },
        textHex:  Palette.text.hi,
    },
    success: {
        normal:   rgba(Palette.accent.teal),
        hover:    shift(Palette.accent.teal, 0.08),
        pressed:  shift(Palette.accent.teal, -0.10),
        disabled: { r: 100, g: 100, b: 110, a: 180 },
        textHex:  Palette.text.inverse,
    },
    danger: {
        normal:   rgba(Palette.accent.rose),
        hover:    shift(Palette.accent.rose, 0.08),
        pressed:  shift(Palette.accent.rose, -0.10),
        disabled: { r: 100, g: 100, b: 110, a: 180 },
        textHex:  Palette.text.hi,
    },
    warn: {
        normal:   rgba(Palette.accent.amber),
        hover:    shift(Palette.accent.amber, 0.08),
        pressed:  shift(Palette.accent.amber, -0.10),
        disabled: { r: 100, g: 100, b: 110, a: 180 },
        textHex:  Palette.text.inverse,
    },
    ghost: {
        normal:   { r: 21, g: 25, b: 41, a: 255 },     // bg.surface
        hover:    { r: 30, g: 36, b: 56, a: 255 },     // bg.card
        pressed:  { r: 37, g: 43, b: 66, a: 255 },     // bg.cardHover
        disabled: { r: 100, g: 100, b: 110, a: 180 },
        textHex:  Palette.text.mid,
    },
};

module.exports = {
    Palette,
    Spacing,
    Radius,
    FontSize,
    Motion,
    ButtonVariants,
    rgba,
    shift,
};
