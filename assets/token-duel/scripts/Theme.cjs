/**
 * Theme.cjs - CommonJS twin of Theme.ts, consumed by generate-scenes.js.
 *
 * KEEP IN SYNC with Theme.ts. If you change a value here, change it there too.
 * (The two are intentionally not generated from each other - a generator was
 * overkill for a flat constants table. Eyeball drift on PR review.)
 *
 * Helpers convert hex → {r,g,b,a} so the scene generator can pass tuples
 * directly into cl(r,g,b,a).
 */

const Palette = {
    bg: {
        // 2026-04-30 v3 - wine eggplant rollout - keep in sync with Theme.ts.
        primary:   '#0A0410',
        surface:   '#1A0820',
        card:      '#1A0820',
        cardHover: '#321448',
        gradientTop: '#1A0B2E',
        gradientBot: '#050810',
        pillTray:   '#241030',
        pillTrayHi: '#321448',
    },
    accent: {
        violet:    '#9945FF',
        violetDim: '#6E2DC9',
        teal:      '#14F195',
        tealDim:   '#0DAA68',
        amber:     '#FFB454',
        amberDim:  '#C8842F',
        // 2026-04-27 UI overhaul: #FF5C8A → #FF4D4D for stronger negative read.
        rose:      '#FF4D4D',
        roseDim:   '#C13B6A',
    },
    text: {
        // 2026-04-30 high-contrast pass - keep in sync with Theme.ts.
        hi:      '#FFFFFF',  // was '#F4F5F9'
        mid:     '#B8B8B8',  // was '#A8AEC9'
        lo:      '#8C8C8C',  // was '#5D6485'
        inverse: '#05070D',
    },
    status: {
        win:     '#14F195',
        loss:    '#FF4D4D',
        neutral: '#B8B8B8',  // was '#A8AEC9' - match text.mid
        warn:    '#FFB454',
    },
    rank: {
        gold:   '#FFD24A',
        silver: '#D8DDF0',
        bronze: '#E08A4A',
        slate:  '#5D6485',
    },
    // 2026-04-28 fighter-card redesign - squad slot pillar palette.
    // emptyBg: dark drop-zone background; filledBg: slightly lifted to give the
    // selected fighter card visual elevation; emptyBorder/targetBorder are the
    // CardEdgeAccent strip alphas swapped at runtime.
    slot: {
        emptyBg:        '#161A28F0',
        filledBg:       '#181C2CF0',
        emptyBorder:    '#FFFFFF50',
        targetBorder:   '#9945FFDC',
        silhouetteFill: '#5D648540',
    },
    // 2026-04-28 fighter-card redesign - alpha applied to WagerStartButton
    // sprite when the squad is incomplete, so the CTA visibly dims.
    ctaDimAlpha: 130,
    // Phase 14 (B4) - card edge-accent palette. Each card gets a 4-px
    // brand-color strip at its top edge that signals semantic role.
    cardEdge: {
        amber:    [255, 210, 74],   // warm achievement (gold/amber)
        amberW:   [255, 180, 84],   // warmer amber (action)
        teal:     [20, 241, 149],   // status / progress (Solana teal)
        violet:   [153, 69, 255],   // brand / identity
        // 2026-04-27 UI overhaul: dedicated active/selected glow.
        violetActive: [153, 69, 255],
        rose:     [255, 77,  77],   // negative perf glow
        gold:     [255, 210, 74],   // rank
        blue:     [56, 148, 252],   // data / price
        slate:    [93, 100, 133],   // utility / muted
        // 2026-04-27 FindMatch redesign: hairline used to subdivide rows
        // inside the unified filter card.
        divider:  [60, 70, 95],
        edgeAlpha:        255,
        edgeThicknessPx:  4,
    },
    // 2026-04-27 FindMatch redesign - pulse dot beside the count label.
    // Tab-conditional: rose when on Live, teal when on Open Lobbies.
    live: {
        pulseOpen: [20, 241, 149],
        pulseLive: [255, 92, 138],
    },
    // Phase 13 (B3) - premium button bevel + halo alphas.
    btn: {
        bevelTopAlpha:    52,   // top highlight strip - was a flat 36 in Phase 2c
        bevelBottomAlpha: 46,   // bottom shadow strip - black, new in B3
        glowAlpha:        80,   // hero halo alpha
        glowPaddingPx:    12,   // halo extends 12 px on every side
    },
    // 2026-04-27 - Game-Over screen palette. Mirrors Theme.ts ResultPalette.
    result: {
        baseDark:    '#0B0E1A',
        cardBg:      '#121826',
        cardEdge:    '#1F2A44',
        win:  { glow: '#1FE0A5', accent: '#22E39A', sub: '#7FE9C4' },
        loss: { glow: '#FF5A6A', accent: '#FF6B7A', sub: '#F2A0AB' },
    },
    // Phase 12 (B1+B2) - neon-trading background polish. Halos sit between
    // the canvas-level black plate and panel content; alpha is intentionally
    // low so corners breathe brand color while center stays dark.
    glow: {
        violet:   '#9945FF3C',  // 60 alpha - top-left halo
        teal:     '#14F19532',  // 50 alpha - bottom-right halo
        amber:    '#FFB45416',  // 22 alpha - center accent spot
        starFar:  '#FFFFFF40',  // 64 alpha - faintest dust tier
        starMid:  '#FFFFFF96',  // 150 alpha - mid tier
        starNear: '#FFFFFFC8',  // 200 alpha - brightest sparks
        // 2026-04-27 Landing UX - gold halo behind TitleLabel.
        gold:     '#FFD24A40',  // 64 alpha - title shimmer
    },
};

const Spacing = { xs: 4, sm: 8, md: 12, lg: 20, xl: 32, xxl: 48 };
// 2026-04-29 (Prompt 1) hierarchy lock-in: every button uses the same corner
// radius so shape variation can never drift between tiers.
const Radius  = { sm: 6, md: 12, lg: 20, pill: 999, btn: 16 };

// 2026-04-29 (Prompt 1) - unified card chrome. Mirrors Theme.ts Card block.
// One canonical body color, one 9-slice corner radius, three padding
// buckets, three elevation tiers. Edge color stays per-card semantic.
const Card = {
    bgHex: Palette.bg.card,            // 2026-04-30: now '#0A0D14' (was '#1E2438')
    bgAlpha: 235,                      // ~92% - denser for black-glass
    radiusPx: 16,
    padding: {
        dense:   12,
        default: 16,
        feature: 20,
    },
    gap: {
        headerToContent: 16,
        contentToMeta:   16,
        intra:           12,
    },
    elevation: {
        base:        { glowAlpha: 0,   glowSpreadPx: 0  },
        elevated:    { glowAlpha: 60,  glowSpreadPx: 12 },
        interactive: { glowAlpha: 110, glowSpreadPx: 16 },
    },
    edgeThicknessPx: 4,
};
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

// 2026-04-29 (Prompt 1) - global button hierarchy. Every button resolves to
// one tier; the tier dictates structural properties (size, glow, effects).
// Variant (color) is still chosen at the call site via ButtonVariants -
// tier is hierarchy, variant is brand. Mirrors ButtonTierSpec in Theme.ts.
//   primary    → hero CTA. Find Match, Start Match, Connect, Play Again.
//   secondary  → major nav. Matches In Progress, Reconnect.
//   tertiary   → inline / minor controls. Refresh, Reset, Settings rows.
//   danger     → destructive actions. Delete account.
const ButtonTierSpec = {
    // Heights aligned to existing LayoutSpec.cjs values (136h FindMatch, 104h
    // Start/MIP/Bot) - both sit inside the user's spec ranges.
    primary:   { height: 136, fontSize: 32, iconSize: 32, glowAlpha: 110, glowPad: 16, paddingX: 24, pressPop: true, idlePulse: true,  ripple: true,  shimmer: false, strongPress: true  },
    secondary: { height: 104, fontSize: 24, iconSize: 26, glowAlpha:  70, glowPad: 12, paddingX: 22, pressPop: true, idlePulse: false, ripple: false, shimmer: false, strongPress: true  },
    tertiary:  { height:  48, fontSize: 18, iconSize: 20, glowAlpha:   0, glowPad:  0, paddingX: 16, pressPop: true, idlePulse: false, ripple: false, shimmer: false, strongPress: false },
    danger:    { height:  48, fontSize: 18, iconSize: 20, glowAlpha:  50, glowPad:  6, paddingX: 16, pressPop: true, idlePulse: false, ripple: false, shimmer: false, strongPress: false },
};

// 2026-04-29 (Prompt 2) - global tab hierarchy. _buildSegmentedPill in
// AppUI.ts pulls all visual properties from TabTierSpec[tier]. Inactive
// label alpha locked at 180 (~70%) - never fade below readability.
//   hub  → primary navigation (Portfolio / Leaderboard) - violet, tallest.
//   mode → mode switching (1v1 / Trio / 4p / 8p, Open / Live) - teal, mid.
//   sub  → content filtering (Stats / History / Trophies) - teal, smallest.
const TabTierSpec = {
    hub:  { height: 56, fontSize: 20, activeFillHex: Palette.accent.violet, trayBgHex: Palette.bg.pillTrayHi, glowOuterAlpha: 60, glowInnerAlpha: 140, activeLabelAlpha: 255, inactiveLabelAlpha: 180, slideMs: 200 },
    mode: { height: 48, fontSize: 18, activeFillHex: Palette.accent.teal,   trayBgHex: Palette.bg.pillTray,   glowOuterAlpha: 60, glowInnerAlpha: 140, activeLabelAlpha: 255, inactiveLabelAlpha: 180, slideMs: 200 },
    sub:  { height: 40, fontSize: 16, activeFillHex: Palette.accent.teal,   trayBgHex: Palette.bg.pillTray,   glowOuterAlpha: 50, glowInnerAlpha: 110, activeLabelAlpha: 255, inactiveLabelAlpha: 180, slideMs: 200 },
};

module.exports = {
    Palette,
    Spacing,
    Radius,
    Card,
    FontSize,
    Motion,
    ButtonVariants,
    ButtonTierSpec,
    TabTierSpec,
    rgba,
    shift,
};
