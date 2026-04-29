/**
 * LayoutSpec.ts — TypeScript twin of LayoutSpec.cjs.
 *
 * KEEP IN SYNC with LayoutSpec.cjs (source of truth for scene-generator).
 * Update both files together.
 *
 * Imported from runtime code only when AppUI / a controller needs to
 * read a position at runtime (rare — most consumption is at scene-gen
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

// 2026-04-29 — uniform back/title/subtitle header band, mirrors MIP.
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

// 2026-04-29 — uniform text styling tokens. Title color = gold for action
// panels (PostMatch keeps its 60pt white hero accent for "YOU WON"). Dim
// text = one canonical RGB for subtitles, status labels, and section
// eyebrows. Eyebrow font size = 12pt across panels.
export const UNIFORM_TEXT = {
    TITLE_COLOR:       { r: 255, g: 210, b: 74 },
    TITLE_FONT_SIZE:   30,
    DIM_COLOR:         { r: 168, g: 174, b: 201 },
    EYEBROW_FONT_SIZE: 12,
} as const;

// 2026-04-29 — UNIFORM spacing scale. Every sibling-to-sibling y delta in
// a panel must come from this set. No literal 36/40/56/72 etc. Compose
// SPACE_32 + SPACE_16 to get 48; SPACE_32 + SPACE_24 for 56; etc.
export const UNIFORM_SPACE = {
    SPACE_8:  8,
    SPACE_12: 12,
    SPACE_16: 16,
    SPACE_24: 24,
    SPACE_32: 32,
} as const;

// 2026-04-29 — UNIFORM centered content column. Cards / CTAs / list rows
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

// 2026-04-29 (Prompt 1) — UNIFORM card geometry. Every card built via
// generate-scenes.js mkCard() uses one of these heights. Row stride =
// h + ROW_GAP. NOTIFICATION_H is a one-off — toast row chrome (left
// ColorStripe) is intentionally not in the unified card system.
export const UNIFORM_CARD = {
    ROW_DENSE_H:     56,
    ROW_DEFAULT_H:   88,
    ROW_FEATURE_H:  160,
    ROW_GAP:          8,
    NOTIFICATION_H:  92,
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
export const POSTMATCH_ZONES = {
    top: {
        backLink:        -28,
        backBtn:         -28,
        title:           -90,
        track:          -148,
        trophy:          -28,
    },
    center: {
        mascotGlow:        0,
        mascotContainer:   0,
        payoutLabel:    -200,
    },
    bottom: {
        sameSquadBtn:     44,
        againBtn:         44,
        sameSquadGlow:    44,
        xpBarFill:       120,
        xpBarLabelLeft:  120,
        xpBarLabelRight: 120,
        cardsRow2:       198,
        cardsRow1:       330,
        rake:            420,
        breakdown:       450,
        subtitle:        482,
        shareButton:      90,
        status:          -50,
    },
} as const;

// 2026-04-29 — Dashboard zone scaffold. Mirrors DashboardLayoutSpec in
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
    const H = { header: 80, title: 104, modeSwitch: 60, subtab: 60 };
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
            title:                { x: 0,   y: 480,  w: 680, h: 72,  type: 'label' },
            subtitle:             { x: 0,   y: 422,  w: 680, h: 30,  type: 'label' },
            mascot:               { x: 0,   y: 250,  w: 320, h: 320, type: 'mascot' },
            ctaCardBg:            { x: 0,   y: -178, w: UNIFORM_LAYOUT.CONTENT_W, h: 440, type: 'group' },
            connectBtn:           { x: 0,   y: -18,  w: UNIFORM_LAYOUT.CONTENT_W, h: 110, type: 'btnPrimary' },
            connectChevron:       { x: 290, y: -18,  w: 24,  h: 28,  type: 'label' },
            trustLine:            { x: 0,   y: -78,  w: 640, h: 20,  type: 'label' },
            liveSignalLabel:      { x: 0,    y: -100, w: 640, h: 20,  type: 'label' },
            liveSignalDot:        { x: -118, y: -99,  w: 8,   h: 8,   type: 'sprite' },
            playAsGuestBtn:       { x: 0,   y: -178, w: UNIFORM_LAYOUT.CONTENT_W, h: 88,  type: 'btnSuccess' },
            reconnBtn:            { x: 0,   y: -278, w: UNIFORM_LAYOUT.CONTENT_W, h: 72,  type: 'btnGhost' },
            connectionStatusPill: { x: 0,   y: -555, w: 200, h: 40,  type: 'chip' },
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

    // 2026-04-28 V4 — "Play Now" hub. Find Match becomes hero (instant play),
    // Start Match demoted to secondary, MIP neutralized (charcoal/btnGhost),
    // Bot Match grows full-width and absorbs Training Mode copy. Recent Match
    // card collapses to single-row (daily-challenge row dropped). Mirrors
    // LayoutSpec.cjs Home block.
    Home: {
        canvas: { w: 720, h: 1280 },
        elements: {
            homeContentScrim:    { x: 0,    y: 0,    w: 720, h: 1280, type: 'sprite' },
            // Header band (V3 — h 64→44, ≈-30%).
            notificationBell:    { x: -296, y: 640,  w: 44,  h: 44,  type: 'btnGhost' },
            notificationBadge:   { x: -278, y: 656,  w: 22,  h: 22,  type: 'badge' },
            walletPill:          { x: 0,    y: 640,  w: 360, h: 60,  type: 'chip' },
            walletPillGlow:      { x: 0,    y: 640,  w: 380, h: 80,  type: 'sprite' },
            walletPillSecureDot: { x: -150, y: 0,    w: 12,  h: 12,  type: 'badge' },
            pubkeyLabel:         { x: -50,  y: 0,    w: 220, h: 26,  type: 'label' },
            walletNameLabel:     { x: 120,  y: 0,    w: 100, h: 16,  type: 'label' },
            openLeaderboardBtn:  { x: -224, y: 640,  w: 44,  h: 44,  type: 'btnGhost' },
            openSettingsBtn:     { x:  224, y: 640,  w: 44,  h: 44,  type: 'btnGhost' },
            disconnectBtn:       { x:  296, y: 640,  w: 44,  h: 44,  type: 'btnGhost' },
            homeHeaderUnderline: { x: 0,    y: 600,  w: 640, h: 1,   type: 'sprite' },
            // V4 — level chip h 80→72 (8h tighter).
            homeLevelChip:       { x: 0,    y: 556,  w: 680, h: 72,  type: 'chip' },
            homeXpProgressLabel: { x: 310,  y: 14,   w: 280, h: 18,  type: 'label' },
            homeXpBarTrack:      { x: 0,    y: -14,  w: 640, h: 14,  type: 'sprite' },
            homeXpBarFill:       { x: -320, y: 0,    w: 0,   h: 14,  type: 'sprite' },
            // V5 (2026-04-28 home UX) — repurposed as user-specific "Last
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
            // V6 (2026-04-28) — CTA scale-up. Find HERO (teal, 136h, +8 over
            // secondary tier), Start (purple, 104h), MIP (charcoal ghost, 104h),
            // Bot (gold full-width, 104h). Uniform 18px gaps. Mirrors LayoutSpec.cjs.
            findMatchBtn:        { x: 0,    y: 320,  w: 680, h: 136, type: 'btnSuccess' },
            findMatchSubtitle:   { x: 0,    y: -36,  w: 620, h: 20,  type: 'label' },
            findMatchChevron:    { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label' },
            findMatchCountBadge: { x: 244,  y: 360,  w: 96,  h: 36,  type: 'badge' },
            findMatchActivityDot:{ x: -296, y: 372,  w: 10,  h: 10,  type: 'badge' },
            startMatchBtn:       { x: 0,    y: 182,  w: 680, h: 104, type: 'btnPrimary' },
            startMatchSubtitle:  { x: 0,    y: -26,  w: 620, h: 20,  type: 'label' },
            startMatchChevron:   { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label' },
            matchesInProgressBtn:        { x: 0,    y: 60,  w: 680, h: 104, type: 'btnGhost' },
            matchesInProgressSubtitle:   { x: 0,    y: -28, w: 620, h: 16,  type: 'label' },
            matchesInProgressChevron:    { x: 310,  y: 0,   w: 24,  h: 24,  type: 'label' },
            matchesInProgressCountBadge: { x: 244,  y: 84,  w: 88,  h: 32,  type: 'badge' },
            matchesInProgressActivityDot:{ x: -296, y: 84,  w: 10,  h: 10,  type: 'badge' },
            botMatchBtn:         { x: 0,    y: -62,  w: 680, h: 104, type: 'btnWarn' },
            botMatchSubtitle:    { x: 0,    y: -24,  w: 620, h: 16,  type: 'label' },
            botMatchSubtitleLine2: { x: 0,  y: -42,  w: 620, h: 14,  type: 'label' },
            botMatchChevron:     { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label' },
            // V4 — Training card REMOVED. Mascot kept here as off-flow node
            // pinned below safe area (consumed by PostMatch panel only); kept
            // in spec to avoid breaking AppUI's mascot lookup when Home is
            // active (mascot is reparented to the HomePanel only by intent).
            mascot:              { x: 0,    y: -820, w: 160, h: 180, type: 'mascot' },
            homeStatus:          { x: 0,    y: -148, w: 460, h: 16,  type: 'label' },
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
    ModePickerOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            title:             { x: 0,    y: 580,  w: 600, h: 48, type: 'label' },
            titleDivider:      { x: 0,    y: 548,  w: 240, h: 2,  type: 'sprite' },
            cancelBtn:         { x: 290,  y: 580,  w: 44,  h: 44, type: 'btnGhost' },
            sectionMode:       { x: 0,    y: 490,  w: 580, h: 18, type: 'label' },
            sectionDuration:   { x: 0,    y: 200,  w: 580, h: 18, type: 'label' },
            sectionTrack:      { x: 0,    y: 90,   w: 580, h: 18, type: 'label' },
            sectionDifficulty: { x: 0,    y: -30,  w: 580, h: 18, type: 'label' },
            paperToggle:       { x: -100, y: 40,   w: 200, h: 52, type: 'btnPrimary' },
            realToggle:        { x: 100,  y: 40,   w: 200, h: 52, type: 'btnGhost' },
            summaryCard:       { x: 0,    y: -200, w: 600, h: 130, type: 'group' },
            startBtn:          { x: 0,    y: -340, w: 580, h: 96,  type: 'btnPrimary' },
            statusLbl:         { x: 0,    y: -440, w: 600, h: 20,  type: 'label' },
        },
        templates: {
            modeBtn:       { count: 4, w: 320, h: 96 },
            windowBtn:     { count: 6, w: 92,  h: 44, y: 148, baseX: -275, gapX: 110 },
            difficultyBtn: { count: 3, w: 168, h: 44, y: -90, baseX: -186, gapX: 186 },
        },
        allowedOverlaps: [
            ['PickerSummaryCard', 'PickerSummaryModeLabel'],
            ['PickerSummaryCard', 'PickerSummaryModifiersLabel'],
            ['PickerSummaryCard', 'PickerSummaryStakeLabel'],
            ['PickerSummaryCard', 'CardEdgeAccent'],
        ],
    },
    RacePanel: {
        canvas: { w: 720, h: 1800 },
        elements: {
            // Battle-UI top row (2026-04-26): [Lv chip] (Timer) [+0.00%]
            racePlayerLevelChip: { x: -260, y: 720, w: 120, h: 40,   type: 'chip' },
            timerRing:           { x: 0,    y: 720, w: 132, h: 132,  type: 'graphics' },
            countdownLabel:      { x: 0,    y: 720, w: 100, h: 32,   type: 'label' },
            heroDelta:           { x: 240,  y: 720, w: 220, h: 80,   type: 'label' },
            playerTokenRow:      { x: 0,    y: 540, w: UNIFORM_LAYOUT.CONTENT_W, h: 110,  type: 'group' },
            opponentSubtitle:    { x: 0,    y: 410, w: 620, h: 64,   type: 'label' },
            duelBarContainer:    { x: 0,    y: 300, w: 680, h: 80,   type: 'group' },
            opponentDelta:       { x: 0,    y: 100,  w: 680, h: 96,   type: 'label' },
            opponentIdentityCard:{ x: 0,    y: -20,  w: 280, h: 44,   type: 'sprite' },
            opponentTokenRow:    { x: 0,    y: -130, w: UNIFORM_LAYOUT.CONTENT_W, h: 110,  type: 'group' },
            opponentCard:        { x: 0,    y: -400, w: 640, h: 110, type: 'sprite' },
            opponentStrip:       { x: 0,    y: -406, w: UNIFORM_LAYOUT.CONTENT_W, h: 260, type: 'group' },
            cancelBtn:           { x: 0,    y: -260, w: 140, h: 36,  type: 'btnGhost' },
            hintLabel:           { x: 0,    y: -310, w: 620, h: 24,  type: 'label' },
            mascot:              { x: 260,  y: -460, w: 120, h: 160, type: 'mascot' },
            vignette:            { x: 0,    y: 0,    w: 720, h: 1280, type: 'graphics' },
        },
        allowedOverlaps: [
            ['RaceTimerRing', 'RaceCountdownLabel'],
            ['RaceTokenCard_4', 'RaceOpponentCard'],
            ['RaceTokenCard_4', 'RaceOpponentStrip'],
            ['RaceOpponentCard', 'RaceOpponentStrip'],
        ],
    },
    SettingsPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // Phase 30 — premium settings redesign. KEEP IN SYNC with LayoutSpec.cjs.
            sheetBg:       { x: 0,    y: -40,  w: 692, h: 1180, type: 'sprite' },
            backLink:      { x: UNIFORM_HEADER.BACK_LINK.x, y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:       { x: UNIFORM_HEADER.BACK_BTN.x,  y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:         { x: 0,    y: UNIFORM_HEADER.TITLE_Y, w: 400, h: 44, type: 'label' },
            walletCard:    { x: 0,    y: 424,  w: UNIFORM_LAYOUT.CONTENT_W, h: 124, type: 'group' },
            profileCard:   { x: 0,    y: 264,  w: UNIFORM_LAYOUT.CONTENT_W, h: 148, type: 'group' },
            quickPlayCard: { x: 0,    y: 36,   w: UNIFORM_LAYOUT.CONTENT_W, h: 260, type: 'group' },
            audioCard:       { x: 0,    y: -192, w: UNIFORM_LAYOUT.CONTENT_W, h: 148, type: 'group' },
            accountCard:     { x: 0,    y: -414, w: UNIFORM_LAYOUT.CONTENT_W, h: 232, type: 'group' },
            dangerZoneLabel: { x: 0,    y: -566, w: 200, h: 14, type: 'label' },
            deleteBtn:       { x: 0,    y: -598, w: 320, h: 44, type: 'btnGhost' },
            status:          { x: 0,    y: -625, w: 640, h: 20, type: 'label' },
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
        ],
    },
    LeaderboardPanel: {
        canvas: { w: 720, h: 1280 },
        RUNTIME_TOP_EDGE: 748,
        elements: {
            backLink:         { x: UNIFORM_HEADER.BACK_LINK.x, y: 720, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:          { x: UNIFORM_HEADER.BACK_BTN.x,  y: 720, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:            { x: 0,    y: 680,  w: 400, h: 44,  type: 'label' },
            personalRankCard: { x: 0,    y: -130, w: UNIFORM_LAYOUT.CONTENT_W, h: 100, type: 'group' },
            status:           { x: 0,    y: -740, w: 600, h: 22,  type: 'label' },
        },
        allowedOverlaps: [['BackLinkLabel', 'BackButton']],
    },
    FindMatchPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:       { x: UNIFORM_HEADER.BACK_LINK.x, y: 750, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:        { x: UNIFORM_HEADER.BACK_BTN.x,  y: 750, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:          { x: 0,    y: 700,  w: 400, h: 36, type: 'label' },
            refreshBtn:     { x: 280,  y: 700,  w: 56,  h: 44, type: 'btnGhost' },
            countLabel:     { x: 0,    y: 665,  w: 600, h: 18, type: 'label' },
            hideFullToggle: { x: 0,    y: 388,  w: 160, h: 28, type: 'btnPrimary' },
            liveCountPulseDot:  { x: -90, y: 665, w: 10,  h: 10,  type: 'sprite' },
            // 2026-04-29 FindMatch UX rebuild: 3 row trays + SegmentMount stubs.
            modeTray:           { x: 80,  y: 540, w: 480, h: 50, type: 'sprite' },
            windowTray:         { x: 80,  y: 480, w: 480, h: 50, type: 'sprite' },
            wagerTray:          { x: 80,  y: 420, w: 480, h: 50, type: 'sprite' },
            segmentMountMode:   { x: 80,  y: 540, w: 480, h: 44, type: 'group'  },
            segmentMountWindow: { x: 80,  y: 480, w: 480, h: 44, type: 'group'  },
            segmentMountWager:  { x: 80,  y: 420, w: 480, h: 44, type: 'group'  },
            fmModeLabel:        { x: -260, y: 540, w: 100, h: 22, type: 'label' },
            fmWindowLabel:      { x: -260, y: 480, w: 100, h: 22, type: 'label' },
            fmWagerLabel:       { x: -260, y: 420, w: 100, h: 22, type: 'label' },
            // Legacy stubs kept for AppUI binding compat (hidden / zero size).
            filterCard:         { x: 0, y: 510, w: UNIFORM_LAYOUT.CONTENT_W, h: 1, type: 'sprite' },
            filterDivider1:     { x: 0, y: 0, w: 1, h: 1, type: 'sprite' },
            filterDivider2:     { x: 0, y: 0, w: 1, h: 1, type: 'sprite' },
            filterDivider3:     { x: 0, y: 0, w: 1, h: 1, type: 'sprite' },
            tabActiveUnderline: { x: 0, y: 0, w: 1, h: 1, type: 'sprite' },
            tailHintTitle:      { x: 0, y: -2000, w: 600, h: 24, type: 'label'  },
            tailHintSubtitle:   { x: 0, y: -2000, w: 600, h: 20, type: 'label'  },
            tailResetBtn:       { x: 0, y: -2000, w: 160, h: 40, type: 'btnGhost' },
            tailStartBtn:       { x: 0, y: -2000, w: 160, h: 40, type: 'btnGhost' },
            emptyLabel:     { x: 0,    y: -340, w: 660, h: 22, type: 'label' },
            hostBtn:        { x: 0,    y: -440, w: 540, h: 64, type: 'btnPrimary' },
            status:         { x: 0,    y: -700, w: 660, h: 20, type: 'label' },
        },
        allowedOverlaps: [],
    },
    TokenDuelPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // 2026-04-27 v2 — classic stack restored, shifted +45 to align pills
            // with HomePanel; FeedScrollView cut 30% (388→272). Mirrors `td`
            // constants block in LayoutSpec.cjs.
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: 685, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: 685, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            // 2026-04-29 token-picker rebuild — title raised 570→560, w 320→360, h 36→48.
            title:           { x: 0,    y: 560,  w: 360, h: 48, type: 'label' },
            // 2026-04-29 — moved 540→520 to clear bbox of larger title (h:36→48 at y:560).
            headerUnderline: { x: 0,    y: 520,  w: 712, h: 2,  type: 'sprite' },
            levelPill:       { x: 85,   y: 620,  w: 140, h: 44, type: 'chip' },
            solPill:         { x: 255,  y: 620,  w: 140, h: 44, type: 'chip' },
            // 2026-04-29b flagship rebalance — h 80→64 (orientation hint, not hero).
            matchSetupCard:  { x: 0,    y: 470,  w: UNIFORM_LAYOUT.CONTENT_W, h: 64, type: 'group' },
            // ready-state underline at matchSetupCard bottom (y = 470 - 32 + 1 = 439).
            matchSetupReadyGlow: { x: 0, y: 439, w: UNIFORM_LAYOUT.CONTENT_W, h: 2, type: 'sprite' },
            // 2026-04-29b — frame h 656→540 to free vertical real estate for squad.
            feedFrameCard:   { x: 0,    y: 147,  w: 712, h: 540, type: 'sprite' },
            // 2026-04-29 — Row 1 re-balanced (priority width on search, no overflow on LIVE).
            search:          { x: 18,   y: 387,  w: 332, h: 44, type: 'editbox' },
            searchClear:     { x: 168,  y: 387,  w: 32,  h: 32, type: 'btnGhost' },
            feedTabDropdown: { x: -250, y: 387,  w: 180, h: 44, type: 'btnGhost' },
            watchlistStar:   { x: 218,  y: 387,  w: 44,  h: 44, type: 'btnGhost' },
            cancelWatchlist: { x: 218,  y: 387,  w: 36,  h: 36, type: 'btnGhost' },
            liveIndicator:   { x: 292,  y: 387,  w: 80,  h: 24, type: 'label' },
            minLiqDropdown:    { x: -16,  y: 343,  w: 110, h: 32,  type: 'chip' },
            columnsBtn:        { x: 270,  y: 343,  w: 96,  h: 32,  type: 'chip' },
            feedColumnHeaders: { x: 0,    y: 305,  w: UNIFORM_LAYOUT.CONTENT_W, h: 24,  type: 'group' },
            feedScrollView:    { x: 0,    y: 85,   w: UNIFORM_LAYOUT.CONTENT_W, h: 392, type: 'scrollview' },
            // 2026-04-29b flagship rebalance — panel h 230→296; squad becomes hero region.
            squadPanel:        { x: 0,    y: -283, w: UNIFORM_LAYOUT.CONTENT_W, h: 296, type: 'group' },
            squadHeaderEyebrow:{ x: 0,    y: -156, w: 360, h: 14,  type: 'label' },
            squadHeaderLabel:  { x: 0,    y: -180, w: 420, h: 28,  type: 'label' },
            squadHeaderRule:   { x: 0,    y: -202, w: 240, h: 1,   type: 'sprite' },
            // 2026-04-29b — divider above wager row (commitment grouping).
            wagerRowDivider:   { x: 0,    y: -428, w: 680, h: 1,   type: 'sprite' },
            // 2026-04-29 — stake + CTA share 60-px baseline; CTA fills remaining width.
            wagerValueButton:  { x: -252, y: -468, w: 160, h: 60,  type: 'btnGhost' },
            wagerStartButton:  { x:   88, y: -468, w: 480, h: 60,  type: 'btnPrimary' },
            wagerLockChip:     { x: -252, y: -468, w: 160, h: 60,  type: 'chip' },
            wagerBotChip:      { x: -252, y: -468, w: 160, h: 60,  type: 'chip' },
            wagerHintLabel:    { x: 0,    y: -700, w: 600, h: 24,  type: 'label' },
            wagerDropdown:     { x: -240, y: -436, w: 360, h: 360, type: 'group' },
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
            status:            { x: 0,    y: -560, w: 688, h: 26,  type: 'label' },
            rowActionPopover:  { x: 0,    y: 0,    w: 260, h: 110, type: 'group' },
            rowActionPickBtn:  { x: 0,    y:  26,  w: 240, h: 44,  type: 'btnPrimary' },
            rowActionChartBtn: { x: 0,    y: -26,  w: 240, h: 44,  type: 'btnGhost' },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
            ['ChangeLabel',   'DeltaLabel'],
            ['LogoSprite',    'CheckboxSprite'],
            ['LogoSprite',    'CheckmarkIcon'],
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
            cardHeaderLabel:       { x: -180, y:  608, w: 220, h:  30, type: 'label' },
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
        canvas: { w: 720, h: 1280 },
        elements: {
            // 2026-04-27 — mirrors the `pm` constants block in LayoutSpec.cjs.
            payoutLabel:     { x: 0, y: -20,  w: 620, h: 96,  type: 'label' },
            shareButton:     { x: 0, y: -540, w: 280, h: 44,  type: 'btnPrimary' },
            mascotContainer: { x: 0, y: 200,  w: 280, h: 280, type: 'mascot' },
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
    LevelUpOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            title:    { x: 0, y: 200,  w: 600, h: 100, type: 'label' },
            bigLevel: { x: 0, y: 30,   w: 600, h: 240, type: 'label' },
            caption:  { x: 0, y: -190, w: 600, h: 36,  type: 'label' },
            rake:     { x: 0, y: -260, w: 600, h: 32,  type: 'label' },
            hint:     { x: 0, y: -560, w: 400, h: 22,  type: 'label' },
        },
        allowedOverlaps: [],
    },
};

export default LayoutSpec;
