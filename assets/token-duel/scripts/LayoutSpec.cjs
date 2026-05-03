/**
 * LayoutSpec.cjs — single source of truth for every UI element's position
 * and size on every screen.
 *
 * KEEP IN SYNC with LayoutSpec.ts (the TypeScript twin used for runtime
 * layout reads). The two files mirror each other intentionally.
 *
 * RULES:
 *   1. NO literal x/y/w/h numbers in generate-scenes.js. Every position
 *      must reference an entry in this file via require('./LayoutSpec.cjs').
 *   2. Cocos coordinate convention: anchor (0.5, 0.5), Y-up, origin at
 *      panel center. x = horizontal offset from center, y = vertical.
 *   3. Every element entry has: { x, y, w, h, type, notes? }. Optional:
 *      anchor: [ax, ay] for non-default anchor.
 *   4. `allowedOverlaps` lists pairs the verifier should ignore (parent
 *      contained in child, button highlight on top of button, etc.).
 *   5. After editing this file: run `npm run scenes && python3
 *      scripts/verify-layout.py` to confirm zero unintended overlaps
 *      WITHOUT rebuilding the APK.
 */

// 2026-04-29 — UNIFORM back/title/subtitle header band, mirrors MIP.
// Every panel with a back button must use these exact panel-local Y values
// and the (x, w, h) shape below. MatchesInProgressPanel is the canonical
// reference (back on its own row, title 40 below, subtitle 36 below title).
const UNIFORM_HEADER = {
    BACK_Y:     580,                                    // back on its own row, panel-local
    TITLE_Y:    540,                                    // 40 below back
    SUBTITLE_Y: 504,                                    // 36 below title
    BACK_LINK:  { x: -280, w: 110, h: 28 },             // visible "← Back" label
    BACK_BTN:   { x: -280, w: 140, h: 36 },             // invisible hit area, slightly larger
};

// 2026-04-29 — uniform text styling tokens. Title color = gold for action
// panels (PostMatch keeps its 60pt white hero accent for "YOU WON"). Dim
// text = one canonical RGB for subtitles, status labels, and section
// eyebrows. Eyebrow font size = 12pt across panels.
const UNIFORM_TEXT = {
    TITLE_COLOR:       { r: 255, g: 210, b: 74 },       // gold (MIP reference)
    TITLE_FONT_SIZE:   30,
    DIM_COLOR:         { r: 168, g: 174, b: 201 },      // canonical "dim text" — subtitles, status, eyebrows
    EYEBROW_FONT_SIZE: 12,
};

// 2026-04-29 — UNIFORM spacing scale. Every sibling-to-sibling y delta in
// a panel must come from this set. No literal 36/40/56/72 etc. Compose
// SPACE_32 + SPACE_16 to get 48; SPACE_32 + SPACE_24 for 56; etc.
const UNIFORM_SPACE = {
    SPACE_8:  8,
    SPACE_12: 12,
    SPACE_16: 16,
    SPACE_24: 24,
    SPACE_32: 32,
};

// 2026-04-29 — UNIFORM centered content column. Cards / CTAs / list rows
// snap to CONTENT_W. Subtitles use BODY_W (narrower for line-length).
// Chips use CHIP_W. Full-canvas backgrounds use CANVAS_W. SAFE_L/R define
// the column edges for left-anchored content.
const UNIFORM_LAYOUT = {
    CONTENT_W: 680,
    BODY_W:    600,
    CHIP_W:    200,
    CANVAS_W:  720,

    SAFE_L:   -340,
    SAFE_R:    340,

    SECTION_GAP_LARGE: 32,   // SPACE_32 — between major sections
    SECTION_GAP:       24,   // SPACE_24 — between row-stacks of cards
    GROUP_GAP:         16,   // SPACE_16 — between sibling cards/rows
    INTRA_GAP:         12,   // SPACE_12 — between elements inside a card
    TIGHT_GAP:          8,   // SPACE_8  — glyph + label, chip + chip
};

// 2026-04-29 (Prompt 1) — UNIFORM card geometry. Every card built via
// generate-scenes.js mkCard() uses one of these heights. Row stride =
// h + ROW_GAP. NOTIFICATION_H is a one-off — toast row chrome (left
// ColorStripe) is intentionally not in the unified card system.
const UNIFORM_CARD = {
    ROW_DENSE_H:     56,    // leaderboard rank rows, history rows
    ROW_DEFAULT_H:   88,    // stat cards, daily challenge rows
    ROW_FEATURE_H:  160,    // hero P&L, top player, post-match result
    ROW_GAP:          8,    // inter-row spacing
    NOTIFICATION_H:  92,    // notification toast / panel rows (one-off)
};

// 2026-05-02 arena rebuild (Phase B). Filter section compacted ~324→180px:
// Mode pill on its own row (full width 600), Duration + Stake side-by-side
// on the second row (290w each), Hide-full toggle in the bottom band of
// the filter card. Captions (Mode/Duration/Stake) hidden — pills are
// self-evident at this size. CTA + lobby pool lift up to fill freed space.
// One source of truth — both this scene-gen file and the AppUI runtime
// read y/w/h from this block.
const FINDMATCH_LAYOUT = {
    SECTION_GAP:     24,
    GROUP_GAP:       16,
    PILL_GAP:         8,
    CARD_PADDING:    16,
    HEADER_Y:       750,    // back link / level chip
    TITLE_Y:        695,    // own row, no overlap with mode pill
    STATUS_Y:       655,    // "LIVE · N matches active now" — runtime opacity 230 when active
    TABS_Y:         615,    // Open Lobbies / Live Now
    FILTER_CARD:  { x: 0, y: 484, w: 640, h: 180 },
    // Captions hidden in compact layout — pills are self-evident.
    MODE_LABEL_Y:   -2000,
    WINDOW_LABEL_Y: -2000,
    WAGER_LABEL_Y:  -2000,
    MODE_ROW_Y:     536,    // top row, full width (600w, 5 segs)
    WINDOW_ROW_Y:   468,    // second row, left half (290w, x=-155)
    WAGER_ROW_Y:    468,    // second row, right half (290w, x=+155)
    HIDE_FULL_Y:    410,    // right-anchored chip inside filter card
    PRIMARY_CTA_Y:  336,
    PRIMARY_CTA_W:  680,
    PRIMARY_CTA_H:   72,
    ROW_BASE_Y:     206,    // first lobby card center (lifted 54→206)
    ROW_STRIDE_Y:  -156,    // 140h card + 16 gap (unchanged)
    ROW_HEIGHT:     140,    // unchanged — internal sub-row offsets stay valid
    PAGINATION_Y:  -360,    // 24px below row 3 bottom (-340)
};

// 2026-04-29 — Dashboard zone scaffold. Portfolio + Leaderboard share a strict
// 5-zone vertical layout (HEADER, TITLE, MODE_SWITCH, SUBTAB, CONTENT) so that
// no element can drift into a sibling row. Each zone exposes topY / bottomY /
// centerY / height, all in panel-local Cocos Y (Y up, origin at panel center).
// Leaderboard collapses MODE_SWITCH (no Paper/Real on that screen), so its
// SUBTAB slides up into where MODE_SWITCH would have lived and CONTENT
// absorbs the freed height. Heights chosen so the hub strip's ±18 outer-glow
// stays inside HEADER, the 3-line title block fits inside TITLE without
// breaching HEADER glow, and CONTENT extends down to y=-480 (status footer
// lives below CONTENT).
function _zone(topY, height) {
    const bottomY = topY - height;
    return { topY, bottomY, centerY: topY - height / 2, height };
}
function buildDashboardZones({ includeModeSwitch }) {
    const TOP = 760;
    // title=104 fits 3 stacked rows (title 44h + subtitle 18h + pubkey 24h)
    // with breathing room and leaves the modeSwitch eyebrow room to sit
    // above the Paper/Real chip without clipping the pubkey row.
    const H = { header: 80, title: 104, modeSwitch: 60, subtab: 60 };
    const header     = _zone(TOP, H.header);
    const title      = _zone(header.bottomY, H.title);
    const modeSwitch = includeModeSwitch ? _zone(title.bottomY, H.modeSwitch) : null;
    const subtab     = _zone((modeSwitch || title).bottomY, H.subtab);
    const contentTop = subtab.bottomY;
    const contentBottom = -480;
    const content    = {
        topY: contentTop,
        bottomY: contentBottom,
        centerY: (contentTop + contentBottom) / 2,
        height: contentTop - contentBottom,
    };
    return { header, title, modeSwitch, subtab, content };
}
const DashboardLayoutSpec = {
    buildZones:  buildDashboardZones,
    portfolio:   buildDashboardZones({ includeModeSwitch: true }),
    leaderboard: buildDashboardZones({ includeModeSwitch: false }),
};

// 2026-04-27 v2 — Token Duel page deterministic Y anchors.
// Source-of-truth for every Y on TokenDuelPanel. NEVER hand-tune element
// Y values on this page; always derive from these. Canvas y-up,
// origin at panel center (range −640..+640).
//
// Layout shape: classic stack — pills/title at top, MatchSetupCard summary
// directly under title, FeedFrameCard (search/chips/cols + scroll) in the
// middle, SquadPanel (header + 3 slots + wager row) at bottom, status footer.
//
// All elements shifted +45 vs the legacy positions so the pills row aligns
// with HomePanel pills at y=620. FeedScrollView height cut 30% from the
// legacy 388 → 272. SquadPanel slides up to keep its original 41-px gap
// below the (now-shorter) scrollview bottom.
const td = {
    // Header band — pills + back; aligned with HomePanel.notificationBell etc.
    // 2026-04-27 v3: HEADER_Y 660→620 — drop pill row right above the title.
    HEADER_Y:           620,
    // 2026-04-29 token-picker rebuild — title raised 540→560 so it clears the
    // match setup card cleanly, and font bumped (see title element h:48).
    TITLE_Y:            560,
    TITLE_BOTTOM:       536,   // = TITLE_Y - title.h(48)/2

    // MatchSetupCard mission bar — directly under title.
    // 2026-04-29 god-tier UX pass: h 64→80 to fit teal top-accent strip + two
    // typographic lines (Squad N/3 left + Stake X SOL right at 22pt, hint at
    // 18pt below). Y recentered so top edge stays at 502; bottom shifts
    // 438→422. Feed frame loses 12 px (top 417→405, h 540→528) to maintain
    // a 17-px gap below the new mission card; squad-panel top stays anchored
    // at -135 because feed-frame bottom remains -123.
    MATCHSETUP_CARD_Y:  462,   // h=80 → top 502, bottom 422
    MATCHSETUP_CARD_H:  80,

    // FeedFrameCard wrapping search/chips/col-headers + scrollview.
    // 2026-05-01 squad-select pass — h 528→448 (-80) so the squad section
    // can grow into the reclaimed space below. Top stays at 405; bottom
    // shifts -123 → -43, freeing 80 px for the squad panel.
    FEED_FRAME_TOP:     405,
    FEED_FRAME_H:       448,
    FEED_FRAME_Y:       181,   // = FEED_FRAME_TOP - FEED_FRAME_H/2

    // 2026-04-30 — Trending + Search hero pass: Row 1 grew from 44 → 60h, so
    // SEARCH_Y dropped 375→365 (top still inside frame), CHIPS_Y 331→311
    // (Row 2 same gap below taller Row 1), COL_HEADERS_Y 293→273, scroll
    // shrank 380→360 to absorb the bump. Feed bottom -125 (was -111).
    SEARCH_Y:           365,
    CHIPS_Y:            311,
    COL_HEADERS_Y:      273,

    // 2026-05-01 — scroll window cut 360→320 to fit the shorter feed frame
    // (h 528→448). At new feedRow.h=120 the window shows ~2.5 visible rows
    // (was ~3 at h=140). Top stays at 245; bottom -115 → -75.
    FEED_SCROLL_TOP:    245,
    FEED_SCROLL_H:      320,
    FEED_SCROLL_Y:      85,    // = FEED_SCROLL_TOP - FEED_SCROLL_H/2
    FEED_SCROLL_BOTTOM: -75,

    // SquadPanel — 2026-05-01 squad-select pass: h 296→376 (+80), absorbing
    // the 80 px reclaimed from the feed frame. Top edge slides up from -135
    // to -55 (12 px below new feed bottom -43); panel center moves -283
    // → -243. Slot row recenters at -218 (was -298); header lifts -180 →
    // -100. Wager row + status unchanged so the bottom commitment band
    // stays anchored.
    SQUAD_PANEL_TOP:    -55,
    SQUAD_PANEL_H:      376,
    SQUAD_PANEL_Y:      -243,  // = SQUAD_PANEL_TOP - SQUAD_PANEL_H/2
    SQUAD_PANEL_BOTTOM: -431,
    SQUAD_HEADER_Y:     -120,    // 2026-05-01 r2.1: lowered to clear feed-scroll bottom (-75) with bigger eyebrow + label
    SQUAD_SLOTS_Y:      -266,    // 2026-05-01 r2.1: pushed down 16 px to maintain rule→slot gap; 220h slots span [-376,-156]
    WAGER_Y:            -468,    // 30 below SquadPanel bottom; spans [-498,-438]
    WAGER_DROPDOWN_Y:   -436,    // mirror; opens upward from wager-value button

    // Footer.
    STATUS_Y:           -580,    // 2026-04-30: -560→-580 to clear new wagerHintLabel at -528
};

// 2026-04-27 — PostMatch / Game Over deterministic Y anchors.
// 2026-04-28 spatial pass — full-height takeover. Panel canvas grows
// 1280→1800 (mirror RacePanel) so the dark wash covers tall devices and
// the app/Home gradient no longer bleeds through above "YOU WON". All
// child Y values shift UP by ~60–95 to (a) reclaim the freed top space,
// (b) anchor CTAs 24 px above world-bottom -640 (was clipping by 4 px),
// and (c) widen the gap between XP bar and CTA glow. SUBTITLE_Y now
// carries ONLY the "Won by X.XX%" headline; the per-token breakdown
// moves to a new BREAKDOWN_Y dimmed line.
//
// Panel root is offset by (0, -SAFE_AREA_TOP, 0) so panel-local y maps
// to world y - 110. Canvas range -640..640 → visible panel-local range
// [-530, 750].
const pm = {
    // Oversized canvas — mirrors RacePanel (720×1800 at Main.scene:103900).
    // Without this the root background sprite stops at 1280 logical px and
    // taller devices (e.g. 1183×2562 → fit-width yields ~2103 visible h)
    // show the underlying app gradient through the top void.
    PANEL_W:          720,
    PANEL_H:          1800,

    // Header band — back button drops INTO the title row (panel-y 564) so
    // the top-left corner stops competing with the YOU WON glow.
    BACK_Y:           564,   // was 620 — aligns with title baseline; left x=-260
    TROPHY_Y:         564,   // mirror back baseline; right x=+280
    TITLE_Y:          564,   // was 540 — pushed up to claim top space
    TRACK_Y:          502,   // was 485 — 12 px below title bottom

    // Mascot zone — center raised to free room for header above. Rings are
    // procedurally drawn from mascot._lpos.y (AppUI:10770) so glow follows.
    MASCOT_Y:         310,   // was 240 — center world 200; ~24 px above payout
    MASCOT_GLOW_WH:   420,   // 2026-04-30 — bumped 380→420 to encompass the new 400 px halo disc
    MASCOT_BOX_WH:    340,   // unchanged

    // Reward punch — payout now sits near canvas vertical center.
    PAYOUT_Y:         55,    // was -50 — paired with font 64→72 in generate-scenes
    SUBTITLE_Y:       -38,   // was -124 — ONLY carries "Won by X.XX%" headline
    BREAKDOWN_Y:      -72,   // NEW — token row "BIO +.. PUMP -.. Goblin -..", opacity 0.7
    RAKE_Y:           -104,  // was -176 — smallest dim line above stat grid

    // Stat cards 2×2 grid — stride 138 preserved; whole grid pulled up.
    CARD_H:           128,   // unchanged
    CARDS_ROW1_Y:     -196,  // was -266 — YOUR DELTA / BEST OPP
    CARDS_ROW2_Y:     -334,  // was -404 — XP EARNED / LEVEL

    // Progression bar — clearly separated from CTA layer (no glow overlap).
    XP_BAR_Y:         -430,  // was -488 — 24 px below row-2 cards, 20 px above CTA top

    // CTAs — anchored 24 px above canvas bottom (no longer clipped).
    CTA_Y:            -474,  // was -534 — center world -584, bottom -616 (24 from -640)

    // Tertiary affordances (hidden in default flow; pushed off-screen).
    SHARE_Y:          -540,  // was -595
    STATUS_Y:         -580,  // was -635
};

// 2026-04-29 — PostMatch viewport-aware 3-zone resolver.
// AppUI._relayoutPostMatchToViewport reads view.getVisibleSize() and
// snaps each child to (zoneAnchor + delta), so the layout follows the
// device viewport instead of the panel canvas. Anchors:
//   topAnchor = (vh / 2) - SAFE_AREA_TOP
//   centerY   = 0                          (panel root sits at world origin)
//   botAnchor = (-vh / 2) + SAFE_AREA_BOT
// Deltas are panel-local Y offsets from the anchor (Y-up). The pm.*_Y
// constants above are kept as fallbacks for the static .scene file
// positions; runtime overrides win.
pm.SAFE_AREA_TOP = 110;          // notch / status-bar clearance (mirrors generate-scenes.js)
pm.SAFE_AREA_BOT =  96;          // gesture-bar / nav-bar clearance
// 2026-04-29 win-screen redesign: reward block (eyebrow + payout +
// breakdown + subtitle) moves OUT of bottom and INTO top zone, above the
// mascot. Mascot stays centered. Rake drops to bottom zone above cards.
// Back nodes are deactivated by AppUI on show, but kept here at safe
// off-screen Y for any leftover code that calls setY by name.
pm.zones = {
    top: {                       // anchor: viewport top - SAFE_AREA_TOP
        backLink:   -2000,       // hidden — back button removed from win screen
        backBtn:    -2000,
        // 2026-04-29 game-over polish — hero block shifted ~48 px DOWN from
        // safe-top and inter-element gaps tightened from (46/44/50/60/42)
        // to spec (16/22/10/14/10). Title font also drops 64→52pt at runtime
        // and grows to 130h to host two-line wrap "YOU WON\nHIBUDD".
        title:       -56,        // was -8 — pushed down to break top crowding
        track:      -134,        // 16 px below title (title visible h ~70)
        earned:     -176,        // 22 px below track
        payoutLabel:-240,        // 10 px below earned (payout visible h ~100)
        breakdownPill:-316,      // 14 px below payout
        subtitle:   -360,        // 10 px below pill
        trophy:      -76,        // follow title shift
    },
    center: {                    // anchor: viewport vertical mid (panel-local 0)
        // 2026-04-30 — both at true center (was +25 nudge). User wants
        // the mascot+glow stack dead-centered on screen.
        mascotGlow:       0,
        mascotContainer:  0,
    },
    bottom: {                    // anchor: viewport bottom + SAFE_AREA_BOT
        sameSquadBtn:    56,     // primary CTA, 56 px above safe-bottom
        againBtn:        56,     // secondary CTA, same row
        sameSquadGlow:   56,     // halo follows primary CTA
        xpBarFill:      150,     // XP bar 38 px above CTA tops (24px tall)
        xpBarLabelLeft: 150,
        xpBarLabelRight:150,
        cardsRow2:      244,     // XP / LEVEL row
        cardsRow1:      388,     // YOUR DELTA / BEST OPP row (144 above row2)
        rake:           540,     // rake line above stat grid (dim, secondary)
        shareButton:     90,     // tertiary, between CTAs and XP bar
        status:         -50,     // off-screen by default
    },
};

// 2026-04-27 — HomePanel deterministic Y anchors.
// The post-sign-in lobby. Layout is locked — every Y on the page derives
// from this block; do NOT hand-tune element y values. Panel root is offset
// by (0, -SAFE_AREA_TOP, 0) so panel-local y maps to world y - 110.
const home = {
    // 2026-04-27 V3 — Battle-launcher hierarchy. Header tightens (icon h
    // 64→44, ≈-30%), RecentMatch + DailyStreak fold into one elevated 2×3
    // stat card, Start CTA dominates (h 104→120), Find/MIP equalize as
    // Tier-1 teal pair, Bot demoted (h 84→72, w 680→600, amberDim).
    // Vertical inter-element gaps drop ~25% (~80→~60 px avg).
    //
    // Header band — 5-icon bar (bell · trophy · wallet · cog · disconnect).
    HEADER_Y:         640,
    HEADER_BADGE_Y:   656,   // bell.y + 16 — tighter against 44-px bell
    HEADER_UNDERLINE_Y: 600, // V3 NEW — subtle violet underline below header band

    // Content stack — top → bottom of the lobby. V4 ("Play Now" hub) — Find
    // Match becomes hero (was Start), Start demoted to secondary, MIP
    // neutralized, Bot Match grows full-width and absorbs Training copy.
    XP_CHIP_Y:        556,   // V4 — h 80→72 tighter (was 548)
    RECENT_CARD_Y:    460,   // V4 — single-row card h 184→96 (was 404)
    // V7 (2026-05-01 home CTA scale-up to 1.75x) — heights bump 136/104/104/104 → 160/122/122/122
    // (≈1.167x on top of V6's 1.5x). GAP stays at 18 px. Find center derived to keep top edge
    // at y=388 (matches V5/V6).
    // Authoritative formula: GAP=18, hF=160, hS=122; FIND=308, START=308-(hF/2+GAP+hS/2)=
    // 308-(80+18+61)=149; MIP=149-(61+18+61)=9; BOT=9-(61+18+61)=-131.
    FIND_CTA_Y:       308,   // V7 — h 136→160; top edge stays at y=388
    FIND_BADGE_Y:     360,   // V7 — top edge unchanged at 388, offset 28 below preserved
    FIND_DOT_Y:       372,   // V7 — top edge unchanged, offset 16 below preserved
    START_CTA_Y:      149,   // V7 — h 104→122, repacked for uniform 18px gap
    MIP_CTA_Y:        9,     // V7 — h 104→122, repacked
    MIP_BADGE_Y:      42,    // V7 — track new top edge (MIP top y=70 → badge y=70-28)
    MIP_DOT_Y:        42,    // V7 — track new top edge (offset 28 below)
    BOT_CTA_Y:        -131,  // V7 — h 104→122, repacked (stack now ends at y=-192)

    // V4 — TRAINING_Y removed; HomeTrainingCard deleted from scene.
    // V3 — DailyStreakStrip + ChooseMatch eyebrow folded into Recent card.
    // Old anchors SECONDARY_Y (320) and SECTION_LBL_Y (260) removed.

    // Legacy off-flow nodes — pinned below safe area, kept ONLY for AppUI
    // binding compat after Phase N4 collapsed them into SettingsPanel.
    LEGACY_RAKE_Y:    -820,
    LEGACY_DELETE_Y:  -880,
    LEGACY_SIGNOUT_Y: -940,
};

// 2026-04-27 — RacePanel deterministic Y anchors.
// The live gameplay / portfolio-race screen. Layout is locked — every Y
// on the page derives from this block; do NOT hand-tune element y values.
// Panel root is offset by (0, -RACE_SAFE_AREA_EXTRA, 0) where
// RACE_SAFE_AREA_EXTRA = 90 (defined in generate-scenes.js); panel-local y
// maps to world y - 90. Canvas is oversized 720×1800.
const race = {
    // Top header row: Lv chip + circular countdown ring + hero delta.
    TOP_HEADER_Y:        720,

    // Player-side token row (3 cards side-by-side, duel layout).
    PLAYER_TOKEN_ROW_Y:  540,

    // Lead-state subtitle ("YOU LEAD" / "DEAD HEAT" / "YOU TRAIL").
    LEAD_STATE_Y:        410,

    // Center tug-of-war duel bar (track + fill + glow + tick + tags).
    DUEL_BAR_Y:          300,

    // Opponent's hero delta (big 80pt portfolio %). 2026-04-29: repurposed
    // as the Round Advantage card center — number now renders the lead in pp.
    // 100 → 110 to give the card+caption a visually-balanced anchor.
    OPP_HERO_DELTA_Y:    110,

    // Round Advantage card — wraps the OPP_HERO_DELTA label with a glowing
    // border + halo + caption + subtext. All centered on OPP_HERO_DELTA_Y.
    ADV_CARD_W:          320,
    ADV_CARD_H:          180,
    ADV_HALO_W:          420,
    ADV_HALO_H:          200,
    ADV_CAPTION_Y:       178,   // sits above the big number
    ADV_SUBTEXT_Y:       42,    // sits below the big number

    // Opponent identity card ("BOT · Lv N"). 2026-04-27: 40 → 0 to clear opponentDelta visual extent.
    // 2026-04-28: 0 → -20 to follow opponentDelta down and keep a clear ≥20px
    // gap between the 80pt PnL glyph extent and the pill (no visual collision).
    OPP_IDENTITY_Y:      -20,

    // Opponent-side token row (3 cards side-by-side, duel layout).
    // 2026-04-28: -90 → -130 to anchor the opponent row near the bottom safe
    // area (mirrors player row top-spacing; gives the screen a 3-zone read).
    OPP_TOKEN_ROW_Y:     -130,

    // 2026-04-30 — Bot portfolio % (bottom-left mirror of heroDelta).
    // 2026-05-01 — pushed -210 → -310 so the distance from OPP_TOKEN_ROW_Y
    // (180 px center-to-center) mirrors heroDelta(720) ↔ playerTokenRow(540).
    OPP_FOOTER_DELTA_Y:  -310,

    // 2026-04-27 — Forfeit + Home buttons paired. Home on LEFT, Forfeit on RIGHT.
    // 2026-05-01 — y -260 → -380 to clear OPP_FOOTER_DELTA_Y (-310, h=80 → bot -350).
    FORFEIT_BTN_Y:       -380,
    FORFEIT_BTN_X:        80,    // moved x=0 → +80 to make room for Home
    HOME_BTN_X:          -80,
    HOME_BTN_Y:          -380,

    // Gameplay hint ("Tap to drop - stack as high as you can"). Sits below Forfeit.
    // 2026-05-01 — -310 → -430 to follow the button row down.
    HINT_LABEL_Y:        -430,

    // 4p/8p multi-player surfaces — mutually exclusive with duel layout.
    OPP_CARD_Y:          -400,   // 1v1 legacy big opponent card (hidden in duel)
    OPP_STRIP_Y:         -406,   // 7-bot opponent leaderboard strip — KILLED 2026-04-27 (force-hidden)

    // Mascot bottom-right corner.
    // 2026-05-01 — -460 → -540 so mascot top clears hint bottom (hint at -430,
    // h=24 → bottom -442; mascot top must be ≤ -442 → center ≤ -522 with h=160).
    MASCOT_Y:            -540,

    // 2026-04-27 — Multi-player condensed-card grid (Trio / 4p / 8p).
    // Group sits in the band below the central duel bar. Row1 cards centered
    // at gridY=+60 (panel y=-130), row2 at gridY=-60 (panel y=-250).
    MULTI_GRID_Y:        -190,
    MULTI_GRID_W:         680,
    MULTI_GRID_H:         260,
    // "← Back" button — only visible when an opponent card is expanded.
    MULTI_BACK_BTN_X:    -260,
    MULTI_BACK_BTN_Y:     140,    // same band as opponentDelta (top-LEFT of expanded view)
};

// 2026-04-27 — LandingPanel deterministic Y anchors.
// The connect / sign-in screen. Layout is locked except for the action-stack
// re-order: Connect (top) → Play as Guest → Reconnect (bottom). Every Y on
// the page derives from this block; do NOT hand-tune element y values.
const landing = {
    // Hero band — title + subtitle + mascot. 2026-04-28 polish pass dropped
    // the redundant tagline + support line (down to one dominant idea).
    // 2026-04-29 demo-ready pass: subtitle pulled tighter to title (432 → 438)
    // so they read as a tighter cap-to-cap unit; mascot zone unchanged.
    TITLE_Y:          480,
    SUBTITLE_Y:       438,    // 2026-04-29 demo-ready: 432 → 438 (tighter cap-to-cap)
    MASCOT_Y:         250,    // 2026-04-28 polish: 300 → 250 (anchor toward CTA)

    // CTA card backdrop (semi-translucent dark surface w/ violet edge).
    CTA_CARD_Y:       -178,   // 2026-04-27 UX upgrade: pulled up 7 (was -185)

    // Action stack inside the CTA card. 2026-04-27 UX upgrade: tightened
    // ~20% — every Y in the stack moved closer to the next neighbor so the
    // stack feels "decided" instead of spread. 2026-04-28: trust line
    // pulled tighter to Connect; new LiveSignal sub-cue inserted between
    // trust and Guest, so Guest + Reconnect drop to make room.
    // 2026-04-29 demo-ready pass: ConnectButton h 126 → 108 (less bloated),
    // so its bottom edge rose 9 px. Trust line gains 24 px clearance; live
    // signal cascades; Guest + Reconnect adjust to keep 18/16 px clearance
    // bands. Reconnect width restored to UNIFORM (was 560), opacity raised
    // in AppUI.
    CONNECT_Y:        -18,    // PRIMARY — Enter the Duel (h=108, was 126)
    TRUST_Y:          -104,   // 2026-04-29 demo-ready: -86 → -104 (24 px clearance below CTA bottom -72)
    LIVE_SIGNAL_Y:    -128,   // 2026-04-29 demo-ready: -112 → -128 (cascade + breathing)
    GUEST_Y:          -196,   // 2026-04-29 demo-ready: -186 → -196 (clear new live signal)
    RECONNECT_Y:      -296,   // 2026-04-29 demo-ready: -282 → -296 (16 px clearance below Guest bottom -236)

    // Bottom status footer.
    STATUS_PILL_Y:    -540,   // 2026-04-29 demo-ready: -555 → -540 (lift off home indicator)
};

// 2026-04-27 — SettingsPanel deterministic Y anchors.
// Top buttons aligned with HomePanel (y=620). Cards/footer shifted UP +30
// from legacy to compress the title-to-WalletCard gap and pull the
// status footer closer to the canvas bottom. Panel root is offset by
// (0, -SAFE_AREA_TOP, 0) so panel-local y maps to world y - 110.
const settings = {
    // Header band — back / title (uniform with MIP).
    // 2026-04-29: back moved to its own row (UNIFORM_HEADER.BACK_Y=580), title
    // moved to its own row below (UNIFORM_HEADER.TITLE_Y=540). Card stack
    // shifted DOWN 80 px to clear the new title row (walletCard top edge
    // would have collided with title without the shift).
    // 2026-04-29 (pass 2): the 80 px shift was under-corrected — wallet card
    // top still landed only 6 px below title bottom, visually colliding on
    // device. Re-derived the stack from first principles: title bottom at
    // y=518 (TITLE_Y=540, h=44), preferred 32 px clearance, then 24 px gap
    // between every card except a flexible 32 px before the Account /
    // Danger Zone block. Footer (delete btn + status) kept put.
    HEADER_Y:             580,   // legacy alias, prefer UNIFORM_HEADER.BACK_Y
    TITLE_Y:              540,   // legacy alias, prefer UNIFORM_HEADER.TITLE_Y

    // 2026-04-30 — uniform 16 px (SPACE_16) inter-card gaps. Wallet collapses
    // 124→96 (single identity row), Account compresses 232→200, Danger Zone
    // pulled up so Delete sits 24 px below Account (no dead zone). Title
    // bottom 518; Wallet top 494 (24 px gap = SPACE_24).
    WALLET_CARD_Y:        446,   // h 96 — top y=494 (SPACE_24 below title), bot y=398
    PROFILE_CARD_Y:       308,   // h 148 — top y=382 (SPACE_16 gap), bot y=234
    QP_CARD_Y:            88,    // h 260 — top y=218 (SPACE_16 gap), bot y=-42
    AUDIO_CARD_Y:         -132,  // h 148 — top y=-58 (SPACE_16 gap), bot y=-206
    ACCOUNT_CARD_Y:       -322,  // h 200 — top y=-222 (SPACE_16 gap), bot y=-422

    // Footer — Delete sits SPACE_24 below Account bottom; status hugs Delete.
    DELETE_BTN_Y:         -468,  // top y=-446 (SPACE_24 below Account bot)
    STATUS_Y:             -510,  // SPACE_16 below Delete bot (-490)

    // Popovers — anchored to QP card; new QP_CARD_Y is +52 vs prior, so each
    // popover Y shifts +52 to keep its on-screen position relative to its row.
    QP_MODE_POPOVER_Y:    70,    // was 18; +52 to track QP_CARD_Y shift
    QP_WINDOW_POPOVER_Y:  24,    // was -28
    QP_WAGER_POPOVER_Y:   -42,   // was -94
};

// 2026-04-27 — PortfolioPanel deterministic Y anchors.
// 2026-04-29 — Y values now DERIVE from DashboardLayoutSpec.portfolio zones
// (HEADER / TITLE / MODE_SWITCH / SUBTAB / CONTENT). The hero PnL card is
// locked to content.topY minus a 32-px safety margin so it cannot bleed into
// the SUBTAB pill row's outer glow. The remainder of the content stack
// preserves its prior internal proportions by rebasing onto the new hero
// anchor (HERO_CARD_Y shifts down ~36 px from the legacy 380 → 344).
const _PZ = DashboardLayoutSpec.portfolio;
// Δ = HERO_CARD_Y(new) − HERO_CARD_Y(legacy 380). Applied to subordinate
// stack elements so the existing internal rhythm survives the zone fix.
const _PZ_HERO_Y = _PZ.content.topY - UNIFORM_SPACE.SPACE_32 - 80;  // 456-32-80 = 344
const _PZ_HERO_DELTA = _PZ_HERO_Y - 380;                            // 344 - 380 = -36
const portfolio = {
    // Header band — back link / title / subtitle / pubkey. All inside HEADER + TITLE zones.
    BACK_Y:               _PZ.header.centerY,                     // 720
    TITLE_Y:              _PZ.title.topY - 24,                    // 656 (h=44 → 634..678, inside)
    SUBTITLE_Y:           _PZ.title.topY - 56,                    // 624
    PUBKEY_Y:             _PZ.title.topY - 80,                    // 600

    // Mode-switch zone (Paper/Real) and subtab zone (Stats/History/Trophies).
    TABS_Y:               _PZ.subtab.centerY,                     // 486
    // 2026-04-29 — eyebrow center 572 lands above the Paper/Real chip with a
    // 4-px gap from the chip top and a 6-px gap from the pubkey bbox bottom.
    // The label is deactivated at runtime by AppUI; static-scene placement
    // here only needs to keep the verifier clean for the (hidden) legacy stub.
    MODE_LABEL_Y:         _PZ.modeSwitch.topY - 4,                // 572 — "MODE" eyebrow
    MODE_TOGGLE_Y:        _PZ.modeSwitch.centerY,                 // 546 — Paper / Real

    // Stats view — content stack (anchored to CONTENT zone top, internal Δ preserved).
    HERO_CARD_Y:          _PZ_HERO_Y,                             // 344 (was 380)
    GROUP_PERF_Y:         230 + _PZ_HERO_DELTA,                   // 210
    PERF_CARDS_Y:         168 + _PZ_HERO_DELTA,                   // 148
    WINRATE_CARD_Y:        78 + _PZ_HERO_DELTA,                   // 58
    GROUP_ACTIVITY_Y:     -50 + _PZ_HERO_DELTA,                   // -70
    ACTIVITY_CARDS_Y:    -120 + _PZ_HERO_DELTA,                   // -140

    // Empty state (when zero games).
    EMPTY_STATE_Y:        200,

    // Footer.
    HINT_Y:               -700,
    STATUS_Y:             -740,

    // History view — scrollview fills CONTENT zone.
    HISTORY_SCROLL_Y:     _PZ.content.centerY,                    // -4
    HISTORY_SCROLL_H:     _PZ.content.height - 16,                // 936
    HISTORY_BASE_Y:       -66,
    HISTORY_GAP_Y:        -124,
    HISTORY_LOAD_MORE_Y:  -260,

    // Trophies view — 3×2 grid of TrophyTile with header band above + footer
    // band below. Tile w/h bumped to 220×260 (gap 16) so each card carries a
    // WEEK eyebrow + 90-px medal/star icon + big win count + label without the
    // empty-space feel of the prior 200×200 layout.
    // Block height: 2*260 + 16 = 536. Top row centerY 150 → bottom -126 →
    // block clears 280..-256 → leaves room for header (~360..420) and
    // footer (-300..-380) inside the 936-tall CONTENT zone.
    TROPHY_GRID_BASE_Y:        150,
    TROPHY_GRID_STRIDE_Y:      -276,
    TROPHY_EMPTY_Y:            _PZ.content.centerY,               // -4
    TROPHY_HEADER_TITLE_Y:     420,
    TROPHY_HEADER_SUBTITLE_Y:  392,
    TROPHY_PAGE_ROW_Y:         420,
    TROPHY_FOOTER_LINE1_Y:     -300,
    TROPHY_FOOTER_LINE2_Y:     -324,
    TROPHY_SHARE_BTN_Y:        -380,
};

// 2026-04-27 — LeaderboardPanel deterministic Y anchors.
// 2026-04-29 — Y values DERIVE from DashboardLayoutSpec.leaderboard zones.
// Leaderboard collapses MODE_SWITCH (no Paper/Real here), so SUBTAB sits
// directly under TITLE and CONTENT absorbs the freed 60 px. The #1 hero
// card is anchored to content.topY minus 32-px safety margin so it cannot
// bleed up into the SUBTAB pill row.
const _LZ = DashboardLayoutSpec.leaderboard;
// 2026-04-29 v2 redesign — slim hero card (h=88), taller rows (h=72), smaller
// row gap (4 px → stride 76), bigger PersonalRankCard (h=148) with btnPrimary CTA.
const _LZ_TOP_PLAYER_H = 88;
const _LZ_ROW_H        = 72;
const _LZ_TOP_PLAYER_Y = _LZ.content.topY - UNIFORM_SPACE.SPACE_16 - _LZ_TOP_PLAYER_H / 2; // 516-16-44 = 456
const leaderboard = {
    // Header band — back / title / subtitle. All inside HEADER + TITLE zones.
    BACK_Y:           _LZ.header.centerY,                          // 720
    TITLE_Y:          _LZ.title.topY - 24,                         // 656
    SUBTITLE_Y:       _LZ.title.topY - 64,                         // 616 (subtitle h=28, gap 4 below title bbox)

    // Subtab zone — 4 mode tabs (1v1 / Trio / 4p / 8p) + this-week chip ride along.
    MODE_TABS_Y:      _LZ.subtab.centerY,                          // 546 (was 590)

    // Hero rank-#1 card — slim, integrated. Sits 16 px below content.topY.
    TOP_PLAYER_Y:     _LZ_TOP_PLAYER_Y,                            // 456 (was 429)
    TOP_PLAYER_H:     _LZ_TOP_PLAYER_H,                            // 88  (was 110)

    // Rank rows 2–10 (lbRow template). 8 px gap below hero, then 4 px gap between rows.
    ROW_H:            _LZ_ROW_H,                                   // 72  (was 56)
    ROWS_BASE_Y:      _LZ_TOP_PLAYER_Y - _LZ_TOP_PLAYER_H / 2 - UNIFORM_SPACE.SPACE_8 - _LZ_ROW_H / 2, // 456-44-8-36 = 368
    ROWS_GAP_Y:       -76,                                         // stride 72 + 4 (was -64)

    // Empty state (when zero matches in mode/timeframe).
    EMPTY_STATE_Y:    150,

    // Sticky-bottom personal rank card ("YOU" footer). Sits below CONTENT zone.
    PERSONAL_RANK_Y:  -446,                                        // re-centered for h=148 (was -440)
    PERSONAL_RANK_H:  148,                                         // bigger CTA + padding (was 130)

    // Status footer.
    STATUS_Y:         -740,
};

// 2026-04-29 — MatchesInProgressPanel: fixed 6-row pool, NO scrollview/Mask.
// Prior scrollview + 30-row pool architecture had row content invisible despite
// every diagnostic passing (data, opacity, world position, font, layer). Cause
// suspected to be cc.Mask interaction with the parent UITransform chain. New
// shape mirrors FindMatchPanel (which renders correctly): rows are direct
// children of the panel, no Mask, no scrollview. 6 rows covers practical load.
const mip = {
    BACK_Y:           580,
    TITLE_Y:          540,
    SUBTITLE_Y:       504,

    // Fixed row pool (no scrollview).
    // 2026-04-29 v2 — teardown pass: ROW_H 132→144 to hold larger type
    // (vs label 20→26pt, status 13→17pt). Stride -160 = 144 + 16.
    ROW_W:            680,
    ROW_H:            144,
    ROW_BASE_Y:       400,    // first row center (header → first card ≈24px)
    ROW_GAP_Y:        -160,   // stride downward (h 144 + 16 gap)
    ROW_COUNT:        6,

    // Empty state (shown when zero active matches).
    EMPTY_STATE_Y:    120,
    EMPTY_TITLE_Y:    60,
    EMPTY_SUB_Y:      0,
    EMPTY_CTA_Y:      -60,

    // "+N more" label below row 5 when n > 6.
    // 2026-04-29 v2 — shifted -480 → -528 to follow the taller stack.
    MORE_LABEL_Y:    -528,

    // Footer.
    STATUS_Y:         -740,

    // 2026-05-02 — "Live Battle" v3 hero geometry (only applied when n=1).
    // Hero grows row 0 to 660×420 with a big-timer centerpiece, animated leader
    // chip, dominant Resume CTA. Stack rows (n>=2) keep the standard row template
    // above. Constants are read by _applyMipHeroLayout in AppUI.ts and applied
    // via setContentSize + setPosition at runtime — generator scaffolds rows at
    // the standard 680×144.
    HERO: {
        CARD_W:           660,
        CARD_H:           420,    // was 260 in prior hero pass
        GLOW_OUTSET:      16,     // → 692×452 cardGlow
        Y:                -260,   // row0 center; leaves ~150px header → card gap
        VS_Y:             160,    // VS line vertical inside card (32pt)
        LIVE_Y:           160,    // LIVE cluster on VS baseline
        LIVE_DOT_X:       260,    // pull dot inward to clear bigger label
        LIVE_LABEL_X:     298,
        LIVE_DOT_SIZE:    16,     // bumped from 12
        LIVE_LABEL_SIZE:  18,     // pt, bumped from 14
        VS_LABEL_SIZE:    32,     // pt, bumped from 26
        TIMER_BIG_Y:      40,     // big-timer label center
        TIMER_BIG_H:      80,
        TIMER_BIG_SIZE:   64,     // pt, gold bold
        PHASE_Y:          -28,    // phase microcopy below big timer
        PHASE_SIZE:       18,     // pt, slate
        LEADER_Y:         -78,    // animated leader chip below phase
        LEADER_SIZE:      22,     // pt, bumped from 14 stack
        PROGRESS_Y:       -150,   // pulled to lower zone
        PROGRESS_H:       8,      // bumped from 6
        ACTION_Y:         -185,   // Resume + Ranks baseline
        RESUME_X:         222,
        RESUME_W:         200,    // bumped from 116
        RESUME_H:         64,     // bumped from 44
        RESUME_GLOW_W:    260,    // bumped from 150
        RESUME_GLOW_H:    96,     // bumped from 72
        DETAILS_X:        -244,
        DETAILS_W:        48,     // shrunk from 84 (icon-only on hero)
        DETAILS_H:        36,
    },
};

const LayoutSpec = {
    // 2026-04-29 — exposed for generator helpers (mkBackHeader, etc.).
    UNIFORM_HEADER,
    UNIFORM_TEXT,
    UNIFORM_SPACE,
    UNIFORM_LAYOUT,
    UNIFORM_CARD,
    FINDMATCH_LAYOUT,
    // 2026-04-29 — Dashboard 5-zone scaffold for Portfolio + Leaderboard.
    DashboardLayoutSpec,
    /* ───── GLOBAL allowed overlaps ─────────────────────────────────── */
    // Pairs listed here are checked AGAINST EVERY PANEL. Use sparingly —
    // for structural patterns that legitimately recur app-wide.
    //
    // Phase 13 (B3) — every button is now a 3-child composite (TopHighlight
    // + BottomShadow + Label). Label is full-button-height so its bbox
    // overlaps both bevel strips by design. The verifier sees ~150 buttons
    // and would flag 300+ false positives without this.
    _GLOBAL_: {
        allowedOverlaps: [
            ['TopHighlight', 'Label'],         // bevel highlight under label
            ['BottomShadow', 'Label'],         // bevel shadow under label
            ['TopHighlight', 'BottomShadow'],  // defensive — shouldn't y-overlap
            // Landing redesign — mkBtnHeroLayered swaps single Label for
            // TitleLabel + SubtitleLabel stacked inside one button rect.
            // The two labels are intentionally close (subtitle hugs title).
            ['TopHighlight', 'TitleLabel'],
            ['BottomShadow', 'TitleLabel'],
            ['TopHighlight', 'SubtitleLabel'],
            ['BottomShadow', 'SubtitleLabel'],
            ['TitleLabel',   'SubtitleLabel'],
            // v2 — opts.gradient adds a MidGloss bevel strip across the
            // button's mid-line; it overlaps every other in-button child
            // by construction (it's a glossy accent layer).
            ['TopHighlight', 'MidGloss'],
            ['BottomShadow', 'MidGloss'],
            ['MidGloss',     'TitleLabel'],
            ['MidGloss',     'SubtitleLabel'],
            ['MidGloss',     'Label'],
            // ConnectChevron is a child of ConnectButton — overlaps button bevel layers.
            ['TopHighlight', 'ConnectChevron'],
            ['BottomShadow', 'ConnectChevron'],
            ['MidGloss',     'ConnectChevron'],
            ['TitleLabel',   'ConnectChevron'],
            ['SubtitleLabel','ConnectChevron'],
            // v2 Landing CTA card backdrop sits behind every action element
            // by design (single visual grouping). Verifier looks up by scene
            // node name (LandingPanel) but Landing.allowedOverlaps is keyed
            // 'Landing' — so these go global to actually clear.
            ['CTACardBg', 'ConnectButton'],
            ['CTACardBg', 'ReconnectButton'],
            ['CTACardBg', 'PlayAsGuestButton'],
            ['CTACardBg', 'TrustLineLabel'],
            ['CTACardBg', 'CardEdgeAccent'],
            // 2026-04-26 lobby restructure — Home action trio has subtitle +
            // chevron CHILDREN of each mkBtnHero button. They overlap the
            // button's own Label/TopHighlight/BottomShadow rect by design.
            ['Label',        'StartMatchSubtitle'],
            ['Label',        'FindMatchSubtitle'],
            ['Label',        'BotMatchSubtitle'],
            ['Label',        'StartMatchChevron'],
            ['Label',        'FindMatchChevron'],
            ['Label',        'BotMatchChevron'],
            ['TopHighlight', 'StartMatchChevron'],
            ['TopHighlight', 'FindMatchChevron'],
            ['TopHighlight', 'BotMatchChevron'],
            ['BottomShadow', 'StartMatchChevron'],
            ['BottomShadow', 'FindMatchChevron'],
            ['BottomShadow', 'BotMatchChevron'],
            // WalletPill houses pubkey + walletName + a secure-dot indicator
            // sitting on the left edge — overlap with PubkeyLabel by design.
            ['PubkeyLabel',  'WalletPillSecureDot'],
            // V5 — Last Result card overlaps: tiny "LAST MATCH" label sits
            // above the OUTCOME / DELTA labels and meta line; halo glow
            // sibling sits behind the card.
            ['HomeLastResultLabel',   'HomeLastResultOutcome'],
            ['HomeLastResultOutcome', 'HomeLastResultDelta'],
            ['HomeLastResultGlow',    'HomeLastResultLabel'],
            ['HomeLastResultGlow',    'HomeLastResultOutcome'],
            ['HomeLastResultGlow',    'HomeLastResultDelta'],
            ['HomeLastResultGlow',    'HomeLastResultMeta'],
        ],
    },

    /* ───── BACKGROUND FX (Phase 12 — neon-trading polish) ──────────── */
    // Phase 21 (F): each halo is now 3 stacked sprites (outer+mid+inner)
    // with decreasing alpha and increasing size to fake a radial falloff.
    // Eye blends the layers into a smooth gradient instead of seeing the
    // single rectangle's hard edge.
    BackgroundFX: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // VIOLET (top-left) — 3-layered halo
            glowTopLeft_Outer:  { x: -220, y: 480,  w: 1300, h: 1300, type: 'sprite',
                notes: 'violet outer veil; alpha 18 — softest fade-to-black ring' },
            glowTopLeft_Mid:    { x: -220, y: 480,  w: 1050, h: 1050, type: 'sprite',
                notes: 'violet mid; alpha 35' },
            glowTopLeft_Inner:  { x: -220, y: 480,  w:  800, h:  800, type: 'sprite',
                notes: 'violet core; alpha 60 — original Phase 12 sprite' },
            // TEAL (bot-right)
            glowBotRight_Outer: { x:  240, y: -520, w: 1250, h: 1250, type: 'sprite',
                notes: 'teal outer veil; alpha 15' },
            glowBotRight_Mid:   { x:  240, y: -520, w: 1000, h: 1000, type: 'sprite',
                notes: 'teal mid; alpha 28' },
            glowBotRight_Inner: { x:  240, y: -520, w:  760, h:  760, type: 'sprite',
                notes: 'teal core; alpha 50 — original Phase 12 sprite' },
            // AMBER (center)
            glowCenter_Outer:   { x:    0, y:    0, w:  900, h:  900, type: 'sprite',
                notes: 'amber outer veil; alpha 8 — barely-there warmth' },
            glowCenter_Mid:     { x:    0, y:    0, w:  750, h:  750, type: 'sprite',
                notes: 'amber mid; alpha 14' },
            glowCenter_Inner:   { x:    0, y:    0, w:  600, h:  600, type: 'sprite',
                notes: 'amber core; alpha 22 — original Phase 12 sprite' },
            starfield:          { x: 0,    y: 0,    w: 720, h: 1280, type: 'group' },
        },
        templates: {
            // 64 deterministic-random stars across 3 alpha tiers.
            // Positions baked at scene-gen time via seeded LCG (seed=42).
            // Far tier = faintest dust; near tier = brightest sparks.
            star: {
                count: 64,
                tiers: [
                    { count: 24, size: 2, alphaMin: 40,  alphaMax: 80  },
                    { count: 24, size: 3, alphaMin: 100, alphaMax: 150 },
                    { count: 16, size: 4, alphaMin: 160, alphaMax: 200 },
                ],
                xRange: [-340, 340],
                yRange: [-560, 600],
                seed: 42,
            },
        },
        // Phase 21 (F): the 9 halo sprites all overlap by design (3 layers
        // per halo + 3 halos cross-overlapping at edges = many pairs). The
        // verifier handles this via the BackgroundGlow_* skip rule (added
        // alongside BtnGlow_* / Ripple_* in scripts/verify-layout.py).
        allowedOverlaps: [],
    },

    /* ───── LANDING ─────────────────────────────────────────────────── */
    // v2 — premium onboarding. Compressed hero (title→subtitle→mascot→tagline
    // →support reads as one block). Action stack lives INSIDE a CTA card
    // backdrop with a violet edge accent (signals "sign-in zone"). Connect
    // gets a glossy gradient + right chevron; trust line sits directly under
    // it; Guest has a dim halo so it visibly defers to Connect. Status pill
    // unchanged at bottom.
    Landing: {
        canvas: { w: 720, h: 1280 },
        bg: { color: '#000000' },
        elements: {
            // Hero band (compressed — was y=500/432/220/45/-10 in v1)
            title:               { x: 0,   y: landing.TITLE_Y,    w: 680, h: 78,  type: 'label',      notes: '2026-04-29 dominance pass: 64pt → 68pt; bbox h 72→78. Token Duel — display, gold + letter-spacing 3 + halo behind' },
            // 2026-04-27 UX upgrade — gold halo behind title for shimmer.
            titleGlow:           { x: 0,   y: landing.TITLE_Y,    w: 720, h: 140, type: 'sprite',     notes: 'gold radial halo behind TitleLabel; alpha-pulsed by LandingFX.addGlowPulse' },
            subtitle:            { x: 0,   y: landing.SUBTITLE_Y, w: 680, h: 26,  type: 'label',      notes: '2026-04-29 demo-ready: 22→18pt subtle (Palette.text.mid). Reads as supporting microcopy under the gold title.' },
            mascot:              { x: 0,   y: landing.MASCOT_Y,   w: 280, h: 280, type: 'mascot',     notes: '2026-04-29 demo-ready: w/h 320→280. Mascot supports the title; no longer dominates the page.' },
            // 2026-04-27 UX upgrade — soft drop-shadow ellipse below mascot.
            mascotShadow:        { x: 0,   y: landing.MASCOT_Y - 150, w: 240, h: 28, type: 'sprite', notes: '2026-04-29 demo-ready: w 280→240, scene alpha 130→0. Sprite painted invisible — installSoftEllipse renders a soft Graphics ellipse on top via enqueuePostDraw. Reads as a pedestal, not a black bar.' },
            // 2026-04-27 UX upgrade — violet radial bloom behind mascot.
            mascotGlow:          { x: 0,   y: landing.MASCOT_Y,   w: 400, h: 400, type: 'sprite',     notes: '2026-04-29 demo-ready: w/h 520→400 (track smaller mascot). Sprite alpha set to 0 in scene — installSoftGlow draws the soft violet radial via Graphics; no hard square ever paints.' },
            // CTA card backdrop — semi-translucent dark surface w/ violet edge.
            ctaCardBg:           { x: 0,   y: landing.CTA_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 400, type: 'group',      notes: '2026-04-29 dominance pass: h 440→400 to trim the dead backdrop below Reconnect. visual grouping behind action stack; bg.card #1E2438 alpha 130 + violet top edge accent' },
            // Action stack (top → bottom: Connect → Trust line → Play as Guest → Reconnect).
            connectBtn:          { x: 0,   y: landing.CONNECT_Y,   w: UNIFORM_LAYOUT.CONTENT_W, h: 108, type: 'btnPrimary', notes: '2026-04-29 demo-ready: h 126→108 (substantial, not bloated). PRIMARY — gradient + glow + chevron; "Stake SOL · Win SOL". Title fontSize override 28pt + paddingX override 28 passed from generate-scenes.js call site (does not touch ButtonTierSpec.primary which other primary CTAs depend on).' },
            connectChevron:      { x: 296, y: landing.CONNECT_Y,   w: 24,  h: 28,  type: 'label',      notes: '2026-04-29 demo-ready: x 290→296 (track new paddingX), › 42→36pt (proportional to smaller button), bbox 28/32 → 24/28.' },
            trustLine:           { x: 0,   y: landing.TRUST_Y,     w: 640, h: 20,  type: 'label',      notes: '2026-04-29 demo-ready: copy restored to full "🔒 Secure · Non-custodial · You control your wallet" (was shortened); font stays 11pt microcopy. Green-tinted for reassurance.' },
            // 2026-04-28 hackathon UX — "live system" cue sits between trust line and Guest button.
            liveSignalLabel:     { x: 0,    y: landing.LIVE_SIGNAL_Y,     w: 640, h: 20, type: 'label',     notes: '"Live now · Join in seconds" — energy cue under Connect; teal-tinted' },
            liveSignalDot:       { x: -118, y: landing.LIVE_SIGNAL_Y + 1, w: 8,   h: 8,  type: 'sprite',    notes: '2026-04-28 polish — leading green dot pulsed by LandingFX.addGlowPulse' },
            playAsGuestBtn:      { x: 0,   y: landing.GUEST_Y,     w: UNIFORM_LAYOUT.CONTENT_W, h: 80,  type: 'btnSuccess', notes: '2026-04-29 demo-ready: h 88→80; same width as Connect (UNIFORM rule), shorter so Connect remains visibly dominant. Body opacity dropped to 180 + halo alpha 40 in AppUI.' },
            reconnBtn:           { x: 0,   y: landing.RECONNECT_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 64,  type: 'btnGhost',   notes: '2026-04-29 demo-ready: w 560→UNIFORM (consistent button widths), runtime opacity 110→180, +1 px violet outline alpha 60 (mkBtnHeroLayered ghost outline opt) so dark-on-dark ghost reads as deliberate, not glitchy. Title fontSize override 18pt to match tertiary feel.' },
            connectionStatusPill:{ x: 0,   y: landing.STATUS_PILL_Y, w: 180, h: 40, type: 'chip',      notes: '2026-04-29 demo-ready: w 200→180; faint pill background (Palette.bg.card alpha 90) so the chip reads as part of the layout, not a floating label. Lifted to -540 to clear the home indicator.' },
        },
        allowedOverlaps: [
            // Card backdrop intentionally sits behind every action element
            ['CTACardBg', 'ConnectButton'],
            ['CTACardBg', 'ConnectChevron'],
            ['CTACardBg', 'TrustLineLabel'],
            ['CTACardBg', 'LiveSignalLabel'],
            ['CTACardBg', 'LiveSignalDot'],
            ['LiveSignalLabel', 'LiveSignalDot'],
            ['CTACardBg', 'ReconnectButton'],
            ['CTACardBg', 'PlayAsGuestButton'],
            ['CTACardBg', 'BtnGlow_ConnectButton'],
            ['CTACardBg', 'BtnGlow_PlayAsGuestButton'],
            ['CTACardBg', 'CardEdgeAccent'],
            // Chevron sits inside ConnectButton's bbox by design (right-aligned)
            ['ConnectButton', 'ConnectChevron'],
            // 2026-04-27 UX upgrade — halos + shadow are intentionally layered
            // BEHIND or AROUND their anchor elements.
            ['TitleGlow', 'TitleLabel'],
            ['TitleGlow', 'SubtitleLabel'],
            ['MascotGlow', 'LandingMascotContainer'],
            ['MascotGlow', 'MascotShadow'],
            ['MascotGlow', 'SubtitleLabel'],
            ['MascotShadow', 'LandingMascotContainer'],
        ],
    },

    /* ───── HOME ────────────────────────────────────────────────────── */
    // Post-connect hub. Top-bar icon row at y=700 (Bell ↔ Pubkey ↔ Settings;
    // symmetric flanking). Chrome strips at y=600/660 (alternates). Primary
    // CTA TRIO (Start / Find / Bot Match) stacked y=499/383/267 with subtitle
    // labels below each. Mascot (idle Seedance) at y=140 as visual centerpiece.
    // Account-management (Disconnect, Delete) y=-50/-160. Status banner y=-300.
    //
    // Sign* + Capabilities MWA-test buttons are intentionally REMOVED — the
    // home is now intent-first (Start vs Find vs Bot) instead of hosting a
    // grab-bag of MWA debug surfaces.
    // 2026-04-26 lobby restructure: HUD header → MatchStatusCard →
    // ChallengeSeasonCard → "CHOOSE MATCH TYPE" → 3 action buttons (subtitles
    // + chevrons reparented INSIDE button rect) → TrainingCard (mascot +
    // free-bot copy + status footer). Disconnect/Delete/SignOut REMOVED from
    // Home; SettingsPanel is the single account-control surface.
    Home: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // 2026-04-26 V2 — production lobby polish: scrim behind content, wallet
            // pill upgraded to glowing centered anchor, XP card grown to a real
            // progression module, RecentMatch card split into 2 rows, secondary
            // stats card slimmed (DAY/CHALLENGES/POOL/RAKE only), CTA trio tiered
            // by size + glow alpha, training card grown with mascot glow halo.
            // ── BACKGROUND SCRIM (full panel, behind everything) ──
            homeContentScrim:    { x: 0,    y: 0,    w: 720, h: 1280, type: 'sprite', notes: 'dim overlay behind content column — reduces starfield contrast' },
            // ── HUD HEADER (y=640, V3) — bell · WalletPill · 3 chrome icons ──
            // V3 — icon w/h 64→44 (≈-30% header band height per UX audit).
            notificationBell:    { x: -296, y: home.HEADER_Y,       w: 44,  h: 44,  type: 'btnGhost', notes: 'V3 — w/h 64→44 (-30% header tighten)' },
            notificationBadge:   { x: -278, y: home.HEADER_BADGE_Y, w: 22,  h: 22,  type: 'badge',    notes: 'unread count badge ON bell (bell.x + 18 keeps top-right offset)' },
            walletPill:          { x: 0,    y: home.HEADER_Y,       w: 360, h: 60,  type: 'chip',     notes: 'centered glowing pill; pubkey + wallet name + status dot' },
            walletPillGlow:      { x: 0,    y: home.HEADER_Y,       w: 380, h: 80,  type: 'sprite',   notes: 'soft violet glow halo SIBLING of WalletPill, renders BEHIND it' },
            walletPillSecureDot: { x: -150, y: 0,    w: 12,  h: 12,  type: 'badge',    notes: 'green status dot at left edge of pill (relative to pill)' },
            pubkeyLabel:         { x: -50,  y: 0,    w: 220, h: 26,  type: 'label',    notes: 'vertically centered; w 280→220 + x -30→-50 to leave room for SeedVault on right' },
            walletNameLabel:     { x: 120,  y: 0,    w: 100, h: 16,  type: 'label',    notes: 'right side of pill (vertically centered) so "Seed Vault" is visible' },
            // Phase N4: openPortfolioBtn removed (Portfolio collapsed into Leaderboard hub).
            // 5-icon bar reordered to [bell | trophy | wallet | cog | disconnect] with wallet centered.
            openLeaderboardBtn:  { x: -224, y: home.HEADER_Y, w: 44,  h: 44,  type: 'btnGhost', notes: 'V3 — w/h 64→44' },
            openSettingsBtn:     { x:  224, y: home.HEADER_Y, w: 44,  h: 44,  type: 'btnGhost', notes: 'V3 — w/h 64→44' },
            // V3 NEW — subtle violet underline beneath header band.
            homeHeaderUnderline: { x: 0,    y: home.HEADER_UNDERLINE_Y, w: 640, h: 1, type: 'sprite', notes: 'V3 — 1×640 violetDim underline at low alpha; visual divider below header' },
            // ── XP MODULE — real progression bar, animated ──
            homeLevelChip:       { x: 0,    y: home.XP_CHIP_Y, w: 680, h: 72,  type: 'chip',     notes: 'V4 — h 80→72; Lv N (gold) + X/Y XP (right) + 640x14 rounded gold progress bar' },
            homeXpProgressLabel: { x: 310,  y: 14,   w: 280, h: 18,  type: 'label',    notes: '"X / Y XP" anchor-right (relative to card)' },
            homeXpBarTrack:      { x: 0,    y: -14,  w: 640, h: 14,  type: 'sprite',   notes: 'rounded track 640x14 (relative to card)' },
            homeXpBarFill:       { x: -320, y: 0,    w: 0,   h: 14,  type: 'sprite',   notes: 'gold fill, left-anchored, width tweens on load (relative to track)' },
            // ── LAST RESULT CARD — V5 (2026-04-28 home UX polish) ──
            // V5 — Repurposed from network-feed "RECENT MATCH" to user-
            // specific "LAST MATCH" anchor: outcome (WON/LOST) + delta SOL
            // + compact meta line ("1v1 · 0.10 stake · 12m ago"). Sourced
            // from Stats.loadLastMatch() — persists across sessions, works
            // for guests + connected wallets. h 96→108 for more presence;
            // outcome/delta colored teal (win) or rose (loss); halo glow
            // sibling pulses subtly when a result is present.
            homeMatchTicker:     { x: 0,    y: home.RECENT_CARD_Y, w: 680, h: 108, type: 'chip',     notes: 'V5 — Last Result anchor; tap → Portfolio history' },
            homeLastResultGlow:  { x: 0,    y: home.RECENT_CARD_Y, w: 704, h: 132, type: 'sprite',   notes: 'V5 — outcome-tinted halo sibling, alpha 0 by default; pulses on win/loss' },
            homeLastResultLabel: { x: -298, y: 38,   w: 200, h: 16,  type: 'label',    notes: 'V5 — "LAST MATCH" 11pt muted (replaces RECENT MATCH header)' },
            homeLastResultOutcome: { x: -180, y: 6,  w: 280, h: 38,  type: 'label',    notes: 'V5 — "WON" / "LOST" / "—" 22pt bold; color set at runtime' },
            homeLastResultDelta: { x: 200,  y: 6,    w: 240, h: 38,  type: 'label',    notes: 'V5 — "+0.10 SOL" / "-0.05 SOL" / "—" 22pt bold; matches outcome color' },
            homeLastResultMeta:  { x: 0,    y: -34,  w: 620, h: 18,  type: 'label',    notes: 'V5 — "1v1 · 0.10 stake · 12m ago" 12pt muted' },
            homeRecentCardElevation: { x: 0, y: -4,  w: 688, h: 116, type: 'sprite',   notes: 'V5 — drop-shadow sprite tracks card h (104→116)' },
            // Tournament alternate — same slot as ticker, mutually exclusive.
            homeTournamentBadge: { x: 0,    y: home.RECENT_CARD_Y, w: 680, h: 108, type: 'chip',     notes: 'tournament alternate; takes ticker slot when active (h matches V5 Last Result card)' },
            // Off-flow placeholders — superseded by SettingsPanel + DailyChallengePanel.
            homeRakeChip:        { x: 0,    y: home.LEGACY_RAKE_Y,    w: 700, h: 22,  type: 'chip',      notes: 'legacy node; off-flow until refactor cleanup' },
            disconnectBtn:       { x:  296, y: home.HEADER_Y,         w: 44,  h: 44,  type: 'btnGhost',  notes: 'V3 — w/h 64→44' },
            deleteBtn:           { x: 180,  y: home.LEGACY_DELETE_Y,  w: 280, h: 56,  type: 'btnGhost',  notes: 'legacy node; account control moved to SettingsPanel' },
            signOutGuestBtn:     { x: 0,    y: home.LEGACY_SIGNOUT_Y, w: 280, h: 56,  type: 'btnGhost',  notes: 'legacy node; account control moved to SettingsPanel' },
            // ── PRIMARY CTA TRIO (V4 — Find=hero > Start=secondary > MIP=neutral > Bot=training) ──
            // V4 — Find Match becomes the hero (instant play). Start Match
            // demoted to secondary (purple, h=96). MIP neutralized to charcoal
            // (btnGhost, h=80). Bot Match grows full-width (h=88, w=680) and
            // absorbs Training Mode copy on a second subtitle line.
            findMatchBtn:        { x: 0,    y: home.FIND_CTA_Y,   w: 680, h: 160, type: 'btnSuccess', notes: 'V7 HERO teal — h 136→160 (1.75x scale of pre-V6 baseline); idle pulse + ripple + shimmer + strong-press' },
            findMatchSubtitle:   { x: 0,    y: -36,               w: 620, h: 20,  type: 'label',      notes: 'V6 — y -32→-36, h 18→20 for 16pt copy in 136h hero' },
            findMatchChevron:    { x: 310,  y: 0,                 w: 24,  h: 24,  type: 'label',      notes: '"›" glyph child of button, anchored right' },
            findMatchCountBadge: { x: 244,  y: home.FIND_BADGE_Y, w: 96,  h: 36,  type: 'badge',      notes: 'V6 — bumped 88×32 → 96×36, label 16→18 bold for hero weight' },
            findMatchActivityDot:{ x: -296, y: home.FIND_DOT_Y,   w: 10,  h: 10,  type: 'badge',      notes: 'V4 NEW — pulsing teal dot, upper-left of hero, visible when lobbies > 0' },
            startMatchBtn:       { x: 0,    y: home.START_CTA_Y,  w: 680, h: 122, type: 'btnPrimary', notes: 'V7 secondary purple — h 104→122 (1.75x scale)' },
            startMatchSubtitle:  { x: 0,    y: -26,               w: 620, h: 20,  type: 'label',      notes: 'V6 — y -22→-26, h 18→20 for 16pt copy' },
            startMatchChevron:   { x: 310,  y: 0,                 w: 24,  h: 24,  type: 'label',      notes: 'CHILD of StartMatchButton' },
            matchesInProgressBtn:        { x: 0,    y: home.MIP_CTA_Y,   w: 680, h: 122, type: 'btnGhost',   notes: 'V7 NEUTRAL charcoal — h 104→122 (1.75x scale); secondaries unify at 122' },
            matchesInProgressSubtitle:   { x: 0,    y: -28,               w: 620, h: 16,  type: 'label',      notes: 'V6 — y -26→-28, h 14→16 for 12pt copy in taller 104h ghost button' },
            matchesInProgressChevron:    { x: 310,  y: 0,                 w: 24,  h: 24,  type: 'label',      notes: 'CHILD of MatchesInProgressButton' },
            matchesInProgressCountBadge: { x: 244,  y: home.MIP_BADGE_Y,  w: 88,  h: 32,  type: 'badge',      notes: 'V6 — bumped 76×28 → 88×32, label 14→16 bold (catches up to old Find size)' },
            matchesInProgressActivityDot:{ x: -296, y: home.MIP_DOT_Y,    w: 10,  h: 10,  type: 'badge',      notes: 'V4 NEW — pulsing teal dot, left edge, visible when active games > 0' },
            botMatchBtn:         { x: 0,    y: home.BOT_CTA_Y,    w: 680, h: 122, type: 'btnWarn',    notes: 'V7 — h 104→122 (1.75x scale) to match Start/MIP tier; full-width gold, two-line subtitle' },
            botMatchSubtitle:    { x: 0,    y: -24,  w: 620, h: 16,  type: 'label',      notes: 'V6 — y -22→-24, h 14→16 for 12pt copy line 1 ("Train before real matches")' },
            botMatchSubtitleLine2: { x: 0,  y: -42,  w: 620, h: 14,  type: 'label',      notes: 'V6 — y -38→-42, h 12→14 for line 2 ("N free matches left")' },
            botMatchChevron:     { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label',      notes: 'CHILD of BotMatchButton (x 270→310 for full-width)' },
            // ── TRAINING HERO CARD — V4 REMOVED ──
            // V4 — HomeTrainingCard + mascot + glow + 4 labels deleted.
            // Mascot definition kept off-flow so AppUI MascotController lookups
            // don't 404 at runtime; mascot only renders inside PostMatch panel
            // now. Training copy lives on the Bot Match card.
            mascot:              { x: 0,    y: home.LEGACY_RAKE_Y, w: 160, h: 180, type: 'mascot',   notes: 'V4 — pinned off-flow; only PostMatchPanel renders the mascot now' },
            homeStatus:          { x: 0,    y: -220, w: 460, h: 16,  type: 'label',     notes: 'V7 — y -148→-220 to clear new Bot bottom y=-192 + 20px breathing room' },
        },
        allowedOverlaps: [
            // V2 — content scrim sits behind everything; intentionally overlaps all
            ['HomeContentScrim',        'NotificationBellButton'],
            ['HomeContentScrim',        'NotificationBellBadge'],
            ['HomeContentScrim',        'WalletPill'],
            ['HomeContentScrim',        'WalletPillGlow'],
            ['HomeContentScrim',        'OpenPortfolioButton'],
            ['HomeContentScrim',        'OpenLeaderboardButton'],
            ['HomeContentScrim',        'OpenSettingsButton'],
            ['HomeContentScrim',        'HomeLevelChip'],
            ['HomeContentScrim',        'HomeMatchTicker'],
            ['HomeContentScrim',        'HomeTournamentBadge'],
            ['HomeContentScrim',        'HomeHeaderUnderline'],            // V3 NEW
            ['HomeContentScrim',        'StartMatchButton'],
            ['HomeContentScrim',        'BtnGlow_StartMatchButton'],
            ['HomeContentScrim',        'FindMatchButton'],
            ['HomeContentScrim',        'BtnGlow_FindMatchButton'],
            ['HomeContentScrim',        'FindMatchButtonCountBadge'],
            ['HomeContentScrim',        'FindMatchActivityDot'],            // V4 NEW
            ['HomeContentScrim',        'MatchesInProgressButton'],
            ['HomeContentScrim',        'BtnGlow_MatchesInProgressButton'],
            ['HomeContentScrim',        'MatchesInProgressCountBadge'],
            ['HomeContentScrim',        'MatchesInProgressActivityDot'],    // V4 NEW
            ['HomeContentScrim',        'BotMatchButton'],
            ['HomeContentScrim',        'BtnGlow_BotMatchButton'],
            ['HomeContentScrim',        'HomeStatusLabel'],                 // V4 — reparented to panel root
            ['NotificationBellButton',  'NotificationBellBadge'],   // badge ON bell
            ['HomeMatchTicker',         'HomeTournamentBadge'],     // alternates
            ['FindMatchButton',         'FindMatchButtonCountBadge'],// badge sits ON the FindMatch button intentionally
            ['FindMatchButton',         'FindMatchActivityDot'],     // V4 NEW — dot sits ON FindMatch
            ['MatchesInProgressButton', 'MatchesInProgressCountBadge'], // badge sits ON the MIP button intentionally
            ['MatchesInProgressButton', 'MatchesInProgressActivityDot'], // V4 NEW — dot sits ON MIP
            // V2 — wallet pill glow halo sits BEHIND the pill; intentional overlap.
            ['WalletPill',              'WalletPillGlow'],
            // Subtitle + chevron now live INSIDE each action button.
            ['StartMatchButton',        'StartMatchSubtitle'],
            ['StartMatchButton',        'StartMatchChevron'],
            ['FindMatchButton',         'FindMatchSubtitle'],
            ['FindMatchButton',         'FindMatchChevron'],
            ['MatchesInProgressButton', 'MatchesInProgressSubtitle'],
            ['MatchesInProgressButton', 'MatchesInProgressChevron'],
            ['BotMatchButton',          'BotMatchSubtitle'],
            ['BotMatchButton',          'BotMatchSubtitleLine2'],   // V4 NEW — second line carries free-match counter
            ['BotMatchButton',          'BotMatchChevron'],
            // WalletPill bbox houses pubkey + wallet name + secure dot.
            ['WalletPill',              'PubkeyLabel'],
            ['WalletPill',              'WalletNameLabel'],
            ['WalletPill',              'WalletPillSecureDot'],
            // V4 — HomeTrainingCard + 6 children deleted; mascot off-flow only.
            // Level chip houses progress bar + labels.
            ['HomeLevelChip',           'HomeLevelChipLabel'],
            ['HomeLevelChip',           'HomeXpProgressLabel'],
            ['HomeLevelChip',           'HomeXpBarTrack'],
            ['HomeXpBarTrack',          'HomeXpBarFill'],
            // V5 — Last Result card has elevation shadow + halo glow.
            ['HomeMatchTicker',         'HomeRecentCardElevation'],
            ['HomeRecentCardElevation', 'HomeMatchTicker'],
            ['HomeMatchTicker',         'HomeLastResultGlow'],
            ['HomeLastResultGlow',      'HomeMatchTicker'],
            ['HomeMatchTicker',         'HomeLastResultLabel'],
            ['HomeMatchTicker',         'HomeLastResultOutcome'],
            ['HomeMatchTicker',         'HomeLastResultDelta'],
            ['HomeMatchTicker',         'HomeLastResultMeta'],
        ],
    },

    /* ───── MODE PICKER OVERLAY ─────────────────────────────────────── */
    // Game-setup overlay shown when user taps Run Squad / Quick Play.
    // 2026-04-30 immersive redesign — full-screen pre-match staging arena.
    // Five vertical zones: Header (top 12%), Mode (top 25%, dominant 2×2 cards),
    // Settings (mid 25%, Duration + Track + Difficulty stack), Summary (16%
    // gold-edged commitment card), CTA (14%, cinematic Enter Match). Background
    // upgrade: opaque dark base + top half-canvas violet gradient sprite +
    // centered radial soft-glow + corner vignette (all sprites; runtime glow
    // routed through LandingFX.installSoftGlow → safeAddGraphics queue).
    // Runtime: AppUI._relayoutModePickerToViewport resizes the panel UTransform,
    // scrim, gradient, and glow to view.getVisibleSize() so the bg never leaves
    // a purple/green bleed band on tall (19.5:9+) viewports.
    // 2026-04-30 arena redesign — viewport-anchored 5-zone layout. Top bar
    // (Back + Close) and footer (CTA + microcopy) are repositioned at runtime
    // by AppUI._relayoutModePickerToViewport() against vh, so the screen
    // hugs the safe-area top + bottom on tall (19.5:9+) devices instead of
    // floating in a centered 1280-tall island. Design Y values below are
    // the editor-preview fallback (1280 canvas).
    ModePickerOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // ── TOP BAR (anchored to viewport top at runtime) ─────────────
            backBtn:           { x: -290, y: 580,  w: 92,  h: 44, type: 'btnGhost',
                notes: '"← Back" left-aligned chip — closes overlay (v1).' },
            cancelBtn:         { x:  314, y: 580,  w: 44,  h: 44, type: 'btnGhost',
                notes: '"✕" right-aligned, same horizontal line as back btn.' },

            // ── HEADER (anchored to viewport top at runtime) ──────────────
            title:             { x: 0,    y: 500,  w: 600, h: 44, type: 'label',
                notes: '"Configure Your Duel" 30pt gold bold tracked.' },
            titleDivider:      { x: 0,    y: 472,  w: 220, h: 3,  type: 'sprite',
                notes: 'Thicker gold divider under title for stronger header presence.' },
            subtitle:          { x: 0,    y: 440,  w: 600, h: 22, type: 'label',
                notes: '"Choose your mode, stake, and match rules" — 14pt mid.' },

            // ── MODE zone (middle) ────────────────────────────────────────
            sectionMode:       { x: 0,    y: 400,  w: 580, h: 18, type: 'label' },

            // ── SETTINGS zone (middle) — modifier band; tighter rhythm ────
            sectionDuration:   { x: 0,    y: 80,   w: 580, h: 18, type: 'label' },
            sectionTrack:      { x: 0,    y: -24,  w: 580, h: 18, type: 'label',
                notes: 'Hidden in Bot/Guest flow; layout collapses up by 80px (SHIFT).' },
            paperToggle:       { x: -105, y: -72,  w: 200, h: 52, type: 'btnPrimary' },
            realToggle:        { x:  105, y: -72,  w: 200, h: 52, type: 'btnGhost' },
            sectionDifficulty: { x: 0,    y: -116, w: 580, h: 18, type: 'label' },

            // ── SUMMARY zone (anchored to viewport bottom at runtime) ─────
            // Hero gold-edged card; focus anchor before the CTA.
            // 2026-05-01 staging polish: 620×180 → 640×196 + breathing scale.
            summaryCard:       { x: 0,    y: -322, w: 640, h: 196, type: 'group',
                notes: 'Hero gold-edged card; mode/modifiers/stake stack with breathing scale.' },
            summaryConnector:  { x: 0,    y: -432, w: 16,  h: 14,  type: 'sprite',
                notes: 'Tiny gold chip linking summary → CTA.' },

            // ── CTA zone (anchored to viewport bottom at runtime) ─────────
            // 2026-05-01 launch-moment treatment: taller hero (120 → 132),
            // edge-to-edge (632 → 640), copy "START DUEL", vibrant violet-blue body.
            startBtn:          { x: 0,    y: -516, w: 640, h: 132, type: 'btnPrimary',
                notes: '"START DUEL" cinematic hero CTA — taller, vibrant violet-blue, halo + ripple.' },
            statusLbl:         { x: 0,    y: -612, w: 620, h: 20,  type: 'label',
                notes: 'Footer microcopy: "1v1 Duel · 0.05 SOL · 30s · Paper · medium".' },
        },
        templates: {
            // 2×2 dominant mode tile grid. Cards 280×140 (was 320×96 flat
            // buttons); rows tightened against new sectionMode position.
            // Names: Mode_<key>. AppUI handlers (_onPickerModeClick) key off these.
            modeBtn: {
                count: 4, w: 280, h: 140,
                keys: ['oneVone', 'trio', 'fourPlayer', 'eightPlayer'],
                labels: ['1 vs 1', 'Trio · 1v1v1', '4 Player FFA', 'Battle Royale'],
                positions: [
                    { x: -152, y: 310 },
                    { x:  152, y: 310 },
                    { x: -152, y: 160 },
                    { x:  152, y: 160 },
                ],
            },
            // 6 duration chips — 92×52, pill radius (h/2). Selected fills
            // teal; unselected pillTray. y=28 pairs tightly with sectionDuration y=80.
            windowBtn: {
                count: 6, w: 92, h: 52, y: 28,
                keys: ['30s', '1m', '5m', '1h', '24h', '7d'],
                labels: ['30s', '1m', '5m', '1h', '24h', '7d'],
                baseX: -275, gapX: 110,
            },
            // 3 difficulty chips — 184×56, edge-to-edge. y=-172 pairs with
            // sectionDifficulty y=-116; modifier band reads as one tight group.
            difficultyBtn: {
                count: 3, w: 184, h: 56, y: -172,
                keys: ['easy', 'medium', 'hard'],
                labels: ['Easy', 'Medium', 'Hard'],
                names: ['PickerDifficultyEasy', 'PickerDifficultyMedium', 'PickerDifficultyHard'],
                baseX: -200, gapX: 200,
            },
        },
        allowedOverlaps: [
            ['PickerSummaryCard', 'PickerSummaryModeLabel'],
            ['PickerSummaryCard', 'PickerSummaryModifiersLabel'],
            ['PickerSummaryCard', 'PickerSummaryStakeLabel'],
            ['PickerSummaryCard', 'CardEdgeAccent'],
            ['PickerSummaryCard', 'PickerSummaryGradient'],
            // Title (600w centered) and top-bar Back/Cancel chips share the
            // upper band but render in disjoint horizontal regions.
            ['ModePickerTitleLabel', 'PickerCancelButton'],
            ['ModePickerTitleLabel', 'PickerBackButton'],
            // Hero glow halo + ripple are intentionally siblings of the CTA.
            ['PickerStartButton', 'BtnGlow_PickerStartButton'],
            ['PickerStartButton', 'Ripple_PickerStartButton'],
        ],
    },

    /* ───── PICKER SUMMARY CARD (nested) ────────────────────────────── */
    // 2026-04-30 immersive redesign — PickerSummaryCard has 5 children so the
    // verifier walks it as a nested panel. The inner gradient sprite spans
    // the top half of the card by design and necessarily overlaps the mode +
    // modifiers labels stacked on top (renders behind via children-order).
    PickerSummaryCard: {
        allowedOverlaps: [
            ['PickerSummaryGradient', 'PickerSummaryModeLabel'],
            ['PickerSummaryGradient', 'PickerSummaryModifiersLabel'],
        ],
    },

    /* ───── RACE ────────────────────────────────────────────────────── */
    // Live race panel — fullscreen overlay during active match. 720×1800
    // (oversized for tall device viewports).
    //
    // 1v1 DUEL LAYOUT (2026-04-26 battle-UI polish; 2026-04-28 vertical-balance pass):
    //   Top row y=720: [Lv chip] (Timer) [hero +%] — single horizontal band.
    //   Player tokens y=540 (3 horizontal cards w/ contribution bars).
    //   Lead-state line y=410 ("YOU LEAD\n+0.48 pp"; replaces tiny gap text).
    //   Duel bar y=300 — tug-of-war bar that moves toward winner.
    //   Opp hero % y=100, opp identity y=-20 ("BOT · Lv 3" header).
    //   Opp tokens y=-130 (mirror; pushed down for bottom-safe-area anchor).
    //   Forfeit y=-260 (small/recessed), mascot y=-460 (dimmed @ 55%).
    //
    // 4p/8p MULTI-MODE FALLBACK: AppUI hides the duel surfaces and re-shows
    // legacy raceCard 5-stack + opponentStrip when requiredPlayers > 2.
    RacePanel: {
        canvas: { w: 720, h: 1800 },
        elements: {
            // 2026-04-26 battle-UI polish — top row is one horizontal band:
            //   [Lv pill]  ( Timer )  [+0.00%]
            // Player identity card (wallet truncation) is dropped — wallet
            // shows in post-match summary instead. Lv pill stays small/low-
            // emphasis on the left; hero delta moves to the right side.
            racePlayerLevelChip: { x: -260, y: race.TOP_HEADER_Y, w: 120, h: 40, type: 'chip',
                notes: 'small Lv pill, top-left of duel battle UI' },

            // Timer + countdown (centered top row).
            // 2026-05-01 — scaled +15% (radius 60→69, box 132→152). Top edge of
            // the circle stays pinned to its prior world Y, so center drops 9 px
            // (race.TOP_HEADER_Y - 9). Chip + heroDelta still align center-to-
            // center to TOP_HEADER_Y; the timer center is intentionally 9 px below.
            timerRing:        { x: 0,    y: race.TOP_HEADER_Y - 9, w: 152, h: 152, type: 'graphics' },
            timerPulse:       { x: 0,    y: 0,    w: 115, h: 115, type: 'graphics', notes: 'inside ring; coords relative to ring' },
            countdownLabel:   { x: 0,    y: race.TOP_HEADER_Y - 9, w: 115, h: 37,  type: 'label' },

            // Hero portfolio delta — right-aligned in top row, bold/primary.
            heroDelta:        { x: 240,  y: race.TOP_HEADER_Y, w: 220, h: 80,  type: 'label' },

            // Player token row container — 3 horizontal cards (tightened spacing)
            // 2026-05-01 — h 110 → 132 to match the restyled duelTokenCard
            // (logo + sym row, big delta, bar) without clipping the bar.
            playerTokenRow:   { x: 0,    y: race.PLAYER_TOKEN_ROW_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 132, type: 'group' },

            // Lead-state copy ("YOU LEAD / YOU TRAIL / DEAD HEAT") — promoted
            // from a tiny subtitle to a 2-line emphasis line above the bar.
            opponentSubtitle: { x: 0,    y: race.LEAD_STATE_Y, w: 620, h: 64,  type: 'label',
                notes: 'lead-state line above duel bar (replaces "you +X.XX pp ahead")' },

            // Duel bar — center tug-of-war (tightened up)
            duelBarContainer: { x: 0,    y: race.DUEL_BAR_Y, w: 680, h: 80,  type: 'group' },
            duelBarTrack:     { x: 0,    y: 0,    w: 640, h: 8,   type: 'graphics', notes: 'relative to container' },
            duelBarFill:      { x: 0,    y: 0,    w: 640, h: 12,  type: 'graphics', notes: 'relative to container' },
            duelBarGlow:      { x: 0,    y: 0,    w: 640, h: 40,  type: 'graphics', notes: 'leading-tip pulse + trail' },
            duelBarCenterTick:{ x: 0,    y: 0,    w: 2,   h: 32,  type: 'graphics' },
            duelBarPlayerTag: { x: -300, y: -22,  w: 80,  h: 16,  type: 'label' },
            duelBarOppTag:    { x: 300,  y: -22,  w: 80,  h: 16,  type: 'label' },
            duelBarLeadingPp: { x: 0,    y: 24,   w: 160, h: 22,  type: 'label', notes: 'floats above leading tip' },

            // Round Advantage card (2026-04-29) — wraps the big opponent-side
            // hero label. Halo sits behind border; both centered on the big
            // number's y. The big number now renders the lead in pp (player −
            // opponent), and the card border + halo color-flip green/red on
            // lead reversal.
            advantageHalo:    { x: 0, y: race.OPP_HERO_DELTA_Y, w: race.ADV_HALO_W, h: race.ADV_HALO_H, type: 'graphics',
                notes: 'Round Advantage soft outer halo (Graphics, no Sprite); color follows lead state.' },
            advantageBorder:  { x: 0, y: race.OPP_HERO_DELTA_Y, w: race.ADV_CARD_W, h: race.ADV_CARD_H, type: 'graphics',
                notes: 'Round Advantage rounded-rect border, 2px stroke; color follows lead state.' },
            advantageCaption: { x: 0, y: race.ADV_CAPTION_Y, w: 300, h: 22, type: 'label',
                notes: '"ROUND ADVANTAGE" small caps, sits above the big number.' },

            // Opponent hero delta — repurposed 2026-04-29 to render the LEAD
            // (player − opponent, in pp) inside the Round Advantage card.
            opponentDelta:    { x: 0,    y: race.OPP_HERO_DELTA_Y, w: 300, h: 90,  type: 'label' },

            advantageSubtext: { x: 0, y: race.ADV_SUBTEXT_Y, w: 300, h: 24, type: 'label',
                notes: '"You’re ahead/behind this round!" — color-matched to card.' },

            // Opponent identity card — moved ABOVE opponent tokens. Internals
            // via templates.identityCard. Single combined "BOT · Lv 3" copy.
            opponentIdentityCard:  { x: 0,   y: race.OPP_IDENTITY_Y, w: 280, h: 44, type: 'sprite' },

            // Opponent token row container — 3 horizontal cards (mirror player)
            // 2026-05-01 — h 110 → 132 (mirrors playerTokenRow restyle).
            opponentTokenRow: { x: 0,    y: race.OPP_TOKEN_ROW_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 132, type: 'group' },

            // 2026-04-30 — Bot portfolio delta, bottom-left mirror of heroDelta.
            // Same w/h/style as the top-right player label. Visible only in
            // duel layout (1v1); hidden by AppUI in 4p/8p multi-bot modes.
            opponentPortfolioDelta: { x: -240, y: race.OPP_FOOTER_DELTA_Y, w: 220, h: 80, type: 'label' },

            // Legacy 1v1 opponent card (HIDDEN in duel layout — gated in AppUI).
            opponentCard:     { x: 0,    y: race.OPP_CARD_Y,  w: 640, h: 110, type: 'sprite' },
            // 4p/8p multi-bot strip — 2026-04-27 KILLED (force-hidden in scene-gen + AppUI).
            // Replaced by multiOppGrid + 7 MultiOppCard_* with tap-to-expand.
            opponentStrip:    { x: 0,    y: race.OPP_STRIP_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 260, type: 'group' },

            // 2026-04-27 — Multi-player condensed-card grid (Trio / 4p / 8p).
            // Hidden by default; AppUI activates when requiredPlayers > 2.
            // 4+3 grid: row1 (4 cards) at gridY=+60, row2 (3 cards) at gridY=-60.
            multiOppGrid:     { x: 0,    y: race.MULTI_GRID_Y, w: race.MULTI_GRID_W, h: race.MULTI_GRID_H, type: 'group',
                notes: 'multi-player N-card grid; AppUI re-positions cards per mode (Trio: 2, 4p: 3, 8p: 4+3).' },
            // "← Back" — only visible when an opponent card is expanded.
            multiBackBtn:     { x: race.MULTI_BACK_BTN_X, y: race.MULTI_BACK_BTN_Y, w: 100, h: 36, type: 'btnGhost',
                notes: 'returns from expanded opp view to the condensed MultiOppGrid.' },

            // Forfeit (paired RIGHT of Home on y=-260 row) + Home button (LEFT)
            cancelBtn:        { x: race.FORFEIT_BTN_X, y: race.FORFEIT_BTN_Y, w: 140, h: 36, type: 'btn',
                notes: '2026-04-27 — moved x 0→+80 to pair with Home button on the LEFT.' },
            homeBtn:          { x: race.HOME_BTN_X, y: race.HOME_BTN_Y, w: 140, h: 36, type: 'btnPrimary',
                notes: '2026-04-27 — "← Home" non-destructive escape; PortfolioRace keeps running, match resumable via MIP panel. 2026-05-01 — promoted btnGhost → btnPrimary so the CTA reads as the brand-purple action.' },

            // Gameplay hint — child of RacePanel so it draws above the panel scrim.
            hintLabel:        { x: 0,    y: race.HINT_LABEL_Y, w: 620, h: 24, type: 'label',
                notes: '"Tap to drop - stack as high as you can"; below Forfeit' },
            mascot:           { x: 260,  y: race.MASCOT_Y, w: 120, h: 160, type: 'mascot',
                notes: 'duel layout: dimmed to ~55% via UIOpacity (decorative)' },
            vignette:         { x: 0,    y: 0,    w: 720, h: 1280, type: 'graphics', notes: 'full-screen alpha overlay' },
        },
        templates: {
            // 5 player token cards — slots 0..4 stacked vertically. AppUI
            // toggles _active per slot based on squad size (1, 3, or 5).
            // Internal layout (relative to card center):
            //   sym left, entry top-center, current bottom-center, delta right
            raceCard: {
                count: 5, w: 640, h: 110,
                baseY: 50, gapY: -130,
                sym:    { x: -250, y: 0,   w: 140, h: 44 },
                entry:  { x: -40,  y: 18,  w: 220, h: 28 },
                cur:    { x: -40,  y: -18, w: 220, h: 28 },
                delta:  { x: 220,  y: 0,   w: 180, h: 60 },
            },
            // 7 opponent rows in OpponentStrip (HIDDEN by default, used in
            // multi-player modes). Coordinates relative to strip center y=-406.
            // symbols width tightened from 240 to 200 so it doesn't overlap
            // name's right edge (name x[-250,-180]; symbols now x[-170, 30],
            // 10 px gap).
            oppRow: {
                count: 7, w: 640, h: 30,
                baseY: 102, gapY: -34,
                avatar:  { x: -280, y: 0, w: 28,  h: 24 },
                name:    { x: -215, y: 0, w: 70,  h: 22 },
                symbols: { x: -70,  y: 0, w: 200, h: 22 },
                delta:   { x: 170,  y: 0, w: 100, h: 26 },
                gap:     { x: 265,  y: 0, w: 90,  h: 20 },
            },
            // Opponent card internals (shown in 1v1 mode). syms width
            // tightened from 260 to 140 (matches name width) so it stacks
            // BELOW name without reaching into avatar's x range. gap y
            // moved from -22 to -30 so it clears delta's bottom edge.
            oppCardInternal: {
                avatar: { x: -280, y: 0,   w: 60,  h: 60 },
                name:   { x: -180, y: 20,  w: 140, h: 24 },
                syms:   { x: -180, y: -14, w: 140, h: 24 },
                delta:  { x: 220,  y: 8,   w: 180, h: 48 },
                gap:    { x: 220,  y: -30, w: 200, h: 22 },
            },
            // 1v1 duel-layout horizontal token row — 3 cards side by side.
            // Used for both player (PlayerTokenCard_0..2) and opponent
            // (OpponentTokenCard_0..2) rows. 2026-05-01 restyle — circular
            // logo on left, symbol left-aligned right of logo, big delta
            // centered below, contribution bar at bottom. Card body recolored
            // to bg.cardHover purple (#321448) in generate-scenes.js to match
            // the squad / picker cards.
            duelTokenCard: {
                count: 3, w: 216, h: 132,
                baseX: -228, gapX: 228,
                logo:  { x: -78, y: 32,  w: 40,  h: 40 },
                sym:   { x:  16, y: 32,  w: 156, h: 28 },
                delta: { x:   0, y: -8,  w: 196, h: 40 },
                bar:   { x:   0, y: -52, w: 180, h: 6 },
            },
            // Identity card internals — positions relative to the card center.
            // dot at far-left, name top-right of dot, level below name.
            identityCard: {
                dot:   { x: -120, y: 0,   w: 10,  h: 10 },
                name:  { x: 8,    y: 12,  w: 240, h: 24 },
                level: { x: 8,    y: -14, w: 240, h: 18 },
            },
            // 2026-04-27 — Multi-player condensed opponent card. AppUI builds
            // 7 such cards as children of RaceMultiOppGrid; activates the
            // right subset per mode (Trio: 2, 4p: 3, 8p: 7).
            multiOppCard: {
                count: 7, w: 160, h: 120,
                row1Y: 60, row2Y: -60,
                rankChip:  { x: -60, y: 42,  w: 40,  h: 20 },
                name:      { x:   0, y: 20,  w: 140, h: 22 },
                delta:     { x:   0, y: -12, w: 140, h: 24 },
                pnlBar:    { x:   0, y: -44, w: 120, h: 4 },
                tap:       { x:   0, y: 0,   w: 160, h: 120 },
            },
        },
        allowedOverlaps: [
            ['RaceTimerRing', 'RaceCountdownLabel'],   // label inside ring
            // Round Advantage card (2026-04-29) — halo + border + caption +
            // big number + subtext are all stacked on the same y anchor by
            // design. The halo bbox intentionally extends beyond the border.
            ['RaceAdvantageHalo', 'RaceAdvantageBorder'],
            ['RaceAdvantageHalo', 'RaceAdvantageCaption'],
            ['RaceAdvantageHalo', 'OpponentDeltaHeroLabel'],
            ['RaceAdvantageHalo', 'RaceAdvantageSubtext'],
            ['RaceAdvantageBorder', 'RaceAdvantageCaption'],
            ['RaceAdvantageBorder', 'OpponentDeltaHeroLabel'],
            ['RaceAdvantageBorder', 'RaceAdvantageSubtext'],
            // Card_4 / OpponentCard / OpponentStrip — mutually exclusive
            // visibility (squad size or 1v1 vs multi-player), bbox overlap
            // is harmless because only one is _active at a time.
            ['RaceTokenCard_4', 'RaceOpponentCard'],
            ['RaceTokenCard_4', 'RaceOpponentStrip'],
            ['RaceOpponentCard', 'RaceOpponentStrip'],
            // Duel layout vs legacy 1v1 layout — mutually exclusive
            // visibility. AppUI shows duel surfaces only when 1v1; legacy
            // 5-card stack + RaceOpponentCard re-show in 4p/8p only.
            ['PlayerTokenCardsRow',  'RaceTokenCard_0'],
            ['PlayerTokenCardsRow',  'RaceTokenCard_1'],
            ['PlayerTokenCardsRow',  'RaceTokenCard_2'],
            ['PlayerTokenCardsRow',  'RaceTokenCard_3'],
            ['PlayerTokenCardsRow',  'RaceTokenCard_4'],
            ['OpponentTokenCardsRow','RaceTokenCard_2'],
            ['OpponentTokenCardsRow','RaceTokenCard_3'],
            ['OpponentTokenCardsRow','RaceTokenCard_4'],
            ['OpponentTokenCardsRow','RaceOpponentCard'],
            ['OpponentTokenCardsRow','RaceOpponentStrip'],
            ['RaceDuelBarContainer', 'RaceTokenCard_2'],
            ['RaceDuelBarContainer', 'RaceTokenCard_3'],
            ['RaceDuelBarContainer', 'RaceTokenCard_4'],
            ['OpponentDeltaHeroLabel','RaceOpponentCard'],
            ['OpponentDeltaHeroLabel','RaceOpponentStrip'],
            ['OpponentSubtitleGapLabel','RaceOpponentCard'],
            ['OpponentSubtitleGapLabel','RaceOpponentStrip'],
            ['OpponentIdentityCard',  'RaceOpponentCard'],
            ['OpponentIdentityCard',  'RaceOpponentStrip'],
            // Player Lv chip — small pill on top row, internal label child.
            ['RacePlayerLevelChip', 'RacePlayerLevelChipLabel'],
            // Identity card internal labels (opponent only — player identity
            // card was dropped 2026-04-26 in favor of the small Lv chip).
            ['OpponentIdentityCard', 'OpponentIdentityNameLabel'],
            ['OpponentIdentityCard', 'OpponentIdentityLevelLabel'],
            ['OpponentIdentityCard', 'OpponentIdentityDot'],
            // Duel bar internals overlap the container (children) and each other
            ['RaceDuelBarContainer', 'DuelBarTrack'],
            ['RaceDuelBarContainer', 'DuelBarFill'],
            ['RaceDuelBarContainer', 'DuelBarGlow'],
            ['RaceDuelBarContainer', 'DuelBarCenterTick'],
            ['RaceDuelBarContainer', 'DuelBarPlayerTagLabel'],
            ['RaceDuelBarContainer', 'DuelBarOppTagLabel'],
            ['RaceDuelBarContainer', 'DuelBarLeadingPpLabel'],
            ['DuelBarTrack', 'DuelBarFill'],
            ['DuelBarTrack', 'DuelBarGlow'],
            ['DuelBarTrack', 'DuelBarCenterTick'],
            ['DuelBarFill',  'DuelBarGlow'],
            ['DuelBarFill',  'DuelBarCenterTick'],
            ['DuelBarGlow',  'DuelBarCenterTick'],
            // ScreenVignette is a full-screen alpha overlay drawn beneath
            // race UI; intentional overlap with everything visible.
            ['ScreenVignette', 'RaceTimerRing'],
            ['ScreenVignette', 'RaceCountdownLabel'],
            ['ScreenVignette', 'RaceHeroDeltaLabel'],
            ['ScreenVignette', 'RaceTokenCard_0'],
            ['ScreenVignette', 'RaceTokenCard_1'],
            ['ScreenVignette', 'RaceTokenCard_2'],
            ['ScreenVignette', 'RaceTokenCard_3'],
            ['ScreenVignette', 'RaceTokenCard_4'],
            ['ScreenVignette', 'RaceOpponentCard'],
            ['ScreenVignette', 'RaceOpponentStrip'],
            ['ScreenVignette', 'RaceCancelButton'],
            ['ScreenVignette', 'RaceHintLabel'],
            ['ScreenVignette', 'RaceMascotContainer'],
            ['ScreenVignette', 'RacePlayerLevelChip'],
            ['ScreenVignette', 'OpponentIdentityCard'],
            ['ScreenVignette', 'PlayerTokenCardsRow'],
            ['ScreenVignette', 'OpponentTokenCardsRow'],
            ['ScreenVignette', 'RaceDuelBarContainer'],
            ['ScreenVignette', 'OpponentDeltaHeroLabel'],
            ['ScreenVignette', 'OpponentSubtitleGapLabel'],
            // 2026-04-27 — new buttons + multi grid sit on top of the
            // full-canvas vignette by design.
            ['ScreenVignette', 'RaceHomeButton'],
            ['ScreenVignette', 'RaceMultiBackButton'],
            ['ScreenVignette', 'RaceMultiOppGrid'],
        ],
    },

    // Phase 22 — Duel bar internal overlaps. Track/Fill/Glow/CenterTick all
    // stack at center y by design (the Fill draws over Track, Glow draws
    // over Fill, CenterTick punctuates the middle). Tags + leading-pp label
    // sit above/below the bar but the Glow's 40px tall bbox crosses them.
    RaceDuelBarContainer: {
        canvas: { w: 680, h: 80 },
        elements: {},
        allowedOverlaps: [
            ['DuelBarTrack', 'DuelBarFill'],
            ['DuelBarTrack', 'DuelBarGlow'],
            ['DuelBarTrack', 'DuelBarCenterTick'],
            ['DuelBarFill',  'DuelBarGlow'],
            ['DuelBarFill',  'DuelBarCenterTick'],
            ['DuelBarGlow',  'DuelBarCenterTick'],
            ['DuelBarGlow',  'DuelBarPlayerTagLabel'],
            ['DuelBarGlow',  'DuelBarOppTagLabel'],
            ['DuelBarGlow',  'DuelBarLeadingPpLabel'],
            ['DuelBarCenterTick', 'DuelBarLeadingPpLabel'],
        ],
    },

    /* ───── SETTINGS ────────────────────────────────────────────────── */
    // Phase 29 redesign — premium fintech-grade hierarchy. 5 cards: WALLET /
    // PROFILE / GAME DEFAULTS (was Quick Play) / PREFERENCES (was Audio+Haptics
    // toggle rows) / ACCOUNT (new — wraps Fees+Reconnect+Disconnect). Saturated
    // edge-stripes removed in favour of subtle 1px hairline borders. Delete
    // Account is now a small red text button below the Account card.
    SettingsPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // Phase 30 redesign — premium settings page. Compact wallet identity
            // card, real toggle switches, account hierarchy with group labels,
            // delete-account moved further down, dark sheet behind cards.
            sheetBg:         { x: 0,    y: 0,    w: 720, h: 1280, type: 'sprite',
                notes: '2026-04-30 — full-canvas dark cover (alpha 255) so no parent panel can bleed through edges. First child of SettingsPanel.' },
            sheetGlow:       { x: 0,    y: 446,  w: 220, h: 220,  type: 'sprite',
                notes: '2026-04-30 — single subtle radial teal accent behind Wallet card area. RGB 20,241,149 α 18.' },
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:           { x: 0,    y: UNIFORM_HEADER.TITLE_Y, w: 400, h: 44,  type: 'label' },
            // Wallet → compact identity card (124→96, single-row identity).
            // 2026-04-30 layout: top row pubkey LEFT-aligned + balance RIGHT-
            // aligned (the primary stat no longer floats bottom-left); bottom
            // row "Connected · Mobile Wallet Adapter" subtitle next to status
            // dot. Divider sprite removed (no longer needed at this height).
            // Teal glow perimeter retained (4 strokes), shrunk to h=96.
            walletCard:      { x: 0,    y: settings.WALLET_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 96, type: 'group',
                children: {
                    header:        { x: -220, y: 32,  w: 200, h: 14, type: 'label',
                        notes: '"WALLET" eyebrow 12px lo-text top-left (matches original safe x=-220)' },
                    walletPubkey:  { x: -100, y: 6,   w: 400, h: 24, type: 'label',
                        notes: '2026-04-30 — mono 22px BOLD identity, box centered at x=-100 → text starts at x=-300; balance box starts at x=+110 (10 px gap). Was floating with its own row.' },
                    copyPubkeyBtn: { x: -100, y: 6,   w: 380, h: 36, type: 'btnGhost',
                        notes: 'invisible hit area covering pubkey for tap-to-copy' },
                    walletBalance: { x: 200,  y: 6,   w: 200, h: 22, type: 'label',
                        notes: '2026-04-30 — mono 20px BOLD bright teal RIGHT-aligned. Box +100 to +300; text ends at +300 (40 px from card edge).' },
                    statusDot:     { x: -300, y: -26, w: 10,  h: 10, type: 'sprite',
                        notes: '2026-04-30 — small connection indicator at bottom-row left, paired with "Connected · MWA" subtitle' },
                    walletName:    { x: -120, y: -26, w: 380, h: 14, type: 'label',
                        notes: 'secondary "Connected · {wallet}" 12px mid-text, LEFT-aligned bottom row' },
                    glowTop:       { x: 0,    y: 47,  w: 686, h: 2,  type: 'sprite',
                        notes: 'teal α 90 perimeter stroke (top)' },
                    glowBot:       { x: 0,    y: -47, w: 686, h: 2,  type: 'sprite' },
                    glowLeft:      { x: -343, y: 0,   w: 2,   h: 94,  type: 'sprite' },
                    glowRight:     { x: 343,  y: 0,   w: 2,   h: 94,  type: 'sprite' },
                },
            },
            // Profile — Phase 31 dual-mode: a display row (label + edit pencil)
            // and a hidden edit row (input + Cancel + Confirm). AppUI flips the
            // two subtrees on tap so committing a username feels intentional
            // rather than "stop typing and pray". 2026-04-30 — eyebrow + label
            // anchored top-left; username value LEFT-aligned with edit pencil
            // RIGHT-aligned on the same row (hibudd no longer center-floats).
            profileCard:     { x: 0,    y: settings.PROFILE_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 148, type: 'group',
                children: {
                    header:           { x: -220, y: 56,  w: 200, h: 14, type: 'label',
                        notes: '"PROFILE" eyebrow 12px lo-text, top-left (matches original safe x=-220)' },
                    usernameLabel:    { x: -220, y: 36,  w: 200, h: 14, type: 'label',
                        notes: '"Username" 12px mid-text below eyebrow' },
                    // Display-mode subtree (default visible).
                    usernameDisplay:  { x: -100, y: 4,   w: 400, h: 32, type: 'label',
                        notes: '2026-04-30 — username readout (22px bold) LEFT-aligned at text-left x=-300 (box centered at -100 with w=400). Was floating center at x=-10.' },
                    editUsernameBtn:  { x: 290,  y: 4,   w: 40,  h: 40, type: 'btnGhost',
                        notes: 'pencil glyph, rounded square; right-edge of card (40 px from card-right)' },
                    // Edit-mode subtree (hidden by default).
                    focusRing:        { x: 0,    y: 6,   w: 624, h: 48, type: 'sprite',
                        notes: 'violet stroke around EditBox, alpha 0 → 80 on focus' },
                    username:         { x: 0,    y: 6,   w: 620, h: 44, type: 'editbox' },
                    usernameCancelBtn:{ x: -110, y: -28, w: 140, h: 34, type: 'btnGhost',
                        notes: 'edit-mode Cancel; hidden in display mode' },
                    usernameConfirmBtn:{x:  110, y: -28, w: 140, h: 34, type: 'btnPrimary',
                        notes: 'edit-mode Confirm; disabled until input differs from saved value' },
                    // Status band — error string in edit mode, "saved ✓" flash in display mode.
                    usernameSaved:    { x: 0,    y: -50, w: 620, h: 16, type: 'label' },
                    usernameHelp:     { x: 0,    y: -50, w: 620, h: 14, type: 'label',
                        notes: 'display-mode helper "🏆 Displayed on leaderboard & matches"; 2026-04-30 — 12→11px ambient' },
                    topBorder:        { x: 0,    y: 73,  w: 686, h: 1,  type: 'sprite' },
                },
            },
            // Phase 29 — "DEFAULT MATCH SETTINGS". Phase 30 — drops ▾ glyph
            // from value labels and adds a › chevron child to each row for
            // stronger affordance. Trading-mode toggle gains a teal glow halo.
            quickPlayCard:   { x: 0,    y: settings.QP_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 260, type: 'group',
                children: {
                    header: { x: -120, y: 116, w: 400, h: 18, type: 'label' },
                    qpModeRow:   { x: 0, y: 76,  w: 620, h: 44, type: 'btnGhost',
                        notes: '2026-04-30 — h 40→44 for breathing room, equal touch targets across all 3 rows',
                        children: {
                            keyLabel:   { x: -284, y: 0, w: 200, h: 20, type: 'label' },
                            valueLabel: { x:  120, y: 0, w: 280, h: 22, type: 'label' },
                            chevron:    { x:  282, y: 0, w: 20,  h: 22, type: 'label' },
                        },
                    },
                    qpWindowRow: { x: 0, y: 30,  w: 620, h: 44, type: 'btnGhost',
                        children: {
                            keyLabel:   { x: -284, y: 0, w: 200, h: 20, type: 'label' },
                            valueLabel: { x:  120, y: 0, w: 280, h: 22, type: 'label' },
                            chevron:    { x:  282, y: 0, w: 20,  h: 22, type: 'label' },
                        },
                    },
                    qpWagerRow:  { x: 0, y: -16, w: 620, h: 44, type: 'btnGhost',
                        children: {
                            keyLabel:   { x: -284, y: 0, w: 200, h: 20, type: 'label' },
                            valueLabel: { x:  120, y: 0, w: 280, h: 22, type: 'label' },
                            chevron:    { x:  282, y: 0, w: 20,  h: 22, type: 'label' },
                        },
                    },
                    qpTrackRow:   { x: -260, y: -72, w: 220, h: 22, type: 'label',
                        notes: 'TRADING MODE key label sibling of toggle' },
                    qpTrackToggle:{ x: 90,  y: -72, w: 320, h: 44, type: 'group',
                        children: {
                            glowHalo:   { x: -78, y: 0, w: 168, h: 52, type: 'sprite',
                                notes: 'teal α 60 halo behind indicator, follows x via tween' },
                            indicator:  { x: -78, y: 0, w: 156, h: 44, type: 'sprite' },
                            paperLabel: { x: -78, y: 0, w: 140, h: 22, type: 'label' },
                            realLabel:  { x:  78, y: 0, w: 140, h: 22, type: 'label' },
                            paperHit:   { x: -78, y: 0, w: 156, h: 44, type: 'btnGhost' },
                            realHit:    { x:  78, y: 0, w: 156, h: 44, type: 'btnGhost' },
                        },
                    },
                    qpTrackHelp:  { x: 0, y: -108, w: 620, h: 16, type: 'label' },
                    topBorder:    { x: 0, y: 129,  w: 686, h: 1,  type: 'sprite' },
                },
            },
            // PREFERENCES — Phase 30: real toggle switches (track + sliding knob)
            // replace the ON/OFF pills. Pill nodes preserved (deactivated) so
            // verifier allowedOverlaps and binding stability stay intact.
            audioCard:       { x: 0,    y: settings.AUDIO_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 148, type: 'group',
                children: {
                    header:        { x: -120, y: 60,  w: 400, h: 16, type: 'label' },
                    soundRow:      { x: 0,    y: 22,  w: 620, h: 48, type: 'btnGhost',
                        children: {
                            icon:        { x: -274, y: 0,   w: 28, h: 28, type: 'sprite' },
                            label:       { x: -232, y: 0,   w: 220, h: 22, type: 'label' },
                            switchTrack: { x:  256, y: 0,   w: 44,  h: 24, type: 'sprite',
                                notes: '2026-04-30 — slimmer switch (was 52×30) for sleeker visual rhythm' },
                            switchKnob:  { x:  266, y: 0,   w: 20,  h: 20, type: 'sprite',
                                notes: 'starts at switchTrack.x+10 when ON, x-10 when OFF (2026-04-30 — was ±12)' },
                            pillBg:      { x:  254, y: 0,   w: 52,  h: 30, type: 'sprite',
                                notes: 'legacy node, deactivated — kept for verifier overlap entries' },
                            pillLbl:     { x:  254, y: 0,   w: 52,  h: 22, type: 'label',
                                notes: 'legacy node, deactivated' },
                        },
                    },
                    hapticsRow:    { x: 0,    y: -34, w: 620, h: 48, type: 'btnGhost',
                        children: {
                            icon:        { x: -274, y: 0,   w: 28, h: 28, type: 'sprite' },
                            label:       { x: -232, y: 0,   w: 220, h: 22, type: 'label' },
                            switchTrack: { x:  256, y: 0,   w: 44,  h: 24, type: 'sprite' },
                            switchKnob:  { x:  266, y: 0,   w: 20,  h: 20, type: 'sprite' },
                            pillBg:      { x:  254, y: 0,   w: 52,  h: 30, type: 'sprite' },
                            pillLbl:     { x:  254, y: 0,   w: 52,  h: 22, type: 'label' },
                        },
                    },
                    rowDivider:    { x: 0,    y: -6,  w: 600, h: 1,  type: 'sprite',
                        notes: 'subtle separator between sound + haptics rows, white α 14' },
                    topBorder:     { x: 0, y: 73, w: 686, h: 1, type: 'sprite' },
                },
            },
            // ACCOUNT — Phase 30: explicit GENERAL / SESSION group labels with a
            // hairline divider between, plus a row divider between Reconnect and
            // Disconnect. 2026-04-30 — h 232→200 to remove dead space and pull
            // Danger Zone closer to Preferences.
            accountCard:     { x: 0,    y: settings.ACCOUNT_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 200, type: 'group',
                children: {
                    header:           { x: -120, y: 84,  w: 400, h: 16, type: 'label' },
                    generalGroupLabel:{ x: -220, y: 64,  w: 200, h: 14, type: 'label',
                        notes: '"GENERAL" group header (lo-text, 10px)' },
                    feesRow:          { x: 0,    y: 36,  w: 620, h: 44, type: 'btnGhost',
                        notes: '2026-04-30 — row h 48→44 for tighter rhythm matching Match Setup',
                        children: {
                            icon:    { x: -274, y: 0,   w: 26, h: 26, type: 'sprite' },
                            // label x shifted -232 → -190 so the auto-fitted text box (overflow=NONE
                            // means anchor 0.5/0.5 centers text on lpos.x) clears the icon at x=-274.
                            label:   { x: -190, y: 0,   w: 360, h: 22, type: 'label' },
                            chevron: { x:  282, y: 0,   w: 20,  h: 22, type: 'label' },
                        },
                    },
                    groupDivider:     { x: 0,    y: 10,  w: 600, h: 1, type: 'sprite',
                        notes: 'GENERAL / SESSION separator hairline' },
                    sessionGroupLabel:{ x: -220, y: -12, w: 200, h: 14, type: 'label' },
                    reconnectRow:     { x: 0,    y: -40, w: 620, h: 44, type: 'btnGhost',
                        children: {
                            icon:    { x: -274, y: 0,   w: 26, h: 26, type: 'sprite' },
                            label:   { x: -190, y: 0,   w: 360, h: 22, type: 'label' },
                            chevron: { x:  282, y: 0,   w: 20,  h: 22, type: 'label' },
                        },
                    },
                    rowDivider:       { x: 0,    y: -66, w: 600, h: 1, type: 'sprite',
                        notes: 'subtle separator between reconnect + disconnect rows' },
                    disconnectRow:    { x: 0,    y: -90, w: 620, h: 44, type: 'btnGhost',
                        children: {
                            icon:    { x: -274, y: 0,   w: 26, h: 26, type: 'sprite' },
                            label:   { x: -190, y: 0,   w: 360, h: 22, type: 'label' },
                            chevron: { x:  282, y: 0,   w: 20,  h: 22, type: 'label' },
                        },
                    },
                    topBorder:        { x: 0, y: 99, w: 686, h: 1, type: 'sprite' },
                },
            },
            // Phase 31 — DANGER ZONE eyebrow framing the destructive Delete
            // Account action. Reads as a deliberate subsection rather than a
            // floating red label.
            dangerZoneLabel: { x: 0,    y: settings.DELETE_BTN_Y + 32, w: 200, h: 14, type: 'label',
                notes: '"DANGER ZONE" 11px lo-text eyebrow, sits 32px above the delete button' },
            // Phase 30 / 31 — Delete Account. Card-style background tinted muted
            // rose (NOT glowing). 2-tap arming flow lives in AppUI._onDelete*.
            deleteBtn:       { x: 0,    y: settings.DELETE_BTN_Y, w: 320, h: 44, type: 'btnGhost',
                notes: 'rose-tinted card row; first tap arms 2-tap confirm in AppUI' },
            status:          { x: 0,    y: settings.STATUS_Y, w: 640, h: 20, type: 'label' },
            // QP popovers — direct children of SettingsPanel for z-order. Y values
            // ride along with the cards (cards shifted +30 in 2026-04-27 refactor).
            qpModePopover:   { x: 200, y: settings.QP_MODE_POPOVER_Y,   w: 220, h: 174, type: 'group',
                notes: 'opens BELOW QPModeRow; 4 options × 40 + 14 padding' },
            qpWindowPopover: { x: 200, y: settings.QP_WINDOW_POPOVER_Y, w: 220, h: 204, type: 'group',
                notes: 'opens BELOW QPWindowRow; 2026-04-27 grew 174→204 for 6 options' },
            qpWagerPopover:  { x: 200, y: settings.QP_WAGER_POPOVER_Y,  w: 220, h: 214, type: 'group',
                notes: 'opens BELOW QPWagerRow; 5 options × 40 + 14' },
        },
        templates: {
            // Phase 27 — popover option templates. Each popover stacks N options
            // vertically with rowH stride. Active option gets ▣ prefix at runtime.
            qpModeOption: {
                count: 4, w: 200, h: 36,
                keys:   ['1v1', 'trio', '4p', '8p'],
                labels: ['1v1', 'Trio', '4p', '8p'],
                ys:     [60, 20, -20, -60],
                logical: ['oneVone', 'trio', 'fourPlayer', 'eightPlayer'],
            },
            qpWindowOption: {
                count: 6, w: 200, h: 30,
                keys:   ['30s', '1m', '5m', '1h', '24h', '7d'],
                labels: ['30s', '1m', '5m', '1h', '24h', '7d'],
                ys:     [80, 48, 16, -16, -48, -80],
            },
            qpWagerOption: {
                count: 5, w: 200, h: 36,
                keys:   ['001', '005', '01', '025', '05'],
                labels: ['0.01 SOL', '0.05 SOL', '0.1 SOL', '0.25 SOL', '0.5 SOL'],
                ys:     [80, 40, 0, -40, -80],
            },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],   // label sits ON invisible button
            // Phase 30 — sheet bg sits behind every card by z-order (first child).
            ['SettingsSheetBg', 'WalletCard'],
            ['SettingsSheetBg', 'ProfileCard'],
            ['SettingsSheetBg', 'QuickPlayDefaultsCard'],
            ['SettingsSheetBg', 'AudioSettingsCard'],
            ['SettingsSheetBg', 'AccountSettingsCard'],
            ['SettingsSheetBg', 'DeleteAccountSettingsButton'],
            ['SettingsSheetBg', 'DangerZoneLabel'],
            ['SettingsSheetBg', 'SettingsStatusLabel'],
            ['SettingsSheetBg', 'SettingsTitleLabel'],
            ['SettingsSheetBg', 'BackLinkLabel'],
            ['SettingsSheetBg', 'BackButton'],
            ['SettingsSheetBg', 'QPModePopover'],
            ['SettingsSheetBg', 'QPWindowPopover'],
            ['SettingsSheetBg', 'QPWagerPopover'],
            ['SettingsSheetBg', 'SettingsSheetGlow'],
            // 2026-04-30 — soft teal halo behind Wallet card; sits between
            // the dark sheet and the cards.
            ['SettingsSheetGlow', 'WalletCard'],
        ],
    },

    // Synthetic top-level entry — verifier matches `Identifier: { ... allowedOverlaps }`
    // by panel name. QPTrackToggle counts as its own panel because it has 5 UI
    // children. The toggle has intentional internal overlaps: indicator sits
    // BEHIND labels (decorative), and invisible hit areas sit ON TOP of both.
    // Phase 30 adds a teal glow halo behind the indicator that follows the same x.
    QPTrackToggle: {
        allowedOverlaps: [
            ['QPTrackIndicator', 'QPTrackPaperLabel'],
            ['QPTrackIndicator', 'QPTrackPaperHit'],
            ['QPTrackPaperLabel', 'QPTrackPaperHit'],
            ['QPTrackRealLabel', 'QPTrackRealHit'],
            ['QPTrackGlowHalo', 'QPTrackIndicator'],
            ['QPTrackGlowHalo', 'QPTrackPaperLabel'],
            ['QPTrackGlowHalo', 'QPTrackPaperHit'],
            ['QPTrackGlowHalo', 'QPTrackRealLabel'],
            ['QPTrackGlowHalo', 'QPTrackRealHit'],
        ],
    },

    // Phase 29 — Wallet card. Status dot sits next to the connected name
    // label, and the truncated pubkey sits next to the copy button. Phase 30
    // adds a 4-stroke violet glow border that overlaps everything inside.
    WalletCard: {
        allowedOverlaps: [
            ['WalletStatusDot', 'WalletNameLabel'],
            ['WalletPubkeyLabel', 'CopyPubkeyButton'],
            ['WalletNameLabel', 'CopyPubkeyButton'],
            ['WalletGlowTop', 'WalletGlowLeft'],
            ['WalletGlowTop', 'WalletGlowRight'],
            ['WalletGlowBot', 'WalletGlowLeft'],
            ['WalletGlowBot', 'WalletGlowRight'],
            // Perimeter strokes intentionally overlap any wide content inside.
            ['HeaderLabel',         'WalletGlowLeft'],
            ['HeaderLabel',         'WalletGlowRight'],
            ['WalletNameLabel',     'WalletGlowLeft'],
            ['WalletNameLabel',     'WalletGlowRight'],
            ['WalletPubkeyLabel',   'WalletGlowLeft'],
            ['WalletPubkeyLabel',   'WalletGlowRight'],
            ['WalletBalanceLabel',  'WalletGlowLeft'],
            ['WalletBalanceLabel',  'WalletGlowRight'],
            // 2026-04-30 — WalletDivider removed (single-row identity layout
            // no longer separates pubkey from balance with a hairline).
        ],
    },

    // Phase 29 — Preference toggle rows. Each row's icon (left gutter) and
    // label sit in the same horizontal band by design. The pill background
    // and its ON/OFF label co-locate on the right. Phase 30 adds toggle-switch
    // siblings (track + sliding knob) on the same right gutter.
    SoundToggleButton: {
        allowedOverlaps: [
            ['PrefSoundIcon', 'SoundToggleButtonLabel'],
            ['SoundToggleButtonPillBg', 'SoundToggleButtonPillLabel'],
            ['SoundToggleButtonSwitchTrack', 'SoundToggleButtonSwitchKnob'],
            ['SoundToggleButtonSwitchTrack', 'SoundToggleButtonPillBg'],
            ['SoundToggleButtonSwitchTrack', 'SoundToggleButtonPillLabel'],
            ['SoundToggleButtonSwitchKnob', 'SoundToggleButtonPillBg'],
            ['SoundToggleButtonSwitchKnob', 'SoundToggleButtonPillLabel'],
        ],
    },
    HapticsToggleButton: {
        allowedOverlaps: [
            ['PrefHapticsIcon', 'HapticsToggleButtonLabel'],
            ['HapticsToggleButtonPillBg', 'HapticsToggleButtonPillLabel'],
            ['HapticsToggleButtonSwitchTrack', 'HapticsToggleButtonSwitchKnob'],
            ['HapticsToggleButtonSwitchTrack', 'HapticsToggleButtonPillBg'],
            ['HapticsToggleButtonSwitchTrack', 'HapticsToggleButtonPillLabel'],
            ['HapticsToggleButtonSwitchKnob', 'HapticsToggleButtonPillBg'],
            ['HapticsToggleButtonSwitchKnob', 'HapticsToggleButtonPillLabel'],
        ],
    },

    // Phase 29 — Account card chevron rows. Icon (left gutter) and label
    // share the same horizontal band by design.
    FeesLinkButton: {
        allowedOverlaps: [
            ['AccountFeesIcon', 'FeesLinkButtonLabel'],
        ],
    },
    ReconnectSettingsButton: {
        allowedOverlaps: [
            ['AccountReconnectIcon', 'ReconnectSettingsButtonLabel'],
        ],
    },
    DisconnectSettingsButton: {
        allowedOverlaps: [
            ['AccountDisconnectIcon', 'DisconnectSettingsButtonLabel'],
        ],
    },

    // Phase 30 / 31 — Profile card. The violet focus ring shares the same
    // bounding box as the EditBox (it's the ring around it). The display-mode
    // username label sits in the same band as the EditBox/focus ring; AppUI
    // toggles _active so only one subtree is visible at a time. The edit
    // pencil button overlaps the right edge of the display label. Help and
    // saved labels share the same Y band (mutually exclusive content).
    ProfileCard: {
        allowedOverlaps: [
            ['UsernameFocusRing', 'UsernameEditBox'],
            ['UsernameLabel',     'UsernameFocusRing'],
            ['UsernameLabel',     'UsernameEditBox'],
            ['UsernameFocusRing', 'UsernameSaveLabel'],
            ['UsernameEditBox',   'UsernameSaveLabel'],
            // Phase 31 — display-mode label co-locates with the editbox band.
            ['UsernameDisplayLabel',  'UsernameFocusRing'],
            ['UsernameDisplayLabel',  'UsernameEditBox'],
            ['UsernameDisplayLabel',  'EditUsernameButton'],
            ['UsernameLabel',         'UsernameDisplayLabel'],
            ['EditUsernameButton',    'UsernameFocusRing'],
            ['EditUsernameButton',    'UsernameEditBox'],
            // Phase 31 — Cancel/Confirm row overlaps focus ring's bottom edge.
            ['UsernameFocusRing',     'UsernameCancelButton'],
            ['UsernameFocusRing',     'UsernameConfirmButton'],
            ['UsernameEditBox',       'UsernameCancelButton'],
            ['UsernameEditBox',       'UsernameConfirmButton'],
            // Phase 31 — saved + help share the same Y band.
            ['UsernameSaveLabel',     'UsernameHelpLabel'],
        ],
    },

    // Phase 30 — Account card has GENERAL / SESSION group labels and divider
    // hairlines that visually nest the chevron rows. Hairlines are intended
    // to span the full row width.
    AccountSettingsCard: {
        allowedOverlaps: [
            ['AccountGroupDivider',     'FeesLinkButton'],
            ['AccountGroupDivider',     'ReconnectSettingsButton'],
            ['AccountRowDivider',       'ReconnectSettingsButton'],
            ['AccountRowDivider',       'DisconnectSettingsButton'],
            ['AccountGeneralGroupLabel','FeesLinkButton'],
            ['AccountSessionGroupLabel','ReconnectSettingsButton'],
        ],
    },

    // Phase 30 — PREFERENCES card. Row divider hairline intentionally spans
    // both toggle rows.
    AudioSettingsCard: {
        allowedOverlaps: [
            ['AudioRowDivider', 'SoundToggleButton'],
            ['AudioRowDivider', 'HapticsToggleButton'],
        ],
    },

    /* ───── MATCHES IN PROGRESS ─────────────────────────────────────── */
    // 2026-04-29 — Nuclear rebuild. Fixed 6-row pool, NO scrollview/Mask.
    // Mirrors FindMatchPanel pattern (which renders correctly). Each row
    // sits directly under the subtitle on the app background — no card
    // chrome, just a thin teal accent stripe on the left and the match info
    // (VS line, time, stake chip, win line, Resume button).
    MatchesInProgressPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:  { x: UNIFORM_HEADER.BACK_LINK.x, y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:   { x: UNIFORM_HEADER.BACK_BTN.x,  y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:     { x: 0, y: UNIFORM_HEADER.TITLE_Y,    w: 600, h: 44, type: 'label',
                notes: '"Matches In Progress" — gold bold 30pt' },
            subtitle:  { x: 0, y: UNIFORM_HEADER.SUBTITLE_Y, w: 520, h: 22, type: 'label',
                notes: 'AppUI fills "{N} games running" / "All clear"' },
            // Empty-state cluster (shown when zero active matches).
            emptyState:        { x: 0, y: mip.EMPTY_STATE_Y, w: 600, h: 240, type: 'group' },
            emptyStateTitle:   { x: 0, y: mip.EMPTY_TITLE_Y + mip.EMPTY_STATE_Y, w: 600, h: 36, type: 'label' },
            emptyStateSubtitle:{ x: 0, y: mip.EMPTY_SUB_Y   + mip.EMPTY_STATE_Y, w: 600, h: 22, type: 'label' },
            emptyStateCta:     { x: 0, y: mip.EMPTY_CTA_Y   + mip.EMPTY_STATE_Y, w: 320, h: 56, type: 'btnPrimary',
                notes: '"Start a Match" — routes to FindMatchPanel' },
            // "+N more" hint below the visible row pool.
            moreLabel: { x: 0, y: mip.MORE_LABEL_Y, w: 600, h: 18, type: 'label' },
            // Legacy scrollview entry — generator still creates a (now unused)
            // MIPScrollView container for row mounting; the active 6-row pool
            // lives as direct panel children but the generator still expects
            // scroll.x/y/w/h to exist. Compatibility shim until generator is
            // updated to the new no-scrollview architecture.
            scroll:    { x: 0, y: 60, w: UNIFORM_LAYOUT.CONTENT_W, h: 1000, type: 'scrollview' },
            // Status footer.
            status:    { x: 0, y: mip.STATUS_Y, w: 600, h: 22, type: 'label' },
        },
        templates: {
            // 6-row pool. Direct children of the panel (NO scrollview, NO Mask).
            // 2026-04-29 — live-control-center redesign. Each row is now a
            // self-contained card with: 9-slice surface, breathing glow halo,
            // 6px leader-state edge, LIVE chip, merged status row, timer
            // progress bar, and an idle-pulsing Resume CTA.
            mipRow: {
                count: mip.ROW_COUNT, w: mip.ROW_W, h: mip.ROW_H,
                baseY: mip.ROW_BASE_Y, gapY: mip.ROW_GAP_Y,
                // 9-slice card surface (deep slate, ~91% alpha). 680×144.
                cardBg:        { x: 0,    y: 0,   w: 680, h: 144 },
                // Soft halo behind card — alpha animated by _mipFrameTick,
                // tinted by leader state (teal/rose/neutral). Outset 16px on
                // each side of cardBg.
                cardGlow:      { x: 0,    y: 0,   w: 696, h: 160 },
                // Leader-state accent stripe (left edge). 6px × 124px.
                edge:          { x: -334, y: 0,   w: 6,   h: 124 },
                // LIVE indicator cluster (top-right): soft glow halo behind
                // a 12×12 dot + "LIVE" microcopy. Glow + dot share xy.
                liveGlow:      { x: 270,  y: 50,  w: 20,  h: 20 },
                liveDot:       { x: 270,  y: 50,  w: 12,  h: 12 },
                liveLabel:     { x: 308,  y: 50,  w: 56,  h: 16 },
                // VS line (left, top): "VS Bot • PAPER" / "VS @user • 0.05 SOL".
                // 26pt bold; left edge anchored at x=-336 (center -156, w=360).
                vsLabel:       { x: -156, y: 46,  w: 360, h: 32 },
                // Leader chip (left, lower-mid): "YOU +0.32%" / "OPP +0.50%".
                // Repurposed from old stakeChip slot — stake info folded into vsLabel.
                // Hidden in pregame.
                stakeChip:     { x: -244, y: -14, w: 160, h: 16 },
                // Merged status line (mid): "Mid match • 11h 32m left". 17pt.
                // Left edge anchored at x=-336 (center -36, w=600).
                statusLabel:   { x: -36,  y: 12,  w: 600, h: 24 },
                // Legacy time slot — kept in place but emptied at render time
                // since time is now folded into statusLabel.
                timeLabel:     { x: 196,  y: 0,   w: 130, h: 18 },
                // Timer progress bar (bottom of card). Track centered; fill
                // is left-anchored (anchor 0, 0.5; width 624 * elapsed/total).
                // h 4→6 for visibility.
                progressTrack: { x: 0,    y: -58, w: 624, h: 6 },
                progressFill:  { x: -312, y: -58, w: 0,   h: 6 },
                // Soft glow halo behind Resume button — alpha-breathes via
                // _mipFrameTick on a 2.5s cycle. Replaces the prior scale pulse.
                resumeGlow:    { x: 254,  y: -30, w: 150, h: 72 },
                // Resume button (right, lower-mid). Static — no scale pulse.
                resumeBtn:     { x: 254,  y: -30, w: 116, h: 44 },
                // 2026-05-02 — small ghost text button immediately LEFT of the
                // resume CTA. Opens LiveStandingsOverlay (player list + ranks
                // + live PnL). 84×36 — sized so resumeGlow's left edge (179)
                // never crosses our right edge (170). Centered at y=-30 so it
                // shares the action-row baseline with the Resume button.
                detailsBtn:    { x: 128,  y: -30, w: 84,  h: 36 },
                // Full-row invisible tap target.
                tapTarget:     { x: 0,    y: 0,   w: mip.ROW_W, h: mip.ROW_H },
            },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
            // Card surface + glow halo sit behind every other row child.
            ['MIPCardBg', 'MIPCardGlow'],
            ['MIPCardBg', 'MIPCardEdge'],
            ['MIPCardBg', 'MIPLiveGlow'],
            ['MIPCardBg', 'MIPLiveDot'],
            ['MIPCardBg', 'MIPLiveLabel'],
            ['MIPCardBg', 'MIPVsLabel'],
            ['MIPCardBg', 'MIPStakeChip'],
            ['MIPCardBg', 'MIPStatusLabel'],
            ['MIPCardBg', 'MIPTimeLabel'],
            ['MIPCardBg', 'MIPProgressTrack'],
            ['MIPCardBg', 'MIPProgressFill'],
            ['MIPCardBg', 'MIPResumeGlow'],
            ['MIPCardBg', 'MIPResumeBtn'],
            ['MIPCardBg', 'MIPDetailsBtn'],
            ['MIPCardBg', 'MIPTapTarget'],
            ['MIPCardGlow', 'MIPCardEdge'],
            ['MIPCardGlow', 'MIPLiveGlow'],
            ['MIPCardGlow', 'MIPLiveDot'],
            ['MIPCardGlow', 'MIPLiveLabel'],
            ['MIPCardGlow', 'MIPVsLabel'],
            ['MIPCardGlow', 'MIPStakeChip'],
            ['MIPCardGlow', 'MIPStatusLabel'],
            ['MIPCardGlow', 'MIPTimeLabel'],
            ['MIPCardGlow', 'MIPProgressTrack'],
            ['MIPCardGlow', 'MIPProgressFill'],
            ['MIPCardGlow', 'MIPResumeGlow'],
            ['MIPCardGlow', 'MIPResumeBtn'],
            ['MIPCardGlow', 'MIPDetailsBtn'],
            ['MIPCardGlow', 'MIPTapTarget'],
            // Tap target sits below all visible row content.
            ['MIPTapTarget', 'MIPCardEdge'],
            ['MIPTapTarget', 'MIPLiveGlow'],
            ['MIPTapTarget', 'MIPLiveDot'],
            ['MIPTapTarget', 'MIPLiveLabel'],
            ['MIPTapTarget', 'MIPVsLabel'],
            ['MIPTapTarget', 'MIPStakeChip'],
            ['MIPTapTarget', 'MIPStatusLabel'],
            ['MIPTapTarget', 'MIPTimeLabel'],
            ['MIPTapTarget', 'MIPProgressTrack'],
            ['MIPTapTarget', 'MIPProgressFill'],
            ['MIPTapTarget', 'MIPResumeGlow'],
            ['MIPTapTarget', 'MIPResumeBtn'],
            ['MIPTapTarget', 'MIPDetailsBtn'],
            // Progress fill rides on the track at the same y/h.
            ['MIPProgressTrack', 'MIPProgressFill'],
            // LIVE cluster: glow under dot under label.
            ['MIPLiveGlow', 'MIPLiveDot'],
            ['MIPLiveGlow', 'MIPLiveLabel'],
            ['MIPLiveDot', 'MIPLiveLabel'],
            // Resume glow halo sits under the button.
            ['MIPResumeGlow', 'MIPResumeBtn'],
            // 2026-05-02 — "Live Battle" v3 hero overlays. Big-timer + big-phase
            // + animated leader chip sit visually above the card surface. Header
            // live-dot rides next to the subtitle.
            ['MIPCardBg',    'MIPBigTimer'],
            ['MIPCardBg',    'MIPBigPhase'],
            ['MIPCardGlow',  'MIPBigTimer'],
            ['MIPCardGlow',  'MIPBigPhase'],
            ['MIPTapTarget', 'MIPBigTimer'],
            ['MIPTapTarget', 'MIPBigPhase'],
            ['Subtitle',     'MIPHeaderLiveDot'],
        ],
    },

    /* ───── LEADERBOARD ─────────────────────────────────────────────── */
    // Hero card for rank #1 (TopPlayerCard) + 9 standard rows + 4-tab segmented
    // mode control + standalone "This Week" chip + EmptyStateGroup + sticky-bottom
    // PersonalRankCard. AppUI fills entries[0] into TopPlayerCard and ranks 2..10
    // into LBRow_1..LBRow_9. Season filter (modeU8=4) drives the same nodes via
    // a wins-based render path.
    LeaderboardPanel: {
        canvas: { w: 720, h: 1280 },
        // 2026-04-29 v2 — HubTabStrip (Portfolio | Leaderboard) is built at
        // runtime by AppUI._buildHubTabs at panel-local y=720 (h=56). It's the
        // visible top of this panel; generator's computePanelTopEdge() picks
        // up RUNTIME_TOP_EDGE to align with other panels.
        RUNTIME_TOP_EDGE: 748,
        elements: {
            // 2026-04-30 UX polish — full-canvas scrim kills BackgroundFX bleed
            // (parent starfield + violet/teal glows). Mirrors HomeContentScrim /
            // FindMatchContentScrim. MUST render first; sits behind every other
            // LeaderboardPanel child. Color = Palette.bg.primary @ alpha 110.
            leaderboardContentScrim: { x: 0, y: 0, w: 720, h: 1280, type: 'sprite', notes: 'dim overlay behind content column — kills starfield/violet bleed' },
            // 2026-04-29: back y derived from DashboardLayoutSpec.leaderboard.header.centerY → shares HEADER zone with HubTabStrip.
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: leaderboard.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: leaderboard.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            // 2026-04-30 — collapsed two-sibling title back into one inline-emoji
            // label ('🏆 Leaderboard'). The two-sibling layout overlapped the "L".
            title:           { x: 0,    y: leaderboard.TITLE_Y,    w: 360, h: 44,  type: 'label' },
            // Subtitle line under title — "{mode} · This Week" / "All modes · This Week".
            // 2026-04-29 v2: h 24 → 28 to fit larger subtitle font.
            subtitle:        { x: 0,    y: leaderboard.SUBTITLE_Y, w: 520, h: 28,  type: 'label' },
            // Standalone "This Week" chip on the right of the segmented control.
            // Node name kept as LBTab_season (modeU8=4) so the existing handler still binds.
            // 2026-04-29 v2: ModeTabsContainer (x=-90, asymmetric left-anchored sprite)
            // deleted — runtime LBModePill (built in AppUI._buildSegmentedPill) fully
            // owns the visual; the scene-bound container leaked past the pill's left edge.
            thisWeekChip:    { x: 240,  y: leaderboard.MODE_TABS_Y,  w: 130, h: 42,  type: 'btnGhost' },
            // Hero card for rank #1. AppUI fills entries[0] here and skips LBRow_0.
            // 2026-04-29 v2: slim 88-tall card (was 110 with bulky gold halo). Halo
            // removed at runtime; gold accent now lives in the existing CardEdge strip.
            topPlayerCard:   { x: 0,    y: leaderboard.TOP_PLAYER_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: leaderboard.TOP_PLAYER_H, type: 'group',
                children: {
                    // 2026-04-30 UX polish — rank now flush-left at x=-300 so it
                    // shares the rank column with LBRow_*. Crown moves to the
                    // RIGHT of the rank badge (was at -300, left of the rank).
                    rank:    { x: -300, y: 0,   w: 64,  h: 36, type: 'label' },
                    crown:   { x: -220, y: 0,   w: 32,  h: 32, type: 'label' },
                    player:  { x: -60,  y: 12,  w: 260, h: 28, type: 'label' },
                    elapsed: { x: -60,  y: -14, w: 260, h: 18, type: 'label' },
                    score:   { x: 230,  y: 0,   w: 180, h: 36, type: 'label' },
                },
            },
            // Empty-state cluster (icon + title + subtitle + CTA). _active toggled by AppUI.
            emptyState:      { x: 0,    y: leaderboard.EMPTY_STATE_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 300, type: 'group',
                children: {
                    icon:    { x: 0,    y: 100,  w: 120, h: 120, type: 'label' },
                    title:   { x: 0,    y: -8,   w: 600, h: 32,  type: 'label' },
                    sub:     { x: 0,    y: -42,  w: 600, h: 22,  type: 'label' },
                    cta:     { x: 0,    y: -110, w: 260, h: 60,  type: 'btnPrimary' },
                },
            },
            // Sticky-bottom YOU card — y=-446 keeps it inside the panel after SAFE_AREA_TOP=110 shift.
            // 2026-04-29 v2: h 130 → 148, CTA btnGhost 200×40 → btnPrimary 240×52 to read as
            // "act here" (was reading as a footer the user could ignore).
            personalRankCard: { x: 0,   y: leaderboard.PERSONAL_RANK_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: leaderboard.PERSONAL_RANK_H, type: 'group',
                children: {
                    header: { x: -290, y: 54,  w: 140, h: 18, type: 'label' },
                    rank:   { x: -100, y: 26,  w: 440, h: 28, type: 'label' },
                    stats:  { x: -100, y: -2,  w: 440, h: 22, type: 'label' },
                    cta:    { x: 200,  y: -50, w: 240, h: 52, type: 'btnPrimary' },
                },
            },
            status:          { x: 0,    y: leaderboard.STATUS_Y, w: 600, h: 22,  type: 'label' },
        },
        templates: {
            // 4 mode tabs (segmented control). The 5th season tab is now a
            // standalone right-side chip — see elements.thisWeekChip.
            lbTab: {
                count: 4, w: 120, h: 42, y: leaderboard.MODE_TABS_Y,
                keys:   ['1v1', 'trio', '4p', '8p'],
                labels: ['1v1', 'Trio', '4p', '8p'],
                xs: [-270, -150, -30, 90],
                activeIdx: 0,
            },
            // 9 rank rows. Rank-1 promoted to TopPlayerCard, so this loop fills
            // ranks 2..10 (LBRow_1..LBRow_9). HeightLabel renamed to ScoreLabel.
            // 2026-04-29 v2: row h 56 → 72, gap stride -64 → -76 (4 px between rows),
            // rank w 50 → 64 (clears "#10"), player/score boxes widened, score x
            // 220 → 250 to push " PTS" suffix toward the right edge.
            lbRow: {
                count: 9, w: UNIFORM_LAYOUT.CONTENT_W, h: leaderboard.ROW_H,
                baseY: leaderboard.ROWS_BASE_Y, gapY: leaderboard.ROWS_GAP_Y,
                rank:    { x: -300, y: 0,   w: 64,  h: 36 },
                player:  { x: -110, y: 10,  w: 320, h: 28 },
                score:   { x: 250,  y: 0,   w: 130, h: 32 },
                elapsed: { x: -110, y: -16, w: 320, h: 18 },
            },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
        ],
    },

    /* ───── FIND MATCH ──────────────────────────────────────────────── */
    // Lobby browser. Header (Back/Title/Refresh) + Count + 2 tabs (Open
    // Lobbies / Live Now), then 3 filter rows (Mode/Window/Wager 5 chips
    // each), HideFull toggle, 8 reusable MatchCardRow templates, empty
    // state, Host CTA, Status. Title shrunk and Count repositioned to
    // clear pre-existing overlaps with Back and Tab rows.
    FindMatchPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // 2026-04-30 UX rebuild — full-canvas scrim kills BackgroundFX
            // bleed (parent starfield + violet/green glows). Mirrors
            // HomeContentScrim. MUST render first; sits behind every other
            // FindMatchPanel child. Color = Palette.bg.primary @ alpha 110.
            findMatchContentScrim: { x: 0, y: 0, w: 720, h: 1280, type: 'sprite', notes: 'dim overlay behind content column — kills starfield/violet bleed' },
            // 2026-04-29 god-tier UX rebuild — strict top-to-bottom flow,
            // dominant primary CTA, FilterCard glass container, 4 tall cards
            // per page. All y values resolve from FINDMATCH_LAYOUT so the
            // rhythm cannot drift. The previous layout overlapped title with
            // the Mode pill (both at UNIFORM_HEADER.TITLE_Y=540) and stacked
            // 3 unbounded filter trays with no container — those are gone.
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: FINDMATCH_LAYOUT.HEADER_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: FINDMATCH_LAYOUT.HEADER_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:           { x: 0,    y: FINDMATCH_LAYOUT.TITLE_Y,  w: 400, h: 44, type: 'label',    notes: 'gold bold "FIND A MATCH"; own row, no overlap' },
            refreshBtn:      { x: 280,  y: FINDMATCH_LAYOUT.TITLE_Y,  w: 56,  h: 44, type: 'btnGhost', notes: 'AppUI tween-spins the icon on tap' },
            countLabel:      { x: -80,  y: FINDMATCH_LAYOUT.STATUS_Y, w: 540, h: 22, type: 'label',    notes: 'ambient status — "LIVE SYSTEM . N LOBBIES ACTIVE"; runtime opacity 153' },
            // Top-right level chip; AppUI applies UIOpacity 178 (~70%) so it
            // does not compete with the title for visual weight.
            lvxpChip:        { x: 240,  y: FINDMATCH_LAYOUT.HEADER_Y, w: 200, h: 32, type: 'chip',     notes: '"Lv N · X/Y"; opacity 70% (runtime); hidden when not connected' },
            // Solid green status indicator (replaced 10×10 pulse dot).
            liveCountPulseDot: { x: -300, y: FINDMATCH_LAYOUT.STATUS_Y, w: 14, h: 14, type: 'sprite', notes: 'solid teal status indicator; addSignalFlicker breath; runtime opacity 153' },
            // FilterCard — flat dim section that visually groups 3 filter
            // blocks and the Hide-Full toggle. Subtle bg contrast (alpha ~110),
            // no floating-card edge — reads as a section of the page.
            filterCard:         { x: FINDMATCH_LAYOUT.FILTER_CARD.x, y: FINDMATCH_LAYOUT.FILTER_CARD.y, w: FINDMATCH_LAYOUT.FILTER_CARD.w, h: FINDMATCH_LAYOUT.FILTER_CARD.h, type: 'sprite', notes: 'flat dim section, alpha ~110, single top hairline; no floating-card edge' },
            // 2026-04-30 UX rebuild — label-above-pill block layout. Each
            // filter is a 2-line block: left-anchored caption then a 600w
            // pill spanning the FilterCard. Inter-block gap 16px.
            fmModeLabel:        { x: -300, y: FINDMATCH_LAYOUT.MODE_LABEL_Y,   w: 200, h: 22, type: 'label',  notes: '"Mode" left-anchored caption; sits above Mode pill' },
            fmWindowLabel:      { x: -300, y: FINDMATCH_LAYOUT.WINDOW_LABEL_Y, w: 200, h: 22, type: 'label',  notes: '"Duration" left-anchored caption' },
            fmWagerLabel:       { x: -300, y: FINDMATCH_LAYOUT.WAGER_LABEL_Y,  w: 200, h: 22, type: 'label',  notes: '"Stake" left-anchored caption' },
            segmentMountMode:   { x: 0,    y: FINDMATCH_LAYOUT.MODE_ROW_Y,   w: 600, h: 44, type: 'group',  notes: 'AppUI mounts _buildSegmentedPill (mode tier, 5 segs, w=600) here' },
            segmentMountWindow: { x: -155, y: FINDMATCH_LAYOUT.WINDOW_ROW_Y, w: 290, h: 44, type: 'group',  notes: 'AppUI mounts _buildSegmentedPill (290w, 5 segs, side-by-side w/ wager)' },
            segmentMountWager:  { x:  155, y: FINDMATCH_LAYOUT.WAGER_ROW_Y,  w: 290, h: 44, type: 'group',  notes: 'AppUI mounts _buildSegmentedPill (290w, 5 segs, side-by-side w/ window)' },
            hideFullToggle:     { x: 240,  y: FINDMATCH_LAYOUT.HIDE_FULL_Y,  w: 120, h: 28, type: 'btnPrimary', notes: 'right-anchored utility toggle inside FilterCard' },
            // Primary "FIND MATCH" CTA — dominant, full-width, below filters.
            // Reactivates the pre-existing legacy hostBtn handler wiring; no
            // new behavior. AppUI flips _active=true at start().
            hostBtn:         { x: 0, y: FINDMATCH_LAYOUT.PRIMARY_CTA_Y, w: FINDMATCH_LAYOUT.PRIMARY_CTA_W, h: FINDMATCH_LAYOUT.PRIMARY_CTA_H, type: 'btnPrimary', notes: 'primary CTA — full-width teal; wires to existing _onFindMatchHostTap' },
            // Empty-state cluster (only visible when 0 lobbies match filters).
            emptyMascot:     { x: 0,    y: -50,  w: 200, h: 220, type: 'mascot',  notes: '3rd MascotController; think state on entry' },
            emptyTitle:      { x: 0,    y: -210, w: 600, h: 40,  type: 'label',   notes: 'gold bold "No matches yet"' },
            emptySubtitle:   { x: 0,    y: -260, w: 600, h: 22,  type: 'label',   notes: '"Be the first to host..."' },
            emptyHostBtn:    { x: -135, y: -340, w: 240, h: 64,  type: 'btnPrimary', notes: 'teal — Host New Match (empty-state CTA)' },
            emptyBotBtn:     { x: 135,  y: -340, w: 240, h: 64,  type: 'btnGhost',   notes: 'amber — Play a Bot (empty-state CTA)' },
            // Legacy stubs — hidden at runtime; kept zero-size so existing
            // AppUI bindings (_findMatchTrayMode, etc.) fail silently.
            modeTray:           { x: 0, y: 0, w: 1, h: 1, type: 'sprite', notes: 'LEGACY hidden — FilterCard provides the bg' },
            windowTray:         { x: 0, y: 0, w: 1, h: 1, type: 'sprite', notes: 'LEGACY hidden' },
            wagerTray:          { x: 0, y: 0, w: 1, h: 1, type: 'sprite', notes: 'LEGACY hidden' },
            filterDivider1:     { x: 0, y: 0, w: 1, h: 1, type: 'sprite', notes: 'LEGACY hidden' },
            filterDivider2:     { x: 0, y: 0, w: 1, h: 1, type: 'sprite', notes: 'LEGACY hidden' },
            filterDivider3:     { x: 0, y: 0, w: 1, h: 1, type: 'sprite', notes: 'LEGACY hidden' },
            tabActiveUnderline: { x: 0, y: 0, w: 1, h: 1, type: 'sprite', notes: 'LEGACY — pill renders own underline' },
            tailHintTitle:      { x: 0, y: -2000, w: 600, h: 24, type: 'label',    notes: 'LEGACY hidden' },
            tailHintSubtitle:   { x: 0, y: -2000, w: 600, h: 20, type: 'label',    notes: 'LEGACY hidden' },
            tailResetBtn:       { x: 0, y: -2000, w: 160, h: 40, type: 'btnGhost', notes: 'LEGACY hidden' },
            tailStartBtn:       { x: 0, y: -2000, w: 160, h: 40, type: 'btnGhost', notes: 'LEGACY hidden' },
            emptyLabel:         { x: 0, y: -2000, w: 660, h: 22, type: 'label',    notes: 'LEGACY hidden — superseded by emptyMascot/Title/Subtitle' },
            status:             { x: 0, y: -700,  w: 660, h: 20, type: 'label' },
        },
        templates: {
            // 2026-04-29 god-tier rebuild — tabs widen to 560 for breathing
            // room at the larger fontSize, and shift to FINDMATCH_LAYOUT.TABS_Y
            // so they sit on their own row above the FilterCard (no longer
            // floating inside it).
            fmTab: {
                count: 2, w: 280, h: 46, y: FINDMATCH_LAYOUT.TABS_Y,
                keys:   ['Open', 'Live'],
                labels: ['Open Lobbies', 'Live Now'],
                xs: [-140, 140],
                activeIdx: 0,
            },
            // 2026-04-29 god-tier rebuild — tall card (140h) with 4 internal
            // sub-rows: [mode | stake | type tag], [duration . players],
            // [progress bar], [action button bottom-right]. Resume button is
            // anchored bottom-right at (240, -50, 120, 36) — ~20% smaller
            // than prior Join CTA, no aggressive bounce. 4 cards per page;
            // pagination strip moved below the row pool to y=-380.
            matchRow: {
                count: 8,
                w: UNIFORM_LAYOUT.CONTENT_W,
                h: FINDMATCH_LAYOUT.ROW_HEIGHT,
                baseY: FINDMATCH_LAYOUT.ROW_BASE_Y,
                gapY:  FINDMATCH_LAYOUT.ROW_STRIDE_Y,
                edgeStripe: { x: -332, y: 0,   w: 6,   h: 128 },
                gradient:   { x: 0,    y: 44,  w: UNIFORM_LAYOUT.CONTENT_W, h: 36 },
                glow:       { x: 0,    y: 0,   w: 700, h: 156 },
                mode:       { x: -280, y: 44,  w: 120, h: 28 },
                wager:      { x: 0,    y: 44,  w: 200, h: 30 },
                trackChip:  { x: 260,  y: 44,  w: 72,  h: 26 },
                window:     { x: -280, y: 8,   w: 480, h: 20 },
                sub:        { x: -280, y: 8,   w: 480, h: 20 },
                capBar:     { x: 0,    y: -22, w: 600, h: 12 },
                capBarFill: { x: 0,    y: -22, w: 600, h: 12 },
                join:       { x: 240,  y: -50, w: 120, h: 36 },
            },
        },
        allowedOverlaps: [
            ['MatchCardRow_0', 'MatchCardEdgeStripe_0'],
            ['MatchCardRow_0', 'MatchCardCapBar_0'],
            ['MatchCardRow_0', 'MatchCardCapBarFill_0'],
            ['MatchCardRow_0', 'MatchCardTrackChip_0'],
            ['MatchCardRow_0', 'MatchCardGradient_0'],
            ['MatchCardRow_0', 'MatchCardGlow_0'],
            ['MatchCardCapBar_0', 'MatchCardCapBarFill_0'],
            // Empty-state mascot extends below the row pool's 8th row bbox by design.
            ['MatchCardRow_7', 'FindMatchEmptyMascot'],
            // 2026-04-29 FindMatch UX rebuild: each filter row tray sits behind
            // a SegmentMount (the segmented pill renders inside it).
            ['FindMatchModeTray',   'FindMatchSegmentMountMode'],
            ['FindMatchWindowTray', 'FindMatchSegmentMountWindow'],
            ['FindMatchWagerTray',  'FindMatchSegmentMountWager'],
            // Pulse dot sits inside the count label band by design.
            ['FindMatchCountLabel', 'FindMatchLiveCountPulseDot'],
            // 2026-05-02 arena rebuild — Phase B compaction parks the 3
            // caption labels off-screen at y=-2000. They stack on top of each
            // other but are non-rendering (active=false at runtime + below
            // viewport bottom anyway).
            ['FindMatchModeRowLabel',   'FindMatchWindowRowLabel'],
            ['FindMatchModeRowLabel',   'FindMatchWagerRowLabel'],
            ['FindMatchWindowRowLabel', 'FindMatchWagerRowLabel'],
        ],
    },

    /* ───── JOIN MATCH CONFIRM OVERLAY ──────────────────────────────── */
    // Top-level modal shown when user taps a match card in FindMatchPanel.
    // Full-screen scrim + centered card (600×600) with match summary +
    // Cancel / Go buttons. On Go: clears scrim, sets _pickerJoinTarget, and
    // routes to TokenDuelPanel in join-mode (locked wager + Join CTA).
    JoinMatchConfirmOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // Scrim — full canvas dimmer covering the FindMatchPanel below.
            scrim:        { x: 0,    y: 0,    w: 720, h: 1280, type: 'sprite' },
            // Card — violet-edged hero card centered.
            card:         { x: 0,    y: 0,    w: 620, h: 640,  type: 'sprite' },
            // Card title — "Confirm Join".
            title:        { x: 0,    y: 240,  w: 540, h: 44,   type: 'label' },
            subtitle:     { x: 0,    y: 200,  w: 540, h: 22,   type: 'label' },
            // Mode badge top-left of card (icon + label).
            modeBadge:    { x: -200, y: 130,  w: 160, h: 44,   type: 'chip' },
            modeBadgeLabel: { x: 0,  y: 0,    w: 140, h: 28,   type: 'label' },
            // Track chip top-right (REAL or PAPER).
            trackChip:    { x: 200,  y: 130,  w: 120, h: 36,   type: 'chip' },
            trackChipLabel: { x: 0,  y: 0,    w: 100, h: 22,   type: 'label' },
            // Wager hero — big gold center.
            wagerHero:    { x: 0,    y: 60,   w: 480, h: 60,   type: 'label' },
            // Meta row 1 (window + capacity).
            windowLabel:  { x: -120, y: 0,    w: 220, h: 24,   type: 'label' },
            capacityLabel:{ x: 120,  y: 0,    w: 220, h: 24,   type: 'label' },
            // Meta row 2 (host + age).
            hostLabel:    { x: -120, y: -42,  w: 220, h: 22,   type: 'label' },
            ageLabel:     { x: 120,  y: -42,  w: 220, h: 22,   type: 'label' },
            // Capacity progress bar (fills based on playerCount/required).
            capacityBar:    { x: 0, y: -90,  w: 460, h: 8,    type: 'sprite', notes: 'background track' },
            capacityBarFill:{ x: 0, y: -90,  w: 460, h: 8,    type: 'sprite', notes: 'foreground fill; AppUI tweens scaleX' },
            // CTA buttons — Cancel (ghost) + Go (success teal hero).
            cancelBtn:    { x: -135, y: -210, w: 240, h: 70,   type: 'btnGhost' },
            goBtn:        { x: 135,  y: -210, w: 240, h: 70,   type: 'btnSuccess' },
            hint:         { x: 0,    y: -270, w: 540, h: 20,   type: 'label' },
        },
        // The card sprite + scrim sprite cover most other children's bboxes
        // by design; verifier should ignore.
        allowedOverlaps: [
            ['JoinConfirmScrim',       'JoinConfirmCard'],
            ['JoinConfirmCard',        'JoinConfirmTitleLabel'],
            ['JoinConfirmCard',        'JoinConfirmSubtitleLabel'],
            ['JoinConfirmCard',        'JoinConfirmModeBadge'],
            ['JoinConfirmCard',        'JoinConfirmTrackChip'],
            ['JoinConfirmCard',        'JoinConfirmWagerHeroLabel'],
            ['JoinConfirmCard',        'JoinConfirmWindowLabel'],
            ['JoinConfirmCard',        'JoinConfirmCapacityLabel'],
            ['JoinConfirmCard',        'JoinConfirmHostLabel'],
            ['JoinConfirmCard',        'JoinConfirmAgeLabel'],
            ['JoinConfirmCard',        'JoinConfirmCapacityBar'],
            ['JoinConfirmCard',        'JoinConfirmCapacityBarFill'],
            ['JoinConfirmCard',        'JoinConfirmCancelButton'],
            ['JoinConfirmCard',        'JoinConfirmGoButton'],
            ['JoinConfirmCard',        'JoinConfirmHintLabel'],
            ['JoinConfirmCapacityBar', 'JoinConfirmCapacityBarFill'],
        ],
    },

    /* ───── LIVE STANDINGS OVERLAY ──────────────────────────────────── */
    // 2026-05-02 — opens from the Matches In Progress card details button.
    // Full-canvas scrim + centered card showing every published squad in the
    // race, ranked by current portfolio delta. Up to 10 fixed row slots
    // (covers 1v1 / Trio / 4P / 8P / BR10). AppUI activates only the rows
    // matching the player count.
    LiveStandingsOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            scrim:     { x: 0, y: 0,   w: 720, h: 1280, type: 'sprite' },
            // Tall hero card — needs room for 10 player rows + chrome.
            card:      { x: 0, y: 0,   w: 660, h: 920, type: 'sprite' },
            title:     { x: 0, y: 410, w: 540, h: 40, type: 'label',
                notes: '"Live Standings" — gold bold 28pt' },
            subtitle:  { x: 0, y: 372, w: 580, h: 22, type: 'label',
                notes: 'AppUI fills "{mode} . {time-left} left . fetched {Xs ago}"' },
            divider:   { x: 0, y: 348, w: 600, h: 1, type: 'sprite' },
            // Inline state label sits in the center of the row band — shows
            // "Loading…" then either flips off (rows render) or "Squads not
            // yet published" when board is empty.
            stateLbl:  { x: 0, y: 0,  w: 540, h: 28, type: 'label' },
            // Close CTA at the bottom of the card.
            closeBtn:  { x: 0, y: -400, w: 240, h: 64, type: 'btnGhost',
                notes: 'Centered close. Scrim tap also dismisses.' },
        },
        templates: {
            // 10 row slots; AppUI activates min(playerCount, 10).
            // Row 0 sits at card-local y=300; each subsequent row sits 64px
            // below. Row 9 lands at y=-276 — clears the closeBtn at y=-400.
            standingsRow: {
                count: 10, w: 600, h: 60,
                baseY: 300, gapY: -64,
                // Per-row child positions — relative to the row group center.
                // Rank chip on the far left, name + mints stacked in the
                // middle, PnL % big on the right.
                rank:      { x: -260, y: 0,   w: 44, h: 44 },
                rankLabel: { x: 0,    y: 0,   w: 44, h: 24 },
                name:      { x: -90,  y: 12,  w: 280, h: 22 },
                mints:     { x: -90,  y: -14, w: 280, h: 18 },
                pnl:       { x: 230,  y: 0,   w: 110, h: 32 },
            },
        },
        // Scrim + card sprites cover everything beneath — verifier ignores.
        // Inside each row, the rank chip sits behind its label, name + mints
        // stack vertically (different y), and pnl is far to the right.
        allowedOverlaps: [
            ['LiveStandingsScrim',  'LiveStandingsCard'],
            ['LiveStandingsCard',   'LiveStandingsTitleLabel'],
            ['LiveStandingsCard',   'LiveStandingsSubtitleLabel'],
            ['LiveStandingsCard',   'LiveStandingsDivider'],
            ['LiveStandingsCard',   'LiveStandingsStateLabel'],
            ['LiveStandingsCard',   'LiveStandingsCloseButton'],
            // Synthetic row entries — see LiveStandingsRow block below.
        ],
    },

    // Synthetic row-name entry. Verifier strips suffixes
    // (LiveStandingsRow_3 → LiveStandingsRow). Each row contains rank chip
    // (sprite + label child) + name label + mints label + pnl label.
    LiveStandingsRow: {
        allowedOverlaps: [
            ['LiveStandingsRank', 'LiveStandingsRankLabel'],
        ],
    },

    /* ───── TOKEN DUEL ──────────────────────────────────────────────── */
    // Phase 8a — Static chrome migrated. Squad/Stake/Feed/Popover/
    // TokenDetail still inline pending Phases 8b-8e.
    //
    // Chrome layout: header (Back/Title/action button row at y=720-750),
    // BalanceChip top-right, Search row y=640, Tab+Watchlist+Live row
    // y=590, Filter chips + dropdowns row y=550, FeedColumnHeaders y=505,
    // Status footer y=-740.
    TokenDuelPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // 2026-04-27 v2 — classic stack restored, shifted +45 to align pills
            // with HomePanel; FeedScrollView cut 30%. Every Y derives from `td`.
            //
            // Stack (top→bottom): pills/back (620) · title (570) · MatchSetupCard
            // (485, h=124) · FeedFrameCard (167, h=416) wrapping {Search 345 ·
            // Chips 293 · ColHeaders 255 · FeedScrollView (103, h=272, ~3 visible
            // rows of h=85)} · SquadPanel (-184, h=220: header → 3 slots → wager+Start)
            // · Status (-362). Side padding 16 → cards w=688/696.
            // 2026-04-29: back y override → 685 to sit on par with the top-right action icon cluster (templates.topRowActionBtn at y=685, h=56).
            backLink:           { x: UNIFORM_HEADER.BACK_LINK.x, y: 685, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:             { x: UNIFORM_HEADER.BACK_BTN.x,  y: 685, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            // 2026-04-29 token-picker rebuild — title overrides UNIFORM_HEADER.TITLE_Y
            // (540) to sit at td.TITLE_Y(560) and bumps font 30→34 (rendered via h:48
            // box) so it reads as the page-owning headline and is not visually swallowed
            // by the match setup card directly beneath it. The "TOKEN DUEL · 1V1" mode
            // tag inside the card is dropped — title carries the mode now.
            title:              { x: 0,    y: td.TITLE_Y,         w: 360, h: 48, type: 'label' },
            // 2026-05-02 token-picker UX — eyebrow caption below title fills the
            // empty band between the gold headline and the MatchSetupCard, so
            // the page reads as "Draft your squad" instead of a floating logo.
            // 14pt UNIFORM_TEXT.DIM_COLOR, narrow column, +2 letter spacing.
            subtitle:           { x: 0,    y: 520, w: 480, h: 18, type: 'label',
                notes: '2026-05-02 — DRAFT YOUR SQUAD eyebrow under title; replaces headerUnderline as the visual band separator.' },
            // 2026-05-02 — moved off-canvas; the new subtitle eyebrow above the
            // matchSetupCard occupies the same band visually, so the 1-px hairline
            // is redundant. Kept as a placeholder for any old AppUI lookups.
            headerUnderline:    { x: -2000, y: -2000, w: 1, h: 1, type: 'sprite',
                notes: '2026-05-02 — superseded by subtitle eyebrow.' },
            // 2026-04-27 v3: pills shrunk further (278×54 → 140×44; 195×54 → 140×44)
            // and right-clustered so both sit on the right half of the canvas with
            // the icon row above them.
            levelPill:          { x: 120, y: td.HEADER_Y,  w: 140, h: 44, type: 'chip',    notes: '2026-04-30 right-zone cluster: x 85->120.' },
            solPill:            { x: 265, y: td.HEADER_Y,  w: 140, h: 44, type: 'chip',    notes: '2026-04-30 right-zone cluster: x 255->265.' },
            // MatchSetupCard — compact summary directly under title.
            // 2026-04-29b flagship rebalance — h 80→64; orientation hint, not
            // hero. Card hosts Squad/Stake row (top) + Hint (bottom) at tighter
            // vertical offsets (re-anchored by AppUI._refreshSquadActionButtons).
            matchSetupCard:     { x: 0,    y: td.MATCHSETUP_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: td.MATCHSETUP_CARD_H, type: 'group',
                notes: 'Match summary card; 3 child labels (squad/stake/hint) populated by AppUI._refreshSquadActionButtons. h=64 — orientation hint only.' },
            // Thin glowing underline at the bottom edge of matchSetupCard.
            // AppUI tints teal + breathes when squad full, mid-grey when picking.
            // y = matchSetupCard.y - matchSetupCard.h/2 + 1 = 470 - 32 + 1 = 439.
            matchSetupReadyGlow:{ x: 0,    y: 439, w: UNIFORM_LAYOUT.CONTENT_W, h: 2, type: 'sprite',
                notes: 'ready-state underline; tinted by AppUI on squad full' },
            // FeedFrameCard — wraps in-card UI. Bottom shrinks with cut feed h.
            feedFrameCard:      { x: 0,    y: td.FEED_FRAME_Y,  w: 712, h: td.FEED_FRAME_H, type: 'sprite',
                notes: 'unified card behind Row 1 + Row 2 + col headers + feed' },
            // 2026-04-29 token-picker rebuild — Row 1 (search row) re-balanced so
            // dropdown / search / star / LIVE share the 680-px content column with
            // 12-px gaps and no overlap. Search gets priority width (332). LIVE
            // sits flush against the safe right edge instead of overflowing.
            // Layout L→R: dropdown(180) | gap | search(332) | gap | star(44) | gap | live(80)
            search:             { x: 18,   y: td.SEARCH_Y, w: 360, h: 60, type: 'editbox' },
            searchClear:        { x: 192,  y: td.SEARCH_Y, w: 36,  h: 36, type: 'btnGhost' },
            feedTabDropdown:    { x: -260, y: td.SEARCH_Y, w: 180, h: 60, type: 'btnGhost' },
            watchlistStar:      { x: 240,  y: td.SEARCH_Y, w: 52,  h: 52, type: 'btnGhost', notes: 'icon-only ★ button (no text)' },
            cancelWatchlist:    { x: 240,  y: td.SEARCH_Y, w: 44,  h: 44, type: 'btnGhost' },
            liveIndicator:      { x: 312,  y: td.SEARCH_Y, w: 80,  h: 28, type: 'label' },
            minLiqDropdown:     { x: -16,  y: td.CHIPS_Y, w: 110, h: 32, type: 'chip' },
            columnsBtn:         { x: 270,  y: td.CHIPS_Y, w: 96,  h: 32, type: 'chip' },
            feedColumnHeaders:  { x: 0,    y: td.COL_HEADERS_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 24, type: 'group' },
            // FeedScrollView — 2026-04-27 v2: h 388→272 (30% cut). Top y=239.
            feedScrollView:     { x: 0,    y: td.FEED_SCROLL_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: td.FEED_SCROLL_H, type: 'scrollview',
                notes: 'h cut 30% (388→272). ~3 visible rows at h=85.' },
            // 2026-05-01 squad-select pass — soft ambient halo behind the slot
            // row so the squad section reads as an illuminated drop-zone band,
            // not a flat container. Single static sprite (no Graphics — keeps
            // SIGSEGV risk at zero). Tinted 50/50 violet+teal at low alpha.
            // Insertion BEFORE squadPanel so it renders behind the slot cards.
            squadAmbientGlow:   { x: 0,    y: td.SQUAD_SLOTS_Y, w: 720, h: 220, type: 'sprite',
                notes: '2026-05-01 — soft violet+teal halo behind squad slots; alpha 0x28' },
            // SquadPanel restored to bottom; same internal layout as legacy (header →
            // 3 slots → wager row), shifted up so the gap to feed bottom matches legacy.
            squadPanel:         { x: 0,    y: td.SQUAD_PANEL_Y, w: 720, h: td.SQUAD_PANEL_H, type: 'group',
                notes: '2026-04-30 — full-width container (was CONTENT_W=712 leaving side gaps on 720 canvas).' },
            // 2026-05-01 r2 — hero squad header band scaled up. Eyebrow font
            // 11→16 (h 14→22), label font 22→30 (h 28→38), so the section
            // reads as the page's primary objective marker. Rule slides down
            // to clear the bigger label bottom.
            squadHeaderEyebrow: { x: 0,    y: td.SQUAD_HEADER_Y + 32, w: 360, h: 18, type: 'label',
                notes: '2026-05-01 r2.1 — N/3 SELECTED eyebrow, 16pt; offset 32 from header so eyebrow top clears feed-scroll bottom -75 by 4 px.' },
            squadHeaderLabel:   { x: 0,    y: td.SQUAD_HEADER_Y, w: 460, h: 38, type: 'label',
                notes: '2026-05-01 r2 — YOUR SQUAD hero label, 30pt bold (was 22pt). Page primary objective marker.' },
            squadHeaderRule:    { x: 0,    y: td.SQUAD_HEADER_Y - 30, w: 240, h: 1,  type: 'sprite',
                notes: '2026-05-01 r2.1 — rule offset 30 below header center so it clears the bigger label bottom + sits 6 px above slot top.' },
            // 2026-05-01 r3 — stake control rebuilt AGAIN: half-width
            // CHUNKY pill (320w × 84h) CENTERED below the CTA, single-line
            // "0.05 SOL  ▾" label at 32pt gold bold. Helper text gets its
            // OWN row below the pill (no more side-by-side overlap with
            // status label or pill). Always shown, with state-based copy
            // (one label only, never two competing).
            wagerRowDivider:    { x: 0,    y: -388, w: 680, h: 1, type: 'sprite',
                notes: '2026-05-02 token-picker UX — moved up 12 px to clear new taller CTA top edge (-400). 12 px below squad ambient bottom (-376), 12 px above CTA top (-400).' },
            wagerStartButton:   { x:    0, y: -444, w: 640, h: 88, type: 'btnPrimary',
                notes: '2026-05-02 token-picker UX — h 64→88 for more gravity on the primary action; y -456→-444 keeps halo bottom (-500) at the same 6-px clearance above stake-pill top (-506).' },
            // betting-duel ($SKR): split the stake pill into a side-by-side
            // currency-picker + amount-picker pair, both centered as a unit.
            // Currency button (-130) sits left of amount button (+130); each
            // 240→200 wide so the two pills + 60 px gap = 460 width fits in the
            // 640 grid above. Y stays at -542 so the row alignment under the CTA
            // halo doesn't shift.
            wagerCurrencyButton:{ x: -130, y: -542, w: 200, h: 72, type: 'btnGhost',
                notes: 'betting-duel ($SKR) — left half of the stake pill row. Caption "WAGER IN", body shows currency code + ▾. Click toggles `_wagerCurrencyDropdown`.' },
            wagerValueButton:   { x: +130, y: -542, w: 200, h: 72, type: 'btnGhost',
                notes: 'betting-duel ($SKR) — right half of the stake pill row. Caption "WAGER", body shows tier amount + currency + ▾. Was centered (x=0, w=240); shrunk to 200 / shifted right to make room for the new currency picker.' },
            wagerLockChip:      { x: +130, y: -542, w: 200, h: 72, type: 'chip',       notes: '2026-05-02 Pass 2 — mirrors stacked stake pill (JOIN MODE). x/w match wagerValueButton.' },
            wagerBotChip:       { x: +130, y: -542, w: 200, h: 72, type: 'chip',       notes: '2026-05-02 Pass 2 — mirrors stacked stake pill (BOT MODE). x/w match wagerValueButton.' },
            wagerHintLabel:     { x:    0, y: -616, w: 600, h: 28, type: 'label',      notes: '2026-05-01 r3 — own row BELOW the stake pill (y -616, gap 26 px below pill bottom -590). Always visible with state-based copy (Pick X more / Squad ready). Centered.' },
            wagerDropdown:      { x: +130, y: -380, w: 360, h: 360, type: 'group',
                notes: 'betting-duel — anchor follows wagerValueButton (right column).' },
            wagerCurrencyDropdown: { x: -130, y: -380, w: 240, h: 130, type: 'group',
                notes: 'betting-duel — currency picker popover, anchored above wagerCurrencyButton. 2 rows (SOL + SKR).' },
            // 8c — Legacy stake cluster (kept for node-name bindings; force-hidden
            // at scene-gen so verifier sees real state. AppUI._hideLegacyBettingDuelNodes
            // is belt-and-suspenders.)
            stakeHeaderLabel:   { x: 0,    y: -395, w: 280, h: 18, type: 'label',     notes: 'LEGACY — _active=false' },
            stakeValueLabel:    { x: 0,    y: -420, w: 300, h: 28, type: 'label',     notes: 'LEGACY — _active=false' },
            stakeSlider:        { x: 0,    y: -455, w: 560, h: 14, type: 'slider',    notes: 'LEGACY — _active=false' },
            stakeCommitButton:  { x: 0,    y: -580, w: 620, h: 56, type: 'btnPrimary',notes: 'LEGACY — _active=false; same slot as start/claim' },
            startGameButton:    { x: 0,    y: -580, w: 620, h: 56, type: 'btnPrimary',notes: 'LEGACY — _active=false; alternates with commit' },
            claimPayoutButton:  { x: 0,    y: -580, w: 620, h: 56, type: 'btnPrimary',notes: 'LEGACY — _active=false; alternates with commit' },
            holding1Label:      { x: 0,    y: -550, w: 200, h: 50, type: 'label',     notes: 'LEGACY — _active=false; AppUI also empties _holdingLabels[]' },
            holding2Label:      { x: 0,    y: -550, w: 200, h: 50, type: 'label',     notes: 'LEGACY — _active=false' },
            holding3Label:      { x: 0,    y: -550, w: 200, h: 50, type: 'label',     notes: 'LEGACY — _active=false' },
            // 8c — Game overlay (paper-match flow — inactive on betting-duel).
            gameArea:           { x: 0,    y: 0,    w: 720, h: 1000, type: 'group',  notes: 'LEGACY — _active=false; full-panel container for tower/HUD' },
            gameOverLabel:      { x: 0,    y: 0,    w: 680, h: 180,  type: 'label',  notes: 'LEGACY — _active=false; full-panel overlay' },
            status:             { x: 0,    y: -2000, w: 688, h: 26, type: 'label',
                notes: '2026-05-01 r3 — moved OFF-CANVAS. AppUI._refreshBottomHelperText keeps it empty; _wagerHintLabel is now the canonical bottom-row state copy.' },
            // 8d — popover containers + their internal labels/buttons. Each
            // popover is _active=false by default; AppUI toggles per-event.
            // Anchors follow their triggers — Δy = +45 from legacy.
            searchSuggestionPopover: { x: -30, y: 390,  w: 560, h: 300, type: 'group',
                notes: 'y = search.y(345) + 45 = 390' },
            feedTabDropdownPopover:  { x: -200, y: 180, w: 240, h: 304, type: 'group',
                notes: 'opens DOWN of FeedTabDropdownButton; y = feedTabDropdown.y(345) - 165 = 180' },
            minLiqDropdownPopover:   { x: -32,  y: 197, w: 120, h: 180, type: 'group',
                notes: 'y = minLiqDropdown.y(293) - 96 = 197' },
            liqSortDropdownPopover:  { x: -160, y: 197, w: 140, h: 100, type: 'group',
                notes: 'opens DOWN from "Liquidity ▾" chip; y = chips.y(293) - 96 = 197' },
            columnsPopover:          { x: 235,  y: 85,  w: 170, h: 360, type: 'group',
                notes: 'opens DOWN-LEFT of ColumnsButton; y = chips.y(293) - 208 = 85' },
            columnsPopoverHint:      { x: 10,   y: -164, w: 160, h: 20, type: 'label',
                notes: 'rel to columnsPopover center; y = colPopStartY(160) - 10*colPopRowH(32) - 4' },
            // SquadDropOverlay — full-panel modal (3 pills from squadDropPill template).
            squadDropOverlay:        { x: 0, y: 0,   w: 720, h: 1280, type: 'group' },
            squadDropTitle:          { x: 0, y: 200, w: 400, h: 22,   type: 'label' },
            squadDropHint:           { x: 0, y: 150, w: 460, h: 18,   type: 'label' },
            // SquadPresetsOverlay — full-panel modal (5 rows + Save + PresetNameModal).
            squadPresetsOverlay:     { x: 0, y: 0,    w: 720, h: 1280, type: 'group' },
            presetsScrim:            { x: 0, y: 0,    w: 720, h: 1280, type: 'btnGhost',
                notes: 'tap-outside-close button; rendered first so child rows sit on top' },
            presetsTitle:            { x: 0, y: 460,  w: 500, h: 34,   type: 'label' },
            presetsHint:             { x: 0, y: 425,  w: 520, h: 18,   type: 'label' },
            presetsSaveButton:       { x: 0, y: -100, w: 420, h: 56,   type: 'btnPrimary' },
            presetsEmptyLabel:       { x: 0, y: -20,  w: 600, h: 22,   type: 'label' },
            presetsModal:            { x: 0, y: -30,  w: 460, h: 200,  type: 'group',
                notes: 'PresetNameModal — child of presets overlay, hidden until Save tapped' },
            presetsModalTitle:       { x: 0,    y: 70,  w: 420, h: 24, type: 'label' },
            presetsModalEditBox:     { x: 0,    y: 20,  w: 400, h: 44, type: 'editbox' },
            presetsModalSave:        { x: -100, y: -50, w: 180, h: 44, type: 'btnPrimary' },
            presetsModalCancel:      { x: 100,  y: -50, w: 180, h: 44, type: 'btnGhost' },
            // Invisible full-panel tap-outside catcher; rendered below popovers.
            backdropButton:          { x: 0, y: 0, w: 720, h: 1280, type: 'btnGhost' },
            // 2026-04-27 — Row-tap popover (Pick + / View Chart). Repositioned
            // at runtime by AppUI to anchor near the tapped row.
            rowActionPopover:        { x: 0, y: 0,  w: 260, h: 110, type: 'group',
                notes: 'shown when a feed row is tapped in default mode; 2 buttons stacked' },
            rowActionPickBtn:        { x: 0, y:  26, w: 240, h: 44, type: 'btnPrimary' },
            rowActionChartBtn:       { x: 0, y: -26, w: 240, h: 44, type: 'btnGhost' },
        },
        templates: {
            // 4 top-row icon buttons — 64×56 each, stride 76. 2026-04-27 v3:
            // y 720→685 (drop above pill row at 620); xs shifted left 30 so
            // the rightmost icon's right edge sits ~30 px from the canvas edge.
            topRowActionBtn: {
                count: 4, w: 64, h: 56, y: 685,
                names:  ['OpenSettingsButton', 'OpenSquadPresetsButton',
                         'SuggestSquadButton', 'HelpButton'],
                labels: ['', '', '', '?'],
                xs:     [70, 146, 222, 298],
            },
            // Sort chips — 2-chip row: [Newest] [Liquidity ▾]. The Liq↓ + Liq↑
            // chips collapsed into a single 'liq' chip that opens
            // liqSortDropdownPopover (mirrors the minLiqDropdown pattern).
            // Filter row reads: [Newest] [Liquidity ▾] [All ▾] ........ [⋮ Cols]
            // ([All ▾] = minLiqDropdown, [⋮ Cols] = columnsBtn — both in elements above.)
            feedFilterChip: {
                count: 2, w: 110, h: 32, y: td.CHIPS_Y,
                keys:   ['newest', 'liq'],
                labels: ['Newest', 'Liquidity ▾'],
                xs:     [-272, -144],
            },
            // 6 column headers (was 7 — Age dropped in 2026-04-26 redesign).
            // Widths kept narrow so headers don't bbox-overlap each other.
            feedColHeader: {
                count: 6, h: 24,
                cols: [
                    { key: 'Token',  text: 'TOKEN',  x: -262, w: 160, align: 0 },
                    { key: 'Score',  text: 'SCORE',  x: 30,   w: 50,  align: 1 },
                    { key: 'Liq',    text: 'LIQ',    x: 90,   w: 40,  align: 1 },
                    { key: 'Vol',    text: 'VOL',    x: 150,  w: 40,  align: 1 },
                    { key: 'Change', text: '24H',    x: 220,  w: 50,  align: 1 },
                    { key: 'Price',  text: 'PRICE',  x: 295,  w: 60,  align: 2 },
                ],
            },
            // 2026-04-29b flagship rebalance — row h 148→120 (within 112-128
            // target), logo 96→64 (avatar never blocks text), checkbox moved
            // into a true 28-px LEFT GUTTER (x=-322) so the selected indicator
            // no longer floats over the avatar. Stride 156→128 (row h + 8 gap).
            // Feed feels compact enough for the squad section to read as the
            // page's main objective.
            //
            // Two-line layout:
            //   Top line    (y=+18): [☐ gutter] [logo 64×64] [SYMBOL bold]  [Score]  [+24H%]
            //   Bottom line (y=-18):                         [name · mint muted]  [Liq] [Vol] [Price]
            //
            // Stride = h(120) + 8 gap = 128. baseY = -60 so first row centers at
            // content y=0. AppUI's _renderFeedRows right-aligns change/delta
            // labels (_horizontalAlign = 2) so the percentage anchors at x=+299.
            // 2026-05-01 squad-select pass — feed rows shrink so the squad
            // section becomes the page's primary objective. h 140→120 (back
            // inside the original 112-128 target window), stride 148→130
            // (10-px gap). Logo 72→60, hero 24h% font 30→26 (set at runtime).
            // Selected state: SelectedEdge widens 4→6, alpha 180→255, with a
            // faint teal row-bg wash + 1.02 scale pop applied in AppUI's
            // _renderFeedRows.
            feedRow: {
                count: 20, w: UNIFORM_LAYOUT.CONTENT_W, h: 120,
                baseY: -60, gapY: -130,
                selectedEdge: { x: -340, y: 0,   w: 6,  h: 112, notes: '2026-05-01 — widened 4→6 + alpha 255 (was 180) when selected' },
                checkbox:     { x: -322, y: 0,   w: 24, h: 24,  notes: 'left gutter tappable affordance' },
                checkmark:    { x: 0,    y: 1,   w: 22, h: 22 },
                logo:         { x: -276, y: 0,   w: 60, h: 60,  notes: '2026-05-01 — slimmed 72→60 to recede with shorter row' },
                symbol:       { x: -126, y: 22,  w: 200, h: 28, notes: '2026-05-01 — y 28→22 for tighter vertical rhythm; x -114→-126 to clear smaller logo' },
                name:         { x: -126, y:  -2, w: 228, h: 18, notes: '2026-05-01 — y 4→-2; x -114→-126' },
                scoreBadge:   { x: -114, y: -34, w: 56,  h: 24, notes: 'rounded bg sprite; wraps scoreLabel; tinted by score band' },
                score:        { x: -114, y: -34, w: 56,  h: 24, notes: '14pt bold, color by band; shares scoreBadge coords' },
                change:       { x: 280,  y: 18,  w: 110, h: 32, notes: '2026-05-01 — y 28→18, font 30→26 (set in AppUI)' },
                delta:        { x: 280,  y: 18,  w: 110, h: 32, notes: 'alternate of change — _active=false' },
                liq:          { x: -36,  y: -34, w: 70,  h: 18, notes: '14pt mid-grey' },
                vol:          { x:  50,  y: -34, w: 70,  h: 18, notes: '14pt mid-grey' },
                price:        { x: 280,  y: -34, w: 110, h: 18, notes: 'gold mono, right-aligned, 14pt' },
                age:          { x: -2000, y: 0,  w: 1, h: 1 },
                dex:          { x: -2000, y: 0,  w: 1, h: 1 },
                liveDot:      { x: 320,  y: -50, w: 8,  h: 8 },
                squadBadge:   { x: 30,   y: 22,  w: 90, h: 22, notes: '2026-05-02 — "IN SQUAD" pill; right of $SYMBOL, top row. AppUI toggles _active per row.' },
                squadBadgeLabel: { x: 0, y: 0,   w: 90, h: 22, notes: 'sits centered inside squadBadge sprite (parent-relative).' },
            },
            // Squad action row — restored 2026-04-26. +Pick re-enters multi-pick
            // mode (still useful when tapping rows isn't ergonomic on small
            // viewports), Manage Squad opens the SquadDropOverlay. Both sit
            // INSIDE the squadPanel, just above the YOUR SQUAD header.
            // 2026-04-26 — Pick / Manage Squad globals removed. Each empty
            // slot now reads 'Pick +' and acts as the per-slot pick affordance;
            // the per-slot × button replaces Manage Squad. Template kept with
            // count: 0 so generate-scenes.js's existing loop produces nothing.
            squadActionBtn: {
                count: 0, w: 180, h: 32, y: -256,
                names:  [],
                labels: [],
                xs:     [],
                colors: [],
                bold:   [],
            },
            // 3 squad slots — 2026-05-01 r2: pillar cards grown again
            // h 172→220 (+48) so they fill the squad container with no
            // dead space below. Internal layout re-anchored for the taller
            // card. Halo grows 188h→236h (still 12 px taller than card).
            squadSlot: {
                count: 3, w: 222, h: 220, y: td.SQUAD_SLOTS_Y,
                xs: [-238, 0, 238],
                glowHalo:   { x:   0, y:    0, w: 244, h: 236, notes: '2026-05-01 r2 — 12px wider/taller than card; behind bg; alpha 0 default, tinted by AppUI on state change' },
                slotIndex:  { x:   0, y:   92, w: 200, h: 16  },
                silhouette: { x:   0, y:    0, w: 128, h: 128, notes: '2026-05-01 r2 — centered for taller card; alpha-pulsed by AppUI' },
                logo:    { x: -78, y:   70, w: 56,  h: 56  },
                symbol:  { x:  16, y:   74, w: 130, h: 24  },
                delta:   { x:   0, y:   12, w: 200, h: 36  },
                score:   { x: -88, y:  -76, w: 56,  h: 16  },
                perfBar: { x:   0, y: -104, w: 196, h: 4   },
                removeBtn: { x: 88, y:  88, w: 28, h: 28, notes: '2026-05-01 r2 — top-right X button; AppUI hides when slot empty' },
            },
            // 8c — 3 legacy stake preset chips at y=-515. LEGACY — _active=false.
            stakeChip: {
                count: 3, w: 160, h: 40, y: -515,
                names:  ['StakeChip_001', 'StakeChip_010', 'StakeChip_100'],
                labels: ['0.001',         '0.01',          '0.1'],
                xs:     [-220, 0, 220],
            },
            // 9b — 5 search-suggestion rows inside SearchSuggestionPopover.
            // Hidden until user types in the search edit box. mint.x shifted
            // -130→-115, w 220→200 so its bbox left x=-215 clears Logo
            // right x=-226 (was 14 px overlap).
            suggestRow: {
                count: 5, w: 540, h: 50,
                rowH: 54, baseY: 115, gapY: -54,
                logo:   { x: -240, y: 0,   w: 28,  h: 28 },
                symbol: { x: -130, y: 8,   w: 170, h: 22 },
                mint:   { x: -115, y: -12, w: 200, h: 18 },
                price:  { x: 150,  y: 8,   w: 90,  h: 22 },
                vol:    { x: 240,  y: 8,   w: 60,  h: 22 },
                change: { x: 200,  y: -12, w: 100, h: 18 },
            },
            // 8c — 8 wager dropdown rows; hidden until WagerValueButton tapped.
            // Display order: ascending $$ then INTRO last (per ModeDefs.WAGER_DISPLAY_TO_TIER).
            // Last row (INTRO) gets gold-tint sprite + label color at scene-gen.
            wagerDropdownRow: {
                count: 8, rowH: 42, padding: 12, w: 340, h: 38,
                labels: ['0.01 SOL', '0.05 SOL', '0.1 SOL', '0.25 SOL',
                         '0.5 SOL',  '1 SOL',    '5 SOL',   '0.001 · INTRO'],
            },
            // betting-duel ($SKR) — currency picker popover rows. AppUI swaps
            // the wagerDropdownRow labels at runtime when SKR is selected
            // (100/500/1k/5k/10k/25k SKR — see WagerCurrency.ts).
            wagerCurrencyDropdownRow: {
                count: 2, rowH: 50, padding: 12, w: 220, h: 46,
                labels: ['SOL', 'SKR'],
            },
            // 8d — popover row/option templates.
            // 6 feed-tab options stacked top-to-bottom (50-px stride).
            feedTabOption: {
                count: 6, w: 224, h: 40,
                keys:   ['new', 'trending', 'gainers', 'volume', 'smart', 'watchlist'],
                labels: ['New Pairs', 'Trending', 'Top Gainers', 'Top Volume', 'Smart Money', 'Watchlist'],
                ys:     [126, 76, 26, -24, -74, -124],
            },
            // 4 min-liq options stacked (48-px stride).
            minLiqOption: {
                count: 4, w: 108, h: 38,
                keys:   ['all', '1k', '5k', '10k'],
                labels: ['All', '$1K+', '$5K+', '$10K+'],
                ys:     [72, 24, -24, -72],
            },
            // 2 liquidity-sort options inside LiqSortDropdownPopover.
            // Replaces the old standalone Liq↓ / Liq↑ chips.
            liqSortOption: {
                count: 2, w: 124, h: 38,
                keys:   ['liq_desc', 'liq_asc'],
                labels: ['Liq High → Low', 'Liq Low → High'],
                ys:     [24, -24],
            },
            // 10 column-toggle rows. AppUI prefixes label with "✓ " when active.
            columnsToggle: {
                count: 10, w: 154, h: 30,
                keys:   ['score', 'liq', 'vol', 'change', 'age', 'mc', 'fdv', 'price', 'holders', 'source'],
                labels: ['Score', 'Liq', 'Vol', '24h', 'Age', 'MC', 'FDV', 'Price', 'Holders', 'DEX'],
                startY: 160, rowH: 32,
            },
            // 3 drop pills inside SquadDropOverlay (60-px stride).
            squadDropPill: {
                count: 3, w: 420, h: 48,
                ys: [60, 0, -60],
            },
            // 5 preset rows inside SquadPresetsOverlay. Internal layout:
            // name (top-left) + symbols (bottom-left) + delete button (right).
            presetRow: {
                count: 5, w: 600, h: 56,
                ys: [360, 290, 220, 150, 80],
                name:      { x: -270, y: 10,  w: 360, h: 26 },
                symbols:   { x: -270, y: -12, w: 360, h: 20 },
                deleteBtn: { x: 260,  y: 0,   w: 48,  h: 44 },
            },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
            // 8b alternates: only one of each pair is _active at a time so the
            // visible overlap is harmless.
            ['ChangeLabel',   'DeltaLabel'],     // % bucket alternates
            ['LogoSprite',    'CheckboxSprite'], // watchlist toggle alternates
            ['LogoSprite',    'CheckmarkIcon'],  // CheckmarkIcon lives inside CheckboxSprite
            // Phase A — WagerLockChip / WagerBotChip / WagerValueButton share
            // the same bbox by design; only one is _active per picker mode
            // (create vs join vs bot). Verifier should ignore.
            ['WagerValueButton', 'WagerLockChip'],
            ['WagerValueButton', 'WagerBotChip'],
            ['WagerLockChip',    'WagerBotChip'],
            // 2026-04-27 UI overhaul — pillar squad cards: GradientTop sprite
            // covers the upper half of the card and is intentionally drawn
            // beneath the SymbolLabel; verifier should ignore the bbox overlap.
            ['GradientTop', 'SymbolLabel'],
            // 2026-04-27 UI overhaul — Start Match button blue→violet gradient
            // overlay sits beneath the bevel highlight + label by design.
            ['GradientRight', 'TopHighlight'],
            ['GradientRight', 'BottomShadow'],
            ['GradientRight', 'Label'],
            // 2026-05-01 squad-select pass — squadAmbientGlow is a decorative
            // backdrop sprite (rendered BEFORE squadPanel + slot cards in the
            // panel children list, alpha 0x28) that intentionally bleeds
            // behind the squad panel bg, the section header band, and all 3
            // slot cards. Whitelisted because the bleed IS the desired effect.
            ['SquadAmbientGlow', 'SquadPanel'],
            ['SquadAmbientGlow', 'SquadHeaderLabel'],
            ['SquadAmbientGlow', 'SquadHeaderRule'],
            ['SquadAmbientGlow', 'SquadSlot_0'],
            ['SquadAmbientGlow', 'SquadSlot_1'],
            ['SquadAmbientGlow', 'SquadSlot_2'],
            // Per-slot SlotGlowHalo (rendered behind slot bg) overlaps every
            // child inside the slot card by design — it's the back layer.
            ['SlotGlowHalo', 'SlotIndexLabel'],
            ['SlotGlowHalo', 'SilhouettePlus'],
            ['SlotGlowHalo', 'LogoSprite'],
            ['SlotGlowHalo', 'SymbolLabel'],
            ['SlotGlowHalo', 'DeltaLabel'],
            ['SlotGlowHalo', 'ScoreBadge'],
            ['SlotGlowHalo', 'PerformanceBar'],
            ['SlotGlowHalo', 'RemoveButton'],
            ['SlotGlowHalo', 'GradientTop'],
            // 2026-05-01 — bottom row reorganized as a centered inline pair:
            // pill (140w) + helper text (360w) sit shoulder-to-shoulder under
            // the CTA. Bbox brushes overlap by design — they read as one
            // commitment group.
            // 2026-05-01 r3 — stake pill and hint moved to separate rows; no
            // longer overlap each other. StatusLabel moved off-canvas so no
            // longer overlaps anything either.
            // 2026-05-02 token-picker UX — DRAFT YOUR SQUAD eyebrow caption
            // sits inside the TitleBgSprite black band by design (the band
            // wraps the title-and-eyebrow header band, not just the title).
            ['TitleBgSprite', 'TokenDuelSubtitle'],
            // 2026-05-02 — legacy MatchSetupSquadLabel + MatchSetupStakeLabel
            // both moved to the same off-canvas placeholder; shared bbox is
            // intentional placeholder, not a visible collision.
            ['MatchSetupSquadLabel', 'MatchSetupStakeLabel'],
        ],
    },

    /* ───── PORTFOLIO ───────────────────────────────────────────────── */
    // Dashboard redesign (foamy-sphinx): hero P/L card anchors the page,
    // secondary stats grouped into Performance + Activity sections, XP
    // progress bar replaces flat XP number, empty state shown when zero
    // games. Tab hierarchy clarified — primary segmented control on top,
    // secondary Paper/Real toggle below with MODE eyebrow label.
    PortfolioPanel: {
        canvas: { w: 720, h: 1280 },
        // 2026-04-29 v2 — HubTabStrip (Portfolio | Leaderboard) is built at
        // runtime by AppUI._buildHubTabs at panel-local y=720 (h=56). It's the
        // visible top of this panel; generator's computePanelTopEdge() picks
        // up RUNTIME_TOP_EDGE to align with other panels.
        RUNTIME_TOP_EDGE: 748,
        elements: {
            historyView: { x: 0, y: 0, w: 720, h: 1280, type: 'group',
                notes: 'PortfolioHistoryView container; hidden until History tab active' },
            // 2026-04-29: back y derived from DashboardLayoutSpec.portfolio.header.centerY → shares HEADER zone with HubTabStrip.
            backLink: { x: UNIFORM_HEADER.BACK_LINK.x, y: portfolio.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:  { x: UNIFORM_HEADER.BACK_BTN.x,  y: portfolio.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:    { x: 0,    y: portfolio.TITLE_Y, w: 400, h: 44, type: 'label' },
            // Subtitle eyebrow under title.
            subtitle:    { x: 0,    y: portfolio.SUBTITLE_Y, w: 460, h: 18, type: 'label' },
            pubkeyLabel: { x: 0,    y: portfolio.PUBKEY_Y,   w: 460, h: 24, type: 'label' },
            // Primary tabs — full-width segmented control.
            statsTab:    { x: -200, y: portfolio.TABS_Y, w: 200, h: 48, type: 'btnPrimary' },
            historyTab:  { x: 0,    y: portfolio.TABS_Y, w: 200, h: 48, type: 'btnGhost' },
            trophiesTab: { x: 200,  y: portfolio.TABS_Y, w: 200, h: 48, type: 'btnGhost' },
            // Secondary mode toggle — smaller, with MODE eyebrow above.
            modeLabel:   { x: 0,    y: portfolio.MODE_LABEL_Y,  w: 100, h: 16, type: 'label' },
            paperTab:    { x: -75,  y: portfolio.MODE_TOGGLE_Y, w: 130, h: 36, type: 'btnPrimary' },
            realTab:     { x: 75,   y: portfolio.MODE_TOGGLE_Y, w: 130, h: 36, type: 'btnGhost' },
            // Group eyebrow headers (left-aligned).
            groupHeaderPerformance: { x: -290, y: portfolio.GROUP_PERF_Y,     w: 200, h: 16, type: 'label' },
            groupHeaderActivity:    { x: -290, y: portfolio.GROUP_ACTIVITY_Y, w: 200, h: 16, type: 'label' },
            // Empty-state container — shown when zero games (hides hero/groups).
            emptyState:         { x: 0,    y: portfolio.EMPTY_STATE_Y, w: 600, h: 400, type: 'group' },
            emptyStateTitle:    { x: 0,    y: 80,   w: 600, h: 36, type: 'label' },
            emptyStateSubtitle: { x: 0,    y: 30,   w: 600, h: 22, type: 'label' },
            emptyStateCta:      { x: 0,    y: -50,  w: 320, h: 56, type: 'btnPrimary' },
            // Footer.
            hint:   { x: 0, y: portfolio.HINT_Y,   w: 620, h: 20, type: 'label' },
            status: { x: 0, y: portfolio.STATUS_Y, w: 640, h: 22, type: 'label' },
            // History view internals.
            historyEmpty:    { x: 0, y: 0, w: 0,   h: 22, type: 'label' },
            historyScroll:   { x: 0, y: portfolio.HISTORY_SCROLL_Y,    w: UNIFORM_LAYOUT.CONTENT_W, h: portfolio.HISTORY_SCROLL_H, type: 'scrollview' },
            historyLoadMore: { x: 0, y: portfolio.HISTORY_LOAD_MORE_Y, w: 400, h: 48, type: 'btnGhost' },
            // Trophies view container + empty label + header/footer/pagination.
            // Header: title + subtitle band; pagination chevrons + page label
            // sit on the right edge of the title row. Footer: two-line caption
            // + ghost Share button. All children parented to trophiesView so
            // the entire subtree toggles with the Trophies tab.
            trophiesView:           { x: 0, y: 0, w: 720, h: 1280, type: 'group' },
            trophiesEmpty:          { x: 0, y: portfolio.TROPHY_EMPTY_Y, w: 0, h: 24, type: 'label' },
            trophiesHeaderTitle:    { x: 0,    y: portfolio.TROPHY_HEADER_TITLE_Y,    w: 360, h: 28, type: 'label' },
            trophiesHeaderSubtitle: { x: 0,    y: portfolio.TROPHY_HEADER_SUBTITLE_Y, w: 480, h: 18, type: 'label' },
            trophiesPagePrev:       { x: 232,  y: portfolio.TROPHY_PAGE_ROW_Y,        w: 32,  h: 32, type: 'btnGhost' },
            trophiesPageLabel:      { x: 280,  y: portfolio.TROPHY_PAGE_ROW_Y,        w: 80,  h: 18, type: 'label' },
            trophiesPageNext:       { x: 328,  y: portfolio.TROPHY_PAGE_ROW_Y,        w: 32,  h: 32, type: 'btnGhost' },
            trophiesFooterLine1:    { x: 0,    y: portfolio.TROPHY_FOOTER_LINE1_Y,    w: 600, h: 16, type: 'label' },
            trophiesFooterLine2:    { x: 0,    y: portfolio.TROPHY_FOOTER_LINE2_Y,    w: 600, h: 16, type: 'label' },
            trophiesShareBtn:       { x: 0,    y: portfolio.TROPHY_SHARE_BTN_Y,       w: 160, h: 40, type: 'btnGhost' },
        },
        templates: {
            // Hero P/L card — focal point. Big colored value + edge accent
            // (green/red/neutral re-tinted at runtime).
            heroPnLCard: {
                x: 0, y: portfolio.HERO_CARD_Y, w: 600, h: 160,
                header:   { x: 0, y: 56,  w: 580, h: 18 },
                value:    { x: 0, y: 6,   w: 580, h: 64 },
                subtitle: { x: 0, y: -52, w: 580, h: 18 },
            },
            // Secondary stat cards — Performance group (Wins, Losses, Win %)
            // + Activity group's Games card. Per-def `w` overrides for full-
            // width Win % row.
            statCard: {
                count: 4, w: 290, h: 88,
                defs: [
                    { key: 'wins',    label: 'WINS',   x: -150, y: portfolio.PERF_CARDS_Y },
                    { key: 'losses',  label: 'LOSSES', x:  150, y: portfolio.PERF_CARDS_Y },
                    { key: 'winrate', label: 'WIN %',  x:    0, y: portfolio.WINRATE_CARD_Y, w: 600 },
                    { key: 'games',   label: 'GAMES',  x: -150, y: portfolio.ACTIVITY_CARDS_Y },
                ],
                header: { x: 0, y: 22,  w: 270, h: 18 },
                value:  { x: 0, y: -16, w: 270, h: 36 },
            },
            // XP/Level card — gamified progress to next level.
            xpCard: {
                x: 150, y: portfolio.ACTIVITY_CARDS_Y, w: 290, h: 88,
                header: { x: -100, y: 22,  w: 80,  h: 18 },
                value:  { x:   90, y: 22,  w: 80,  h: 18 },
                track:  { x:    0, y: -10, w: 250, h: 8  },
                footer: { x:    0, y: -28, w: 270, h: 16 },
            },
            // 11 — 6 trophy tiles in a 3×2 grid (220×260, 16-px gap).
            // Tile internals (top→bottom): WEEK eyebrow at +108 (small caps,
            // dim), 120-px Emoji icon (rendered at IconLibrary size 90) at +30,
            // big WinsValue label at -60 (28-pt bold white "12"), small
            // WinsLabel at -94 ("wins"). Top-edge stripe is recolored per-rank
            // at runtime in AppUI._renderTrophyPage (gold/silver/bronze/purple).
            trophyTile: {
                count: 6, w: 220, h: 260, gap: 16,
                cols: 3, rows: 2,
                gridXOffset: -1, // (col - 1) * (w + gap) — cols [-236, 0, 236]
                gridYBase:   portfolio.TROPHY_GRID_BASE_Y,
                gridYStride: portfolio.TROPHY_GRID_STRIDE_Y,
                weekEyebrow: { x: 0, y: 108, w: 200, h: 14 },
                emoji:       { x: 0, y: 30,  w: 120, h: 120 },
                winsValue:   { x: 0, y: -60, w: 200, h: 36 },
                winsLabel:   { x: 0, y: -94, w: 200, h: 16 },
            },
            // 30-row pool inside PortfolioHistoryView's ScrollView. AppUI
            // toggles _active per row + writes labels (Date/Mode/Placement/
            // Opponent/Payout) per MatchHistoryEntry (AppUI._renderMatchHistoryRows).
            //
            // baseY/gapY: rows cascade top-down beneath content anchor
            // (0.5, 1). First row centered at y=-66 (top inset 8 + rowH/2),
            // each subsequent row 124 px lower (rowH 116 + 8 gap).
            //
            // 2026-04-29 redesign — 116-tall card with 4 columns separated by
            // hairline dividers: [medal+date | mode/place | chip+opponent |
            // payout]. Medal node (Icon) is empty at scene time; AppUI
            // calls IconLibrary.attach with medalGold/medalSilver/medalBronze
            // depending on placement + mode. Chip node holds the per-track
            // mini-icon (robot/chart/coin).
            matchHistoryRow: {
                count: 30, w: 660, h: 116,
                baseY: portfolio.HISTORY_BASE_Y, gapY: portfolio.HISTORY_GAP_Y,
                icon:      { x: -270, y:  16, size: 56 },
                date:      { x: -270, y: -32, w: 120, h: 16, color: [160, 170, 190] },
                dividerA:  { x: -180, y:   0, w: 1,   h: 84, color: [60, 70, 95, 180] },
                mode:      { x:  -90, y:  18, w: 180, h: 28, color: [255, 255, 255] },
                placement: { x:  -90, y: -18, w: 180, h: 22, color: [180, 190, 210] },
                dividerB:  { x:    0, y:   0, w: 1,   h: 84, color: [60, 70, 95, 180] },
                chip:      { x:   30, y:   0, size: 22 },
                opponent:  { x:  110, y:   0, w: 140, h: 28, color: [220, 226, 240] },
                dividerC:  { x:  180, y:   0, w: 1,   h: 84, color: [60, 70, 95, 180] },
                payout:    { x:  255, y:   0, w: 150, h: 32, color: [48, 198, 155] },
            },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
        ],
    },

    // Synthetic panel-named entry — the verifier walks every node with
    // children as a "panel", so PFStatCard_xp gets its own allowedOverlaps
    // bucket. Same pattern as NotificationToastSlot below.
    PFStatCard_xp: {
        allowedOverlaps: [
            // Progress fill is layered on top of the track sprite by design.
            ['PFXpProgressBar', 'PFXpProgressBarFill'],
        ],
    },

    // 2026-04-29 redesign — 4-column card with hairline dividers between
    // each section. Dividers sit at the column boundary by design, so they
    // touch (1-px) the labels in adjacent columns. Chip + Opponent share
    // column 3 with a small horizontal overlap at the chip's right edge.
    // Verifier strips trailing _N so this entry covers MatchHistoryRow_0..29.
    MatchHistoryRow: {
        allowedOverlaps: [
            ['Divider0', 'Mode'],
            ['Divider0', 'Placement'],
            ['Mode',     'Divider1'],
            ['Placement','Divider1'],
            ['Chip',     'Opponent'],
            ['Opponent', 'Divider2'],
            ['Divider2', 'Payout'],
        ],
    },

    // 2026-04-27 UI overhaul — pillar squad cards. Verifier strips trailing
    // _N so this entry covers SquadSlot_0/_1/_2. The GradientTop sprite is
    // a layered visual under the SymbolLabel by design (gradient simulation).
    // 2026-04-29b flagship rebalance — silhouette grew 90→110 and now extends
    // into the SlotIndex band by design (it's the faint "+" drop-zone glyph
    // sitting BEHIND every other label/sprite on empty cards).
    SquadSlot: {
        allowedOverlaps: [
            ['GradientTop',    'SymbolLabel'],
            ['GradientTop',    'SilhouettePlus'],
            ['GradientTop',    'SlotIndexLabel'],
            ['SilhouettePlus', 'SymbolLabel'],
            ['SilhouettePlus', 'SlotIndexLabel'],
            ['SymbolLabel',    'SlotIndexLabel'],
        ],
    },

    // 2026-04-27 UI overhaul — Start Match hero CTA. The GradientRight sprite
    // simulates a blue→violet gradient and intentionally sits beneath the
    // bevel highlights and label inside the button.
    WagerStartButton: {
        allowedOverlaps: [
            ['GradientRight', 'TopHighlight'],
            ['GradientRight', 'BottomShadow'],
            ['GradientRight', 'Label'],
        ],
    },

    // 2026-04-29 — Synthetic row-name entry. The verifier walks every node
    // with children as its own "panel"; each MIPRow_N has 13 visible
    // children stacked on top of CardGlow + CardBg + invisible TapTarget.
    // Suffix-stripped match (MIPRow_3 → MIPRow).
    MIPRow: {
        allowedOverlaps: [
            // CardGlow (back of stack) sits under everything.
            ['MIPCardGlow', 'MIPCardBg'],
            ['MIPCardGlow', 'MIPTapTarget'],
            ['MIPCardGlow', 'MIPCardEdge'],
            ['MIPCardGlow', 'MIPProgressTrack'],
            ['MIPCardGlow', 'MIPProgressFill'],
            ['MIPCardGlow', 'MIPLiveDot'],
            ['MIPCardGlow', 'MIPLiveLabel'],
            ['MIPCardGlow', 'MIPVsLabel'],
            ['MIPCardGlow', 'MIPStakeChip'],
            ['MIPCardGlow', 'MIPStatusLabel'],
            ['MIPCardGlow', 'MIPTimeLabel'],
            ['MIPCardGlow', 'MIPResumeBtn'],
            ['MIPCardGlow', 'MIPDetailsBtn'],
            // CardBg (slate surface) sits under all foreground content.
            ['MIPCardBg', 'MIPTapTarget'],
            ['MIPCardBg', 'MIPCardEdge'],
            ['MIPCardBg', 'MIPProgressTrack'],
            ['MIPCardBg', 'MIPProgressFill'],
            ['MIPCardBg', 'MIPLiveDot'],
            ['MIPCardBg', 'MIPLiveLabel'],
            ['MIPCardBg', 'MIPVsLabel'],
            ['MIPCardBg', 'MIPStakeChip'],
            ['MIPCardBg', 'MIPStatusLabel'],
            ['MIPCardBg', 'MIPTimeLabel'],
            ['MIPCardBg', 'MIPResumeBtn'],
            ['MIPCardBg', 'MIPDetailsBtn'],
            // Invisible tap target spans the full card; sits below all visible content.
            ['MIPTapTarget', 'MIPCardEdge'],
            ['MIPTapTarget', 'MIPProgressTrack'],
            ['MIPTapTarget', 'MIPProgressFill'],
            ['MIPTapTarget', 'MIPLiveDot'],
            ['MIPTapTarget', 'MIPLiveLabel'],
            ['MIPTapTarget', 'MIPVsLabel'],
            ['MIPTapTarget', 'MIPStakeChip'],
            ['MIPTapTarget', 'MIPStatusLabel'],
            ['MIPTapTarget', 'MIPTimeLabel'],
            ['MIPTapTarget', 'MIPResumeBtn'],
            ['MIPTapTarget', 'MIPDetailsBtn'],
            // Edge stripe at far left; vsLabel bbox extends close to it.
            ['MIPCardEdge', 'MIPVsLabel'],
            // Progress fill rides on the track at the same y/h.
            ['MIPProgressTrack', 'MIPProgressFill'],
            // Resume button sits at bottom-right, overlaps the progress
            // bar's right end. Intentional — bar visually runs UNDER the CTA.
            ['MIPProgressTrack', 'MIPResumeBtn'],
            ['MIPProgressFill', 'MIPResumeBtn'],
            // LIVE dot + label cluster (right cluster).
            ['MIPLiveDot', 'MIPLiveLabel'],
            // Stake chip + status label share the same y row; bboxes touch.
            ['MIPStakeChip', 'MIPStatusLabel'],
        ],
    },

    // 2026-04-27 — synthetic panel-name entry for the multi-opponent cards
    // on RacePanel. Each MultiOppCard_N has an invisible TapTarget child
    // sitting BEHIND 4 visible children (rank chip, name, delta, PnL bar).
    MultiOppCard: {
        allowedOverlaps: [
            ['MultiOppCardTap', 'MultiOppRankChip'],
            ['MultiOppCardTap', 'MultiOppName'],
            ['MultiOppCardTap', 'MultiOppDelta'],
            ['MultiOppCardTap', 'MultiOppPnlBar'],
        ],
    },

    /* ───── NOTIFICATION TOAST OVERLAY ──────────────────────────────── */
    // Phase 9b — Toast slot template migrated. Overlay container is always
    // _active=true; individual slots toggle when AppUI's
    // NotificationToastQueue paints + animates.
    NotificationToastOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            overlay: { x: 0, y: 0, w: 720, h: 360, type: 'group',
                notes: 'transparent container; taps fall through' },
        },
        templates: {
            // 3 stacked toast slots (640×96). Each slot has: color stripe
            // (left edge) · icon (left) · title (top) · body (bottom) ·
            // dismiss button (right edge) · progress bar (bottom strip).
            //
            // Phase 9b fix: Title/Body lpos shifted (-160 → -100), w shrunk
            // (380 → 220), Body h shrunk (38 → 30) and y shifted (-8 → -12)
            // to clear icon (left), dismiss (right), and each other (top/bottom).
            toastSlot: {
                count: 3, w: 640, h: 96,
                ys: [600, 490, 380],
                stripe:   { x: -316, y: 0,   w: 8,   h: 96 },
                icon:     { x: -260, y: 0,   w: 56,  h: 56 },
                title:    { x: -100, y: 18,  w: 220, h: 26 },
                body:     { x: -100, y: -12, w: 220, h: 30 },
                dismiss:  { x: 290,  y: 0,   w: 50,  h: 96 },
                progress: { x: 0,    y: -46, w: 632, h: 4 },
            },
        },
        allowedOverlaps: [],
    },

    // Synthetic template-named entry. The verifier's parse_allowed_overlaps
    // matches any `Identifier: { ... allowedOverlaps: [...] }` block, and its
    // panel-name lookup falls back to the template name (panel with trailing
    // _N stripped). So pairs listed here apply to NotificationToastSlot_0/_1/_2.
    NotificationToastSlot: {
        allowedOverlaps: [
            // ColorStripe (left-edge full-height accent) + ProgressBar
            // (bottom-strip full-width countdown) cross at the bottom-left
            // corner. Both are decorative spans of the slot edges.
            ['ToastColorStripe',   'ToastProgressBar'],
            // DismissButton (right-edge full-height tap target) crosses
            // ProgressBar at the bottom-right corner. Same reason.
            ['ToastDismissButton', 'ToastProgressBar'],
        ],
    },

    /* ───── NOTIFICATION PANEL ──────────────────────────────────────── */
    // Premium-feed redesign (2026-04-29): single-row header with title left
    // + low-emphasis "Mark all read" text + ✕ corner. Per-item Mark-as-Read
    // and selection mode dropped — tap-a-card = mark that one read. Rows
    // now group under Today / Earlier section labels. Per-row left stripe
    // and checkbox dropped; a thin teal accent edge appears on the right
    // of unread rows, paired with a teal dot. Read rows dim to 70% opacity.
    NotificationPanel: {
        canvas: { w: 720, h: 1280 },
        card: { w: 400, h: 1280, restingX: 160, offX: 600 },
        elements: {
            // List area sits below the (now single-row) header divider. y=-90
            // claws back the 20px we won by collapsing the action row.
            listContainer:        { x: 0,    y: -90, w: 360, h: 920, type: 'group' },
            // Header row — title left, "Mark all read" text-button right of title,
            // close ✕ in the top-right corner. All three at y=608.
            cardHeaderLabel:      { x: -178, y: 608, w: 196, h: 30, type: 'label' },
            cardMarkAllReadButton:{ x:  90,  y: 608, w: 110, h: 28, type: 'btnGhost' },
            cardCloseButton:      { x:  168, y: 608, w: 36,  h: 36, type: 'btnGhost' },
            // 1px low-alpha divider, lifted up beneath the single header row.
            cardHeaderDivider:    { x:    0, y: 580, w: 356, h: 1,  type: 'sprite' },
            // Section labels ("TODAY" / "EARLIER"). Y is computed at runtime;
            // these specs lock x / w / h only.
            groupLabelToday:      { x: -160, y: 0,   w: 200, h: 16, type: 'label' },
            groupLabelEarlier:    { x: -160, y: 0,   w: 200, h: 16, type: 'label' },
            // Empty-state group: centered icon + title + subtitle.
            emptyIcon:            { x:    0, y: 80,  w: 64,  h: 64, type: 'group' },
            emptyTitleLabel:      { x:    0, y: 0,   w: 320, h: 24, type: 'label' },
            emptySubtitleLabel:   { x:    0, y: -28, w: 340, h: 18, type: 'label' },
        },
        templates: {
            // 8 reusable rows. baseY/gapY are now seeded values; AppUI
            // recomputes Y at render time to interleave section labels.
            // Row chrome simplified: icon · title · body · time · dot ·
            // right-edge accent (only visible when unread).
            notifRow: {
                count: 8, w: 360, h: 76, gap: 12,
                baseY: 432, gapY: -88,
                icon:       { x: -148, y:   0, w:  40, h: 40 },
                title:      { x:    8, y:  14, w: 220, h: 22 },
                body:       { x:    8, y: -10, w: 220, h: 18 },
                time:       { x:  148, y:  18, w:  60, h: 16 },
                dot:        { x:  158, y: -18, w:   8, h:  8 },
                accentEdge: { x:  178, y:   0, w:   3, h: 76 },
            },
        },
        allowedOverlaps: [],
    },

    /* ───── TOURNAMENT PANEL ────────────────────────────────────────── */
    // Phase 9b — Roster slot template migrated. Full chrome migration
    // (back, title, status, prize, join, status footer) deferred.
    TournamentPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            roster:  { x: 0, y: 150, w: UNIFORM_LAYOUT.CONTENT_W, h: 440, type: 'group' },
            // 2026-04-29 — uniform back/title header, mirrors MIP.
            backLink: { x: UNIFORM_HEADER.BACK_LINK.x, y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:  { x: UNIFORM_HEADER.BACK_BTN.x,  y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:   { x: 0,    y: UNIFORM_HEADER.TITLE_Y, w: 300, h: 44, type: 'label' },
            // 11 — header strip + join CTA. 2026-04-29: shifted DOWN ~50 to
            // clear the new MIP-style title row (y=540, spans 518-562).
            matchLabel:  { x: 0,    y: 488, w: 500, h: 20, type: 'label' },
            statusLabel: { x: 0,    y: 458, w: 500, h: 22, type: 'label' },
            prizeLabel:  { x: 0,    y: 425, w: 600, h: 22, type: 'label' },
            joinBtn:     { x: 0,    y: -460, w: UNIFORM_LAYOUT.CONTENT_W, h: 58, type: 'btnPrimary',
                notes: 'shown only when status=Waiting AND slot free AND not already in' },
        },
        templates: {
            // 10 reusable roster slots. AppUI activates per joined player,
            // writes Pubkey/Height/Medal labels.
            //
            // Phase 9b fix: height.w shrunk 180→120 so its bbox right edge
            // x=240 clears Medal left edge x=240 (touches, no overlap).
            tournamentSlot: {
                count: 10, w: 620, h: 36,
                baseY: 200, gapY: -42,
                pubkey: { x: -240, y: 0, w: 300, h: 22 },
                height: { x: 180,  y: 0, w: 120, h: 22 },
                medal:  { x: 280,  y: 0, w: 80,  h: 28 },
            },
        },
        allowedOverlaps: [],
    },

    /* ───── TOKEN DETAIL ────────────────────────────────────────────── */
    // 2026-04-28 scouting-page redesign — restructured into identity header,
    // section-labeled control bands (Safety / Range / View / Unit), framed
    // chart card with dynamic header, and Token Stats grid with edge accents.
    TokenDetailPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // Identity band — Back at left, Symbol/Name centered, MintChip at right.
            // 2026-04-29: back y override → 614 to sit on par with symbolLabel (the panel's topmost solid element).
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: 614, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: 614, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            symbolLabel:     { x:    0, y: 614, w: 320, h: 34, type: 'label' },
            nameLabel:       { x:    0, y: 588, w: 320, h: 18, type: 'label' },
            mintChip:        { x:  255, y: 612, w: 130, h: 26, type: 'btnGhost' },

            // Slim premium CTA — narrower & shorter; teal halo via mkBtnHero.
            pickBtn:         { x:    0, y: 552, w: 560, h: 42, type: 'btnPrimary' },

            // Section labels — uppercase, mini, muted (lo-tier).
            safetyHeader:    { x: -290, y: 506, w: 200, h: 14, type: 'label' },
            rangeHeader:     { x: -290, y: 446, w: 200, h: 14, type: 'label' },
            viewHeader:      { x: -200, y: 386, w: 120, h: 14, type: 'label' },
            unitHeader:      { x:  140, y: 386, w: 120, h: 14, type: 'label' },

            // Chart module — strict 380px-tall framed container with internal padding.
            // Top edge at y=320 clears denom-toggle bottom (y=341) with 21px gap that
            // also accommodates the chartDivider hairline at y=330. Bottom at y=-60
            // leaves 30px breathing room above statsHeader at y=-90.
            chartCard:       { x:    0, y: 130, w: 680, h: 380, type: 'group' },
            chartHeader:     { x: -160, y: 168, w: 320, h: 16, type: 'label',
                notes: 'rel ChartCard center; left-aligned dim caption, top-left inside card with 20px left / 14px top padding' },
            chartArea:       { x:    0, y: -18, w: UNIFORM_LAYOUT.CONTENT_W, h: 332, type: 'group',
                notes: 'rel ChartCard center; cc.Graphics surface; sits below 24px header band, 12px symmetric inside-card padding' },
            chartLoadLabel:  { x:    0, y:   0, w: 300, h: 22, type: 'label',
                notes: 'rel to ChartArea center; shown while loading' },

            // Hairline divider between control band and ChartCard.
            chartDivider:    { x:    0, y: 330, w: 600, h:   1, type: 'sprite',
                notes: 'low-alpha blue hairline; sits in the gap between denom toggles and ChartCard top' },

            // Token Stats label — moved up to sit 30px below ChartCard bottom (y=-60).
            statsHeader:     { x: -290, y: -90, w: 220, h: 14, type: 'label' },

            status:          { x:    0, y: -625, w: 660, h: 20, type: 'label' },
        },
        templates: {
            // 4 safety chips — smaller chips below SafetyHeader at y=506.
            safetyChip: {
                count: 4, w: 130, h: 28, y: 474,
                baseX: -240, gapX: 155,
                defs: [
                    { key: 'mint',  label: '◎ Mint' },
                    { key: 'auth',  label: '◎ Auth' },
                    { key: 'lp',    label: '◎ LP' },
                    { key: 'top10', label: '◎ Top10' },
                ],
            },
            // 6 timeframe buttons below RangeHeader at y=446. Computed: -275 + t * 90.
            timeframeBtn: {
                count: 6, w: 80, h: 30, y: 414,
                baseX: -275, gapX: 90,
                defs: [
                    { key: '1m',  label: '1m'  },
                    { key: '5m',  label: '5m'  },
                    { key: '15m', label: '15m' },
                    { key: '1H',  label: '1H'  },
                    { key: '4H',  label: '4H'  },
                    { key: '1D',  label: '1D'  },
                ],
            },
            // 4 denom toggles paired under VIEW / UNIT headers (y=386).
            denomBtn: {
                count: 4, w: 88, h: 26, y: 354,
                defs: [
                    { key: 'price', label: 'Price', x: -200 },
                    { key: 'mcap',  label: 'MCap',  x: -100 },
                    { key: 'usd',   label: 'USD',   x:  100 },
                    { key: 'sol',   label: 'SOL',   x:  200 },
                ],
            },
            // 6 stat cards in 3×2 grid (y=-365 / -445). Each gets a top-edge
            // accent strip; "dynamic" recolored at runtime per change sign.
            detailStatCard: {
                count: 6, w: 210, h: 70,
                defs: [
                    { key: 'price',   label: 'PRICE',   x: -225, y: -155, accent: 'amber' },
                    { key: 'liq',     label: 'LIQ',     x:  0,   y: -155, accent: 'blue'  },
                    { key: 'mcap',    label: 'MCAP',    x:  225, y: -155, accent: 'blue'  },
                    { key: 'vol24h',  label: 'VOL 24H', x: -225, y: -235, accent: 'blue'  },
                    { key: 'change',  label: '24H',     x:  0,   y: -235, accent: 'dynamic' },
                    { key: 'holders', label: 'HOLDERS', x:  225, y: -235, accent: 'slate' },
                ],
                header: { x: 0, y: 16,  w: 200, h: 22 },
                value:  { x: 0, y: -14, w: 200, h: 28 },
            },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
            ['ChartHeaderLabel', 'ChartCard'],
            ['ChartArea', 'ChartCard'],
        ],
    },

    /* ───── DAILY CHALLENGE ─────────────────────────────────────────── */
    // Phase 9c — chrome migrated + DailyStreakCard internals fixed. Title
    // shrunk to clear back chrome; StreakDayLabel h shrunk to clear
    // StreakBestLabel.
    DailyChallengePanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:           { x: 0,    y: UNIFORM_HEADER.TITLE_Y, w: 400, h: 44, type: 'label' },
            // 11 — DailyStreakCard at y=440 + internals (relative to card center).
            streakCard:      { x: 0,    y: 440, w: 600, h: 100, type: 'group' },
            streakHeader:    { x: -260, y: 34,  w: 200, h: 16,  type: 'label' },
            streakDayLabel:  { x: 0,    y: 2,   w: 560, h: 38,  type: 'label',
                notes: '9c: h 46→38 (bbox y[-17,21]) to clear StreakBestLabel top y=-17' },
            streakBestLabel: { x: 0,    y: -28, w: 560, h: 22,  type: 'label' },
            // 11 — SeasonSummaryCard at y=-60 + internals.
            seasonCard:      { x: 0,    y: -60, w: 600, h: 120, type: 'group' },
            seasonHeader:    { x: -260, y: 42,  w: 200, h: 16,  type: 'label' },
            seasonRank:      { x: 0,    y: 14,  w: 560, h: 26,  type: 'label' },
            seasonPodium:    { x: 0,    y: -18, w: 560, h: 22,  type: 'label' },
            seasonPrize:     { x: 0,    y: -42, w: 560, h: 18,  type: 'label' },
            // 11 — status footer.
            status:          { x: 0,    y: -540, w: 600, h: 20, type: 'label' },
        },
        templates: {
            // 3 challenge rows. Each: description (top-left) + progress (bottom-left)
            // + reward (right) + checkmark (far right).
            challengeRow: {
                count: 3, w: 600, h: 80,
                ys: [280, 180, 80],
                description: { x: -250, y: 14,  w: 360, h: 28 },
                progress:    { x: -250, y: -14, w: 360, h: 20 },
                reward:      { x: 150,  y: 0,   w: 120, h: 22 },
                checkmark:   { x: 260,  y: 0,   w: 48,  h: 36 },
            },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
        ],
    },

    /* ───── SPECTATOR ───────────────────────────────────────────────── */
    // Phase 9c — chrome migrated. Title shrunk to clear back button.
    SpectatorPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // 2026-04-29 — uniform back/title header, mirrors MIP.
            backLink: { x: UNIFORM_HEADER.BACK_LINK.x, y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:  { x: UNIFORM_HEADER.BACK_BTN.x,  y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:   { x: 0,    y: UNIFORM_HEADER.TITLE_Y, w: 300, h: 44, type: 'label' },
            // 11 — header strip + player/event lists + join CTA. 2026-04-29:
            // shifted DOWN ~50 to clear the new MIP-style title row.
            matchLabel:      { x: 0, y: 488, w: 500, h: 20, type: 'label' },
            statusLabel:     { x: 0, y: 458, w: 500, h: 22, type: 'label' },
            playerList:      { x: 0, y: 240, w: UNIFORM_LAYOUT.CONTENT_W, h: 380, type: 'group' },
            eventList:       { x: 0, y: -170, w: UNIFORM_LAYOUT.CONTENT_W, h: 260, type: 'group' },
            eventListHeader: { x: -270, y: 110, w: 300, h: 18, type: 'label' },
            joinBtn:         { x: 0, y: -440, w: UNIFORM_LAYOUT.CONTENT_W, h: 56, type: 'btnPrimary' },
        },
        templates: {
            // 10 spectator player rows in SpectatorPlayerList.
            playerRow: {
                count: 10, w: 600, h: 34,
                baseY: 170, gapY: -38,
                pubkey: { x: -240, y: 0, w: 280, h: 22 },
                height: { x: 220,  y: 0, w: 200, h: 22 },
            },
            // 10 event rows in SpectatorEventList. Single Text label per row.
            eventRow: {
                count: 10, w: 600, h: 18,
                baseY: 80, gapY: -20,
                text: { x: 0, y: 0, w: 600, h: 18 },
            },
        },
        allowedOverlaps: [],
    },

    /* ───── POST MATCH ──────────────────────────────────────────────── */
    // Drifting-gadget redesign — five-beat hierarchy:
    //   Outcome → Mascot → SOL → Stats → CTA. Mascot is the centerpiece;
    //   payout sits directly under it; subtitle/rake hug payout; cards in
    //   2×2 grid below; XP bar; CTAs (Play Again primary teal / Pick New
    //   Squad secondary blue); Share + Status as small bottom-row affordances.
    PostMatchPanel: {
        canvas: { w: pm.PANEL_W, h: pm.PANEL_H },
        elements: {
            // 2026-04-27 — every Y on this page is derived from the `pm`
            // constants block at the top of this file. NEVER hand-tune y.
            outcomeBg:       { x: 0,    y: 0,    w: pm.PANEL_W, h: pm.PANEL_H, type: 'graphics',
                notes: 'full-canvas Graphics rect; AppUI fills + fades alpha on show' },
            // 2026-04-29 win-screen redesign — back nodes parked off-canvas
            // and AppUI deactivates them on show. Kept as 1×1 stubs so any
            // legacy code that does getChildByName('PostMatchBackButton')
            // still gets a valid node (just with active=false).
            backLink:        { x: -2000, y: -2000, w: 1, h: 1, type: 'label' },
            backBtn:         { x: -2000, y: -2000, w: 1, h: 1, type: 'btnGhost' },
            // 2026-04-29 polish — h 80→130 so two-line "YOU WON\n{NAME}"
            // wrap renders without clipping (runtime drops font 64→52pt).
            title:           { x: 0,    y: pm.TITLE_Y, w: 620, h: 130, type: 'label',
                notes: '52pt bold runtime; 130h hosts two-line username wrap' },
            track:           { x: 0,    y: pm.TRACK_Y, w: 600, h: 44,  type: 'label' },
            // 2026-04-29 — eyebrow label above the +X SOL hero. AppUI sets
            // string ("YOU EARNED" / "YOU LOST") + colors per outcome.
            earned:          { x: 0,    y: pm.PAYOUT_Y + 60, w: 400, h: 22, type: 'label',
                notes: 'NEW — 14pt eyebrow above payout hero' },
            // Mascot glow halo — shrunk 480→320 so payout label clears it.
            mascotGlow:      { x: 0,    y: pm.MASCOT_Y, w: pm.MASCOT_GLOW_WH, h: pm.MASCOT_GLOW_WH, type: 'graphics',
                notes: 'circle fill alpha 0; AppUI tweens to 140 (~0.55) tinted by outcome. 2026-04-27 — shrunk 480→320.' },
            mascotContainer: { x: 0,    y: pm.MASCOT_Y, w: pm.MASCOT_BOX_WH, h: pm.MASCOT_BOX_WH, type: 'mascot',
                notes: '2026-04-27 — shrunk 360→280 (proportional to glow).' },
            payoutLabel:     { x: 0,    y: pm.PAYOUT_Y, w: 620, h: 110, type: 'label',
                notes: '72pt mono (was 64; +12.5% per spec), scale-in + ticker on win.' },
            subtitle:        { x: 0,    y: pm.SUBTITLE_Y, w: 600, h: 32, type: 'label',
                notes: '22pt headline only ("Won by X.XX%"); breakdown moved to its own dimmed label below.' },
            // 2026-04-29 — breakdown chip pill (rounded charcoal background)
            // wrapping the per-token row, so it visually separates from the
            // subtitle and reads as a chip not a floating subtitle.
            breakdownPill:   { x: 0,    y: pm.BREAKDOWN_Y, w: 540, h: 36, type: 'sprite',
                notes: 'NEW — chip-pill background; child label = PostMatchBreakdownLabel.' },
            breakdown:       { x: 0,    y: 0, w: 520, h: 26, type: 'label',
                notes: 'per-token row, 18pt, opacity ~0.7. Child of breakdownPill — local x/y both 0.' },
            rake:            { x: 0,    y: pm.RAKE_Y, w: 600, h: 40, type: 'label' },
            // 2026-04-29 polish — bar narrows 480→420 and labels push out to
            // ±250 so "Lv N" / "+N XP" sit clear of the fill rectangle.
            xpBarLabelLeft:  { x: -250, y: pm.XP_BAR_Y, w: 200, h: 22, type: 'label',
                notes: '"Lv N → Lv N+1" 14pt mid-grey' },
            xpBarFill:       { x: 0,    y: pm.XP_BAR_Y, w: 420, h: 24, type: 'graphics',
                notes: '2026-04-29 — h 16→24 thicker; w 480→420 to clear labels.' },
            xpBarLabelRight: { x: 250,  y: pm.XP_BAR_Y, w: 120, h: 22, type: 'label',
                notes: '"+10 XP" 18pt bold accent' },
            // 2026-04-29 — CTAs widen 320→340 with a 16-px center gap and
            // grow 64→84 to host two-line title + subtitle ("PICK NEW SQUAD"
            // / "Try a different lineup", "HOME" / "Back to main menu").
            sameSquadBtn:    { x: -178, y: pm.CTA_Y, w: 340, h: 84, type: 'btnPrimary' },
            againBtn:        { x:  178, y: pm.CTA_Y, w: 340, h: 84, type: 'btnPrimary' },
            shareButton:     { x: 0,    y: pm.SHARE_Y, w: 280, h: 44, type: 'btnPrimary',
                notes: 'tertiary; only visible for real-track wins' },
            status:          { x: 0,    y: pm.STATUS_Y, w: 640, h: 20, type: 'label' },
            trophy:          { x: 280,  y: pm.TROPHY_Y, w: 64, h: 64, type: 'label',
                notes: 'corner badge in title row; AppUI attaches rankIcon at show time.' },
        },
        templates: {
            // 4 stat cards in a 2×2 grid (you/opp/xp/lvl). 2026-04-27 — value
            // label split into Value (big +N) + ValueSub (small breakdown line)
            // so AppUI can render multiplier/breakdown at smaller font without
            // multi-line overflow. Card h bumped 116 → 128 to host both lines.
            pmCard: {
                count: 4, w: 300, h: pm.CARD_H,
                defs: [
                    { key: 'you', label: 'YOUR DELTA', x: -160, y: pm.CARDS_ROW1_Y },
                    { key: 'opp', label: 'BEST OPP',   x:  160, y: pm.CARDS_ROW1_Y },
                    { key: 'xp',  label: 'XP EARNED',  x: -160, y: pm.CARDS_ROW2_Y },
                    { key: 'lvl', label: 'LEVEL',      x:  160, y: pm.CARDS_ROW2_Y },
                ],
                // 2026-04-29 polish — header smaller/muter, value bigger,
                // sub tighter. Header pushed up 4 px to give value more room.
                header:   { x: 0, y: 46,  w: 280, h: 20, fontSize: 13 },
                value:    { x: 0, y: -8,  w: 280, h: 40, fontSize: 36 },   // 32→36
                valueSub: { x: 0, y: -42, w: 280, h: 18, fontSize: 12 },   // 13→12
            },
            // 12 confetti shells, child of TrophyLabel; AppUI rebases burst
            // origin to mascot world position at show time so the burst still
            // emanates from the celebrate mascot.
            confetti: {
                count: 12, w: 60, h: 60,
                x: 0, y: 0,
            },
        },
        allowedOverlaps: [
            // Mascot character is rendered INSIDE the glow circle by design.
            ['MascotGlow', 'PostMatchMascotContainer'],
            // XP bar = [Lv N→ label][green fill bar][+N XP label] — labels
            // sit at the ENDS of the fill bar by design.
            ['PostMatchXPBarLabelLeft',  'PostMatchXPBarFill'],
            ['PostMatchXPBarLabelRight', 'PostMatchXPBarFill'],
            // 2026-04-27 — track + rake labels 2× larger; their bboxes touch
            // adjacent elements by a few px but the rendered text is centered
            // and doesn't visually overlap.
            ['PostMatchTitleLabel', 'PostMatchTrackLabel'],
            ['PostMatchRakeLabel',  'PMCard_you'],
            ['PostMatchRakeLabel',  'PMCard_opp'],
            // 2026-04-28 — back button drops into title row (BACK_Y=TITLE_Y).
            // Back is left-anchored at x=-260 (small ghost btn); title is
            // center-anchored at x=0 (620 wide). They share Y but render in
            // disjoint horizontal regions.
            ['PostMatchBackButton', 'PostMatchTitleLabel'],
            ['PostMatchTitleLabel', 'TrophyLabel'],
        ],
    },

    /* ───── WAITING PANEL ───────────────────────────────────────────── */
    // Phase 10 — Real-mode matchmaking + paper-mode brief transition.
    // Title/Mode/Rake/Progress stack near top; spinner mid-screen; Cancel/
    // Bot/Force buttons stacked at bottom (alternates per state); Streak
    // banner up top (hidden unless streak ≥ 3); status footer.
    WaitingPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            title:        { x: 0, y: 300,  w: 600, h: 40, type: 'label' },
            mode:         { x: 0, y: 250,  w: 600, h: 24, type: 'label' },
            rake:         { x: 0, y: 220,  w: 600, h: 22, type: 'label',
                notes: 'AppUI populates with "Rake: X.X% · pot: Y.Y SOL"' },
            progress:     { x: 0, y: 180,  w: 600, h: 28, type: 'label' },
            spinner:      { x: 0, y: 80,   w: 300, h: 40, type: 'label' },
            streakBanner: { x: 0, y: 480,  w: 620, h: 36, type: 'label',
                notes: 'hidden unless current_streak >= 3' },
            cancelBtn:    { x: 0, y: -100, w: 380, h: 56, type: 'btnDanger' },
            botBtn:       { x: 0, y: -180, w: 380, h: 56, type: 'btnPrimary',
                notes: 'hidden; revealed after timeout (real) or immediately (paper)' },
            forceBtn:     { x: 0, y: -260, w: 420, h: 56, type: 'btnGhost',
                notes: 'hidden until match active 5+ min with missing players; bold' },
            status:       { x: 0, y: -600, w: 640, h: 20, type: 'label' },
        },
        allowedOverlaps: [],
    },

    /* ───── TUTORIAL OVERLAY ────────────────────────────────────────── */
    // Phase 28 — gamified redesign. 4 themed cards (one visible at a time),
    // slide-carousel between cards on tap. Each card has accent color,
    // icon, big title, body, mascot, progress dots, hint.
    TutorialOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // Scrim (alpha=200 black) + tap-anywhere-dismiss button on root.
            // Cards live as direct children; no top-level elements needed.
        },
        templates: {
            // 4 themed cards. AppUI activates card[step] + its glow halo;
            // others stay _active=false. Each card is a Group container
            // holding accentBar, icon, title, divider, body, mascot,
            // dotsGroup, hint as children.
            tutorialCard: {
                count: 4, w: 600, h: 500,
                names: ['TutorialCard_0', 'TutorialCard_1', 'TutorialCard_2', 'TutorialCard_3'],
                glowNames: ['TutorialCardGlow_0', 'TutorialCardGlow_1', 'TutorialCardGlow_2', 'TutorialCardGlow_3'],
                titles: [
                    'PICK YOUR SQUAD',
                    'STAKE YOUR SOL',
                    'WATCH IT LIVE',
                    'FIRST MATCH FREE',
                ],
                bodies: [
                    'Pick 3 tokens you think will pump the most over the match window.',
                    'Stake some SOL. Your squad\'s % change battles your opponent\'s.',
                    'Watch your portfolio tick live. Biggest % gain (or smallest loss) wins.',
                    'Tap a token, pick a squad, hit Run Squad. The first match is on the house.',
                ],
                // Per-step accent colors [r,g,b] — teal/gold/violet/emerald.
                accents: [
                    [48, 198, 155],
                    [218, 165, 32],
                    [153, 69, 255],
                    [20, 241, 149],
                ],
                // Icon glyphs (emoji fallback; AppUI may swap to PNG via
                // IconLibrary.attach at runtime).
                iconKeys:    ['star', 'bolt', 'chart', 'trophy'],
                iconGlyphs:  ['★', '⚡', '📊', '🏆'],
                // Mascot states per-step — must be valid MascotState enum values.
                mascotStates: ['idle', 'celebrate', 'think', 'celebrate'],
                // Card-internal child layout (anchor 0.5,0.5; range −250..+250).
                children: {
                    glow:      { x: 0,    y: 0,    w: 640, h: 540, type: 'sprite',
                        notes: 'halo sibling of card frame; rendered first → behind card' },
                    accentBar: { x: 0,    y: 247,  w: 600, h: 6,   type: 'sprite' },
                    icon:      { x: 0,    y: 190,  w: 80,  h: 80,  type: 'label' },
                    title:     { x: 0,    y: 120,  w: 560, h: 42,  type: 'label' },
                    divider:   { x: 0,    y: 85,   w: 280, h: 2,   type: 'sprite' },
                    body:      { x: 0,    y: 20,   w: 540, h: 120, type: 'label' },
                    mascot:    { x: 200,  y: -115, w: 120, h: 140, type: 'mascot' },
                    dotsGroup: { x: -210, y: -225, w: 120, h: 14,  type: 'group' },
                    dot:       { w: 12, h: 12, stride: 22 },
                    hint:      { x: 120,  y: -225, w: 240, h: 20,  type: 'label' },
                },
            },
        },
        allowedOverlaps: [
            // Glow halo sits BEHIND its card frame — intentional (template-name pair
            // matches TutorialCardGlow_0+TutorialCard_0, _1+_1, etc.).
            ['TutorialCardGlow', 'TutorialCard'],
        ],
    },

    /* ───── COUNTDOWN OVERLAY ───────────────────────────────────────── */
    // Phase 10 — pre-match cinematic. Big 3/2/1 digit center; squad +
    // "Match starting…" hint below. AppUI drives the animation chain.
    // 2026-04-26: canvas h 1280 → 1800 to match RacePanel — at 1280 the
    // dark scrim sprite was shorter than the device viewport (~1602+ tall
    // under FIXED_WIDTH) and the lobby's training card / race mascot bled
    // through at the bottom edge.
    CountdownOverlay: {
        canvas: { w: 720, h: 1800 },
        elements: {
            bigLabel:    { x: 0, y: 40,   w: 400, h: 240, type: 'label' },
            squadLabel:  { x: 0, y: -140, w: 620, h: 36,  type: 'label' },
            hintLabel:   { x: 0, y: -210, w: 600, h: 24,  type: 'label' },
        },
        allowedOverlaps: [],
    },

    /* ───── SIGNING OVERLAY ─────────────────────────────────────────── */
    // Phase 10 — wallet-wait modal. Spinner glyph (gold; AppUI rotates) +
    // status + hint.
    SigningOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            spinner:     { x: 0, y: 80,  w: 200, h: 120, type: 'label' },
            statusLabel: { x: 0, y: -40, w: 680, h: 36,  type: 'label' },
            hintLabel:   { x: 0, y: -90, w: 620, h: 24,  type: 'label' },
        },
        allowedOverlaps: [],
    },

    /* ───── LOADING OVERLAY (Phase 19) ──────────────────────────────── */
    // Post-tap wait coverage — shown during reconnect (cached auth) and
    // post-connect home render. Mascot greeter + spinner + status + tip.
    LoadingOverlay: {
        canvas: { w: 720, h: 1280 },
        bg: { color: '#04060C' },
        elements: {
            mascotContainer: { x: 0, y: 200,  w: 200, h: 200, type: 'mascot',
                notes: '5th MascotController instance — idle Seedance frames during load. Square 200x200 to match 384x384 source aspect.' },
            spinner:         { x: 0, y: -40,  w: 200, h: 120, type: 'label',
                notes: 'gold ⟳ at 80pt; AppUI rotates -360°/sec' },
            statusLabel:     { x: 0, y: -220, w: 680, h: 36,  type: 'label' },
            tipLabel:        { x: 0, y: -300, w: 620, h: 24,  type: 'label',
                notes: 'rotating tip — cycles 6 tips every 3s while shown' },
        },
        allowedOverlaps: [],
    },

    /* ───── LEVEL UP OVERLAY ────────────────────────────────────────── */
    // Phase 10 — XP celebration cinematic. Scrim (alpha=235 dark purple) +
    // tap-to-dismiss + "LEVEL UP" + big level digit + caption + rake-
    // discount callout. Auto-dismisses after 2.8s.
    LevelUpOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            title:    { x: 0, y: 200,  w: 600, h: 100, type: 'label',
                notes: 'gold, bold, 64pt' },
            bigLevel: { x: 0, y: 30,   w: 600, h: 240, type: 'label',
                notes: 'bold, 180pt; AppUI tweens count-up' },
            caption:  { x: 0, y: -190, w: 600, h: 36,  type: 'label' },
            rake:     { x: 0, y: -260, w: 600, h: 32,  type: 'label',
                notes: 'teal-accent: "Your rake: X.X% (was Y.Y%)"' },
            hint:     { x: 0, y: -560, w: 400, h: 22,  type: 'label' },
        },
        allowedOverlaps: [],
    },
};

module.exports = LayoutSpec;
