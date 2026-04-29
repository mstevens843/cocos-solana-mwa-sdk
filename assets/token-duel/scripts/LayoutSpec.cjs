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
    TITLE_Y:            570,
    TITLE_BOTTOM:       552,   // = TITLE_Y - title.h(36)/2

    // MatchSetupCard summary — directly under title.
    // 2026-04-27 v3: 455 → 480 (gap title→card halved 50→25).
    MATCHSETUP_CARD_Y:  480,   // h=93 → top 527, bottom 433

    // FeedFrameCard wrapping search/chips/col-headers + scrollview.
    // 2026-04-27 v3: top 375→417 (gap card→frame halved 33→16). Inside-frame
    // items + everything below shift up 42 to follow.
    FEED_FRAME_TOP:     417,
    FEED_FRAME_H:       656,
    FEED_FRAME_Y:       89,    // = FEED_FRAME_TOP - FEED_FRAME_H/2

    // In-frame mid band — search/filter/cols (all +42 vs v2).
    SEARCH_Y:           387,
    CHIPS_Y:            335,
    COL_HEADERS_Y:      297,

    // Feed scrollview — h=510 unchanged; top +42.
    FEED_SCROLL_TOP:    281,
    FEED_SCROLL_H:      510,
    FEED_SCROLL_Y:      26,    // = FEED_SCROLL_TOP - FEED_SCROLL_H/2
    FEED_SCROLL_BOTTOM: -229,

    // SquadPanel — 2026-04-27 UI overhaul: bumped 220→230 to host taller (140h) pillar cards.
    // New stack: header at -279 (30 below top); cards centered at y=-370 spanning [-440,-300]
    // with h=140; wager row pushed to -488 to clear card bottom; status stays at -568.
    SQUAD_PANEL_TOP:    -249,
    SQUAD_PANEL_H:      230,
    SQUAD_PANEL_Y:      -364,  // = SQUAD_PANEL_TOP - SQUAD_PANEL_H/2
    SQUAD_PANEL_BOTTOM: -479,
    SQUAD_HEADER_Y:     -279,    // 30 px below panel top; pillar cards drop right under it
    SQUAD_SLOTS_Y:      -370,    // panel center for 140h cards; spans [-440,-300]
    WAGER_Y:            -488,    // 48 below card bottom (-440); wager spans [-516,-460]
    WAGER_DROPDOWN_Y:   -456,    // mirror; opens upward from wager-value button

    // Footer.
    STATUS_Y:           -568,    // 2026-04-27: -537→-568 (follow wager down)
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
    MASCOT_GLOW_WH:   380,   // unchanged
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
    // V6 (2026-04-28 home CTA scale-up) — heights bump 128/96/80/88 → 136/104/104/104,
    // GAP unified at 18 px. Find center derived to keep top edge at y=388 (matches V5).
    // Authoritative formula: GAP=18, hF=136, hS=104; FIND=320, START=320-(hF/2+GAP+hS/2)=
    // 320-(68+18+52)=182; MIP=182-(52+18+52)=60; BOT=60-(52+18+52)=-62.
    FIND_CTA_Y:       320,   // V6 — h 128→136 (+8 over secondary tier)
    FIND_BADGE_Y:     360,   // V6 — track new top edge (FIND top y=388 → badge y=388-28)
    FIND_DOT_Y:       372,   // V6 — track new top edge
    START_CTA_Y:      182,   // V6 — h 96→104, repacked for uniform 18px gap
    MIP_CTA_Y:        60,    // V6 — h 80→104, repacked
    MIP_BADGE_Y:      84,    // V6 — track new top edge (MIP top y=112)
    MIP_DOT_Y:        84,    // V6 — track new top edge
    BOT_CTA_Y:        -62,   // V6 — h 88→104, repacked (stack now ends at y=-114)

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

    // Opponent's hero delta (big 80pt portfolio %).
    // 2026-04-28: 140 → 100 to drop -0.07% into the mid-low zone, reduce its
    // vertical dominance, and pull weight into the under-used bottom half.
    OPP_HERO_DELTA_Y:    100,

    // Opponent identity card ("BOT · Lv N"). 2026-04-27: 40 → 0 to clear opponentDelta visual extent.
    // 2026-04-28: 0 → -20 to follow opponentDelta down and keep a clear ≥20px
    // gap between the 80pt PnL glyph extent and the pill (no visual collision).
    OPP_IDENTITY_Y:      -20,

    // Opponent-side token row (3 cards side-by-side, duel layout).
    // 2026-04-28: -90 → -130 to anchor the opponent row near the bottom safe
    // area (mirrors player row top-spacing; gives the screen a 3-zone read).
    OPP_TOKEN_ROW_Y:     -130,

    // 2026-04-27 — Forfeit + Home buttons paired on y=-260. Home on LEFT,
    // Forfeit on RIGHT. Hint text + mascot stay where they are.
    FORFEIT_BTN_Y:       -260,
    FORFEIT_BTN_X:        80,    // moved x=0 → +80 to make room for Home
    HOME_BTN_X:          -80,
    HOME_BTN_Y:          -260,

    // Gameplay hint ("Tap to drop - stack as high as you can"). Sits below Forfeit.
    HINT_LABEL_Y:        -310,

    // 4p/8p multi-player surfaces — mutually exclusive with duel layout.
    OPP_CARD_Y:          -400,   // 1v1 legacy big opponent card (hidden in duel)
    OPP_STRIP_Y:         -406,   // 7-bot opponent leaderboard strip — KILLED 2026-04-27 (force-hidden)

    // Mascot bottom-right corner.
    MASCOT_Y:            -460,

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
    TITLE_Y:          480,
    SUBTITLE_Y:       422,
    MASCOT_Y:         250,    // 2026-04-28 polish: 300 → 250 (anchor toward CTA)

    // CTA card backdrop (semi-translucent dark surface w/ violet edge).
    CTA_CARD_Y:       -178,   // 2026-04-27 UX upgrade: pulled up 7 (was -185)

    // Action stack inside the CTA card. 2026-04-27 UX upgrade: tightened
    // ~20% — every Y in the stack moved closer to the next neighbor so the
    // stack feels "decided" instead of spread. 2026-04-28: trust line
    // pulled tighter to Connect; new LiveSignal sub-cue inserted between
    // trust and Guest, so Guest + Reconnect drop to make room.
    CONNECT_Y:        -18,    // PRIMARY — Connect Wallet (h=110)
    TRUST_Y:          -78,    // 2026-04-28: -88 → -78 (tighter to Connect)
    LIVE_SIGNAL_Y:    -100,   // 2026-04-28 polish: -114 → -100 (closer to CTA)
    GUEST_Y:          -178,   // 2026-04-28: -158 → -178 (room for live signal)
    RECONNECT_Y:      -278,   // 2026-04-28: -262 → -278 (follow Guest down)

    // Bottom status footer.
    STATUS_PILL_Y:    -555,
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
    HEADER_Y:             580,   // legacy alias, prefer UNIFORM_HEADER.BACK_Y
    TITLE_Y:              540,   // legacy alias, prefer UNIFORM_HEADER.TITLE_Y

    // Card stack — shifted DOWN 80 from previous to clear new title row.
    WALLET_CARD_Y:        450,   // was 530, shift -80
    PROFILE_CARD_Y:       296,   // was 376
    QP_CARD_Y:            58,    // was 138
    AUDIO_CARD_Y:         -184,  // was -104
    ACCOUNT_CARD_Y:       -412,  // was -332

    // Standalone footer (also shifted -80; bottom is tight on short devices).
    DELETE_BTN_Y:         -598,  // was -518
    STATUS_Y:             -625,  // was -562 (clamped above canvas bottom -640)

    // Popovers — direct children of panel for z-order; ride along with
    // their card parents so anchors stay consistent.
    QP_MODE_POPOVER_Y:    18,    // was 98, shift -80
    QP_WINDOW_POPOVER_Y:  -28,   // was 52
    QP_WAGER_POPOVER_Y:   -94,   // was -14
};

// 2026-04-27 — PortfolioPanel deterministic Y anchors.
// Hub-style page accessed from HomePanel's trophy icon (alongside Leaderboard).
// Layout is locked — every page-level Y derives from this block. Card-internal
// child y values stay inline. Panel root is offset by (0, -SAFE_AREA_TOP, 0).
const portfolio = {
    // Header band — back link / title / subtitle / pubkey.
    BACK_Y:               720,
    TITLE_Y:              680,
    SUBTITLE_Y:           644,
    PUBKEY_Y:             632,

    // Sub-tab strip + mode toggle.
    TABS_Y:               560,   // Stats / History / Trophies
    MODE_LABEL_Y:         510,   // "MODE" eyebrow
    MODE_TOGGLE_Y:        482,   // Paper / Real

    // Stats view — content stack.
    HERO_CARD_Y:          380,   // Total Profit hero card
    GROUP_PERF_Y:         230,   // "PERFORMANCE" eyebrow
    PERF_CARDS_Y:         168,   // Wins / Losses cards
    WINRATE_CARD_Y:       78,    // Win % full-width card
    GROUP_ACTIVITY_Y:     -50,   // "ACTIVITY" eyebrow
    ACTIVITY_CARDS_Y:     -120,  // Games / XP-Level cards

    // Empty state (when zero games).
    EMPTY_STATE_Y:        200,

    // Footer.
    HINT_Y:               -700,
    STATUS_Y:             -740,

    // History view — scrollview + row pool internals.
    HISTORY_SCROLL_Y:     40,
    HISTORY_SCROLL_H:     780,
    HISTORY_BASE_Y:       -36,
    HISTORY_GAP_Y:        -72,
    HISTORY_LOAD_MORE_Y:  -260,

    // Trophies view — 3×2 grid of TrophyTile.
    TROPHY_GRID_BASE_Y:   220,
    TROPHY_GRID_STRIDE_Y: -220,
    TROPHY_EMPTY_Y:       540,
};

// 2026-04-27 — LeaderboardPanel deterministic Y anchors.
// Hub-style page accessed from HomePanel's trophy icon (alongside Portfolio).
// Layout is locked — every page-level Y derives from this block. Card-internal
// child y values stay inline. Panel root is offset by (0, -SAFE_AREA_TOP, 0).
const leaderboard = {
    // Header band — back / title / subtitle.
    BACK_Y:           720,
    TITLE_Y:          680,
    SUBTITLE_Y:       638,

    // Mode-tabs row + this-week chip (segmented control).
    MODE_TABS_Y:      590,

    // Hero rank-#1 card.
    TOP_PLAYER_Y:     510,

    // Rank rows 2–10 (lbRow template).
    ROWS_BASE_Y:      400,
    ROWS_GAP_Y:       -64,

    // Empty state (when zero matches in mode/timeframe).
    EMPTY_STATE_Y:    150,

    // Sticky-bottom personal rank card ("YOU" footer).
    PERSONAL_RANK_Y:  -440,

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
    ROW_W:            660,
    ROW_H:            100,
    ROW_BASE_Y:       400,    // first row center
    ROW_GAP_Y:        -110,   // stride downward
    ROW_COUNT:        6,

    // Empty state (shown when zero active matches).
    EMPTY_STATE_Y:    120,
    EMPTY_TITLE_Y:    60,
    EMPTY_SUB_Y:      0,
    EMPTY_CTA_Y:      -60,

    // "+N more" label below row 5 when n > 6.
    MORE_LABEL_Y:    -260,

    // Footer.
    STATUS_Y:         -740,
};

const LayoutSpec = {
    // 2026-04-29 — exposed for generator helpers (mkBackHeader, etc.).
    UNIFORM_HEADER,
    UNIFORM_TEXT,
    UNIFORM_SPACE,
    UNIFORM_LAYOUT,
    UNIFORM_CARD,
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
            // 2026-04-27 UX upgrade — depth gradient (purple top → near-black bottom)
            // sitting BEHIND the global Starfield. Three-stack opacity falloff per
            // band, matching the BackgroundGlow_TopLeft_Outer/Mid/Inner pattern.
            bgGradientTopOuter:  { x: 0,   y: 480,  w: 720, h: 320, type: 'sprite',     notes: 'deep purple top band, low alpha (≈18) — softens into mid' },
            bgGradientTopMid:    { x: 0,   y: 540,  w: 720, h: 200, type: 'sprite',     notes: 'deep purple top band, mid alpha (≈40)' },
            bgGradientTopInner:  { x: 0,   y: 600,  w: 720, h: 80,  type: 'sprite',     notes: 'deep purple top band, peak alpha (≈80) at very top' },
            bgGradientBotOuter:  { x: 0,   y: -480, w: 720, h: 320, type: 'sprite',     notes: 'near-black bottom band, low alpha (≈22) — softens into mid' },
            bgGradientBotMid:    { x: 0,   y: -560, w: 720, h: 200, type: 'sprite',     notes: 'near-black bottom band, mid alpha (≈55)' },
            bgGradientBotInner:  { x: 0,   y: -620, w: 720, h: 80,  type: 'sprite',     notes: 'near-black bottom band, peak alpha (≈110) at very bottom' },
            // Hero band (compressed — was y=500/432/220/45/-10 in v1)
            title:               { x: 0,   y: landing.TITLE_Y,    w: 680, h: 72,  type: 'label',      notes: 'Token Duel — 64pt display, gold + letter-spacing 2 + halo behind' },
            // 2026-04-27 UX upgrade — gold halo behind title for shimmer.
            titleGlow:           { x: 0,   y: landing.TITLE_Y,    w: 720, h: 140, type: 'sprite',     notes: 'gold radial halo behind TitleLabel; alpha-pulsed by LandingFX.addGlowPulse' },
            subtitle:            { x: 0,   y: landing.SUBTITLE_Y, w: 680, h: 30,  type: 'label',      notes: '"Outperform. Or get outperformed." — 22pt body, mid, dimmed' },
            mascot:              { x: 0,   y: landing.MASCOT_Y,   w: 320, h: 320, type: 'mascot',     notes: '2026-04-28 hackathon UX: w/h 280→320 (+14%); mascot is the centerpiece' },
            // 2026-04-27 UX upgrade — soft drop-shadow ellipse below mascot.
            mascotShadow:        { x: 0,   y: landing.MASCOT_Y - 170, w: 240, h: 28, type: 'sprite', notes: '2026-04-28 hackathon UX: shadow w 200→240, drop 20 to follow taller mascot; cl(0,0,0,90)' },
            // 2026-04-27 UX upgrade — violet radial bloom behind mascot.
            mascotGlow:          { x: 0,   y: landing.MASCOT_Y,   w: 520, h: 520, type: 'sprite',     notes: '2026-04-28 hackathon UX: w/h 440→520 (+18%); violet radial halo grows with mascot; alpha-pulsed by LandingFX.addGlowPulse' },
            // CTA card backdrop — semi-translucent dark surface w/ violet edge.
            ctaCardBg:           { x: 0,   y: landing.CTA_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 440, type: 'group',      notes: 'visual grouping behind action stack; bg.card #1E2438 alpha 130 + violet top edge accent' },
            // Action stack (top → bottom: Connect → Trust line → Play as Guest → Reconnect).
            connectBtn:          { x: 0,   y: landing.CONNECT_Y,   w: UNIFORM_LAYOUT.CONTENT_W, h: 110, type: 'btnPrimary', notes: 'PRIMARY — gradient + glow + chevron; "Stake SOL · Win SOL"' },
            connectChevron:      { x: 290, y: landing.CONNECT_Y,   w: 24,  h: 28,  type: 'label',      notes: 'right-aligned › inside ConnectButton — directional cue' },
            trustLine:           { x: 0,   y: landing.TRUST_Y,     w: 640, h: 20,  type: 'label',      notes: '"Secure · Non-custodial · You control your wallet" — sits directly under Connect inside card; green-tinted for reassurance' },
            // 2026-04-28 hackathon UX — "live system" cue sits between trust line and Guest button.
            liveSignalLabel:     { x: 0,    y: landing.LIVE_SIGNAL_Y,     w: 640, h: 20, type: 'label',     notes: '"Live now · Join in seconds" — energy cue under Connect; teal-tinted' },
            liveSignalDot:       { x: -118, y: landing.LIVE_SIGNAL_Y + 1, w: 8,   h: 8,  type: 'sprite',    notes: '2026-04-28 polish — leading green dot pulsed by LandingFX.addGlowPulse' },
            playAsGuestBtn:      { x: 0,   y: landing.GUEST_Y,     w: UNIFORM_LAYOUT.CONTENT_W, h: 88,  type: 'btnSuccess', notes: '2026-04-27 UX upgrade: w/h 660/100→640/88 — softer than primary' },
            reconnBtn:           { x: 0,   y: landing.RECONNECT_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 72,  type: 'btnGhost',   notes: '2026-04-27 UX upgrade: w/h 660/80→620/72 — minimal weight; only active when AuthCache.hasCachedAuth' },
            connectionStatusPill:{ x: 0,   y: landing.STATUS_PILL_Y, w: 200, h: 40, type: 'chip',      notes: 'subtle bottom pill — disconnected/connecting/failed states' },
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
            // 2026-04-27 UX upgrade — gradient + halos + shadow are intentionally
            // layered BEHIND or AROUND their anchor elements.
            ['BgGradientTopOuter', 'BgGradientTopMid'],
            ['BgGradientTopOuter', 'BgGradientTopInner'],
            ['BgGradientTopMid', 'BgGradientTopInner'],
            ['BgGradientBotOuter', 'BgGradientBotMid'],
            ['BgGradientBotOuter', 'BgGradientBotInner'],
            ['BgGradientBotMid', 'BgGradientBotInner'],
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
            findMatchBtn:        { x: 0,    y: home.FIND_CTA_Y,   w: 680, h: 136, type: 'btnSuccess', notes: 'V6 HERO teal — h 128→136 (+8 over secondary tier); idle pulse + ripple + shimmer + strong-press' },
            findMatchSubtitle:   { x: 0,    y: -36,               w: 620, h: 20,  type: 'label',      notes: 'V6 — y -32→-36, h 18→20 for 16pt copy in 136h hero' },
            findMatchChevron:    { x: 310,  y: 0,                 w: 24,  h: 24,  type: 'label',      notes: '"›" glyph child of button, anchored right' },
            findMatchCountBadge: { x: 244,  y: home.FIND_BADGE_Y, w: 96,  h: 36,  type: 'badge',      notes: 'V6 — bumped 88×32 → 96×36, label 16→18 bold for hero weight' },
            findMatchActivityDot:{ x: -296, y: home.FIND_DOT_Y,   w: 10,  h: 10,  type: 'badge',      notes: 'V4 NEW — pulsing teal dot, upper-left of hero, visible when lobbies > 0' },
            startMatchBtn:       { x: 0,    y: home.START_CTA_Y,  w: 680, h: 104, type: 'btnPrimary', notes: 'V6 secondary purple — h 96→104 (top of 88-104 range)' },
            startMatchSubtitle:  { x: 0,    y: -26,               w: 620, h: 20,  type: 'label',      notes: 'V6 — y -22→-26, h 18→20 for 16pt copy' },
            startMatchChevron:   { x: 310,  y: 0,                 w: 24,  h: 24,  type: 'label',      notes: 'CHILD of StartMatchButton' },
            matchesInProgressBtn:        { x: 0,    y: home.MIP_CTA_Y,   w: 680, h: 104, type: 'btnGhost',   notes: 'V6 NEUTRAL charcoal — h 80→104; secondaries unify at 104 (Find +8 over)' },
            matchesInProgressSubtitle:   { x: 0,    y: -28,               w: 620, h: 16,  type: 'label',      notes: 'V6 — y -26→-28, h 14→16 for 12pt copy in taller 104h ghost button' },
            matchesInProgressChevron:    { x: 310,  y: 0,                 w: 24,  h: 24,  type: 'label',      notes: 'CHILD of MatchesInProgressButton' },
            matchesInProgressCountBadge: { x: 244,  y: home.MIP_BADGE_Y,  w: 88,  h: 32,  type: 'badge',      notes: 'V6 — bumped 76×28 → 88×32, label 14→16 bold (catches up to old Find size)' },
            matchesInProgressActivityDot:{ x: -296, y: home.MIP_DOT_Y,    w: 10,  h: 10,  type: 'badge',      notes: 'V4 NEW — pulsing teal dot, left edge, visible when active games > 0' },
            botMatchBtn:         { x: 0,    y: home.BOT_CTA_Y,    w: 680, h: 104, type: 'btnWarn',    notes: 'V6 — h 88→104 to match Start/MIP tier; full-width gold, two-line subtitle' },
            botMatchSubtitle:    { x: 0,    y: -24,  w: 620, h: 16,  type: 'label',      notes: 'V6 — y -22→-24, h 14→16 for 12pt copy line 1 ("Train before real matches")' },
            botMatchSubtitleLine2: { x: 0,  y: -42,  w: 620, h: 14,  type: 'label',      notes: 'V6 — y -38→-42, h 12→14 for line 2 ("N free matches left")' },
            botMatchChevron:     { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label',      notes: 'CHILD of BotMatchButton (x 270→310 for full-width)' },
            // ── TRAINING HERO CARD — V4 REMOVED ──
            // V4 — HomeTrainingCard + mascot + glow + 4 labels deleted.
            // Mascot definition kept off-flow so AppUI MascotController lookups
            // don't 404 at runtime; mascot only renders inside PostMatch panel
            // now. Training copy lives on the Bot Match card.
            mascot:              { x: 0,    y: home.LEGACY_RAKE_Y, w: 160, h: 180, type: 'mascot',   notes: 'V4 — pinned off-flow; only PostMatchPanel renders the mascot now' },
            homeStatus:          { x: 0,    y: -148, w: 460, h: 16,  type: 'label',     notes: 'V6 — y -120→-148 to clear new Bot bottom y=-114 + 34px breathing room' },
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
    // Lock-in redesign — modal reframed as commitment screen, not settings.
    // Title "Configure Your Duel" + thin gold divider, softened section
    // labels (title-case 13pt, no tracking), bigger primary mode buttons,
    // shrunken secondary chips, new MatchSummaryCard above CTA, larger
    // "Enter Match" CTA. Hint and wagerReadout removed (folded into card).
    ModePickerOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            title:             { x: 0,    y: 580,  w: 600, h: 48, type: 'label',
                notes: 'Lock-in: "Configure Your Duel" 32pt gold bold tracked' },
            titleDivider:      { x: 0,    y: 548,  w: 240, h: 2,  type: 'sprite',
                notes: 'Thin gold divider under title' },
            cancelBtn:         { x: 290,  y: 580,  w: 44,  h: 44, type: 'btnGhost' },
            // Section headers — title-case 13pt no-tracking; less shouty.
            sectionMode:       { x: 0,    y: 490,  w: 580, h: 18, type: 'label' },
            sectionDuration:   { x: 0,    y: 200,  w: 580, h: 18, type: 'label' },
            sectionTrack:      { x: 0,    y: 90,   w: 580, h: 18, type: 'label' },
            sectionDifficulty: { x: 0,    y: -30,  w: 580, h: 18, type: 'label' },
            paperToggle:       { x: -100, y: 40,   w: 200, h: 52, type: 'btnPrimary' },
            realToggle:        { x: 100,  y: 40,   w: 200, h: 52, type: 'btnGhost' },
            // New summary card — gold-edged dark card with mode/modifiers/stake stack.
            summaryCard:       { x: 0,    y: -200, w: 600, h: 130, type: 'group',
                notes: 'Lock-in card; gold edge; mode/modifiers/stake stack.' },
            startBtn:          { x: 0,    y: -340, w: 580, h: 96,  type: 'btnPrimary',
                notes: '"Enter Match" hero CTA — taller than Phase 23 (was 560×80).' },
            statusLbl:         { x: 0,    y: -440, w: 600, h: 20, type: 'label' },
        },
        templates: {
            // Stage 3 mode rebalance: [1v1, Trio, 4p, 8p].
            // Names: Mode_<key>. AppUI key handlers in _onPickerModeTap key off these.
            modeBtn: {
                count: 4, w: 320, h: 96,
                keys: ['oneVone', 'trio', 'fourPlayer', 'eightPlayer'],
                labels: ['1 vs 1', 'Trio · 1v1v1', '4 Player FFA', 'Battle Royale'],
                positions: [
                    { x: -170, y: 420 },
                    { x:  170, y: 420 },
                    { x: -170, y: 290 },
                    { x:  170, y: 290 },
                ],
            },
            // 6 duration chips — shrunk to 92×44 (was 100×52); secondary weight.
            windowBtn: {
                count: 6, w: 92, h: 44, y: 148,
                keys: ['30s', '1m', '5m', '1h', '24h', '7d'],
                labels: ['30s', '1m', '5m', '1h', '24h', '7d'],
                baseX: -275, gapX: 110,
            },
            // 3 difficulty chips — shrunk to 168×44 (was 180×52); secondary weight.
            difficultyBtn: {
                count: 3, w: 168, h: 44, y: -90,
                keys: ['easy', 'medium', 'hard'],
                labels: ['Easy', 'Medium', 'Hard'],
                names: ['PickerDifficultyEasy', 'PickerDifficultyMedium', 'PickerDifficultyHard'],
                baseX: -186, gapX: 186,
            },
        },
        allowedOverlaps: [
            ['PickerSummaryCard', 'PickerSummaryModeLabel'],
            ['PickerSummaryCard', 'PickerSummaryModifiersLabel'],
            ['PickerSummaryCard', 'PickerSummaryStakeLabel'],
            ['PickerSummaryCard', 'CardEdgeAccent'],
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

            // Timer + countdown (centered top row)
            timerRing:        { x: 0,    y: race.TOP_HEADER_Y, w: 132, h: 132, type: 'graphics' },
            timerPulse:       { x: 0,    y: 0,    w: 100, h: 100, type: 'graphics', notes: 'inside ring; coords relative to ring' },
            countdownLabel:   { x: 0,    y: race.TOP_HEADER_Y, w: 100, h: 32,  type: 'label' },

            // Hero portfolio delta — right-aligned in top row, bold/primary.
            heroDelta:        { x: 240,  y: race.TOP_HEADER_Y, w: 220, h: 80,  type: 'label' },

            // Player token row container — 3 horizontal cards (tightened spacing)
            playerTokenRow:   { x: 0,    y: race.PLAYER_TOKEN_ROW_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 110, type: 'group' },

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

            // Opponent hero delta — slightly LARGER than player (80pt vs 56pt)
            // for symmetry of stake when losing the duel.
            opponentDelta:    { x: 0,    y: race.OPP_HERO_DELTA_Y, w: 680, h: 96,  type: 'label' },

            // Opponent identity card — moved ABOVE opponent tokens. Internals
            // via templates.identityCard. Single combined "BOT · Lv 3" copy.
            opponentIdentityCard:  { x: 0,   y: race.OPP_IDENTITY_Y, w: 280, h: 44, type: 'sprite' },

            // Opponent token row container — 3 horizontal cards (mirror player)
            opponentTokenRow: { x: 0,    y: race.OPP_TOKEN_ROW_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 110, type: 'group' },

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
            homeBtn:          { x: race.HOME_BTN_X, y: race.HOME_BTN_Y, w: 140, h: 36, type: 'btnGhost',
                notes: '2026-04-27 — "← Home" non-destructive escape; PortfolioRace keeps running, match resumable via MIP panel.' },

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
            // (OpponentTokenCard_0..2) rows. Internal sym top, delta middle,
            // contribution bar bottom (Graphics, drawn per tick).
            duelTokenCard: {
                count: 3, w: 216, h: 110,
                baseX: -228, gapX: 228,
                sym:   { x: 0,   y: 32,  w: 196, h: 28 },
                delta: { x: 0,   y: -8,  w: 196, h: 36 },
                bar:   { x: 0,   y: -42, w: 180, h: 6 },
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
            sheetBg:         { x: 0,    y: -40,  w: 692, h: 1180, type: 'sprite',
                notes: 'subtle dark overlay (z-order behind all cards) — first child of SettingsPanel' },
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: UNIFORM_HEADER.BACK_Y, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:           { x: 0,    y: UNIFORM_HEADER.TITLE_Y, w: 400, h: 44,  type: 'label' },
            // Wallet → compact identity card (160→124, ~22% reduction).
            // Layout: header row (status dot + secondary "Connected · MWA"),
            // pubkey row (mono, prominent, with copy icon), divider, balance row.
            // Violet glow border (4 perimeter strokes) replaces top hairline.
            walletCard:      { x: 0,    y: settings.WALLET_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 124, type: 'group',
                children: {
                    header:        { x: -220, y: 42,  w: 200, h: 16, type: 'label',
                        notes: 'micro-header "WALLET" — 2026-04-27 x -304→-220 to clear card-left edge' },
                    statusDot:     { x: -270, y: 18,  w: 12,  h: 12, type: 'sprite' },
                    walletName:    { x: 4,    y: 18,  w: 540, h: 18, type: 'label',
                        notes: 'secondary "Connected · {wallet}" (12px mid-text)' },
                    walletPubkey:  { x: -52,  y: -6,  w: 460, h: 24, type: 'label',
                        notes: 'mono 18px hi-text, left-aligned identity' },
                    copyPubkeyBtn: { x: 252,  y: -6,  w: 36,  h: 36, type: 'btnGhost' },
                    divider:       { x: 0,    y: -26, w: 632, h: 1,  type: 'sprite',
                        notes: 'hairline between pubkey and balance, white α 24' },
                    walletBalance: { x: -290, y: -38, w: 460, h: 20, type: 'label',
                        notes: 'mono 16px teal, left-aligned — 2026-04-27 x -304→-290 / y -42→-38 to clear card border (kept above divider y=-26)' },
                    glowTop:       { x: 0,    y: 61,  w: 686, h: 2,  type: 'sprite',
                        notes: 'violet α 80 perimeter stroke (top)' },
                    glowBot:       { x: 0,    y: -61, w: 686, h: 2,  type: 'sprite' },
                    glowLeft:      { x: -343, y: 0,   w: 2,   h: 122, type: 'sprite' },
                    glowRight:     { x: 343,  y: 0,   w: 2,   h: 122, type: 'sprite' },
                },
            },
            // Profile — Phase 31 dual-mode: a display row (label + edit pencil)
            // and a hidden edit row (input + Cancel + Confirm). AppUI flips the
            // two subtrees on tap so committing a username feels intentional
            // rather than "stop typing and pray". Username label gets a soft
            // trophy glyph + faded helper line tying it to leaderboard identity.
            profileCard:     { x: 0,    y: settings.PROFILE_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 148, type: 'group',
                children: {
                    header:           { x: -220, y: 56,  w: 200, h: 16, type: 'label' },
                    usernameLabel:    { x: -220, y: 36,  w: 200, h: 16, type: 'label',
                        notes: '"Username" 11px mid-text above the input' },
                    // Display-mode subtree (default visible).
                    usernameDisplay:  { x: -10,  y: 6,   w: 520, h: 32, type: 'label',
                        notes: 'username readout (22px hi-text); replaced by EditBox in edit mode' },
                    editUsernameBtn:  { x: 290,  y: 6,   w: 44,  h: 44, type: 'btnGhost',
                        notes: 'pencil glyph, opens edit subtree on tap' },
                    // Edit-mode subtree (hidden by default).
                    focusRing:        { x: 0,    y: 6,   w: 624, h: 48, type: 'sprite',
                        notes: 'violet stroke around EditBox, alpha 0 → 80 on focus' },
                    username:         { x: 0,    y: 6,   w: 620, h: 44, type: 'editbox' },
                    usernameCancelBtn:{ x: -110, y: -28, w: 140, h: 34, type: 'btnGhost',
                        notes: 'edit-mode Cancel; hidden in display mode' },
                    usernameConfirmBtn:{x:  110, y: -28, w: 140, h: 34, type: 'btnPrimary',
                        notes: 'edit-mode Confirm; disabled until input differs from saved value' },
                    // Status band — error string in edit mode, "saved ✓" flash in display mode.
                    usernameSaved:    { x: 0,    y: -52, w: 620, h: 18, type: 'label' },
                    usernameHelp:     { x: 0,    y: -52, w: 620, h: 16, type: 'label',
                        notes: 'display-mode helper "🏆 Displayed on leaderboard & matches"; hidden when usernameSaved is non-empty' },
                    topBorder:        { x: 0,    y: 73,  w: 686, h: 1,  type: 'sprite' },
                },
            },
            // Phase 29 — "DEFAULT MATCH SETTINGS". Phase 30 — drops ▾ glyph
            // from value labels and adds a › chevron child to each row for
            // stronger affordance. Trading-mode toggle gains a teal glow halo.
            quickPlayCard:   { x: 0,    y: settings.QP_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 260, type: 'group',
                children: {
                    header: { x: -120, y: 116, w: 400, h: 18, type: 'label' },
                    qpModeRow:   { x: 0, y: 76,  w: 620, h: 40, type: 'btnGhost',
                        children: {
                            keyLabel:   { x: -284, y: 0, w: 200, h: 20, type: 'label' },
                            valueLabel: { x:  120, y: 0, w: 280, h: 22, type: 'label' },
                            chevron:    { x:  282, y: 0, w: 20,  h: 22, type: 'label' },
                        },
                    },
                    qpWindowRow: { x: 0, y: 30,  w: 620, h: 40, type: 'btnGhost',
                        children: {
                            keyLabel:   { x: -284, y: 0, w: 200, h: 20, type: 'label' },
                            valueLabel: { x:  120, y: 0, w: 280, h: 22, type: 'label' },
                            chevron:    { x:  282, y: 0, w: 20,  h: 22, type: 'label' },
                        },
                    },
                    qpWagerRow:  { x: 0, y: -16, w: 620, h: 40, type: 'btnGhost',
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
                            switchTrack: { x:  254, y: 0,   w: 52,  h: 30, type: 'sprite' },
                            switchKnob:  { x:  266, y: 0,   w: 24,  h: 24, type: 'sprite',
                                notes: 'starts at switchTrack.x+12 when ON, x-12 when OFF' },
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
                            switchTrack: { x:  254, y: 0,   w: 52,  h: 30, type: 'sprite' },
                            switchKnob:  { x:  266, y: 0,   w: 24,  h: 24, type: 'sprite' },
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
            // Disconnect. Card grows 200 → 232 to accommodate the headers.
            accountCard:     { x: 0,    y: settings.ACCOUNT_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 232, type: 'group',
                children: {
                    header:           { x: -120, y: 100, w: 400, h: 16, type: 'label' },
                    generalGroupLabel:{ x: -220, y: 78,  w: 200, h: 14, type: 'label',
                        notes: '"GENERAL" group header (lo-text, 10px)' },
                    feesRow:          { x: 0,    y: 46,  w: 620, h: 48, type: 'btnGhost',
                        children: {
                            icon:    { x: -274, y: 0,   w: 26, h: 26, type: 'sprite' },
                            // label x shifted -232 → -190 so the auto-fitted text box (overflow=NONE
                            // means anchor 0.5/0.5 centers text on lpos.x) clears the icon at x=-274.
                            label:   { x: -190, y: 0,   w: 360, h: 22, type: 'label' },
                            chevron: { x:  282, y: 0,   w: 20,  h: 22, type: 'label' },
                        },
                    },
                    groupDivider:     { x: 0,    y: 16,  w: 600, h: 1, type: 'sprite',
                        notes: 'GENERAL / SESSION separator hairline' },
                    sessionGroupLabel:{ x: -220, y: -2,  w: 200, h: 14, type: 'label' },
                    reconnectRow:     { x: 0,    y: -34, w: 620, h: 48, type: 'btnGhost',
                        children: {
                            icon:    { x: -274, y: 0,   w: 26, h: 26, type: 'sprite' },
                            // label x shifted -232 → -190 so the auto-fitted text box (overflow=NONE
                            // means anchor 0.5/0.5 centers text on lpos.x) clears the icon at x=-274.
                            label:   { x: -190, y: 0,   w: 360, h: 22, type: 'label' },
                            chevron: { x:  282, y: 0,   w: 20,  h: 22, type: 'label' },
                        },
                    },
                    rowDivider:       { x: 0,    y: -64, w: 600, h: 1, type: 'sprite',
                        notes: 'subtle separator between reconnect + disconnect rows' },
                    disconnectRow:    { x: 0,    y: -90, w: 620, h: 48, type: 'btnGhost',
                        children: {
                            icon:    { x: -274, y: 0,   w: 26, h: 26, type: 'sprite' },
                            // label x shifted -232 → -190 so the auto-fitted text box (overflow=NONE
                            // means anchor 0.5/0.5 centers text on lpos.x) clears the icon at x=-274.
                            label:   { x: -190, y: 0,   w: 360, h: 22, type: 'label' },
                            chevron: { x:  282, y: 0,   w: 20,  h: 22, type: 'label' },
                        },
                    },
                    topBorder:        { x: 0, y: 115, w: 686, h: 1, type: 'sprite' },
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
            ['WalletDivider',       'WalletGlowLeft'],
            ['WalletDivider',       'WalletGlowRight'],
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
            mipRow: {
                count: mip.ROW_COUNT, w: mip.ROW_W, h: mip.ROW_H,
                baseY: mip.ROW_BASE_Y, gapY: mip.ROW_GAP_Y,
                // Thin teal accent on far left (only chrome).
                edge:       { x: -326, y: 0,   w: 4,   h: 80 },
                // VS line (left, top): "VS BOT" / "VS @user".
                vsLabel:    { x: -180, y: 18,  w: 280, h: 28 },
                // Time line (right, top): "18h 42m left".
                timeLabel:  { x: 180,  y: 18,  w: 140, h: 22 },
                // Win line (left, bottom): "Round just started" / "YOU +0.32%" / "OPP +0.50%".
                winLine:    { x: -100, y: -18, w: 220, h: 18 },
                // Stake chip (left of win line, bottom): "PAPER" / "0.5 SOL".
                stakeChip:  { x: -220, y: -18, w: 120, h: 18 },
                // Resume button (right, center).
                resumeBtn:  { x: 220,  y: 0,   w: 100, h: 36 },
                // Full-row invisible tap target.
                tapTarget:  { x: 0,    y: 0,   w: mip.ROW_W, h: mip.ROW_H },
            },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
            // Tap target sits behind all visible row content.
            ['MIPTapTarget', 'MIPCardEdge'],
            ['MIPTapTarget', 'MIPVsLabel'],
            ['MIPTapTarget', 'MIPTimeLabel'],
            ['MIPTapTarget', 'MIPWinLine'],
            ['MIPTapTarget', 'MIPStakeChip'],
            ['MIPTapTarget', 'MIPResumeBtn'],
            // Stake chip and win line share the bottom row at the same y; they
            // are positioned to not overlap visually but their bbox may.
            ['MIPStakeChip', 'MIPWinLine'],
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
            // 2026-04-29: back y override → 720 to sit on par with HubTabStrip (built at runtime at y=720, h=56).
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: 720, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: 720, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:           { x: 0,    y: leaderboard.TITLE_Y,    w: 400, h: 44,  type: 'label' },
            // Subtitle line under title — "{mode} · This Week" / "All modes · This Week".
            subtitle:        { x: 0,    y: leaderboard.SUBTITLE_Y, w: 520, h: 24,  type: 'label' },
            // Pill-shaped bg behind the 4 mode tabs (segmented control container).
            modeTabsContainer: { x: -90, y: leaderboard.MODE_TABS_Y, w: 480, h: 46, type: 'sprite',
                notes: 'segmented-control bg behind 4 mode tabs (left-anchored)' },
            // Standalone "This Week" chip on the right of the segmented control.
            // Node name kept as LBTab_season (modeU8=4) so the existing handler still binds.
            thisWeekChip:    { x: 240,  y: leaderboard.MODE_TABS_Y,  w: 130, h: 42,  type: 'btnGhost' },
            // Hero card for rank #1. AppUI fills entries[0] here and skips LBRow_0.
            topPlayerCard:   { x: 0,    y: leaderboard.TOP_PLAYER_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 110, type: 'group',
                children: {
                    crown:   { x: -290, y: 22,  w: 40,  h: 40, type: 'label' },
                    rank:    { x: -240, y: 22,  w: 60,  h: 28, type: 'label' },
                    player:  { x: -50,  y: 18,  w: 240, h: 28, type: 'label' },
                    elapsed: { x: -50,  y: -16, w: 240, h: 18, type: 'label' },
                    score:   { x: 230,  y: 4,   w: 160, h: 40, type: 'label' },
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
            // Sticky-bottom YOU card — y=-440 keeps it inside the panel after SAFE_AREA_TOP=110 shift.
            personalRankCard: { x: 0,   y: leaderboard.PERSONAL_RANK_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 130, type: 'group',
                children: {
                    header: { x: -290, y: 46,  w: 120, h: 18, type: 'label' },
                    rank:   { x: -90,  y: 22,  w: 440, h: 28, type: 'label' },
                    stats:  { x: -90,  y: -8,  w: 440, h: 22, type: 'label' },
                    cta:    { x: 220,  y: -42, w: 200, h: 40, type: 'btnGhost' },
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
            lbRow: {
                count: 9, w: UNIFORM_LAYOUT.CONTENT_W, h: 56,
                baseY: leaderboard.ROWS_BASE_Y, gapY: leaderboard.ROWS_GAP_Y,
                rank:    { x: -300, y: 0,   w: 50,  h: 30 },
                player:  { x: -110, y: 6,   w: 280, h: 24 },
                score:   { x: 220,  y: 6,   w: 120, h: 28 },
                elapsed: { x: -110, y: -16, w: 280, h: 18 },
            },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
            // Segmented control: tabs sit ON ModeTabsContainer by design.
            ['ModeTabsContainer', 'LBTab_1v1'],
            ['ModeTabsContainer', 'LBTab_trio'],
            ['ModeTabsContainer', 'LBTab_4p'],
            ['ModeTabsContainer', 'LBTab_8p'],
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
            // 2026-04-29 — uniform back/title header, mirrors MIP. refreshBtn
            // sits to the right of the title (was sharing the back row at y=700);
            // moved to y=540 to flank the title.
            // 2026-04-29: back y override → 750 to sit on par with lvxpChip (the panel's topmost solid element).
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: 750, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: 750, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:           { x: 0,    y: UNIFORM_HEADER.TITLE_Y, w: 400, h: 44, type: 'label',    notes: 'gold bold; sword IconBadge attached at runtime via _attachStaticIconBadges' },
            refreshBtn:      { x: 280,  y: UNIFORM_HEADER.TITLE_Y, w: 56,  h: 44, type: 'btnGhost', notes: 'AppUI tween-spins the icon on tap for refresh feedback' },
            countLabel:      { x: 0,    y: UNIFORM_HEADER.SUBTITLE_Y, w: 600, h: 22, type: 'label',    notes: 'live count pill — pulses via addIdlePulse; sits in subtitle slot' },
            // Phase A2 — Lv/XP chip TOP-RIGHT of header (relocated from -260
            // → 240 in Stage 2 to match the new Home + TokenDuel pattern).
            lvxpChip:        { x: 240,  y: 750,  w: 200, h: 32, type: 'chip',     notes: '"Lv N · X/Y"; gold-on-dim; hidden when not connected' },
            // 2026-04-28 final pass — Hide-full now lives INSIDE FilterCard footer.
            hideFullToggle:  { x: 0,    y: 418,  w: 160, h: 24, type: 'btnPrimary', notes: '2026-04-28 polish — utility tone, smaller + lower contrast (Phase F)' },
            // 2026-04-27 FindMatch redesign — pulse dot left of count label.
            // AppUI tints rose/teal per active tab and runs addIdlePulse on it.
            liveCountPulseDot:  { x: -90, y: UNIFORM_HEADER.SUBTITLE_Y, w: 10, h: 10, type: 'sprite', notes: 'addIdlePulse — rose on Live, teal on Open; tracks countLabel y' },
            // 2026-04-28 final pass — unified FilterCard now contains EVERYTHING:
            // tabs (top), 3 chip rows (with row labels left), and Hide-full footer.
            // Card grew to h=240 to encapsulate all sub-elements.
            filterCard:         { x: 0, y: 510, w: UNIFORM_LAYOUT.CONTENT_W, h: 240, type: 'sprite', notes: 'violet edge — encapsulates tabs + Mode/Window/Wager rows + Hide-full footer' },
            filterDivider1:     { x: 0, y: 520, w: 620, h: 1,   type: 'sprite', notes: 'hairline between Mode and Window rows' },
            filterDivider2:     { x: 0, y: 480, w: 620, h: 1,   type: 'sprite', notes: 'hairline between Window and Wager rows' },
            filterDivider3:     { x: 0, y: 438, w: 620, h: 1,   type: 'sprite', notes: 'hairline between Wager row and Hide-full footer' },
            // 2026-04-28 final pass — small dim row labels left of each chip row.
            // x=-312, w=70 keeps right edge (-277) clear of leftmost chip's left edge (-265).
            fmModeLabel:        { x: -312, y: 540, w: 70,  h: 22, type: 'label',  notes: '"Mode" — dim text left of mode chips' },
            fmWindowLabel:      { x: -312, y: 500, w: 70,  h: 22, type: 'label',  notes: '"Duration" — dim text left of window chips' },
            fmWagerLabel:       { x: -312, y: 460, w: 70,  h: 22, type: 'label',  notes: '"Stake" — dim text left of wager chips' },
            // Tab active underline — slides between -122 and +122 via AppUI tween.
            // y=575 puts it just below the tab buttons (now inside FilterCard top).
            tabActiveUnderline: { x: -122, y: 575, w: 200, h: 4, type: 'sprite', notes: 'violet — slides under active tab (now inside FilterCard)' },
            // 2026-04-28 final pass — tail hint shown below match list when 1-2 matches present.
            // AppUI repositions y at runtime; values here cover the visibleCount=1 case.
            tailHintTitle:      { x: 0, y: 200, w: 600, h: 24, type: 'label', notes: '"No matches right now" — shown below 1-2 visible matches' },
            tailHintSubtitle:   { x: 0, y: 172, w: 600, h: 20, type: 'label', notes: '"Adjust filters or start your own duel" — sub-hint, dim' },
            // 2026-04-28 polish — Reset/Start CTAs sit ~40px below subtitle when tail visible.
            // AppUI repositions per-render based on lastCardY.
            tailResetBtn:       { x: -90,  y: 130, w: 160, h: 40, type: 'btnGhost', notes: 'Reset filters — only when tail visible' },
            tailStartBtn:       { x: 90,   y: 130, w: 160, h: 40, type: 'btnGhost', notes: 'Start a duel — only in Open Lobbies + tail visible' },
            // Phase A2 empty state — mascot + 2 CTAs replace the bare "no lobbies" label.
            emptyMascot:     { x: 0,    y: -50,  w: 200, h: 220, type: 'mascot',  notes: '3rd MascotController; think state on entry' },
            emptyTitle:      { x: 0,    y: -210, w: 600, h: 40,  type: 'label',   notes: 'gold bold "No matches yet"' },
            emptySubtitle:   { x: 0,    y: -260, w: 600, h: 22,  type: 'label',   notes: '"Be the first to host…"' },
            emptyHostBtn:    { x: -135, y: -340, w: 240, h: 64,  type: 'btnPrimary', notes: 'teal — Host New Match' },
            emptyBotBtn:     { x: 135,  y: -340, w: 240, h: 64,  type: 'btnGhost',   notes: 'amber — Play a Bot' },
            // Legacy empty state — kept for back-compat / fallback. Default _active=false.
            emptyLabel:      { x: 0,    y: -380, w: 660, h: 22, type: 'label',    notes: 'LEGACY — superseded by emptyMascot/Title/Subtitle/HostBtn/BotBtn' },
            hostBtn:         { x: 0,    y: -440, w: 540, h: 64, type: 'btnPrimary', notes: 'LEGACY — kept for binding; default _active=false' },
            status:          { x: 0,    y: -700, w: 660, h: 20, type: 'label' },
        },
        templates: {
            // 2026-04-28 final pass — tabs promoted INSIDE FilterCard top (y=602).
            // Active state is violet (Solana brand for navigation) with a sliding
            // violet underline below.
            fmTab: {
                count: 2, w: 240, h: 46, y: 602,
                keys:   ['Open', 'Live'],
                labels: ['Open Lobbies', 'Live Now'],
                xs: [-122, 122],
                activeIdx: 0,
            },
            // 5 mode-filter chips at y=540. Sit visually inside FilterCard, right
            // of fmModeLabel ("Mode:").
            fmModeFilter: {
                count: 5, w: 110, h: 36, y: 540,
                keys:   ['all', 'oneVone', 'trio', '4p', '8p'],
                labels: ['All', '1v1', 'Trio', '4p', '8p'],
                baseX: -210, gapX: 118,
            },
            // 5 window-filter chips at y=500. Sit visually inside FilterCard.
            fmWindowFilter: {
                count: 5, w: 110, h: 36, y: 500,
                keys:   ['all', '1h', '1d', '3d', '7d'],
                labels: ['All', '30s', '1m', '5m', '1h'],
                baseX: -210, gapX: 118,
            },
            // 5 wager-bucket chips at y=460. Sit visually inside FilterCard.
            fmWagerFilter: {
                count: 5, w: 110, h: 36, y: 460,
                keys:   ['all', 'low', 'mid', 'high', 'whale'],
                labels: ['All', 'Low', 'Mid', 'High', 'Whale'],
                baseX: -210, gapX: 118,
            },
            // 8 match cards. 2026-04-28 final pass: bumped h 90 → 108, gapY −100 → −118,
            // baseY 360 → 320, capacity bar 5 → 8 thick, Resume btn 120×64 → 150×80.
            matchRow: {
                count: 8, w: UNIFORM_LAYOUT.CONTENT_W, h: 108,
                baseY: 320, gapY: -118,
                edgeStripe: { x: -325, y: 0,   w: 14,  h: 96 },  // mode-color accent (taller)
                gradient:   { x: 0,    y: 22,  w: UNIFORM_LAYOUT.CONTENT_W, h: 54 },  // top-half sheen overlay
                glow:       { x: 0,    y: 0,   w: 668, h: 116 }, // border glow (alpha 0 default)
                mode:       { x: -260, y: 28,  w: 100, h: 26 },
                wager:      { x: -90,  y: 28,  w: 160, h: 32 },  // bold gold hero
                trackChip:  { x: 50,   y: 28,  w: 78,  h: 28 },  // REAL/PAPER pill
                window:     { x: 145,  y: 28,  w: 120, h: 22 },
                sub:        { x: -280, y: -22, w: 540, h: 18 },
                capBar:     { x: -30,  y: -44, w: 300, h: 8 },   // thicker background track
                capBarFill: { x: -30,  y: -44, w: 300, h: 8 },   // foreground fill
                join:       { x: 275,  y: 0,   w: 150, h: 80 },  // dominant CTA (larger)
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
            // 2026-04-28 final pass — FilterCard now ENCAPSULATES tabs + chips + dividers + hide-full + row labels.
            ['FilterCard', 'FilterMode_all'],
            ['FilterCard', 'FilterMode_oneVone'],
            ['FilterCard', 'FilterMode_trio'],
            ['FilterCard', 'FilterMode_4p'],
            ['FilterCard', 'FilterMode_8p'],
            ['FilterCard', 'FilterWindow_all'],
            ['FilterCard', 'FilterWindow_1h'],
            ['FilterCard', 'FilterWindow_1d'],
            ['FilterCard', 'FilterWindow_3d'],
            ['FilterCard', 'FilterWindow_7d'],
            ['FilterCard', 'FilterWager_all'],
            ['FilterCard', 'FilterWager_low'],
            ['FilterCard', 'FilterWager_mid'],
            ['FilterCard', 'FilterWager_high'],
            ['FilterCard', 'FilterWager_whale'],
            ['FilterCard', 'FilterDivider1'],
            ['FilterCard', 'FilterDivider2'],
            ['FilterCard', 'FilterDivider3'],
            ['FilterCard', 'FindMatchTab_Open'],
            ['FilterCard', 'FindMatchTab_Live'],
            ['FilterCard', 'TabActiveUnderline'],
            ['FilterCard', 'FilterHideFullToggle'],
            ['FilterCard', 'FindMatchModeRowLabel'],
            ['FilterCard', 'FindMatchWindowRowLabel'],
            ['FilterCard', 'FindMatchWagerRowLabel'],
            ['FilterCard', 'ChipGlow_FindMatchTab_Open'],
            ['FilterCard', 'ChipGlow_FindMatchTab_Live'],
            ['FilterCard', 'ChipGlow_FilterMode_all'],
            ['FilterCard', 'ChipGlow_FilterMode_oneVone'],
            ['FilterCard', 'ChipGlow_FilterMode_trio'],
            ['FilterCard', 'ChipGlow_FilterMode_4p'],
            ['FilterCard', 'ChipGlow_FilterMode_8p'],
            ['FilterCard', 'ChipGlow_FilterWindow_all'],
            ['FilterCard', 'ChipGlow_FilterWindow_1h'],
            ['FilterCard', 'ChipGlow_FilterWindow_1d'],
            ['FilterCard', 'ChipGlow_FilterWindow_3d'],
            ['FilterCard', 'ChipGlow_FilterWindow_7d'],
            ['FilterCard', 'ChipGlow_FilterWager_all'],
            ['FilterCard', 'ChipGlow_FilterWager_low'],
            ['FilterCard', 'ChipGlow_FilterWager_mid'],
            ['FilterCard', 'ChipGlow_FilterWager_high'],
            ['FilterCard', 'ChipGlow_FilterWager_whale'],
            // Tab underline sits below tab buttons by design.
            ['TabActiveUnderline', 'FindMatchTab_Open'],
            ['TabActiveUnderline', 'FindMatchTab_Live'],
            // Pulse dot sits inside the count label band by design.
            ['FindMatchCountLabel', 'FindMatchLiveCountPulseDot'],
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
            backBtn:            { x: UNIFORM_HEADER.BACK_BTN.x,  y: 685, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:              { x: 0,    y: UNIFORM_HEADER.TITLE_Y, w: 320, h: 44, type: 'label' },
            // 2026-04-27 UI overhaul — thin violet glow line anchoring header band.
            // Sits 12 px below title baseline (TITLE_Y - title.h/2 - 12 = 540).
            headerUnderline:    { x: 0,    y: 540, w: 712, h: 2, type: 'sprite',
                notes: 'thin violet glow line under title — anchors header band, alpha 80' },
            // 2026-04-27 v3: pills shrunk further (278×54 → 140×44; 195×54 → 140×44)
            // and right-clustered so both sit on the right half of the canvas with
            // the icon row above them.
            levelPill:          { x: 85,  y: td.HEADER_Y,  w: 140, h: 44, type: 'chip',    notes: '"Lv N · curr/max XP"' },
            solPill:            { x: 255, y: td.HEADER_Y,  w: 140, h: 44, type: 'chip',    notes: '"◼ 19.99 SOL"' },
            // MatchSetupCard restored — multi-line summary directly under title.
            // Mode tag (top-left) + Squad/Stake (mid) + Hint (bottom) live INSIDE.
            // 2026-04-27 v2: h 124 → 93 (25% shorter so the rest of the layout
            // can pull upward).
            matchSetupCard:     { x: 0,    y: td.MATCHSETUP_CARD_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 93, type: 'group',
                notes: 'Match summary card; 4 child labels (mode/squad/stake/hint) populated by AppUI._refreshSquadActionButtons.' },
            // 2026-04-27 UI overhaul — thin glowing underline at bottom of matchSetupCard.
            // AppUI tints teal+breathes when squad full, mid-grey when picking. Sits at
            // matchSetupCard.y - matchSetupCard.h/2 + 1 = 480 - 46.5 + 1 ≈ 434.
            matchSetupReadyGlow:{ x: 0,    y: 434, w: UNIFORM_LAYOUT.CONTENT_W, h: 2, type: 'sprite',
                notes: 'ready-state underline; tinted by AppUI on squad full' },
            // FeedFrameCard — wraps in-card UI. Bottom shrinks with cut feed h.
            feedFrameCard:      { x: 0,    y: td.FEED_FRAME_Y,  w: 712, h: td.FEED_FRAME_H, type: 'sprite',
                notes: 'unified card behind Row 1 + Row 2 + col headers + feed' },
            search:             { x: 46,   y: td.SEARCH_Y, w: 312, h: 44, type: 'editbox' },
            searchClear:        { x: 188,  y: td.SEARCH_Y, w: 32,  h: 32, type: 'btnGhost' },
            feedTabDropdown:    { x: -224, y: td.SEARCH_Y, w: 200, h: 44, type: 'btnGhost' },
            watchlistStar:      { x: 240,  y: td.SEARCH_Y, w: 44,  h: 44, type: 'btnGhost', notes: 'icon-only ★ button (no text)' },
            cancelWatchlist:    { x: 240,  y: td.SEARCH_Y, w: 36,  h: 36, type: 'btnGhost' },
            liveIndicator:      { x: 314,  y: td.SEARCH_Y, w: 80,  h: 24, type: 'label' },
            minLiqDropdown:     { x: -16,  y: td.CHIPS_Y, w: 110, h: 32, type: 'chip' },
            columnsBtn:         { x: 270,  y: td.CHIPS_Y, w: 96,  h: 32, type: 'chip' },
            feedColumnHeaders:  { x: 0,    y: td.COL_HEADERS_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: 24, type: 'group' },
            // FeedScrollView — 2026-04-27 v2: h 388→272 (30% cut). Top y=239.
            feedScrollView:     { x: 0,    y: td.FEED_SCROLL_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: td.FEED_SCROLL_H, type: 'scrollview',
                notes: 'h cut 30% (388→272). ~3 visible rows at h=85.' },
            // SquadPanel restored to bottom; same internal layout as legacy (header →
            // 3 slots → wager row), shifted up so the gap to feed bottom matches legacy.
            squadPanel:         { x: 0,    y: td.SQUAD_PANEL_Y, w: UNIFORM_LAYOUT.CONTENT_W, h: td.SQUAD_PANEL_H, type: 'group',
                notes: 'sticky bottom card wrapping squadHeaderLabel + 3 squadSlots + wager row.' },
            squadHeaderLabel:   { x: 0,    y: td.SQUAD_HEADER_Y, w: 420, h: 24, type: 'label',
                notes: 'YOUR SQUAD label.' },
            // 2026-04-27 UI overhaul — wagerValueButton compact pill (200→160 w, 56→52 h);
            // wagerStartButton bumped 56→60 h for "full height" hero feel.
            wagerValueButton:   { x: -260, y: td.WAGER_Y, w: 160, h: 52, type: 'btnGhost',
                notes: 'tier selector; compact pill; opens WagerDropdown UPWARD.' },
            wagerStartButton:   { x:  100, y: td.WAGER_Y, w: 480, h: 60, type: 'btnPrimary',
                notes: '▶ Start Duel CTA — blue→violet gradient; relabels to "Pick X more" when squad incomplete.' },
            wagerLockChip:      { x: -260, y: td.WAGER_Y, w: 160, h: 52, type: 'chip',       notes: 'JOIN-MODE replaces wagerValueButton.' },
            wagerBotChip:       { x: -260, y: td.WAGER_Y, w: 160, h: 52, type: 'chip',       notes: 'BOT-MODE replaces wagerValueButton.' },
            wagerHintLabel:     { x: 0,    y: -700, w: 600, h: 24, type: 'label',      notes: 'LEGACY — _active=false. Hint moved into matchSetupCard.matchSetupHintLabel.' },
            wagerDropdown:      { x: -260, y: td.WAGER_DROPDOWN_Y, w: 360, h: 360, type: 'group',
                notes: 'opens UPWARD from wager-value button (anchor 0.5,0 bottom-center; _lpos.y is the dropdown bottom edge). 2026-04-27 UI overhaul: x -240→-260 to align with new compact wagerValueButton.' },
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
            status:             { x: 0,    y: td.STATUS_Y, w: 688, h: 26, type: 'label',
                notes: 'Holdings loaded (...). 55-px gap below SquadPanel bottom.' },
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
            // 20 reusable feed rows in the scroll-view content. baseY/gapY drive
            // vertical placement (rowHeight 66 + 4 gap = 70 stride, first row
            // centered at y=-33 from content top).
            //
            // Internal layout: 14 child nodes per row. SymbolLabel was w=160 in
            // Phase 8a — shrunk to 140 here so its right edge (x=-110) clears
            // ScoreLabel's left edge (x=-110), eliminating the 20× SymbolLabel
            // ↔ ScoreLabel 10-px overlap that the verifier flagged.
            // ChangeLabel and DeltaLabel share the same position (delta is
            // the alternate label, hidden by default — see allowedOverlaps).
            // feedRow — restored to legacy h=170 2-line mobile card.
            //   Top line (y=36):    [Avatar 150x150] [SYMBOL bold]   [Score]   [+24H% color]
            //   Bottom line (y=-30):                  [name·mint muted]  [Liq] [Vol]   [Price]
            feedRow: {
                // 2026-04-27 — row height +25% (240 → 300) per user request.
                // baseY shifted so first row TOP stays at content origin
                // y=0; gapY adjusted to preserve the 4-px between-row gap.
                // Child y values inside the row are unchanged — extra 60
                // units distribute as padding above + below the content.
                count: 20, w: UNIFORM_LAYOUT.CONTENT_W, h: 300,
                baseY: -150, gapY: -304,
                selectedEdge: { x: -334, y: 0,   w: 5,   h: 292, notes: 'left teal stripe — h scales with row' },
                checkbox:     { x: -320, y: 0,   w: 22,  h: 22,  notes: 'watchlist mode — hidden by default' },
                checkmark:    { x: 0,    y: 1,   w: 22,  h: 22 },
                logo:         { x: -253, y: 0,   w: 220, h: 220, notes: '2.5x hero icon — was 90×90' },
                symbol:       { x: -30,  y: 70,  w: 154, h: 26,  notes: 'bold 22pt — pushed right of bigger logo' },
                score:        { x: 40,   y: 70,  w: 44,  h: 20 },
                change:       { x: 280,  y: 70,  w: 90,  h: 30,  notes: 'HERO 24H% — 26pt bold' },
                delta:        { x: 280,  y: 70,  w: 90,  h: 30,  notes: 'alternate of change — _active=false' },
                name:         { x: -30,  y: -70, w: 154, h: 18 },
                liq:          { x: 80,   y: -70, w: 70,  h: 18 },
                vol:          { x: 160,  y: -70, w: 70,  h: 18 },
                price:        { x: 270,  y: -70, w: 90,  h: 18,  notes: 'gold mono, right-aligned, 16pt' },
                age:          { x: -2000, y: 0,  w: 1, h: 1 },
                dex:          { x: -2000, y: 0,  w: 1, h: 1 },
                liveDot:      { x: 320,  y: -150, w: 8,  h: 8 },
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
            // 3 squad slots — 2026-04-27 UI overhaul: 90×90 squares → 222×140 pillars
            // filling the squadPanel as 3 equal-width cards with 16-px gaps.
            // 222w + 16 gap = 238 stride; left card spans [-349,-127], center
            // [-111,111], right [127,349] inside the 700-wide squadPanel.
            // Internal layout: logo top-left, symbol right of logo, hero delta
            // centered, score bottom-left, perf bar at bottom edge.
            // 2026-04-28 fighter-card redesign — added slotIndex (top label,
            // "Slot 1/2/3" for empty cards) + silhouette (faint "+" placeholder
            // behind "Pick +" so empty slots read as intentional drop zones).
            squadSlot: {
                count: 3, w: 222, h: 140, y: td.SQUAD_SLOTS_Y,
                xs: [-238, 0, 238],
                slotIndex:  { x:   0, y:  54, w: 200, h: 16  },
                silhouette: { x:   0, y:  -4, w: 90,  h: 90  },
                logo:    { x: -78, y:  32, w: 56,  h: 56  },
                symbol:  { x:  16, y:  36, w: 130, h: 24  },
                delta:   { x:   0, y: -12, w: 200, h: 32  },
                score:   { x: -88, y: -52, w: 56,  h: 16  },
                perfBar: { x:   0, y: -64, w: 196, h: 3   },
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
            // 2026-04-29: back y override → 720 to sit on par with HubTabStrip (built at runtime at y=720, h=56).
            backLink: { x: UNIFORM_HEADER.BACK_LINK.x, y: 720, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:  { x: UNIFORM_HEADER.BACK_BTN.x,  y: 720, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
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
            // Trophies view container + empty label.
            trophiesView:    { x: 0, y: 0, w: 720, h: 1280, type: 'group' },
            trophiesEmpty:   { x: 0, y: portfolio.TROPHY_EMPTY_Y, w: 0, h: 24, type: 'label' },
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
            // 11 — 6 trophy tiles in a 3×2 grid (200×200, 20-px gap).
            trophyTile: {
                count: 6, w: 200, h: 200, gap: 20,
                cols: 3, rows: 2,
                gridXOffset: -1, // (col - 1) * (w + gap) — cols [-220, 0, 220]
                gridYBase:   portfolio.TROPHY_GRID_BASE_Y,
                gridYStride: portfolio.TROPHY_GRID_STRIDE_Y,
                emoji: { x: 0, y: 50,  w: 200, h: 70 },
                title: { x: 0, y: -10, w: 200, h: 20 },
                wins:  { x: 0, y: -40, w: 200, h: 18 },
            },
            // 30-row pool inside PortfolioHistoryView's ScrollView. AppUI
            // toggles _active per row + writes 5 labels (Date/Mode/Wager/
            // Placement/Payout) per MatchHistoryEntry (AppUI.ts:9310).
            //
            // baseY/gapY: rows cascade top-down beneath content anchor
            // (0.5, 1). First row centered at y=-36 (rowH/2 below top),
            // each subsequent row 72 px lower (rowH 64 + 8 gap).
            //
            // Phase 9a: each label's w shrunk from a catch-all 560 to its
            // actual column slot — eliminates 4 internal overlaps per row
            // × 30 rows = 120 overlaps cleared. Centers (x,y) unchanged.
            matchHistoryRow: {
                count: 30, w: 600, h: 64,
                baseY: portfolio.HISTORY_BASE_Y, gapY: portfolio.HISTORY_GAP_Y,
                date:      { x: -270, y: 16,  w: 120, h: 18, color: [160, 170, 190] },
                mode:      { x: -90,  y: 16,  w: 160, h: 18, color: [255, 255, 255] },
                wager:     { x: 90,   y: 16,  w: 140, h: 18, color: [200, 210, 220] },
                placement: { x: -90,  y: -14, w: 240, h: 18, color: [255, 255, 255] },
                payout:    { x: 200,  y: -14, w: 160, h: 20, color: [48, 198, 155] },
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

    // 2026-04-27 UI overhaul — pillar squad cards. Verifier strips trailing
    // _N so this entry covers SquadSlot_0/_1/_2. The GradientTop sprite is
    // a layered visual under the SymbolLabel by design (gradient simulation).
    SquadSlot: {
        allowedOverlaps: [
            ['GradientTop', 'SymbolLabel'],
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

    // 2026-04-27 — Synthetic row-name entry. The verifier walks every node
    // with children as its own "panel"; each MIPRow_N has the invisible
    // TapTarget sitting behind 7 visible children. Suffix-stripped match.
    MIPRow: {
        allowedOverlaps: [
            ['MIPTapTarget', 'MIPCardEdge'],
            ['MIPTapTarget', 'MIPWinLine'],
            ['MIPTapTarget', 'MIPWindowLine'],
            ['MIPTapTarget', 'MIPStakeChip'],
            ['MIPTapTarget', 'MIPOpponentChip'],
            ['MIPTapTarget', 'MIPRing'],
            ['MIPTapTarget', 'MIPTimeLabel'],
            // Ring (radius 22, y=8) and time label (y=-22) share the right
            // column. Time label bbox extends up into ring bbox by design.
            ['MIPRing', 'MIPTimeLabel'],
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
    // Right-side tray refactor (2026-04-28): card narrowed 480→400 (≈55%
    // of canvas), backdrop restored to scrim so the home dims through the
    // left side instead of reading as one solid full-width panel. Header
    // now hosts title + Mark-all-read inline, with close ✕ at top-right.
    NotificationPanel: {
        canvas: { w: 720, h: 1280 },
        // Card geometry consumed by scene-gen + AppUI tweens.
        card: { w: 400, h: 1280, restingX: 160, offX: 600 },
        elements: {
            // List area sits below header divider; w 360 matches card content width.
            // 2026-04-28 — y dropped -80 → -110, h shortened 940 → 900 to clear new
            // 50/50 action row (MarkAsRead | MarkAllRead) below the title.
            listContainer:        { x: 0,    y: -110, w: 360, h: 900, type: 'group' },
            // Header row 1 — title alone (top). Close ✕ stays top-right corner.
            cardHeaderLabel:      { x: -170, y: 608, w: 200, h: 30, type: 'label' },
            cardCloseButton:      { x: 168,  y: 608, w: 36,  h: 36, type: 'btnGhost' },
            // Header row 2 — 50/50 action split: left = MarkAsRead (selection mode),
            // right = MarkAllRead (existing bulk action). Both 170w with 4px gap.
            cardMarkAsReadButton: { x: -90,  y: 556, w: 170, h: 36, type: 'btnGhost' },
            cardMarkAllReadButton:{ x: 90,   y: 556, w: 170, h: 36, type: 'btnGhost' },
            // 1px low-alpha divider beneath the header row.
            cardHeaderDivider:    { x: 0,    y: 530, w: 356, h: 1,  type: 'sprite' },
            // Group section headers ("Now" / "Today" / "Earlier"). Y is
            // computed at runtime; these specs lock width/height/x only.
            groupLabelNow:        { x: -78,  y: 0,   w: 200, h: 18, type: 'label' },
            groupLabelToday:      { x: -78,  y: 0,   w: 200, h: 18, type: 'label' },
            groupLabelEarlier:    { x: -78,  y: 0,   w: 200, h: 18, type: 'label' },
            // Empty-state group: centered icon + title + subtitle, swaps in when no rows.
            emptyIcon:            { x: 0,    y: 80,  w: 64,  h: 64, type: 'group' },
            emptyTitleLabel:      { x: 0,    y: 0,   w: 320, h: 24, type: 'label' },
            emptySubtitleLabel:   { x: 0,    y: -28, w: 340, h: 18, type: 'label' },
        },
        templates: {
            // 8 reusable rows in NotifListContainer. AppUI activates per
            // unread notification, writes Title/Body/Time labels, toggles
            // unread dot. Geometry tightened to fit 360-wide content area.
            // 2026-04-28 — added checkbox slot (left of icon) for selection
            // mode; icon/title/body slid right to clear it.
            notifRow: {
                count: 8, w: 360, h: 92, gap: 8,
                baseY: 460, gapY: -100,
                stripe:   { x: -177, y: 0,   w: 6,   h: 92 },
                checkbox: { x: -156, y: 0,   w: 24,  h: 24 },
                icon:     { x: -122, y: 0,   w: 40,  h: 40 },
                title:    { x: 4,    y: 18,  w: 200, h: 22 },
                body:     { x: 4,    y: -10, w: 200, h: 28 },
                time:     { x: 130,  y: -32, w: 80,  h: 16 },
                dot:      { x: 162,  y: 32,  w: 8,   h: 8 },
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
            // 2026-04-29 — uniform back STYLE (x/w/h/text) per MIP. PostMatch
            // keeps its 60pt h=80 title at pm.TITLE_Y=564, so the back row
            // sits ABOVE the title's top edge (604) at y=622 instead of MIP's
            // y=580 (which would overlap the title bbox).
            backLink:        { x: UNIFORM_HEADER.BACK_LINK.x, y: 622, w: UNIFORM_HEADER.BACK_LINK.w, h: UNIFORM_HEADER.BACK_LINK.h, type: 'label' },
            backBtn:         { x: UNIFORM_HEADER.BACK_BTN.x,  y: 622, w: UNIFORM_HEADER.BACK_BTN.w,  h: UNIFORM_HEADER.BACK_BTN.h,  type: 'btnGhost' },
            title:           { x: 0,    y: pm.TITLE_Y, w: 620, h: 80,  type: 'label',
                notes: '60pt bold, color-coded green/rose by outcome (was 56)' },
            track:           { x: 0,    y: pm.TRACK_Y, w: 600, h: 44,  type: 'label' },
            // Mascot glow halo — shrunk 480→320 so payout label clears it.
            mascotGlow:      { x: 0,    y: pm.MASCOT_Y, w: pm.MASCOT_GLOW_WH, h: pm.MASCOT_GLOW_WH, type: 'graphics',
                notes: 'circle fill alpha 0; AppUI tweens to 140 (~0.55) tinted by outcome. 2026-04-27 — shrunk 480→320.' },
            mascotContainer: { x: 0,    y: pm.MASCOT_Y, w: pm.MASCOT_BOX_WH, h: pm.MASCOT_BOX_WH, type: 'mascot',
                notes: '2026-04-27 — shrunk 360→280 (proportional to glow).' },
            payoutLabel:     { x: 0,    y: pm.PAYOUT_Y, w: 620, h: 110, type: 'label',
                notes: '72pt mono (was 64; +12.5% per spec), scale-in + ticker on win.' },
            subtitle:        { x: 0,    y: pm.SUBTITLE_Y, w: 600, h: 32, type: 'label',
                notes: '22pt headline only ("Won by X.XX%"); breakdown moved to its own dimmed label below.' },
            breakdown:       { x: 0,    y: pm.BREAKDOWN_Y, w: 640, h: 26, type: 'label',
                notes: 'NEW 2026-04-28 — per-token row "BIO +X% · PUMP -X% · ...", 18pt, opacity ~0.7, color text.mid.' },
            rake:            { x: 0,    y: pm.RAKE_Y, w: 600, h: 40, type: 'label' },
            xpBarLabelLeft:  { x: -240, y: pm.XP_BAR_Y, w: 200, h: 22, type: 'label',
                notes: '"Lv N → Lv N+1" 14pt mid-grey' },
            xpBarFill:       { x: 0,    y: pm.XP_BAR_Y, w: 480, h: 16, type: 'graphics',
                notes: 'Track + accent fill; AppUI tweens fill width on show' },
            xpBarLabelRight: { x: 240,  y: pm.XP_BAR_Y, w: 120, h: 22, type: 'label',
                notes: '"+10 XP" 18pt bold accent' },
            sameSquadBtn:    { x: -180, y: pm.CTA_Y, w: 320, h: 64, type: 'btnPrimary' },
            againBtn:        { x: 180,  y: pm.CTA_Y, w: 320, h: 64, type: 'btnPrimary' },
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
                header:   { x: 0, y: 42,  w: 280, h: 22 },
                value:    { x: 0, y: -8,  w: 280, h: 36, fontSize: 32 },   // big +N (was y=-22, h=44, font 34)
                valueSub: { x: 0, y: -42, w: 280, h: 20, fontSize: 13 },   // NEW small sub-line
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
