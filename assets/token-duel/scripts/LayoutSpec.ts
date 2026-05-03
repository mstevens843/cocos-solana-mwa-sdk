/**
 * LayoutSpec.ts - TypeScript twin of LayoutSpec.cjs.
 *
 * KEEP IN SYNC with LayoutSpec.cjs (source of truth for scene-generator).
 * Update both files together.
 *
 * Imported from runtime code only when AppUI / a controller needs to
 * read a position at runtime (rare - most consumption is at scene-gen
 * time). Build-time scene generation reads the .cjs.
 */

export interface ElementSpec {
    x: number;
    y: number;
    w: number;
    h: number;
    type: 'label' | 'sprite' | 'btnPrimary' | 'btnSuccess' | 'btnDanger' | 'btnGhost' | 'btnWarn' | 'mascot' | 'graphics' | 'group' | 'image' | 'editbox' | 'scrollview' | 'chip' | 'tab' | 'badge' | 'slider';
    anchor?: [number, number];
    notes?: string;
}

export interface PanelSpec {
    canvas: { w: number; h: number };
    bg?: { color: string };
    /**
     * Override for panels whose topmost solid element is built at runtime
     * (e.g. Portfolio/Leaderboard HubTabStrip). Generator's lobbyMount()
     * uses this when scanning `elements` would miss the real visual top.
     * See generate-scenes.js `computePanelTopEdge()`.
     */
    RUNTIME_TOP_EDGE?: number;
    elements: Record<string, ElementSpec>;
    templates?: Record<string, { count: number; baseX?: number; baseY?: number; gapX?: number; gapY?: number; x?: number; y?: number; w: number; h: number }>;
    allowedOverlaps: Array<[string, string]>;
}

// 2026-04-29 - uniform back/title/subtitle header band, mirrors MIP.
// Every panel with a back button must use these exact panel-local Y values
// and the (x, w, h) shape below. MatchesInProgressPanel is the canonical
// reference (back on its own row, title 40 below, subtitle 36 below title).
export const UNIFORM_HEADER = {
    BACK_Y:     580,
    TITLE_Y:    540,
    SUBTITLE_Y: 504,
    BACK_LINK:  { x: -280, w: 110, h: 28 },
    BACK_BTN:   { x: -280, w: 140, h: 36 },
} as const;

// 2026-04-29 - uniform text styling tokens. Title color = gold for action
// panels (PostMatch keeps its 60pt white hero accent for "YOU WON"). Dim
// text = one canonical RGB for subtitles, status labels, and section
// eyebrows. Eyebrow font size = 12pt across panels.
export const UNIFORM_TEXT = {
    TITLE_COLOR:       { r: 255, g: 210, b: 74 },
    TITLE_FONT_SIZE:   30,
    DIM_COLOR:         { r: 168, g: 174, b: 201 },
    EYEBROW_FONT_SIZE: 12,
} as const;

// 2026-04-29 - UNIFORM spacing scale. Every sibling-to-sibling y delta in
// a panel must come from this set. No literal 36/40/56/72 etc. Compose
// SPACE_32 + SPACE_16 to get 48; SPACE_32 + SPACE_24 for 56; etc.
export const UNIFORM_SPACE = {
    SPACE_8:  8,
    SPACE_12: 12,
    SPACE_16: 16,
    SPACE_24: 24,
    SPACE_32: 32,
} as const;

// 2026-04-29 - UNIFORM centered content column. Cards / CTAs / list rows
// snap to CONTENT_W. Subtitles use BODY_W (narrower for line-length).
// Chips use CHIP_W. Full-canvas backgrounds use CANVAS_W. SAFE_L/R define
// the column edges for left-anchored content.
export const UNIFORM_LAYOUT = {
    CONTENT_W: 680,
    BODY_W:    600,
    CHIP_W:    200,
    CANVAS_W:  720,

    SAFE_L:   -340,
    SAFE_R:    340,

    SECTION_GAP_LARGE: 32,
    SECTION_GAP:       24,
    GROUP_GAP:         16,
    INTRA_GAP:         12,
    TIGHT_GAP:          8,
} as const;

// 2026-04-29 (Prompt 1) - UNIFORM card geometry. Every card built via
// generate-scenes.js mkCard() uses one of these heights. Row stride =
// h + ROW_GAP. NOTIFICATION_H is a one-off - toast row chrome (left
// ColorStripe) is intentionally not in the unified card system.
export const UNIFORM_CARD = {
    ROW_DENSE_H:     56,
    ROW_DEFAULT_H:   88,
    ROW_FEATURE_H:  160,
    ROW_GAP:          8,
    NOTIFICATION_H:  92,
} as const;

// 2026-05-02 arena rebuild (Phase B). Filter section compacted ~324→180px:
// Mode pill on its own row (full width 600), Duration + Stake side-by-side
// on the second row (290w each), Hide-full toggle in the bottom band of
// the filter card. Captions (Mode/Duration/Stake) hidden - pills are
// self-evident at this size. CTA + lobby pool lift up to fill freed space.
// One source of truth - both LayoutSpec.cjs (scene-gen) and AppUI runtime
// must read y/w/h from this block so the layout cannot drift.
export const FINDMATCH_LAYOUT = {
    SECTION_GAP:     24,
    GROUP_GAP:       16,
    PILL_GAP:         8,
    CARD_PADDING:    16,
    HEADER_Y:       750,   // back link / level chip
    TITLE_Y:        695,   // own row, no overlap with mode pill
    STATUS_Y:       655,   // "LIVE · N matches active now" - runtime opacity 230 when active
    TABS_Y:         615,   // Open Lobbies / Live Now
    FILTER_CARD:  { x: 0, y: 484, w: 640, h: 180 },
    // Captions hidden in compact layout - pills are self-evident.
    MODE_LABEL_Y:   -2000,
    WINDOW_LABEL_Y: -2000,
    WAGER_LABEL_Y:  -2000,
    MODE_ROW_Y:     536,   // top row, full width (600w, 5 segs)
    WINDOW_ROW_Y:   468,   // second row, left half (290w, x=-155)
    WAGER_ROW_Y:    468,   // second row, right half (290w, x=+155)
    HIDE_FULL_Y:    410,   // right-anchored chip inside filter card
    PRIMARY_CTA_Y:  336,
    PRIMARY_CTA_W:  680,
    PRIMARY_CTA_H:   72,
    ROW_BASE_Y:     206,   // first lobby card center (lifted 54→206)
    ROW_STRIDE_Y:  -156,   // 140h card + 16 gap (unchanged)
    ROW_HEIGHT:     140,   // unchanged - internal sub-row offsets stay valid
    PAGINATION_Y:  -360,   // 24px below row 3 bottom (-340)
} as const;

// 2026-04-29 PostMatch viewport-aware 3-zone resolver. Mirrors pm.zones
// in LayoutSpec.cjs. AppUI._relayoutPostMatchToViewport reads
// view.getVisibleSize() and snaps each child to (zoneAnchor + delta) so
// the layout follows the device viewport instead of the panel canvas.
//   topAnchor = (vh / 2) - SAFE_AREA_TOP
//   centerY   = 0                          (panel root rests at world origin)
//   botAnchor = (-vh / 2) + SAFE_AREA_BOT
export const POSTMATCH_SAFE_AREA_TOP = 110;
export const POSTMATCH_SAFE_AREA_BOT =  96;
// 2026-04-29 win-screen redesign: reward block (eyebrow + payout +
// breakdown + subtitle) moves OUT of bottom zone INTO top zone, above the
// mascot. Mascot stays centered. Rake drops to bottom zone above cards.
// KEEP IN SYNC with LayoutSpec.cjs `pm.zones`.
export const POSTMATCH_ZONES = {
    top: {
        backLink:      -2000,    // hidden - back button removed from win screen
        backBtn:       -2000,
        // 2026-04-29 game-over polish - hero block shifted ~48 px DOWN
        // from safe-top, internal gaps tightened to (16/22/10/14/10).
        // KEEP IN SYNC with LayoutSpec.cjs `pm.zones.top`.
        title:           -56,
        track:          -134,
        earned:         -176,
        payoutLabel:    -240,
        breakdownPill:  -316,
        subtitle:       -360,
        trophy:          -76,
    },
    center: {
        // 2026-04-29 - mascot nudged 25 px up to balance lowered hero.
        mascotGlow:       25,
        mascotContainer:  25,
    },
    bottom: {
        sameSquadBtn:     56,
        againBtn:         56,
        sameSquadGlow:    56,
        xpBarFill:       150,
        xpBarLabelLeft:  150,
        xpBarLabelRight: 150,
        cardsRow2:       244,
        cardsRow1:       388,
        rake:            540,    // moved out of card-row interleave
        shareButton:      90,
        status:          -50,
    },
} as const;

// 2026-04-29 - Dashboard zone scaffold. Mirrors DashboardLayoutSpec in
// LayoutSpec.cjs. AppUI runtime pill builders (Stats/History/Trophies, Paper/
// Real, 1v1/Trio/4p/8p, Portfolio/Leaderboard hub strip) read y from these
// zones so they cannot drift into a sibling row.
export interface DashboardZone {
    topY: number;
    bottomY: number;
    centerY: number;
    height: number;
}
export interface DashboardZones {
    header:      DashboardZone;
    title:       DashboardZone;
    modeSwitch:  DashboardZone | null;
    subtab:      DashboardZone;
    content:     DashboardZone;
}
function _zone(topY: number, height: number): DashboardZone {
    const bottomY = topY - height;
    return { topY, bottomY, centerY: topY - height / 2, height };
}
export function buildDashboardZones(opts: { includeModeSwitch: boolean }): DashboardZones {
    const TOP = 760;
    const H = { header: 80, title: 88, modeSwitch: 60, subtab: 60 };
    const header     = _zone(TOP, H.header);
    const title      = _zone(header.bottomY, H.title);
    const modeSwitch = opts.includeModeSwitch ? _zone(title.bottomY, H.modeSwitch) : null;
    const subtab     = _zone((modeSwitch || title).bottomY, H.subtab);
    const contentTop = subtab.bottomY;
    const contentBottom = -480;
    const content: DashboardZone = {
        topY: contentTop,
        bottomY: contentBottom,
        centerY: (contentTop + contentBottom) / 2,
        height: contentTop - contentBottom,
    };
    return { header, title, modeSwitch, subtab, content };
}
export const DashboardLayoutSpec = {
    portfolio:   buildDashboardZones({ includeModeSwitch: true }),
    leaderboard: buildDashboardZones({ includeModeSwitch: false }),
} as const;

export const LayoutSpec: Record<string, PanelSpec> = {
    BackgroundFX: {
        canvas: { w: 720, h: 1280 },
        elements: {
            glowTopLeft_Outer:  { x: -220, y: 480,  w: 1300, h: 1300, type: 'sprite' },
            glowTopLeft_Mid:    { x: -220, y: 480,  w: 1050, h: 1050, type: 'sprite' },
            glowTopLeft_Inner:  { x: -220, y: 480,  w:  800, h:  800, type: 'sprite' },
            glowBotRight_Outer: { x:  240, y: -520, w: 1250, h: 1250, type: 'sprite' },
            glowBotRight_Mid:   { x:  240, y: -520, w: 1000, h: 1000, type: 'sprite' },
            glowBotRight_Inner: { x:  240, y: -520, w:  760, h:  760, type: 'sprite' },
            glowCenter_Outer:   { x:    0, y:    0, w:  900, h:  900, type: 'sprite' },
            glowCenter_Mid:     { x:    0, y:    0, w:  750, h:  750, type: 'sprite' },
            glowCenter_Inner:   { x:    0, y:    0, w:  600, h:  600, type: 'sprite' },
            starfield:          { x:    0, y:    0, w:  720, h: 1280, type: 'group' },
        },
        allowedOverlaps: [],
    },
    Landing: {
        canvas: { w: 720, h: 1280 },
        bg: { color: '#000000' },
        elements: {
            // 2026-04-29 demo-ready pass: subtitle y 432→438 (tighter cap-to-cap),
            // mascot 320→280 (supports title, doesn't dominate), connectBtn h
            // 126→108 (substantial not bloated), chevron x 290→296 + bbox 28/32
            // → 24/28 (font 42→36 proportional), trustLine y -86→-104 (24 px
            // clearance), liveSignal y -112→-128 (cascade), playAsGuestBtn h
            // 88→80 + y -186→-196 (clearly secondary), reconnBtn w 560→UNIFORM
            // + y -282→-296 (consistent button widths; runtime opacity 110→180
            // + violet outline make it read as deliberate tertiary), pill w
            // 200→180 + y -555→-540 + faint bg.
            title:                { x: 0,   y: 480,  w: 680, h: 78,  type: 'label' },
            subtitle:             { x: 0,   y: 438,  w: 680, h: 26,  type: 'label' },
            mascot:               { x: 0,   y: 250,  w: 280, h: 280, type: 'mascot' },
            ctaCardBg:            { x: 0,   y: -178, w: UNIFORM_LAYOUT.CONTENT_W, h: 400, type: 'group' },
            connectBtn:           { x: 0,   y: -18,  w: UNIFORM_LAYOUT.CONTENT_W, h: 108, type: 'btnPrimary' },
            connectChevron:       { x: 296, y: -18,  w: 24,  h: 28,  type: 'label' },
            trustLine:            { x: 0,   y: -104, w: 640, h: 20,  type: 'label' },
            liveSignalLabel:      { x: 0,    y: -128, w: 640, h: 20,  type: 'label' },
            liveSignalDot:        { x: -118, y: -127, w: 8,   h: 8,   type: 'sprite' },
            playAsGuestBtn:       { x: 0,   y: -196, w: UNIFORM_LAYOUT.CONTENT_W, h: 80,  type: 'btnSuccess' },
            reconnBtn:            { x: 0,   y: -296, w: UNIFORM_LAYOUT.CONTENT_W, h: 64,  type: 'btnGhost' },
            connectionStatusPill: { x: 0,   y: -540, w: 180, h: 40,  type: 'chip' },
        },
        allowedOverlaps: [
            ['CTACardBg', 'ConnectButton'],
            ['CTACardBg', 'ConnectChevron'],
            ['CTACardBg', 'TrustLineLabel'],
            ['CTACardBg', 'LiveSignalLabel'],
            ['CTACardBg', 'ReconnectButton'],
            ['CTACardBg', 'PlayAsGuestButton'],
            ['CTACardBg', 'BtnGlow_ConnectButton'],
            ['CTACardBg', 'BtnGlow_PlayAsGuestButton'],
            ['CTACardBg', 'CardEdgeAccent'],
            ['ConnectButton', 'ConnectChevron'],
        ],
    },

    // 2026-04-28 V4 - "Play Now" hub. Find Match becomes hero (instant play),
    // Start Match demoted to secondary, MIP neutralized (charcoal/btnGhost),
    // Bot Match grows full-width and absorbs Training Mode copy. Recent Match
    // card collapses to single-row (daily-challenge row dropped). Mirrors
    // LayoutSpec.cjs Home block.
    Home: {
        canvas: { w: 720, h: 1280 },
        elements: {
            homeContentScrim:    { x: 0,    y: 0,    w: 720, h: 1280, type: 'sprite' },
            // Header band (V3 - h 64→44, ≈-30%).
            notificationBell:    { x: -296, y: 638,  w: 48,  h: 48,  type: 'btnGhost' },
            notificationBadge:   { x: -276, y: 656,  w: 22,  h: 22,  type: 'badge' },
            walletPill:          { x: 0,    y: 640,  w: 360, h: 60,  type: 'chip' },
            walletPillGlow:      { x: 0,    y: 640,  w: 380, h: 80,  type: 'sprite' },
            walletPillSecureDot: { x: -150, y: 0,    w: 12,  h: 12,  type: 'badge' },
            pubkeyLabel:         { x: -50,  y: 0,    w: 220, h: 26,  type: 'label' },
            walletNameLabel:     { x: 120,  y: 0,    w: 100, h: 16,  type: 'label' },
            openLeaderboardBtn:  { x: -224, y: 638,  w: 48,  h: 48,  type: 'btnGhost' },
            openSettingsBtn:     { x:  224, y: 638,  w: 48,  h: 48,  type: 'btnGhost' },
            disconnectBtn:       { x:  296, y: 638,  w: 48,  h: 48,  type: 'btnGhost' },
            homeHeaderUnderline: { x: 0,    y: 600,  w: 640, h: 1,   type: 'sprite' },
            // V4 - level chip h 80→72 (8h tighter).
            homeLevelChip:       { x: 0,    y: 556,  w: 680, h: 72,  type: 'chip' },
            homeXpProgressLabel: { x: 310,  y: 14,   w: 280, h: 18,  type: 'label' },
            homeXpBarTrack:      { x: 0,    y: -14,  w: 640, h: 14,  type: 'sprite' },
            homeXpBarFill:       { x: -320, y: 0,    w: 0,   h: 14,  type: 'sprite' },
            // V5 (2026-04-28 home UX) - repurposed as user-specific "Last
            // Result" anchor: outcome (WON/LOST) + delta + compact meta line.
            // h 96→108 for slightly more presence; chip generation replaced
            // by 4 label children + glow halo sibling.
            homeMatchTicker:     { x: 0,    y: 460,  w: 680, h: 108, type: 'chip' },
            homeLastResultGlow:  { x: 0,    y: 460,  w: 704, h: 132, type: 'sprite' },
            homeLastResultLabel: { x: -298, y: 38,   w: 200, h: 16,  type: 'label' },
            homeLastResultOutcome: { x: -180, y: 6,  w: 280, h: 38,  type: 'label' },
            homeLastResultDelta: { x: 200,  y: 6,    w: 240, h: 38,  type: 'label' },
            homeLastResultMeta:  { x: 0,    y: -34,  w: 620, h: 18,  type: 'label' },
            homeRecentCardElevation: { x: 0, y: -4,  w: 688, h: 116, type: 'sprite' },
            homeTournamentBadge: { x: 0,    y: 460,  w: 680, h: 108, type: 'chip' },
            // V7 (2026-05-01) - CTA scale-up to 1.75x. Find HERO (teal, 160h),
            // Start (purple, 122h), MIP (charcoal ghost, 122h), Bot (gold
            // full-width, 122h). Uniform 18px gaps. FIND top stays at y=388.
            // Mirrors LayoutSpec.cjs home.* constants.
            findMatchBtn:        { x: 0,    y: 308,  w: 680, h: 160, type: 'btnSuccess' },
            findMatchSubtitle:   { x: 0,    y: -36,  w: 620, h: 20,  type: 'label' },
            findMatchChevron:    { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label' },
            findMatchCountBadge: { x: 244,  y: 360,  w: 96,  h: 36,  type: 'badge' },
            findMatchActivityDot:{ x: -296, y: 372,  w: 10,  h: 10,  type: 'badge' },
            startMatchBtn:       { x: 0,    y: 149,  w: 680, h: 122, type: 'btnPrimary' },
            startMatchSubtitle:  { x: 0,    y: -26,  w: 620, h: 20,  type: 'label' },
            startMatchChevron:   { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label' },
            matchesInProgressBtn:        { x: 0,    y: 9,   w: 680, h: 122, type: 'btnGhost' },
            matchesInProgressSubtitle:   { x: 0,    y: -28, w: 620, h: 16,  type: 'label' },
            matchesInProgressChevron:    { x: 310,  y: 0,   w: 24,  h: 24,  type: 'label' },
            matchesInProgressCountBadge: { x: 244,  y: 42,  w: 88,  h: 32,  type: 'badge' },
            matchesInProgressActivityDot:{ x: -296, y: 42,  w: 10,  h: 10,  type: 'badge' },
            botMatchBtn:         { x: 0,    y: -131, w: 680, h: 122, type: 'btnWarn' },
            botMatchSubtitle:    { x: 0,    y: -24,  w: 620, h: 16,  type: 'label' },
            botMatchSubtitleLine2: { x: 0,  y: -42,  w: 620, h: 14,  type: 'label' },
            botMatchChevron:     { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label' },
            // V4 - Training card REMOVED. Mascot kept here as off-flow node
            // pinned below safe area (consumed by PostMatch panel only); kept
            // in spec to avoid breaking AppUI's mascot lookup when Home is
            // active (mascot is reparented to the HomePanel only by intent).
            mascot:              { x: 0,    y: -820, w: 160, h: 180, type: 'mascot' },
            homeStatus:          { x: 0,    y: -220, w: 460, h: 16,  type: 'label' },
        },
        allowedOverlaps: [
            ['NotificationBellButton',  'NotificationBellBadge'],
            ['HomeMatchTicker',         'HomeTournamentBadge'],
            ['HomeMatchTicker',         'HomeRecentCardElevation'],
            ['HomeMatchTicker',         'HomeLastResultGlow'],
            ['HomeMatchTicker',         'HomeLastResultLabel'],
            ['HomeMatchTicker',         'HomeLastResultOutcome'],
            ['HomeMatchTicker',         'HomeLastResultDelta'],
            ['HomeMatchTicker',         'HomeLastResultMeta'],
            ['HomeRecentCardElevation', 'HomeMatchTicker'],
            ['HomeLastResultGlow',      'HomeMatchTicker'],
            ['FindMatchButton',         'FindMatchButtonCountBadge'],
            ['FindMatchButton',         'FindMatchActivityDot'],
            ['MatchesInProgressButton', 'MatchesInProgressCountBadge'],
            ['MatchesInProgressButton', 'MatchesInProgressActivityDot'],
            ['StartMatchButton',        'StartMatchSubtitle'],
            ['StartMatchButton',        'StartMatchChevron'],
            ['FindMatchButton',         'FindMatchSubtitle'],
            ['FindMatchButton',         'FindMatchChevron'],
            ['MatchesInProgressButton', 'MatchesInProgressSubtitle'],
            ['MatchesInProgressButton', 'MatchesInProgressChevron'],
            ['BotMatchButton',          'BotMatchSubtitle'],
            ['BotMatchButton',          'BotMatchSubtitleLine2'],
            ['BotMatchButton',          'BotMatchChevron'],
            ['WalletPill',              'PubkeyLabel'],
            ['WalletPill',              'WalletNameLabel'],
            ['WalletPill',              'WalletPillSecureDot'],
            ['HomeLevelChip',           'HomeLevelChipLabel'],
            ['HomeLevelChip',           'HomeXpProgressLabel'],
            ['HomeLevelChip',           'HomeXpBarTrack'],
            ['HomeXpBarTrack',          'HomeXpBarFill'],
        ],
    },
    // KEEP IN SYNC with LayoutSpec.cjs ModePickerOverlay (2026-04-30 arena redesign).
    ModePickerOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backBtn:           { x: -290, y: 580,  w: 92,  h: 44, type: 'btnGhost' },
            cancelBtn:         { x:  314, y: 580,  w: 44,  h: 44, type: 'btnGhost' },
            title:             { x: 0,    y: 500,  w: 600, h: 44, type: 'label' },
            titleDivider:      { x: 0,    y: 472,  w: 220, h: 3,  type: 'sprite' },
            subtitle:          { x: 0,    y: 440,  w: 600, h: 22, type: 'label' },
            sectionMode:       { x: 0,    y: 400,  w: 580, h: 18, type: 'label' },
            sectionDuration:   { x: 0,    y: 80,   w: 580, h: 18, type: 'label' },
            sectionTrack:      { x: 0,    y: -24,  w: 580, h: 18, type: 'label' },
            paperToggle:       { x: -105, y: -72,  w: 200, h: 52, type: 'btnPrimary' },
            realToggle:        { x:  105, y: -72,  w: 200, h: 52, type: 'btnGhost' },
            trackHelper:       { x: 0,    y: -100, w: 580, h: 18, type: 'label' },
            sectionDifficulty: { x: 0,    y: -116, w: 580, h: 18, type: 'label' },
            difficultyHelper:  { x: 0,    y: -210, w: 580, h: 18, type: 'label' },
            summaryCard:       { x: 0,    y: -322, w: 640, h: 196, type: 'group' },
            summaryConnector:  { x: 0,    y: -432, w: 16,  h: 14,  type: 'sprite' },
            startBtn:          { x: 0,    y: -516, w: 640, h: 132, type: 'btnPrimary' },
            statusLbl:         { x: 0,    y: -612, w: 620, h: 20,  type: 'label' },
        },
        templates: {
            modeBtn:       { count: 4, w: 280, h: 140 },
            windowBtn:     { count: 6, w: 92,  h: 52, y: 28,   baseX: -275, gapX: 110 },
            difficultyBtn: { count: 3, w: 184, h: 56, y: -172, baseX: -200, gapX: 200 },
        },
        allowedOverlaps: [
            ['PickerSummaryCard', 'PickerSummaryModeLabel'],
            ['PickerSummaryCard', 'PickerSummaryModifiersLabel'],
            ['PickerSummaryCard', 'PickerSummaryStakeLabel'],
            ['PickerSummaryCard', 'PickerTicketHeaderLabel'],
            ['PickerSummaryCard', 'PickerSummaryWagerCaptionLabel'],
            ['PickerSummaryCard', 'CardEdgeAccent'],
            ['PickerSummaryCard', 'PickerSummaryGradient'],
            ['ModePickerTitleLabel', 'PickerCancelButton'],
            ['ModePickerTitleLabel', 'PickerBackButton'],
            ['PickerStartButton', 'BtnGlow_PickerStartButton'],
            ['PickerStartButton', 'Ripple_PickerStartButton'],
            ['PickerStartButton', 'StartButtonGoldEdge'],
        ],
    },
    RacePanel: {
        canvas: { w: 720, h: 1800 },
        elements: {
            // Battle-UI top row (2026-04-26): (Timer) [+0.00%]
            // 2026-05-01 - Timer ring scaled +15% (132→152). Top edge of circle
            // is pinned to its prior world Y, so center drops 9 px (720→711).
            // 2026-05-02 - RacePlayerLevelChip moved from top-left corner to
            // centered above PlayerTokenCardsRow (mirrors OpponentIdentityCard
            // above OpponentTokenCardsRow). Width grew 120→200 for "YOU · Lv N".
            racePlayerLevelChip: { x: 0,    y: 625, w: 200, h: 40,   type: 'chip' },
            timerRing:           { x: 0,    y: 711, w: 152, h: 152,  type: 'graphics' },
            countdownLabel:      { x: 0,    y: 711, w: 115, h: 37,   type: 'label' },
            heroDelta:           { x: 240,  y: 720, w: 220, h: 80,   type: 'label' },
            playerTokenRow:      { x: 0,    y: 540, w: UNIFORM_LAYOUT.CONTENT_W, h: 132,  type: 'group' },
            opponentSubtitle:    { x: 0,    y: 410, w: 620, h: 64,   type: 'label' },
            duelBarContainer:    { x: 0,    y: 300, w: 680, h: 80,   type: 'group' },
            advantageHalo:       { x: 0,    y: 110, w: 420, h: 200,  type: 'graphics' },
            advantageBorder:     { x: 0,    y: 110, w: 320, h: 180,  type: 'graphics' },
            advantageCaption:    { x: 0,    y: 178, w: 300, h: 22,   type: 'label' },
            opponentDelta:       { x: 0,    y: 110, w: 300, h: 90,   type: 'label' },
            advantageSubtext:    { x: 0,    y: 42,  w: 300, h: 24,   type: 'label' },
            opponentIdentityCard:{ x: 0,    y: -20,  w: 280, h: 44,   type: 'sprite' },
            opponentTokenRow:    { x: 0,    y: -130, w: UNIFORM_LAYOUT.CONTENT_W, h: 132,  type: 'group' },
            // 2026-05-01 - bot PnL pushed to -310 to mirror player PnL distance
            // from cards (180 px center-to-center, matching heroDelta↔playerTokenRow).
            opponentPortfolioDelta: { x: -240, y: -310, w: 220, h: 80, type: 'label' },
            opponentCard:        { x: 0,    y: -400, w: 640, h: 110, type: 'sprite' },
            opponentStrip:       { x: 0,    y: -406, w: UNIFORM_LAYOUT.CONTENT_W, h: 260, type: 'group' },
            // 2026-05-01 - Forfeit / Home pushed -260 → -380 to clear bot-PnL row.
            cancelBtn:           { x: 0,    y: -380, w: 140, h: 36,  type: 'btnGhost' },
            hintLabel:           { x: 0,    y: -430, w: 620, h: 24,  type: 'label' },
            mascot:              { x: 260,  y: -540, w: 120, h: 160, type: 'mascot' },
            vignette:            { x: 0,    y: 0,    w: 720, h: 1280, type: 'graphics' },
        },
        allowedOverlaps: [
            ['RaceTimerRing', 'RaceCountdownLabel'],
            ['RaceTokenCard_4', 'RaceOpponentCard'],
            ['RaceTokenCard_4', 'RaceOpponentStrip'],
            ['RaceOpponentCard', 'RaceOpponentStrip'],
            // Round-advantage card - halo wraps border + labels by design.
            ['RaceAdvantageHalo', 'RaceAdvantageBorder'],
            ['RaceAdvantageHalo', 'RaceAdvantageCaption'],
            ['RaceAdvantageHalo', 'OpponentDeltaHeroLabel'],
            ['RaceAdvantageHalo', 'RaceAdvantageSubtext'],
            ['RaceAdvantageBorder', 'RaceAdvantageCaption'],
            ['RaceAdvantageBorder', 'OpponentDeltaHeroLabel'],
            ['RaceAdvantageBorder', 'RaceAdvantageSubtext'],
            // 2026-05-02 - RacePlayerLevelChip moved to y=625 as squad header
            // above PlayerTokenCardsRow (mirror of OpponentIdentityCard above
            // OpponentTokenCardsRow). Tight band between timer ring bottom
            // (y=635) and row container top (y=606) makes some bbox overlap
            // unavoidable; visually clean because the timer-ring lower rim is
            // empty pixels and the row container's upper band sits above the
            // actual cards.
            ['RacePlayerLevelChip', 'PlayerTokenCardsRow'],
            ['RacePlayerLevelChip', 'RaceTimerRing'],
        ],
    },
    SettingsPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // Phase 30 / 2026-04-30 polish - premium settings redesign. KEEP IN
            // SYNC with LayoutSpec.cjs. Wallet h 124→96 (single identity row),
            // Account h 232→200 (tighter rhythm), Danger Zone pulled up; sheet
            // grew to full canvas to kill parent-panel bleed at edges.
            sheetBg:       { x: 0,    y: 0,    w: 720, h: 1280, type: 'sprite' },
            sheetGlow:     { x: 0,    y: 446,  w: 220, h: 220,  type: 'sprite' },
            backLink:      { x: UNIFORM_HEADER.BACK_LINK.x, y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:       { x: UNIFORM_HEADER.BACK_BTN.x,  y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:         { x: 0,    y: UNIFORM_HEADER.TITLE_Y, w: 400, h: 44, type: 'label' },
            walletCard:    { x: 0,    y: 446,  w: UNIFORM_LAYOUT.CONTENT_W, h: 96,  type: 'group' },
            profileCard:   { x: 0,    y: 308,  w: UNIFORM_LAYOUT.CONTENT_W, h: 148, type: 'group' },
            quickPlayCard: { x: 0,    y: 88,   w: UNIFORM_LAYOUT.CONTENT_W, h: 260, type: 'group' },
            audioCard:       { x: 0,    y: -132, w: UNIFORM_LAYOUT.CONTENT_W, h: 148, type: 'group' },
            accountCard:     { x: 0,    y: -322, w: UNIFORM_LAYOUT.CONTENT_W, h: 200, type: 'group' },
            dangerZoneLabel: { x: 0,    y: -436, w: 200, h: 14, type: 'label' },
            deleteBtn:       { x: 0,    y: -468, w: 320, h: 44, type: 'btnGhost' },
            status:          { x: 0,    y: -510, w: 640, h: 20, type: 'label' },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
            ['WalletStatusDot', 'WalletNameLabel'],
            ['WalletPubkeyLabel', 'CopyPubkeyButton'],
            ['SettingsSheetBg', 'WalletCard'],
            ['SettingsSheetBg', 'ProfileCard'],
            ['SettingsSheetBg', 'QuickPlayDefaultsCard'],
            ['SettingsSheetBg', 'AudioSettingsCard'],
            ['SettingsSheetBg', 'AccountSettingsCard'],
            ['SettingsSheetBg', 'DeleteAccountSettingsButton'],
            ['SettingsSheetBg', 'DangerZoneLabel'],
            ['SettingsSheetBg', 'SettingsSheetGlow'],
            ['SettingsSheetGlow', 'WalletCard'],
        ],
    },
    LeaderboardPanel: {
        canvas: { w: 720, h: 1280 },
        RUNTIME_TOP_EDGE: 748,
        elements: {
            leaderboardContentScrim: { x: 0, y: 0, w: 720, h: 1280, type: 'sprite' },
            backLink:         { x: UNIFORM_HEADER.BACK_LINK.x, y: 720, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:          { x: UNIFORM_HEADER.BACK_BTN.x,  y: 720, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            // 2026-04-30 - collapsed two-sibling title back into one inline-emoji label.
            title:            { x: 0,    y: 680,  w: 360, h: 44,  type: 'label' },
            // 2026-05-02 polish - header helper lines: scoring legitimacy + weekly reset.
            scoringHelper:    { x: 0,    y: 588,  w: 600, h: 18,  type: 'label' },
            seasonHelper:     { x: 0,    y: 570,  w: 600, h: 16,  type: 'label' },
            // 2026-05-02 polish - h grew 100→160 to host the new SublineLabel.
            personalRankCard: { x: 0,    y: -130, w: UNIFORM_LAYOUT.CONTENT_W, h: 160, type: 'group' },
            status:           { x: 0,    y: -740, w: 600, h: 22,  type: 'label' },
        },
        allowedOverlaps: [['BackLinkLabel', 'BackButton']],
    },
    FindMatchPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // 2026-04-30 UX rebuild - full-canvas scrim kills BackgroundFX bleed
            // (mirrors HomeContentScrim). MUST render first; sits behind every
            // other FindMatchPanel child. Color = Palette.bg.primary @ alpha 110.
            findMatchContentScrim: { x: 0, y: 0, w: 720, h: 1280, type: 'sprite' },
            // 2026-04-29 god-tier UX rebuild - strict top-to-bottom flow,
            // dominant primary CTA, FilterCard glass container, 4 tall cards.
            backLink:       { x: UNIFORM_HEADER.BACK_LINK.x, y: FINDMATCH_LAYOUT.HEADER_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:        { x: UNIFORM_HEADER.BACK_BTN.x,  y: FINDMATCH_LAYOUT.HEADER_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:          { x: 0,    y: FINDMATCH_LAYOUT.TITLE_Y,  w: 400, h: 44, type: 'label' },
            refreshBtn:     { x: 280,  y: FINDMATCH_LAYOUT.TITLE_Y,  w: 56,  h: 44, type: 'btnGhost' },
            countLabel:     { x: -80,  y: FINDMATCH_LAYOUT.STATUS_Y, w: 540, h: 22, type: 'label' },
            liveCountPulseDot:  { x: -300, y: FINDMATCH_LAYOUT.STATUS_Y, w: 14,  h: 14,  type: 'sprite' },
            // FilterCard - flat dim section that visually groups the 3 filter
            // blocks and the Hide-Full toggle. Subtle bg contrast (alpha ~110),
            // no floating-card edge - reads as a section of the page.
            filterCard:     { x: FINDMATCH_LAYOUT.FILTER_CARD.x, y: FINDMATCH_LAYOUT.FILTER_CARD.y, w: FINDMATCH_LAYOUT.FILTER_CARD.w, h: FINDMATCH_LAYOUT.FILTER_CARD.h, type: 'sprite' },
            // 2026-04-30 UX rebuild - label-above-pill block layout. Each
            // filter is a 2-line block: left-anchored caption then a 600w pill
            // spanning the FilterCard. Inter-block gap 16px.
            fmModeLabel:        { x: -300, y: FINDMATCH_LAYOUT.MODE_LABEL_Y,   w: 200, h: 22, type: 'label' },
            fmWindowLabel:      { x: -300, y: FINDMATCH_LAYOUT.WINDOW_LABEL_Y, w: 200, h: 22, type: 'label' },
            fmWagerLabel:       { x: -300, y: FINDMATCH_LAYOUT.WAGER_LABEL_Y,  w: 200, h: 22, type: 'label' },
            segmentMountMode:   { x: 0,    y: FINDMATCH_LAYOUT.MODE_ROW_Y,   w: 600, h: 44, type: 'group' },
            segmentMountWindow: { x: -155, y: FINDMATCH_LAYOUT.WINDOW_ROW_Y, w: 290, h: 44, type: 'group' },
            segmentMountWager:  { x:  155, y: FINDMATCH_LAYOUT.WAGER_ROW_Y,  w: 290, h: 44, type: 'group' },
            hideFullToggle:     { x: 240,  y: FINDMATCH_LAYOUT.HIDE_FULL_Y,  w: 120, h: 28, type: 'btnPrimary' },
            // Top-right level chip; AppUI applies UIOpacity 178 (~70%) so it
            // does not compete with the title for visual weight.
            lvxpChip:       { x: 240, y: FINDMATCH_LAYOUT.HEADER_Y, w: 200, h: 32, type: 'chip' },
            // Primary "FIND MATCH" CTA - dominant, full-width, below filters.
            // Wires to existing _onFindMatchHostTap (legacy handler kept).
            hostBtn:        { x: 0, y: FINDMATCH_LAYOUT.PRIMARY_CTA_Y, w: FINDMATCH_LAYOUT.PRIMARY_CTA_W, h: FINDMATCH_LAYOUT.PRIMARY_CTA_H, type: 'btnPrimary' },
            // Empty-state cluster (only visible when 0 lobbies match filters).
            emptyMascot:    { x: 0,    y: -50,  w: 200, h: 220, type: 'mascot' },
            emptyTitle:     { x: 0,    y: -210, w: 600, h: 40,  type: 'label' },
            emptySubtitle:  { x: 0,    y: -260, w: 600, h: 22,  type: 'label' },
            emptyHostBtn:   { x: -135, y: -340, w: 240, h: 64,  type: 'btnPrimary' },
            emptyBotBtn:    { x: 135,  y: -340, w: 240, h: 64,  type: 'btnGhost' },
            // Legacy zero-size stubs kept so AppUI bindings do not break.
            modeTray:           { x: 0, y: 0, w: 1, h: 1, type: 'sprite' },
            windowTray:         { x: 0, y: 0, w: 1, h: 1, type: 'sprite' },
            wagerTray:          { x: 0, y: 0, w: 1, h: 1, type: 'sprite' },
            filterDivider1:     { x: 0, y: 0, w: 1, h: 1, type: 'sprite' },
            filterDivider2:     { x: 0, y: 0, w: 1, h: 1, type: 'sprite' },
            filterDivider3:     { x: 0, y: 0, w: 1, h: 1, type: 'sprite' },
            tabActiveUnderline: { x: 0, y: 0, w: 1, h: 1, type: 'sprite' },
            tailHintTitle:      { x: 0, y: -2000, w: 600, h: 24, type: 'label' },
            tailHintSubtitle:   { x: 0, y: -2000, w: 600, h: 20, type: 'label' },
            tailResetBtn:       { x: 0, y: -2000, w: 160, h: 40, type: 'btnGhost' },
            tailStartBtn:       { x: 0, y: -2000, w: 160, h: 40, type: 'btnGhost' },
            emptyLabel:         { x: 0, y: -2000, w: 660, h: 22, type: 'label' },
            status:             { x: 0, y: -700,  w: 660, h: 20, type: 'label' },
        },
        allowedOverlaps: [],
    },
    TokenDuelPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // 2026-04-27 v2 - classic stack restored, shifted +45 to align pills
            // with HomePanel; FeedScrollView cut 30% (388→272). Mirrors `td`
            // constants block in LayoutSpec.cjs.
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: 685, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: 685, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            // 2026-04-29 token-picker rebuild - title raised 570→560, w 320→360, h 36→48.
            title:           { x: 0,    y: 560,  w: 360, h: 48, type: 'label' },
            // 2026-05-02 token-picker UX - DRAFT YOUR SQUAD eyebrow below title.
            subtitle:        { x: 0,    y: 520,  w: 480, h: 18, type: 'label' },
            // 2026-05-02 - superseded by subtitle eyebrow; off-canvas placeholder.
            headerUnderline: { x: -2000, y: -2000, w: 1, h: 1, type: 'sprite' },
            levelPill:       { x: 120,  y: 620,  w: 140, h: 44, type: 'chip' },
            solPill:         { x: 265,  y: 620,  w: 140, h: 44, type: 'chip' },
            // 2026-04-29 god-tier UX pass - mission bar h 64→80, recentered y
            // 470→462 so top edge stays at 502; bottom 438→422.
            matchSetupCard:  { x: 0,    y: 462,  w: UNIFORM_LAYOUT.CONTENT_W, h: 80, type: 'group' },
            // ready-state underline at matchSetupCard bottom (y = 462 - 40 + 1 = 423).
            matchSetupReadyGlow: { x: 0, y: 423, w: UNIFORM_LAYOUT.CONTENT_W, h: 2, type: 'sprite' },
            // 2026-05-01 squad-select pass - frame h 528→448 (-80) so the
            // squad section can absorb 80 px of reclaimed space. Top stays
            // at 405; bottom shifts -123 → -43.
            feedFrameCard:   { x: 0,    y: 181,  w: 712, h: 448, type: 'sprite' },
            // 2026-04-30 - Row 1 grown 44→60h. Trending + Search are the
            // hero controls; Watchlist/LIVE scaled up proportionally. Row 2
            // (filter chips) stays small as secondary controls. Headers +
            // scroll shifted down to absorb the extra height.
            // 2026-05-03 R2 — row 1 freed; LIVE/★/Cols cluster on row 2.
            search:          { x: 110,  y: 365,  w: 440, h: 60, type: 'editbox' },
            searchClear:     { x: 290,  y: 365,  w: 36,  h: 36, type: 'btnGhost' },
            feedTabDropdown: { x: -220, y: 365,  w: 220, h: 60, type: 'btnGhost' },
            watchlistStar:   { x: 225,  y: 311,  w: 44,  h: 44, type: 'btnGhost' },
            cancelWatchlist: { x: 225,  y: 311,  w: 44,  h: 44, type: 'btnGhost' },
            liveIndicator:   { x: 295,  y: 311,  w: 80,  h: 28, type: 'label' },
            minLiqDropdown:    { x: -16,  y: 311,  w: 110, h: 32,  type: 'chip' },
            columnsBtn:        { x: 170,  y: 311,  w: 44,  h: 32,  type: 'chip' },
            // 2026-05-02 token-picker UX - column headers hidden (moved off-canvas).
            // The 3-zone row layout (LEFT identity / MIDDLE pills / RIGHT %+price)
            // is self-explanatory; the table-style header strip read as
            // "spreadsheet" rather than "draft list" and competed with the
            // YOUR SQUAD section for hierarchy.
            feedColumnHeaders: { x: -2000, y: -2000, w: 1, h: 1,  type: 'group' },
            // 2026-05-01 - scroll h 360→320 (fits shorter feed frame); ~2.5
            // visible rows at new feedRow.h=120.
            feedScrollView:    { x: 0,    y: 85,   w: UNIFORM_LAYOUT.CONTENT_W, h: 320, type: 'scrollview' },
            // 2026-05-01 squad-select pass - soft ambient halo behind the
            // 3 slot pillars. Single sprite (no Graphics) keeps SIGSEGV risk zero.
            squadAmbientGlow:  { x: 0,    y: -266, w: 720, h: 220, type: 'sprite' },
            squadPanel:        { x: 0,    y: -243, w: 720, h: 376, type: 'group' },
            // 2026-05-01 r2.1 - eyebrow font 16 (h=18), label font 30 (h=38)
            squadHeaderEyebrow:{ x: 0,    y: -88,  w: 360, h: 18,  type: 'label' },
            squadHeaderLabel:  { x: 0,    y: -120, w: 460, h: 38,  type: 'label' },
            squadHeaderRule:   { x: 0,    y: -150, w: 240, h: 1,   type: 'sprite' },
            // 2026-05-01 r3 - half-width chunky stake pill (320×84) centered
            // below the CTA, single-line "0.05 SOL ▾" at 32pt gold. Helper
            // text gets its own row below the pill, always visible.
            wagerRowDivider:   { x: 0,    y: -388, w: 680, h: 1,   type: 'sprite' },
            wagerStartButton:  { x:    0, y: -444, w: UNIFORM_LAYOUT.CONTENT_W, h: 88,  type: 'btnPrimary' },
            wagerValueButton:  { x:    0, y: -542, w: 240, h: 72,  type: 'btnGhost' },
            wagerLockChip:     { x:    0, y: -542, w: 240, h: 72,  type: 'chip' },
            wagerBotChip:      { x:    0, y: -542, w: 240, h: 72,  type: 'chip' },
            wagerHintLabel:    { x:    0, y: -616, w: 600, h: 28,  type: 'label' },
            wagerDropdown:     { x:    0, y: -380, w: 360, h: 360, type: 'group' },
            stakeHeaderLabel:  { x: 0,    y: -395, w: 280, h: 18,  type: 'label' },
            stakeValueLabel:   { x: 0,    y: -420, w: 300, h: 28,  type: 'label' },
            stakeSlider:       { x: 0,    y: -455, w: 560, h: 14,  type: 'graphics' },
            stakeCommitButton: { x: 0,    y: -580, w: 620, h: 56,  type: 'btnPrimary' },
            startGameButton:   { x: 0,    y: -580, w: 620, h: 56,  type: 'btnPrimary' },
            claimPayoutButton: { x: 0,    y: -580, w: 620, h: 56,  type: 'btnPrimary' },
            holding1Label:     { x: 0,    y: -550, w: 200, h: 50,  type: 'label' },
            holding2Label:     { x: 0,    y: -550, w: 200, h: 50,  type: 'label' },
            holding3Label:     { x: 0,    y: -550, w: 200, h: 50,  type: 'label' },
            gameArea:          { x: 0,    y: 0,    w: 720, h: 1000,type: 'group' },
            gameOverLabel:     { x: 0,    y: 0,    w: 680, h: 180, type: 'label' },
            status:            { x: 0,    y: -2000, w: 688, h: 22,  type: 'label' },
            rowActionPopover:  { x: 0,    y: 0,    w: 260, h: 110, type: 'group' },
            rowActionPickBtn:  { x: 0,    y:  26,  w: 240, h: 44,  type: 'btnPrimary' },
            rowActionChartBtn: { x: 0,    y: -26,  w: 240, h: 44,  type: 'btnGhost' },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
            ['ChangeLabel',   'DeltaLabel'],
            ['LogoSprite',    'CheckboxSprite'],
            ['LogoSprite',    'CheckmarkIcon'],
            // 2026-05-01 squad-select pass.
            ['SquadAmbientGlow', 'SquadPanel'],
            ['SquadAmbientGlow', 'SquadHeaderLabel'],
            ['SquadAmbientGlow', 'SquadHeaderRule'],
            ['SquadAmbientGlow', 'SquadSlot_0'],
            ['SquadAmbientGlow', 'SquadSlot_1'],
            ['SquadAmbientGlow', 'SquadSlot_2'],
            ['SlotGlowHalo', 'SlotIndexLabel'],
            ['SlotGlowHalo', 'SilhouettePlus'],
            ['SlotGlowHalo', 'LogoSprite'],
            ['SlotGlowHalo', 'SymbolLabel'],
            ['SlotGlowHalo', 'DeltaLabel'],
            ['SlotGlowHalo', 'ScoreBadge'],
            ['SlotGlowHalo', 'PerformanceBar'],
            ['SlotGlowHalo', 'RemoveButton'],
            ['SlotGlowHalo', 'GradientTop'],
            // 2026-05-01 r3 - stake pill and hint moved to separate rows;
            // status moved off-canvas. No remaining intentional overlaps.
        ],
    },
    PortfolioPanel: {
        canvas: { w: 720, h: 1280 },
        RUNTIME_TOP_EDGE: 748,
        elements: {
            historyView: { x: 0,    y: 0,   w: 720, h: 1280, type: 'group' },
            backLink:    { x: UNIFORM_HEADER.BACK_LINK.x, y: 720, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:     { x: UNIFORM_HEADER.BACK_BTN.x,  y: 720, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:       { x: 0,    y: 680, w: 400, h: 44,   type: 'label' },
        },
        allowedOverlaps: [['BackLinkLabel', 'BackButton']],
    },
    NotificationToastOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            overlay: { x: 0, y: 0, w: 720, h: 360, type: 'group' },
        },
        allowedOverlaps: [
            ['ToastColorStripe',   'ToastProgressBar'],
            ['ToastDismissButton', 'ToastProgressBar'],
        ],
    },
    NotificationPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            listContainer:         { x:    0, y:  -90, w: 360, h: 920, type: 'group' },
            cardHeaderLabel:       { x: -178, y:  608, w: 196, h:  30, type: 'label' },
            cardMarkAllReadButton: { x:   90, y:  608, w: 110, h:  28, type: 'btnGhost' },
            cardCloseButton:       { x:  168, y:  608, w:  36, h:  36, type: 'btnGhost' },
            cardHeaderDivider:     { x:    0, y:  580, w: 356, h:   1, type: 'sprite' },
            groupLabelToday:       { x: -160, y:    0, w: 200, h:  16, type: 'label' },
            groupLabelEarlier:     { x: -160, y:    0, w: 200, h:  16, type: 'label' },
            emptyIcon:             { x:    0, y:   80, w:  64, h:  64, type: 'group' },
            emptyTitleLabel:       { x:    0, y:    0, w: 320, h:  24, type: 'label' },
            emptySubtitleLabel:    { x:    0, y:  -28, w: 340, h:  18, type: 'label' },
        },
        allowedOverlaps: [],
    },
    TournamentPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            roster:  { x: 0,    y: 150, w: UNIFORM_LAYOUT.CONTENT_W, h: 440, type: 'group' },
            backLink: { x: UNIFORM_HEADER.BACK_LINK.x, y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:  { x: UNIFORM_HEADER.BACK_BTN.x,  y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:   { x: 0,    y: UNIFORM_HEADER.TITLE_Y, w: 300, h: 44, type: 'label' },
        },
        allowedOverlaps: [],
    },
    TokenDetailPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: 614, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: 614, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            symbolLabel:     { x:    0, y: 614,  w: 320, h: 34, type: 'label' },
            nameLabel:       { x:    0, y: 588,  w: 320, h: 18, type: 'label' },
            mintChip:        { x:  255, y: 612,  w: 130, h: 26, type: 'btnGhost' },
            pickBtn:         { x:    0, y: 552,  w: 560, h: 42, type: 'btnPrimary' },
            safetyHeader:    { x: -290, y: 506,  w: 200, h: 14, type: 'label' },
            rangeHeader:     { x: -290, y: 446,  w: 200, h: 14, type: 'label' },
            viewHeader:      { x: -200, y: 386,  w: 120, h: 14, type: 'label' },
            unitHeader:      { x:  140, y: 386,  w: 120, h: 14, type: 'label' },
            chartCard:       { x:    0, y: 130,  w: 680, h: 380, type: 'group' },
            statsHeader:     { x: -290, y:  -90, w: 220, h: 14, type: 'label' },
            status:          { x:    0, y: -625, w: 660, h: 20, type: 'label' },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
            ['ChartHeaderLabel', 'ChartCard'],
            ['ChartArea', 'ChartCard'],
        ],
    },
    DailyChallengePanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:           { x: 0,    y: 600, w: 400, h: 40, type: 'label' },
            streakDayLabel:  { x: 0,    y: 2,   w: 560, h: 38, type: 'label' },
            streakBestLabel: { x: 0,    y: -28, w: 560, h: 22, type: 'label' },
        },
        allowedOverlaps: [['BackLinkLabel', 'BackButton']],
    },
    SpectatorPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink: { x: UNIFORM_HEADER.BACK_LINK.x, y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:  { x: UNIFORM_HEADER.BACK_BTN.x,  y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:   { x: 0,    y: UNIFORM_HEADER.TITLE_Y, w: 300, h: 44, type: 'label' },
        },
        allowedOverlaps: [],
    },
    PostMatchPanel: {
        canvas: { w: 720, h: 1800 },
        elements: {
            // 2026-04-29 - mirrors PostMatchPanel.elements in LayoutSpec.cjs.
            // Reward block sits above mascot in top zone; rake sits above
            // stat cards in bottom zone. Back nodes off-canvas.
            backLink:        { x: -2000, y: -2000, w: 1, h: 1, type: 'label' },
            backBtn:         { x: -2000, y: -2000, w: 1, h: 1, type: 'btnGhost' },
            earned:          { x: 0, y: 115,  w: 400, h: 22,  type: 'label' },
            payoutLabel:     { x: 0, y: 55,   w: 620, h: 110, type: 'label' },
            breakdownPill:   { x: 0, y: -72,  w: 540, h: 36,  type: 'sprite' },
            shareButton:     { x: 0, y: -540, w: 280, h: 44,  type: 'btnPrimary' },
            mascotContainer: { x: 0, y: 310,  w: 340, h: 340, type: 'mascot' },
            sameSquadBtn:    { x: -178, y: -474, w: 340, h: 84, type: 'btnPrimary' },
            againBtn:        { x:  178, y: -474, w: 340, h: 84, type: 'btnPrimary' },
        },
        allowedOverlaps: [
            ['MascotGlow', 'PostMatchMascotContainer'],
            ['PostMatchXPBarLabelLeft',  'PostMatchXPBarFill'],
            ['PostMatchXPBarLabelRight', 'PostMatchXPBarFill'],
        ],
    },
    WaitingPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            title:        { x: 0, y: 300,  w: 600, h: 40, type: 'label' },
            mode:         { x: 0, y: 250,  w: 600, h: 24, type: 'label' },
            rake:         { x: 0, y: 220,  w: 600, h: 22, type: 'label' },
            progress:     { x: 0, y: 180,  w: 600, h: 28, type: 'label' },
            spinner:      { x: 0, y: 80,   w: 300, h: 40, type: 'label' },
            streakBanner: { x: 0, y: 480,  w: 620, h: 36, type: 'label' },
            cancelBtn:    { x: 0, y: -100, w: 380, h: 56, type: 'btnDanger' },
            botBtn:       { x: 0, y: -180, w: 380, h: 56, type: 'btnPrimary' },
            forceBtn:     { x: 0, y: -260, w: 420, h: 56, type: 'btnGhost' },
            status:       { x: 0, y: -600, w: 640, h: 20, type: 'label' },
        },
        allowedOverlaps: [],
    },
    TutorialOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {},
        allowedOverlaps: [],
    },
    CountdownOverlay: {
        canvas: { w: 720, h: 1800 },
        elements: {
            bigLabel:   { x: 0, y: 40,   w: 400, h: 240, type: 'label' },
            squadLabel: { x: 0, y: -140, w: 620, h: 36,  type: 'label' },
            hintLabel:  { x: 0, y: -210, w: 600, h: 24,  type: 'label' },
        },
        allowedOverlaps: [],
    },
    SigningOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            spinner:     { x: 0, y: 80,  w: 200, h: 120, type: 'label' },
            statusLabel: { x: 0, y: -40, w: 680, h: 36,  type: 'label' },
            hintLabel:   { x: 0, y: -90, w: 620, h: 24,  type: 'label' },
        },
        allowedOverlaps: [],
    },
    LoadingOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            mascotContainer: { x: 0, y: 200,  w: 200, h: 200, type: 'mascot' },
            spinner:         { x: 0, y: -40,  w: 200, h: 120, type: 'label' },
            statusLabel:     { x: 0, y: -220, w: 680, h: 36,  type: 'label' },
            tipLabel:        { x: 0, y: -300, w: 620, h: 24,  type: 'label' },
        },
        allowedOverlaps: [],
    },
    // 2026-05-03 - LevelUpOverlay is now runtime-built (see
    // assets/token-duel/scripts/LevelUpOverlay.ts). No layout entry needed.
};

export default LayoutSpec;
