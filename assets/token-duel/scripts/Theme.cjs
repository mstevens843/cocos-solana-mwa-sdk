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
