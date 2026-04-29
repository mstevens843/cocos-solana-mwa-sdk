/**
 * Theme.ts — single source of truth for Token Duel UX.
 *
 * Palette, spacing, radii, typography, motion. Replaces the hardcoded RGB
 * tuples scattered through generate-scenes.js (line 31, 195+) and AppUI
 * tween call sites.
 *
 * KEEP IN SYNC with Theme.cjs (CommonJS twin used by generate-scenes.js).
 * The two files mirror each other intentionally — a generator was overkill
 * for ~150 lines of constants. If you change a value here, change it in
 * Theme.cjs too.
 */

import { Color } from 'cc';

/* ── Palette ─────────────────────────────────────────────────────────── */

export const Palette = {
    bg: {
        primary:   '#0B0E1A',
        // 2026-04-27 UI overhaul: #151929 → #121826 per arena-UI spec.
        surface:   '#121826',
        card:      '#1E2438',
        cardHover: '#252B42',
        // 2026-04-27 Landing UX upgrade — vertical depth gradient on landing.
        gradientTop: '#1A0B2E',  // deep purple at top
        gradientBot: '#050810',  // near-black at bottom
        // 2026-04-28 Hub-tab visibility upgrade — segmented-pill containers
        // need edge contrast against the panel surface. pillTray sits ~6%
        // brighter than `surface`; pillTrayHi gives the primary (violet) hub
        // pill an extra step of contrast over secondary (teal) sub-pills.
        pillTray:   '#1F2438',
        pillTrayHi: '#262C44',
    },
    accent: {
        violet:    '#9945FF',  // Solana violet
        violetDim: '#6E2DC9',
        teal:      '#14F195',  // Solana teal
        tealDim:   '#0DAA68',
        amber:     '#FFB454',
        amberDim:  '#C8842F',
        // 2026-04-27 UI overhaul: #FF5C8A → #FF4D4D for stronger negative read.
        rose:      '#FF4D4D',
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
        loss:    '#FF4D4D',
        neutral: '#A8AEC9',
        warn:    '#FFB454',
    },
    rank: {
        gold:   '#FFD24A',
        silver: '#D8DDF0',
        bronze: '#E08A4A',
        slate:  '#5D6485',
    },
    border: {
        subtleHex: '#FFFFFF14',  // 8% alpha
        strongHex: '#FFFFFF29',  // 16% alpha
    },
    // 2026-04-28 fighter-card redesign — squad slot pillar palette.
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
    // 2026-04-28 fighter-card redesign — alpha applied to WagerStartButton
    // sprite when the squad is incomplete, so the CTA visibly dims.
    ctaDimAlpha: 130,
    // Phase 14 (B4) — card edge-accent palette.
    cardEdge: {
        amber:    [255, 210, 74],
        amberW:   [255, 180, 84],
        teal:     [20, 241, 149],
        violet:   [153, 69, 255],
        // 2026-04-27 UI overhaul — selected/active glow.
        violetActive: [153, 69, 255],
        rose:     [255, 77,  77],
        gold:     [255, 210, 74],
        blue:     [56, 148, 252],
        slate:    [93, 100, 133],
        // 2026-04-27 FindMatch redesign: hairline used to subdivide rows
        // inside the unified filter card.
        divider:  [60, 70, 95],
        edgeAlpha:        255,
        edgeThicknessPx:  4,
    },
    // 2026-04-27 FindMatch redesign — pulse dot beside the count label.
    // Tab-conditional: rose when on Live, teal when on Open Lobbies.
    live: {
        pulseOpen: [20, 241, 149],
        pulseLive: [255, 92, 138],
    },
    // Phase 13 (B3) — premium button bevel + halo alphas.
    btn: {
        bevelTopAlpha:    52,
        bevelBottomAlpha: 46,
        glowAlpha:        80,
        glowPaddingPx:    12,
    },
    // 2026-04-27 — Game-Over screen palette. Replaces full-screen pink/teal
    // wash with a deep-dark base + colored radial glow. Keeps colors out of
    // AppUI (where they were hardcoded as Color(48,198,155,255) literals).
    result: {
        baseDark:    '#0B0E1A',  // canvas wash — deep, near-black
        cardBg:      '#121826',  // stat-card surface — slightly above bg
        cardEdge:    '#1F2A44',  // muted blue-gray for secondary chrome
        win:  { glow: '#1FE0A5', accent: '#22E39A', sub: '#7FE9C4' },
        loss: { glow: '#FF5A6A', accent: '#FF6B7A', sub: '#F2A0AB' },
    },
    // Phase 12 (B1+B2) — neon-trading background polish.
    glow: {
        violet:   '#9945FF3C',
        teal:     '#14F19532',
        amber:    '#FFB45416',
        starFar:  '#FFFFFF40',
        starMid:  '#FFFFFF96',
        starNear: '#FFFFFFC8',
        // 2026-04-27 Landing UX — gold halo behind TitleLabel.
        gold:     '#FFD24A40',
    },
} as const;

/* ── Spacing / Radii ──────────────────────────────────────────────────── */

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 20, xl: 32, xxl: 48 } as const;
// 2026-04-29 (Prompt 1) hierarchy lock-in: every button uses the same corner
// radius so shape variation can never drift between tiers. Tabs keep the pill
// (h/2) since they're a different component family.
export const Radius  = { sm: 6, md: 12, lg: 20, pill: 999, btn: 16 } as const;

/* ── Card system ─────────────────────────────────────────────────────── */

// 2026-04-29 (Prompt 1) — unified card chrome. Every card built via
// generate-scenes.js mkCard() reads from this block. Body color is one
// canonical surface (Palette.bg.card); corners are a single 16 px 9-slice
// SpriteFrame (asset: assets/demo/resources/ui/card_bg_r16.png); padding is
// bucketed dense/default/feature; elevation is bucketed base/elevated/
// interactive. Edge accent color stays per-card-semantic (Palette.cardEdge.*).
export const Card = {
    bgHex: Palette.bg.card,            // '#1E2438'
    bgAlpha: 230,                      // ~90% — replaces 130/255 drift
    radiusPx: 16,                      // asset-driven; tokenized for docs
    padding: {
        dense:   12,                   // leaderboard rows, history rows
        default: 16,                   // most cards
        feature: 20,                   // hero / CTA cards
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
    edgeThicknessPx: 4,                // mirrors Palette.cardEdge.edgeThicknessPx
} as const;

/* ── Typography ──────────────────────────────────────────────────────── */

export const Type = {
    display: { family: 'Sora-Bold',         systemFallback: 'Arial', weights: [700] },
    body:    { family: 'Inter-Regular',     systemFallback: 'Arial', weights: [400, 600] },
    mono:    { family: 'JetBrainsMono-Regular', systemFallback: 'Menlo', weights: [400] },
} as const;

export const FontSize = {
    h1: 48, h2: 36, h3: 28, h4: 22,
    body: 18, small: 14, micro: 11,
    button: 26, badge: 16,
} as const;

/* ── Motion ──────────────────────────────────────────────────────────── */

export const Motion = {
    fast: 0.12,   // 120ms — micro-interactions, tap feedback
    base: 0.22,   // 220ms — panel swaps, modal show
    slow: 0.40,   // 400ms — celebration, level-up
    bg:   0.60,   // 600ms — ambient background loops
} as const;

export const Easing = {
    snap:    'cubicOut',
    settle:  'backOut',
    smooth:  'sineInOut',
    leave:   'cubicIn',
} as const;

/* ── Button hierarchy ────────────────────────────────────────────────── */

// 2026-04-29 (Prompt 1) — global button hierarchy. Every button in the app
// resolves to one of four tiers; ButtonTierSpec[tier] dictates structural
// properties (size, glow, effects). Color/variant is still chosen at the
// call site via ButtonVariants — tier is hierarchy, variant is brand.
//
//   primary    → hero CTA. Find Match, Start Match, Connect, Play Again.
//   secondary  → major nav. Matches In Progress, Reconnect.
//   tertiary   → inline / minor controls. Refresh, Reset, Settings rows.
//   danger     → destructive actions. Delete account.
export type ButtonTier = 'primary' | 'secondary' | 'tertiary' | 'danger';

export const ButtonTierSpec: Record<ButtonTier, {
    height: number;
    fontSize: number;
    iconSize: number;
    glowAlpha: number;
    glowPad: number;
    paddingX: number;
    pressPop: boolean;
    idlePulse: boolean;
    ripple: boolean;
    shimmer: boolean;
    strongPress: boolean;
}> = {
    primary:   { height: 132, fontSize: 32, iconSize: 32, glowAlpha: 110, glowPad: 14, paddingX: 24, pressPop: true, idlePulse: true,  ripple: true,  shimmer: false, strongPress: true  },
    secondary: { height: 100, fontSize: 24, iconSize: 26, glowAlpha:  70, glowPad: 10, paddingX: 22, pressPop: true, idlePulse: false, ripple: false, shimmer: false, strongPress: true  },
    tertiary:  { height:  48, fontSize: 18, iconSize: 20, glowAlpha:   0, glowPad:  0, paddingX: 16, pressPop: true, idlePulse: false, ripple: false, shimmer: false, strongPress: false },
    danger:    { height:  48, fontSize: 18, iconSize: 20, glowAlpha:  50, glowPad:  6, paddingX: 16, pressPop: true, idlePulse: false, ripple: false, shimmer: false, strongPress: false },
};

/* ── Tab hierarchy ───────────────────────────────────────────────────── */

// 2026-04-29 (Prompt 2) — global tab hierarchy. _buildSegmentedPill in
// AppUI.ts pulls all visual properties from TabTierSpec[tier]. Three tiers:
//   hub  → primary navigation (Portfolio / Leaderboard) — violet, tallest.
//   mode → mode switching (1v1 / Trio / 4p / 8p, Open / Live) — teal, mid.
//   sub  → content filtering (Stats / History / Trophies) — teal, smallest.
//
// Inactive label alpha is locked at 180 (~70%) per Prompt 2 spec — never
// fade below readability.
export type TabTier = 'hub' | 'mode' | 'sub';

export const TabTierSpec: Record<TabTier, {
    height: number;
    fontSize: number;
    activeFillHex: string;
    trayBgHex: string;
    glowOuterAlpha: number;
    glowInnerAlpha: number;
    activeLabelAlpha: number;
    inactiveLabelAlpha: number;
    slideMs: number;
}> = {
    hub:  { height: 56, fontSize: 20, activeFillHex: Palette.accent.violet, trayBgHex: Palette.bg.pillTrayHi, glowOuterAlpha: 60, glowInnerAlpha: 140, activeLabelAlpha: 255, inactiveLabelAlpha: 180, slideMs: 200 },
    mode: { height: 48, fontSize: 18, activeFillHex: Palette.accent.teal,   trayBgHex: Palette.bg.pillTray,   glowOuterAlpha: 60, glowInnerAlpha: 140, activeLabelAlpha: 255, inactiveLabelAlpha: 180, slideMs: 200 },
    sub:  { height: 40, fontSize: 16, activeFillHex: Palette.accent.teal,   trayBgHex: Palette.bg.pillTray,   glowOuterAlpha: 50, glowInnerAlpha: 110, activeLabelAlpha: 255, inactiveLabelAlpha: 180, slideMs: 200 },
};

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Parse "#RRGGBB" or "#RRGGBBAA" → cc.Color. */
export function colorFromHex(hex: string): Color {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    const a = h.length >= 8 ? parseInt(h.substring(6, 8), 16) : 255;
    return new Color(r, g, b, a);
}

/** Parse hex → {r,g,b,a} plain object (no cc.Color allocation). */
export function rgbaFromHex(hex: string): { r: number; g: number; b: number; a: number } {
    const h = hex.replace('#', '');
    return {
        r: parseInt(h.substring(0, 2), 16),
        g: parseInt(h.substring(2, 4), 16),
        b: parseInt(h.substring(4, 6), 16),
        a: h.length >= 8 ? parseInt(h.substring(6, 8), 16) : 255,
    };
}

/** Convenience wrappers reused throughout AppUI. */
export const themeColor = {
    win:     () => colorFromHex(Palette.status.win),
    loss:    () => colorFromHex(Palette.status.loss),
    neutral: () => colorFromHex(Palette.status.neutral),
    warn:    () => colorFromHex(Palette.status.warn),
    textHi:  () => colorFromHex(Palette.text.hi),
    textMid: () => colorFromHex(Palette.text.mid),
    textLo:  () => colorFromHex(Palette.text.lo),
    violet:  () => colorFromHex(Palette.accent.violet),
    teal:    () => colorFromHex(Palette.accent.teal),
    amber:   () => colorFromHex(Palette.accent.amber),
    rose:    () => colorFromHex(Palette.accent.rose),
    gold:    () => colorFromHex(Palette.rank.gold),
    silver:  () => colorFromHex(Palette.rank.silver),
    bronze:  () => colorFromHex(Palette.rank.bronze),
};
