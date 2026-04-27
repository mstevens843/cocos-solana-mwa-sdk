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

// 2026-04-27 — Token Duel page deterministic Y anchors.
// Source-of-truth for every Y on TokenDuelPanel. NEVER hand-tune element
// Y values on this page; always derive from these.  Canvas y-up,
// origin at panel center (range −640..+640).
const td = {
    // Header band (unchanged)
    HEADER_Y:           575,   // pills row + back link
    TITLE_Y:            525,   // "Token Duel" centered
    TITLE_BOTTOM:       507,   // = TITLE_Y - title.h(36)/2

    // Top region — relocated SquadPanel (was bottom y=-345)
    SQUAD_PANEL_TOP:    503,   // 4px gap below title
    SQUAD_PANEL_H:      178,   // compressed from 220 to fit between title and feed-frame
    SQUAD_PANEL_Y:      414,   // = SQUAD_PANEL_TOP - SQUAD_PANEL_H/2
    SQUAD_PANEL_BOTTOM: 325,
    SQUAD_HEADER_Y:     486,   // "YOUR SQUAD" — top of panel
    SQUAD_SLOTS_Y:      438,   // 3 slots row, h=64
    WAGER_Y:            358,   // wager-value btn (left) + Start Duel CTA (right), h=56
    WAGER_DROPDOWN_Y:   144,   // OPENS DOWNWARD now (overlays feed top); was y=-363 opening upward

    // Feed container — top stays put, expands downward
    FEED_FRAME_TOP:     320,   // 5px gap below SQUAD_PANEL_BOTTOM
    FEED_FRAME_H:       940,   // wraps in-card UI + 2x scrollview down to just above status
    FEED_FRAME_Y:      -150,   // = FEED_FRAME_TOP - FEED_FRAME_H/2

    // In-card top band — re-homed mode tag (left) + squad counter (right)
    GAMEMODE_CHIP_Y:    302,   // h=24 pill, top-LEFT of feed frame
    SQUAD_COUNTER_Y:    302,   // h=24 label, top-RIGHT of feed frame

    // In-card mid band (search/filter/cols) — shifted ~24px down
    SEARCH_Y:           276,   // h=44 (was 300)
    CHIPS_Y:            228,   // h=32 (was 248)
    COL_HEADERS_Y:      196,   // h=24 (was 210)

    // Feed scrollview — literal 2x height, growing downward
    FEED_SCROLL_TOP:    180,   // 4px below col-headers bottom (184). Was 194 — moved DOWN 14
    FEED_SCROLL_H:      776,   // 2x of original 388
    FEED_SCROLL_Y:     -208,   // = FEED_SCROLL_TOP - FEED_SCROLL_H/2
    FEED_SCROLL_BOTTOM:-596,

    // Footer
    STATUS_Y:          -616,   // 4px gap below feed bottom; in-canvas
};

const LayoutSpec = {
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
            // HomeMatchTicker card has a "RECENT MATCHES" header label that
            // spans the full card width and 5 chip groups below it. The
            // header bbox marginally crosses the chip group bboxes.
            ['HomeMatchTickerHeader', 'HomeMatchChip_mode'],
            ['HomeMatchTickerHeader', 'HomeMatchChip_players'],
            ['HomeMatchTickerHeader', 'HomeMatchChip_stake'],
            ['HomeMatchTickerHeader', 'HomeMatchChip_duration'],
            ['HomeMatchTickerHeader', 'HomeMatchChip_created'],
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
            title:               { x: 0,   y: 510,  w: 680, h: 72,  type: 'label',      notes: 'Token Duel — 64pt display, gold' },
            subtitle:            { x: 0,   y: 445,  w: 680, h: 30,  type: 'label',      notes: 'Portfolio Race on Solana — 24pt body, mid' },
            mascot:              { x: 0,   y: 280,  w: 260, h: 260, type: 'mascot',     notes: 'idle Seedance frames; slightly larger (was 240)' },
            tagline:             { x: 0,   y: 110,  w: 680, h: 40,  type: 'label',      notes: 'SINGLE-line tagline: "Build. Battle. Outperform." (was 2-line in v1)' },
            supportLine:         { x: 0,   y: 66,   w: 660, h: 22,  type: 'label',      notes: 'Connect your wallet or start practicing instantly — 16pt lo' },
            // CTA card backdrop (NEW v2) — semi-translucent dark surface w/ violet edge
            ctaCardBg:           { x: 0,   y: -185, w: 700, h: 440, type: 'group',      notes: 'visual grouping behind action stack; bg.card #1E2438 alpha 130 + violet top edge accent' },
            // Action stack (re-anchored within card)
            connectBtn:          { x: 0,   y: -25,  w: 660, h: 110, type: 'btnPrimary', notes: 'PRIMARY — gradient + glow + chevron; "Use real funds · compete for SOL"' },
            connectChevron:      { x: 290, y: -25,  w: 24,  h: 28,  type: 'label',      notes: 'right-aligned › inside ConnectButton — directional cue (NEW)' },
            trustLine:           { x: 0,   y: -100, w: 640, h: 20,  type: 'label',      notes: 'NEW — "Secure · Non-custodial · You control your wallet" — sits directly under Connect inside card' },
            reconnBtn:           { x: 0,   y: -170, w: 660, h: 80,  type: 'btnGhost',   notes: 'SECONDARY — ghost-teal Reconnect; only active when AuthCache.hasCachedAuth' },
            playAsGuestBtn:      { x: 0,   y: -285, w: 660, h: 100, type: 'btnSuccess', notes: 'TERTIARY — Guest w/ DIM halo (alpha 40) so it doesnt rival Connect' },
            connectionStatusPill:{ x: 0,   y: -555, w: 200, h: 40,  type: 'chip',       notes: 'subtle bottom pill — disconnected/connecting/failed states' },
        },
        allowedOverlaps: [
            // Card backdrop intentionally sits behind every action element
            ['CTACardBg', 'ConnectButton'],
            ['CTACardBg', 'ConnectChevron'],
            ['CTACardBg', 'TrustLineLabel'],
            ['CTACardBg', 'ReconnectButton'],
            ['CTACardBg', 'PlayAsGuestButton'],
            ['CTACardBg', 'BtnGlow_ConnectButton'],
            ['CTACardBg', 'BtnGlow_PlayAsGuestButton'],
            ['CTACardBg', 'CardEdgeAccent'],
            // Chevron sits inside ConnectButton's bbox by design (right-aligned)
            ['ConnectButton', 'ConnectChevron'],
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
            // ── HUD HEADER (y=620) — bell · WalletPill · 3 chrome icons ──
            notificationBell:    { x: -330, y: 620,  w: 56,  h: 56,  type: 'btnGhost', notes: 'Phase N4: far-left of 5-icon bar; bell icon attached at runtime' },
            notificationBadge:   { x: -308, y: 638,  w: 22,  h: 22,  type: 'badge',    notes: 'unread count badge ON bell (bell.x + 22 to keep top-right offset)' },
            walletPill:          { x: 0,    y: 620,  w: 360, h: 60,  type: 'chip',     notes: 'centered glowing pill; pubkey + wallet name + status dot' },
            walletPillGlow:      { x: 0,    y: 620,  w: 380, h: 80,  type: 'sprite',   notes: 'soft violet glow halo SIBLING of WalletPill, renders BEHIND it' },
            walletPillSecureDot: { x: -150, y: 0,    w: 12,  h: 12,  type: 'badge',    notes: 'green status dot at left edge of pill (relative to pill)' },
            pubkeyLabel:         { x: -30,  y: 6,    w: 280, h: 24,  type: 'label',    notes: 'short address inside WalletPill (relative to pill)' },
            walletNameLabel:     { x: 0,    y: -16,  w: 280, h: 14,  type: 'label',    notes: 'wallet brand line under address (relative to pill)' },
            // Phase N4: openPortfolioBtn removed (Portfolio collapsed into Leaderboard hub).
            // 5-icon bar reordered to [bell | trophy | wallet | cog | disconnect] with wallet centered.
            openLeaderboardBtn:  { x: -250, y: 620,  w: 56,  h: 56,  type: 'btnGhost', notes: 'left of WalletPill — opens Portfolio+Leaderboard hub' },
            openSettingsBtn:     { x:  250, y: 620,  w: 56,  h: 56,  type: 'btnGhost', notes: 'right of WalletPill — settings' },
            // ── XP MODULE (y=540, h=80) — real progression bar, animated ──
            homeLevelChip:       { x: 0,    y: 540,  w: 680, h: 80,  type: 'chip',     notes: 'Lv N (gold 22pt) + X/Y XP (right) + 640x14 rounded gold progress bar' },
            homeXpProgressLabel: { x: 310,  y: 18,   w: 280, h: 18,  type: 'label',    notes: '"X / Y XP" anchor-right (relative to card)' },
            homeXpBarTrack:      { x: 0,    y: -14,  w: 640, h: 14,  type: 'sprite',   notes: 'rounded track 640x14 (relative to card)' },
            homeXpBarFill:       { x: -320, y: 0,    w: 0,   h: 14,  type: 'sprite',   notes: 'gold fill, left-anchored, width tweens on load (relative to track)' },
            // ── RECENT MATCH CARD (y=420, h=140) — 2-row chip grid ──
            homeMatchTicker:     { x: 0,    y: 420,  w: 680, h: 140, type: 'chip',     notes: 'recent-matches card with header + 2 rows of chips; tap → SpectatorPanel' },
            homeMatchTickerHeader: { x: 0,  y: 58,   w: 660, h: 16,  type: 'label',    notes: '"RECENT MATCH" header (relative to card)' },
            homeMatchChipDivider: { x: 0,   y: -7,   w: 600, h: 1,   type: 'sprite',   notes: 'subtle 1-px divider between row 1 and row 2 (relative to card)' },
            homeMatchChip:       { keys: ['mode', 'players', 'stake', 'duration', 'created'],
                                   labels: ['MODE', 'PLAYERS', 'STAKE', 'DURATION', 'CREATED'],
                                   xs: [-200, 0, 200, -100, 100],
                                   ys: [18, 18, 18, -38, -38],
                                   ws: [160, 160, 160, 200, 200],
                                   h: 52,
                                   keyFs: 10, valFs: 14,
                                   notes: '5 chips: row 1 (mode/players/stake), row 2 (duration/created)' },
            // Tournament alternate — same slot as ticker, mutually exclusive.
            homeTournamentBadge: { x: 0,    y: 420,  w: 680, h: 140, type: 'chip',     notes: 'tournament alternate; takes ticker slot when active' },
            // Off-flow placeholders — superseded by SettingsPanel + homeChalChip
            // 'rake' key. Nodes pinned below safe-area so they never collide.
            homeRakeChip:        { x: 0,    y: -820, w: 700, h: 22,  type: 'chip',      notes: 'legacy node; off-flow until refactor cleanup' },
            disconnectBtn:       { x:  330, y: 620,  w: 56,  h: 56,  type: 'btnGhost',  notes: 'Phase N4: Home top-bar far-right; one-tap wallet/guest disconnect (drawDisconnect icon)' },
            deleteBtn:           { x: 180,  y: -880, w: 280, h: 56,  type: 'btnGhost',  notes: 'legacy node; account control moved to SettingsPanel' },
            signOutGuestBtn:     { x: 0,    y: -940, w: 280, h: 56,  type: 'btnGhost',  notes: 'legacy node; account control moved to SettingsPanel' },
            // ── SECONDARY STATS CARD (y=320, h=64) — 4 chips, no SEASON ──
            // Node name "DailyStreakStrip" preserved for AppUI binding stability;
            // semantically this is now the SecondaryStats card.
            dailyStreakStrip:    { x: 0,    y: 320,  w: 680, h: 64,  type: 'chip',     notes: '4 chips (DAY/CHALLENGES/POOL/RAKE); tap → DailyChallengePanel' },
            homeChalChip:        { keys: ['day', 'challenges', 'pool', 'rake'],
                                   labels: ['DAY', 'CHALLENGES', 'POOL', 'RAKE'],
                                   xs: [-240, -80, 80, 240], y: 0, w: 130, h: 52,
                                   keyFs: 10, valFs: 14,
                                   notes: 'inline 4 chip groups inside SecondaryStats card (SEASON dropped)' },
            // ── SECTION TITLE (y=260) ──
            homeChooseMatchLabel: { x: 0,   y: 260,  w: 680, h: 24,  type: 'label',    notes: '"CHOOSE MATCH TYPE" tracked uppercase muted lo-tier' },
            // ── PRIMARY CTA TRIO (tiered hierarchy: Start > Find > Bot) ──
            startMatchBtn:       { x: 0,    y: 196,  w: 680, h: 104, type: 'btnPrimary', notes: 'Hero violet — host real match (TALLEST + brightest glow)' },
            startMatchSubtitle:  { x: 0,    y: -22,  w: 620, h: 18,  type: 'label',      notes: 'CHILD of StartMatchButton' },
            startMatchChevron:   { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label',      notes: '"›" glyph child of button, anchored right' },
            findMatchBtn:        { x: 0,    y: 80,   w: 680, h: 92,  type: 'btnSuccess', notes: 'Hero teal — browse open lobbies (mid)' },
            findMatchSubtitle:   { x: 0,    y: -22,  w: 620, h: 18,  type: 'label',      notes: 'CHILD of FindMatchButton' },
            findMatchChevron:    { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label',      notes: 'CHILD of FindMatchButton' },
            findMatchCountBadge: { x: 244,  y: 102,  w: 76,  h: 28,  type: 'badge',      notes: 'live count pill on right side of FindMatchBtn' },
            botMatchBtn:         { x: 0,    y: -28,  w: 680, h: 84,  type: 'btnWarn',    notes: 'Warn amber — paper / vs bots / free practice (smallest, muted)' },
            botMatchSubtitle:    { x: 0,    y: -22,  w: 620, h: 18,  type: 'label',      notes: 'CHILD of BotMatchButton' },
            botMatchChevron:     { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label',      notes: 'CHILD of BotMatchButton' },
            // ── TRAINING HERO CARD (y=-200, h=196) — mascot + glow + CTA hint ──
            homeTrainingCard:    { x: 0,    y: -200, w: 680, h: 196, type: 'card',      notes: 'hero card with mascot (left) + copy (right); subtle gradient feel' },
            trainingMascotGlow:  { x: -220, y: 0,    w: 200, h: 200, type: 'sprite',    notes: 'soft amber glow halo BEHIND mascot (relative to card)' },
            mascot:              { x: -220, y: 0,    w: 160, h: 180, type: 'mascot',    notes: 'mascot inside training card (relative to card)' },
            homeTrainingTitleLabel: { x: 40, y: 60,  w: 440, h: 24,  type: 'label',     notes: '"TRAINING MODE" gold bold tracked, anchor-left (relative to card)' },
            homeTrainingBodyLabel:  { x: 40, y: 20,  w: 440, h: 24,  type: 'label',     notes: '"N free matches left" body, anchor-left (relative to card)' },
            homeTrainingHintLabel:  { x: 40, y: -12, w: 460, h: 18,  type: 'label',     notes: '"Easier bots · paper-track only" muted (relative to card)' },
            trainingCtaHint:     { x: 40,   y: -44,  w: 460, h: 18,  type: 'label',     notes: '"Tap Bot Match to begin" amber italic CTA hint (relative to card)' },
            homeStatus:          { x: 40,   y: -76,  w: 460, h: 16,  type: 'label',     notes: 'thin lo-tier status footer (relative to card)' },
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
            ['HomeContentScrim',        'DailyStreakStrip'],
            ['HomeContentScrim',        'HomeChooseMatchLabel'],
            ['HomeContentScrim',        'StartMatchButton'],
            ['HomeContentScrim',        'BtnGlow_StartMatchButton'],
            ['HomeContentScrim',        'FindMatchButton'],
            ['HomeContentScrim',        'BtnGlow_FindMatchButton'],
            ['HomeContentScrim',        'FindMatchButtonCountBadge'],
            ['HomeContentScrim',        'BotMatchButton'],
            ['HomeContentScrim',        'BtnGlow_BotMatchButton'],
            ['HomeContentScrim',        'HomeTrainingCard'],
            ['NotificationBellButton',  'NotificationBellBadge'],   // badge ON bell
            ['HomeMatchTicker',         'HomeTournamentBadge'],     // alternates
            ['FindMatchButton',         'FindMatchButtonCountBadge'],// badge sits ON the FindMatch button intentionally
            // V2 — wallet pill glow halo sits BEHIND the pill; intentional overlap.
            ['WalletPill',              'WalletPillGlow'],
            // Subtitle + chevron now live INSIDE each action button.
            ['StartMatchButton',        'StartMatchSubtitle'],
            ['StartMatchButton',        'StartMatchChevron'],
            ['FindMatchButton',         'FindMatchSubtitle'],
            ['FindMatchButton',         'FindMatchChevron'],
            ['BotMatchButton',          'BotMatchSubtitle'],
            ['BotMatchButton',          'BotMatchChevron'],
            // WalletPill bbox houses pubkey + wallet name + secure dot.
            ['WalletPill',              'PubkeyLabel'],
            ['WalletPill',              'WalletNameLabel'],
            ['WalletPill',              'WalletPillSecureDot'],
            // Training card houses mascot + glow + 3 labels + reparented status footer.
            ['HomeTrainingCard',        'MascotContainer'],
            ['HomeTrainingCard',        'TrainingMascotGlow'],
            ['HomeTrainingCard',        'HomeTrainingTitleLabel'],
            ['HomeTrainingCard',        'HomeTrainingBodyLabel'],
            ['HomeTrainingCard',        'HomeTrainingHintLabel'],
            ['HomeTrainingCard',        'TrainingCtaHint'],
            ['HomeTrainingCard',        'HomeStatusLabel'],
            // Mascot glow sits behind mascot — intentional overlap.
            ['TrainingMascotGlow',      'MascotContainer'],
            // Level chip houses progress bar + labels.
            ['HomeLevelChip',           'HomeLevelChipLabel'],
            ['HomeLevelChip',           'HomeXpProgressLabel'],
            ['HomeLevelChip',           'HomeXpBarTrack'],
            ['HomeXpBarTrack',          'HomeXpBarFill'],
            // RecentMatch divider sits inside card.
            ['HomeMatchTicker',         'HomeMatchChipDivider'],
        ],
    },

    /* ───── MODE PICKER OVERLAY ─────────────────────────────────────── */
    // Game-setup overlay shown when user taps Run Squad / Quick Play.
    // Layout (top-down): Title + ✕ at y=500, Hint y=460, 2×2 mode grid
    // y=410/330, WagerReadout y=230, 4-col window row y=150, Paper/Real
    // toggle y=90, 3-col difficulty row y=40, Start CTA y=-30, Status y=-100.
    // Phase 23 — premium redesign. Spread across full canvas; bigger
    // buttons; section headers ("MATCH MODE" / "DURATION" / "TRACK" /
    // "DIFFICULTY") above each row to give visual rhythm.
    ModePickerOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            title:             { x: 0,    y: 580,  w: 480, h: 44, type: 'label',
                notes: 'Phase 23: y 500→580, w 500→480 (clears Cancel ✕ at x=290), fontSize 26→32, gold bold tracked' },
            cancelBtn:         { x: 290,  y: 580,  w: 44,  h: 44, type: 'btnGhost' },
            hint:              { x: 0,    y: 530,  w: 600, h: 18, type: 'label' },
            // Phase 23 — section headers above each button row.
            sectionMode:       { x: 0,    y: 440,  w: 600, h: 22, type: 'label',
                notes: 'tracked uppercase 16pt lo-tier' },
            sectionDuration:   { x: 0,    y: 190,  w: 600, h: 22, type: 'label' },
            sectionTrack:      { x: 0,    y: 40,   w: 600, h: 22, type: 'label' },
            sectionDifficulty: { x: 0,    y: -110, w: 600, h: 22, type: 'label' },
            wagerReadout:      { x: 0,    y: -280, w: 600, h: 32, type: 'label',
                notes: 'Phase 23: fontSize 14→20, gold bold' },
            paperToggle:       { x: -115, y: -20,  w: 220, h: 60, type: 'btnPrimary' },
            realToggle:        { x: 115,  y: -20,  w: 220, h: 60, type: 'btnGhost' },
            startBtn:          { x: 0,    y: -380, w: 560, h: 80, type: 'btnPrimary',
                notes: 'Phase 23: hero CTA — 420×60 → 560×80; idle pulse + halo from Phase 13/AppUI' },
            statusLbl:         { x: 0,    y: -460, w: 600, h: 20, type: 'label' },
        },
        templates: {
            // Stage 3 mode rebalance: [1v1, Trio, 4p, 8p].
            // Names: Mode_<key>. AppUI key handlers in _onPickerModeTap key off these.
            modeBtn: {
                count: 4, w: 300, h: 80,
                keys: ['oneVone', 'trio', 'fourPlayer', 'eightPlayer'],
                labels: ['1 vs 1', 'Trio · 1v1v1', '4 Player FFA', 'Battle Royale'],
                positions: [
                    { x: -160, y: 380 },
                    { x:  160, y: 380 },
                    { x: -160, y: 290 },
                    { x:  160, y: 290 },
                ],
            },
            // 4 window chips in a single row. Phase 23: 140×40 → 160×52.
            windowBtn: {
                count: 4, w: 160, h: 52, y: 130,
                keys: ['1h', '1d', '3d', '7d'],
                labels: ['1 Hour', '1 Day', '3 Days', '7 Days'],
                baseX: -258, gapX: 172,
            },
            // 3 difficulty chips in a single row. Phase 23: 130×40 → 180×52.
            difficultyBtn: {
                count: 3, w: 180, h: 52, y: -170,
                keys: ['easy', 'medium', 'hard'],
                labels: ['Easy', 'Medium', 'Hard'],
                names: ['PickerDifficultyEasy', 'PickerDifficultyMedium', 'PickerDifficultyHard'],
                baseX: -200, gapX: 200,
            },
        },
        allowedOverlaps: [],
    },

    /* ───── RACE ────────────────────────────────────────────────────── */
    // Live race panel — fullscreen overlay during active match. 720×1800
    // (oversized for tall device viewports).
    //
    // 1v1 DUEL LAYOUT (2026-04-26 battle-UI polish):
    //   Top row y=720: [Lv chip] (Timer) [hero +%] — single horizontal band.
    //   Player tokens y=540 (3 horizontal cards w/ contribution bars).
    //   Lead-state line y=410 ("YOU LEAD\n+0.48 pp"; replaces tiny gap text).
    //   Duel bar y=300 — tug-of-war bar that moves toward winner.
    //   Opp hero % y=140, opp identity y=40 ("BOT · Lv 3" header).
    //   Opp tokens y=-90 (mirror).
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
            racePlayerLevelChip: { x: -260, y: 720, w: 120, h: 40, type: 'chip',
                notes: 'small Lv pill, top-left of duel battle UI' },

            // Timer + countdown (centered top row)
            timerRing:        { x: 0,    y: 720,  w: 132, h: 132, type: 'graphics' },
            timerPulse:       { x: 0,    y: 0,    w: 100, h: 100, type: 'graphics', notes: 'inside ring; coords relative to ring' },
            countdownLabel:   { x: 0,    y: 720,  w: 100, h: 32,  type: 'label' },

            // Hero portfolio delta — right-aligned in top row, bold/primary.
            heroDelta:        { x: 240,  y: 720,  w: 220, h: 80,  type: 'label' },

            // Player token row container — 3 horizontal cards (tightened spacing)
            playerTokenRow:   { x: 0,    y: 540,  w: 696, h: 110, type: 'group' },

            // Lead-state copy ("YOU LEAD / YOU TRAIL / DEAD HEAT") — promoted
            // from a tiny subtitle to a 2-line emphasis line above the bar.
            opponentSubtitle: { x: 0,    y: 410,  w: 620, h: 64,  type: 'label',
                notes: 'lead-state line above duel bar (replaces "you +X.XX pp ahead")' },

            // Duel bar — center tug-of-war (tightened up)
            duelBarContainer: { x: 0,    y: 300,  w: 680, h: 80,  type: 'group' },
            duelBarTrack:     { x: 0,    y: 0,    w: 640, h: 8,   type: 'graphics', notes: 'relative to container' },
            duelBarFill:      { x: 0,    y: 0,    w: 640, h: 12,  type: 'graphics', notes: 'relative to container' },
            duelBarGlow:      { x: 0,    y: 0,    w: 640, h: 40,  type: 'graphics', notes: 'leading-tip pulse + trail' },
            duelBarCenterTick:{ x: 0,    y: 0,    w: 2,   h: 32,  type: 'graphics' },
            duelBarPlayerTag: { x: -300, y: -22,  w: 80,  h: 16,  type: 'label' },
            duelBarOppTag:    { x: 300,  y: -22,  w: 80,  h: 16,  type: 'label' },
            duelBarLeadingPp: { x: 0,    y: 24,   w: 160, h: 22,  type: 'label', notes: 'floats above leading tip' },

            // Opponent hero delta — slightly LARGER than player (80pt vs 56pt)
            // for symmetry of stake when losing the duel.
            opponentDelta:    { x: 0,    y: 140,  w: 680, h: 96,  type: 'label' },

            // Opponent identity card — moved ABOVE opponent tokens. Internals
            // via templates.identityCard. Single combined "BOT · Lv 3" copy.
            opponentIdentityCard:  { x: 0,   y: 40,  w: 280, h: 44, type: 'sprite' },

            // Opponent token row container — 3 horizontal cards (mirror player)
            opponentTokenRow: { x: 0,    y: -90,  w: 696, h: 110, type: 'group' },

            // Legacy 1v1 opponent card (HIDDEN in duel layout — gated in AppUI).
            opponentCard:     { x: 0,    y: -400, w: 640, h: 110, type: 'sprite' },
            // 4p/8p multi-bot strip (still used when requiredPlayers > 2)
            opponentStrip:    { x: 0,    y: -406, w: 640, h: 260, type: 'group' },

            // Forfeit (smaller, dimmer, below opponent section) + mascot + vignette
            cancelBtn:        { x: 0,    y: -260, w: 140, h: 36,  type: 'btn',
                notes: 'duel layout: small/recessed gray surface, low emphasis' },
            mascot:           { x: 260,  y: -460, w: 120, h: 160, type: 'mascot',
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
            ['ScreenVignette', 'RaceMascotContainer'],
            ['ScreenVignette', 'RacePlayerLevelChip'],
            ['ScreenVignette', 'OpponentIdentityCard'],
            ['ScreenVignette', 'PlayerTokenCardsRow'],
            ['ScreenVignette', 'OpponentTokenCardsRow'],
            ['ScreenVignette', 'RaceDuelBarContainer'],
            ['ScreenVignette', 'OpponentDeltaHeroLabel'],
            ['ScreenVignette', 'OpponentSubtitleGapLabel'],
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
            backLink:        { x: -280, y: 618,  w: 110, h: 28,  type: 'label' },
            backBtn:         { x: -280, y: 618,  w: 140, h: 36,  type: 'btnGhost' },
            title:           { x: 0,    y: 612,  w: 400, h: 40,  type: 'label' },
            // Wallet → compact identity card (160→124, ~22% reduction).
            // Layout: header row (status dot + secondary "Connected · MWA"),
            // pubkey row (mono, prominent, with copy icon), divider, balance row.
            // Violet glow border (4 perimeter strokes) replaces top hairline.
            walletCard:      { x: 0,    y: 500,  w: 688, h: 124, type: 'group',
                children: {
                    header:        { x: -304, y: 42,  w: 200, h: 16, type: 'label',
                        notes: 'micro-header "WALLET"' },
                    statusDot:     { x: -270, y: 18,  w: 12,  h: 12, type: 'sprite' },
                    walletName:    { x: 4,    y: 18,  w: 540, h: 18, type: 'label',
                        notes: 'secondary "Connected · {wallet}" (12px mid-text)' },
                    walletPubkey:  { x: -52,  y: -6,  w: 460, h: 24, type: 'label',
                        notes: 'mono 18px hi-text, left-aligned identity' },
                    copyPubkeyBtn: { x: 252,  y: -6,  w: 36,  h: 36, type: 'btnGhost' },
                    divider:       { x: 0,    y: -26, w: 632, h: 1,  type: 'sprite',
                        notes: 'hairline between pubkey and balance, white α 24' },
                    walletBalance: { x: -304, y: -42, w: 460, h: 20, type: 'label',
                        notes: 'mono 16px teal, left-aligned' },
                    glowTop:       { x: 0,    y: 61,  w: 686, h: 2,  type: 'sprite',
                        notes: 'violet α 80 perimeter stroke (top)' },
                    glowBot:       { x: 0,    y: -61, w: 686, h: 2,  type: 'sprite' },
                    glowLeft:      { x: -343, y: 0,   w: 2,   h: 122, type: 'sprite' },
                    glowRight:     { x: 343,  y: 0,   w: 2,   h: 122, type: 'sprite' },
                },
            },
            // Profile — adds explicit "Username" label above the input + a
            // focus ring that fades in on edit.
            profileCard:     { x: 0,    y: 346,  w: 688, h: 148, type: 'group',
                children: {
                    header:       { x: -304, y: 56,  w: 200, h: 16, type: 'label' },
                    usernameLabel:{ x: -304, y: 36,  w: 200, h: 16, type: 'label',
                        notes: '"Username" 11px mid-text above the input' },
                    focusRing:    { x: 0,    y: 8,   w: 624, h: 48, type: 'sprite',
                        notes: 'violet stroke around EditBox, alpha 0 → 80 on focus' },
                    username:     { x: 0,    y: 8,   w: 620, h: 44, type: 'editbox' },
                    usernameSaved:{ x: 0,    y: -22, w: 620, h: 18, type: 'label' },
                    usernameHelp: { x: 0,    y: -46, w: 620, h: 16, type: 'label' },
                    topBorder:    { x: 0,    y: 73,  w: 686, h: 1,  type: 'sprite' },
                },
            },
            // Phase 29 — "DEFAULT MATCH SETTINGS". Phase 30 — drops ▾ glyph
            // from value labels and adds a › chevron child to each row for
            // stronger affordance. Trading-mode toggle gains a teal glow halo.
            quickPlayCard:   { x: 0,    y: 108,  w: 688, h: 260, type: 'group',
                children: {
                    header: { x: -304, y: 116, w: 400, h: 18, type: 'label' },
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
            audioCard:       { x: 0,    y: -134, w: 688, h: 148, type: 'group',
                children: {
                    header:        { x: -304, y: 60,  w: 400, h: 16, type: 'label' },
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
            accountCard:     { x: 0,    y: -362, w: 688, h: 232, type: 'group',
                children: {
                    header:           { x: -304, y: 100, w: 400, h: 16, type: 'label' },
                    generalGroupLabel:{ x: -304, y: 78,  w: 200, h: 14, type: 'label',
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
                    sessionGroupLabel:{ x: -304, y: -2,  w: 200, h: 14, type: 'label' },
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
            // Phase 30 — Delete Account moved further down with a 54px buffer
            // above (intentional friction for a destructive action).
            deleteBtn:       { x: 0,    y: -548, w: 220, h: 32, type: 'btnGhost',
                notes: 'small red text — rose label, NOT bold. Sits ~54px below account card.' },
            status:          { x: 0,    y: -592, w: 640, h: 20, type: 'label' },
            // Phase 27 — QP popovers. Direct children of SettingsPanel for z-order.
            // y-positions follow the new QP card y=108 (was 90) — shifted +18 so
            // each popover still opens just below its row.
            qpModePopover:   { x: 200, y: 68,   w: 220, h: 174, type: 'group',
                notes: 'opens BELOW QPModeRow (panel y=184); 4 options × 40 + 14 padding' },
            qpWindowPopover: { x: 200, y: 22,   w: 220, h: 174, type: 'group',
                notes: 'opens BELOW QPWindowRow (panel y=138)' },
            qpWagerPopover:  { x: 200, y: -44,  w: 220, h: 214, type: 'group',
                notes: 'opens BELOW QPWagerRow (panel y=92); 5 options × 40 + 14' },
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
                count: 4, w: 200, h: 36,
                keys:   ['1h', '1d', '3d', '7d'],
                labels: ['1h', '1d', '3d', '7d'],
                ys:     [60, 20, -20, -60],
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

    // Phase 30 — Profile card. The violet focus ring shares the same
    // bounding box as the EditBox (it's the ring around it). The "Username"
    // label sits in the gutter to the left of the input but its left padding
    // overlaps the EditBox bbox by a few px. Save / help labels sit just
    // below the input and the focus ring's bottom edge dips into them.
    ProfileCard: {
        allowedOverlaps: [
            ['UsernameFocusRing', 'UsernameEditBox'],
            ['UsernameLabel',     'UsernameFocusRing'],
            ['UsernameLabel',     'UsernameEditBox'],
            ['UsernameFocusRing', 'UsernameSaveLabel'],
            ['UsernameEditBox',   'UsernameSaveLabel'],
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

    /* ───── LEADERBOARD ─────────────────────────────────────────────── */
    // Hero card for rank #1 (TopPlayerCard) + 9 standard rows + 4-tab segmented
    // mode control + standalone "This Week" chip + EmptyStateGroup + sticky-bottom
    // PersonalRankCard. AppUI fills entries[0] into TopPlayerCard and ranks 2..10
    // into LBRow_1..LBRow_9. Season filter (modeU8=4) drives the same nodes via
    // a wins-based render path.
    LeaderboardPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:        { x: -280, y: 720,  w: 110, h: 28,  type: 'label' },
            backBtn:         { x: -280, y: 720,  w: 140, h: 36,  type: 'btnGhost' },
            title:           { x: 0,    y: 680,  w: 400, h: 44,  type: 'label' },
            // Subtitle line under title — "{mode} · This Week" / "All modes · This Week".
            subtitle:        { x: 0,    y: 638,  w: 520, h: 24,  type: 'label' },
            // Pill-shaped bg behind the 4 mode tabs (segmented control container).
            modeTabsContainer: { x: -90, y: 590, w: 480, h: 46, type: 'sprite',
                notes: 'segmented-control bg behind 4 mode tabs (left-anchored)' },
            // Standalone "This Week" chip on the right of the segmented control.
            // Node name kept as LBTab_season (modeU8=4) so the existing handler still binds.
            thisWeekChip:    { x: 240,  y: 590,  w: 130, h: 42,  type: 'btnGhost' },
            // Hero card for rank #1. AppUI fills entries[0] here and skips LBRow_0.
            topPlayerCard:   { x: 0,    y: 510,  w: 660, h: 110, type: 'group',
                children: {
                    crown:   { x: -290, y: 22,  w: 40,  h: 40, type: 'label' },
                    rank:    { x: -240, y: 22,  w: 60,  h: 28, type: 'label' },
                    player:  { x: -50,  y: 18,  w: 240, h: 28, type: 'label' },
                    elapsed: { x: -50,  y: -16, w: 240, h: 18, type: 'label' },
                    score:   { x: 230,  y: 4,   w: 160, h: 40, type: 'label' },
                },
            },
            // Empty-state cluster (icon + title + subtitle + CTA). _active toggled by AppUI.
            emptyState:      { x: 0,    y: 150,  w: 660, h: 300, type: 'group',
                children: {
                    icon:    { x: 0,    y: 100,  w: 120, h: 120, type: 'label' },
                    title:   { x: 0,    y: -8,   w: 600, h: 32,  type: 'label' },
                    sub:     { x: 0,    y: -42,  w: 600, h: 22,  type: 'label' },
                    cta:     { x: 0,    y: -110, w: 260, h: 60,  type: 'btnPrimary' },
                },
            },
            // Sticky-bottom YOU card — y=-440 keeps it inside the panel after SAFE_AREA_TOP=110 shift.
            personalRankCard: { x: 0,   y: -440, w: 660, h: 130, type: 'group',
                children: {
                    header: { x: -290, y: 46,  w: 120, h: 18, type: 'label' },
                    rank:   { x: -90,  y: 22,  w: 440, h: 28, type: 'label' },
                    stats:  { x: -90,  y: -8,  w: 440, h: 22, type: 'label' },
                    cta:    { x: 220,  y: -42, w: 200, h: 40, type: 'btnGhost' },
                },
            },
            status:          { x: 0,    y: -740, w: 600, h: 22,  type: 'label' },
        },
        templates: {
            // 4 mode tabs at y=590 (segmented control). The 5th season tab is now a
            // standalone right-side chip — see elements.thisWeekChip.
            lbTab: {
                count: 4, w: 120, h: 42, y: 590,
                keys:   ['1v1', 'trio', '4p', '8p'],
                labels: ['1v1', 'Trio', '4p', '8p'],
                xs: [-270, -150, -30, 90],
                activeIdx: 0,
            },
            // 9 rank rows. Rank-1 promoted to TopPlayerCard, so this loop fills
            // ranks 2..10 (LBRow_1..LBRow_9). HeightLabel renamed to ScoreLabel.
            lbRow: {
                count: 9, w: 660, h: 56,
                baseY: 400, gapY: -64,
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
            backBtn:         { x: -280, y: 700,  w: 160, h: 44, type: 'btnGhost' },
            title:           { x: 0,    y: 700,  w: 400, h: 40, type: 'label',    notes: 'gold bold; sword IconBadge attached at runtime via _attachStaticIconBadges' },
            refreshBtn:      { x: 280,  y: 700,  w: 56,  h: 44, type: 'btnGhost', notes: 'AppUI tween-spins the icon on tap for refresh feedback' },
            countLabel:      { x: 0,    y: 665,  w: 600, h: 22, type: 'label',    notes: 'live count pill — pulses via addIdlePulse' },
            // Phase A2 — Lv/XP chip TOP-RIGHT of header (relocated from -260
            // → 240 in Stage 2 to match the new Home + TokenDuel pattern).
            lvxpChip:        { x: 240,  y: 750,  w: 200, h: 32, type: 'chip',     notes: '"Lv N · X/Y"; gold-on-dim; hidden when not connected' },
            hideFullToggle:  { x: 0,    y: 445,  w: 220, h: 36, type: 'btnPrimary' },
            // Phase 2b — segmented-control container cards behind each filter
            // row. mkCardEdge attaches a 1px brand-color stripe along top edge.
            // Containers render BEFORE chips in _children so they sit beneath.
            tabRowContainer:    { x: 0, y: 628, w: 660, h: 50, type: 'sprite', notes: 'teal edge — Open / Live tabs' },
            modeRowContainer:   { x: 0, y: 580, w: 660, h: 50, type: 'sprite', notes: 'violet edge — Mode filter' },
            windowRowContainer: { x: 0, y: 535, w: 660, h: 50, type: 'sprite', notes: 'teal-dim edge — Duration filter' },
            wagerRowContainer:  { x: 0, y: 490, w: 660, h: 50, type: 'sprite', notes: 'amber-dim edge — Wager filter' },
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
            // 2 mode tabs at y=628 (Open Lobbies / Live Now).
            fmTab: {
                count: 2, w: 200, h: 38, y: 628,
                keys:   ['Open', 'Live'],
                labels: ['Open Lobbies', 'Live Now'],
                xs: [-100, 100],
                activeIdx: 0,
            },
            // 5 mode-filter chips at y=580 (Stage 3: br10 → 8p, added Trio).
            fmModeFilter: {
                count: 5, w: 125, h: 38, y: 580,
                keys:   ['all', 'oneVone', 'trio', '4p', '8p'],
                labels: ['All', '1v1', 'Trio', '4p', '8p'],
                baseX: -266, gapX: 133,
            },
            // 5 window-filter chips at y=535.
            fmWindowFilter: {
                count: 5, w: 125, h: 38, y: 535,
                keys:   ['all', '1h', '1d', '3d', '7d'],
                labels: ['All', '30s', '1m', '5m', '1h'],
                baseX: -266, gapX: 133,
            },
            // 5 wager-bucket chips at y=490.
            fmWagerFilter: {
                count: 5, w: 125, h: 38, y: 490,
                keys:   ['all', 'low', 'mid', 'high', 'whale'],
                labels: ['All', 'Low', 'Mid', 'High', 'Whale'],
                baseX: -266, gapX: 133,
            },
            // 8 match cards. Phase A2 redesign: kept h=80 (preserves baseY/gapY)
            // but added edge-stripe (mode-color), wager hero, track chip, capacity
            // bar — all positioned within the 80-px row bbox.
            matchRow: {
                count: 8, w: 660, h: 80,
                baseY: 380, gapY: -88,
                edgeStripe: { x: -325, y: 0,   w: 12,  h: 70 },  // mode-color accent
                mode:       { x: -260, y: 18,  w: 100, h: 24 },
                wager:      { x: -100, y: 18,  w: 160, h: 28 },  // bold gold hero
                trackChip:  { x: 60,   y: 18,  w: 70,  h: 22 },  // REAL/PAPER pill
                window:     { x: 150,  y: 18,  w: 110, h: 20 },
                sub:        { x: -280, y: -16, w: 540, h: 18 },
                capBar:     { x: -10,  y: -34, w: 240, h: 4 },   // background track
                capBarFill: { x: -10,  y: -34, w: 240, h: 4 },   // foreground fill
                join:       { x: 270,  y: 0,   w: 110, h: 56 },
            },
        },
        allowedOverlaps: [
            ['MatchCardRow_0', 'MatchCardEdgeStripe_0'],
            ['MatchCardRow_0', 'MatchCardCapBar_0'],
            ['MatchCardRow_0', 'MatchCardCapBarFill_0'],
            ['MatchCardRow_0', 'MatchCardTrackChip_0'],
            ['MatchCardCapBar_0', 'MatchCardCapBarFill_0'],
            // Empty-state mascot extends below the row pool's 8th row bbox by design.
            ['MatchCardRow_7', 'FindMatchEmptyMascot'],
            // Phase 2b — chip-row containers wrap every chip + glow sibling by design.
            ['TabRowContainer',    'FindMatchTab_Open'],
            ['TabRowContainer',    'FindMatchTab_Live'],
            ['ModeRowContainer',   'FilterMode_all'],
            ['ModeRowContainer',   'FilterMode_oneVone'],
            ['ModeRowContainer',   'FilterMode_trio'],
            ['ModeRowContainer',   'FilterMode_4p'],
            ['ModeRowContainer',   'FilterMode_8p'],
            ['WindowRowContainer', 'FilterWindow_all'],
            ['WindowRowContainer', 'FilterWindow_1h'],
            ['WindowRowContainer', 'FilterWindow_1d'],
            ['WindowRowContainer', 'FilterWindow_3d'],
            ['WindowRowContainer', 'FilterWindow_7d'],
            ['WagerRowContainer',  'FilterWager_all'],
            ['WagerRowContainer',  'FilterWager_low'],
            ['WagerRowContainer',  'FilterWager_mid'],
            ['WagerRowContainer',  'FilterWager_high'],
            ['WagerRowContainer',  'FilterWager_whale'],
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
            // 2026-04-27 layout pivot — squad panel hoisted to top, feed grown 2x downward.
            // All Y values on this page are derived from `td` constants above. NEVER
            // hand-tune y here; edit `td` and the elements follow.
            //
            // Stack (top→bottom): icons row (615) · headerRow (575: Back+Pill) ·
            // title (525) · SquadPanel (414, h=178: header→3 slots→wager+Start) ·
            // FeedFrameCard (-150, h=940) wrapping {GameModeChip top-left + SquadCounter
            // top-right at 302, Search 276, Chips 228, ColHeaders 196, FeedScrollview
            // (-208, h=776, ~8 visible rows of h=85)} · Status (-616).
            // matchSetupCard removed — its mode tag + squad counter re-homed as
            // top-level gameModeChip (top-LEFT of feed frame) and squadCounterLabel
            // (top-RIGHT). Side padding 16 → cards w=688/696.
            backLink:           { x: -288, y: 575,  w: 100, h: 28, type: 'label' },
            backBtn:            { x: -288, y: 575,  w: 120, h: 40, type: 'btnGhost' },
            // Title moves to its own row below Back/Pill so it's centered cleanly.
            title:              { x: 0,    y: 525,  w: 320, h: 36, type: 'label' },
            // Two SEPARATE rounded pills on header row 1 (right side).
            // Wider than the old combined pill so long XP totals
            // ("Lv 99 · 12345/67890") and 2-decimal SOL never overflow.
            // Right margin 16px from canvas edge (canvas right = 360, solPill
            // right edge = 360 - 16 = 344 → solPill center = 344 - 65 = 279).
            // levelPill sits left of solPill with 8px gap.
            levelPill:          { x: 113,  y: 575,  w: 185, h: 36, type: 'chip',    notes: '"Lv N · curr/max XP" — auto-fits up to Lv 99 · 12345/67890.' },
            solPill:            { x: 279,  y: 575,  w: 130, h: 36, type: 'chip',    notes: '"◼ 19.99 SOL" — 2 decimals, mint label, gold edge.' },
            // 2026-04-27 — MatchSetupCard SUPERSEDED. Its mode tag + squad counter
            // re-homed to top-level gameModeChip / squadCounterLabel. Entry kept
            // at off-canvas y for legacy-binding safety; node force-hidden in
            // generate-scenes.js (_active=false).
            matchSetupCard:     { x: 0,    y: -9999, w: 688, h: 124, type: 'group',  notes: 'LEGACY — superseded 2026-04-27; _active=false at scene-gen' },
            // Re-homed from matchSetupCard — top-LEFT of feedFrameCard top band.
            gameModeChip:       { x: -250, y: td.GAMEMODE_CHIP_Y, w: 168, h: 24, type: 'chip',
                notes: 'TOKEN DUEL · 1V1 mode tag — top-LEFT of FeedFrameCard. AppUI._matchSetupModeTag binding retargets here.' },
            // Re-homed from matchSetupCard — top-RIGHT of feedFrameCard top band.
            squadCounterLabel:  { x:  270, y: td.SQUAD_COUNTER_Y, w: 124, h: 24, type: 'label',
                notes: 'Squad: X/3 — top-RIGHT of FeedFrameCard. AppUI._matchSetupSquadLabel binding retargets here.' },
            // 2026-04-27 — feedFrameCard expanded down by 388 (literal 2x scrollview).
            // Top stays at y=320 (bottom of new SquadPanel + 5gap). Bottom drops to y=-620.
            feedFrameCard:      { x: 0,    y: td.FEED_FRAME_Y,  w: 712, h: td.FEED_FRAME_H, type: 'sprite',
                notes: 'unified card behind Row 1 + Row 2 + col headers + feed; 2026-04-27 grew downward to wrap 2x scrollview' },
            search:             { x: 46,   y: td.SEARCH_Y, w: 312, h: 44, type: 'editbox', notes: 'shrunken to share Row 1 with Trending dropdown + star + LIVE' },
            searchClear:        { x: 188,  y: td.SEARCH_Y, w: 32,  h: 32, type: 'btnGhost' },
            feedTabDropdown:    { x: -224, y: td.SEARCH_Y, w: 200, h: 44, type: 'btnGhost' },
            watchlistStar:      { x: 240,  y: td.SEARCH_Y, w: 44,  h: 44, type: 'btnGhost', notes: 'icon-only ★ button (no text)' },
            cancelWatchlist:    { x: 240,  y: td.SEARCH_Y, w: 36,  h: 36, type: 'btnGhost' },
            liveIndicator:      { x: 314,  y: td.SEARCH_Y, w: 80,  h: 24, type: 'label' },
            // Filter row — pill chips: [Newest] [Liquidity ▾] [All ▾] ........ [⋮ Cols]
            // Newest + Liquidity ▾ come from feedFilterChip template (xs=[-272,-160]).
            // [All ▾] = minLiqDropdown (relabeled at runtime from active value).
            // [⋮ Cols] = columnsBtn shrunk for icon-feel at far right.
            minLiqDropdown:     { x: -16,  y: td.CHIPS_Y, w: 110, h: 32, type: 'chip',    notes: 'label morphs to active value: "All ▾" / "$1K+ ▾" / "$5K+ ▾" / "$10K+ ▾"' },
            columnsBtn:         { x: 270,  y: td.CHIPS_Y, w: 96,  h: 32, type: 'chip',    notes: 'reads "Cols ±" — wider than original 80 to fit new label' },
            feedColumnHeaders:  { x: 0,    y: td.COL_HEADERS_Y, w: 696, h: 24, type: 'group',    notes: 'docked just above scrollview; bg sprite child gives it visible chrome.' },
            // FeedScrollview — 2026-04-27 doubled to h=776 (literal 2x), top stays at y=180.
            feedScrollView:     { x: 0,    y: td.FEED_SCROLL_Y, w: 696, h: td.FEED_SCROLL_H, type: 'scrollview',
                notes: '2026-04-27 — h 388→776 (2x), top y=180. ~8 full rows visible at row h=85.' },
            // 2026-04-27 — Squad panel relocated to top region (was y=-345 bottom).
            // Compressed from h=220 to h=178 to fit between title bottom (y=507) and
            // FeedFrameCard top (y=320). Internal layout: header (y=486, h=18) →
            // 3 slots (y=438, h=64) → wager row (y=358, h=56).
            squadPanel:         { x: 0,    y: td.SQUAD_PANEL_Y, w: 700, h: td.SQUAD_PANEL_H, type: 'group',
                notes: '2026-04-27 hoisted to top. Wraps squadHeaderLabel + 3 squadSlots + wager row.' },
            squadHeaderLabel:   { x: 0,    y: td.SQUAD_HEADER_Y, w: 420, h: 18, type: 'label',
                notes: 'YOUR SQUAD — top of squadPanel.' },
            // Wager row — left wager-value button (200 wide), right start CTA (460 wide).
            wagerValueButton:   { x: -240, y: td.WAGER_Y, w: 200, h: 56, type: 'btnGhost',
                notes: '2026-04-27 — moved to top with squad panel. Tier selector; opens WagerDropdown DOWNWARD now.' },
            wagerStartButton:   { x: 110,  y: td.WAGER_Y, w: 460, h: 56, type: 'btnPrimary',
                notes: '▶ Start Duel CTA — relabels to "Pick X more" when squad incomplete.' },
            wagerLockChip:      { x: -240, y: td.WAGER_Y, w: 200, h: 56, type: 'chip',       notes: 'JOIN-MODE replaces wagerValueButton.' },
            wagerBotChip:       { x: -240, y: td.WAGER_Y, w: 200, h: 56, type: 'chip',       notes: 'BOT-MODE replaces wagerValueButton.' },
            wagerHintLabel:     { x: 0,    y: -700, w: 600, h: 24, type: 'label',      notes: 'LEGACY — _active=false at scene-gen. Kept for AppUI binding compatibility.' },
            wagerDropdown:      { x: -240, y: td.WAGER_DROPDOWN_Y, w: 360, h: 360, type: 'group',
                notes: '2026-04-27 — opens DOWNWARD now. Anchored below wager-value button (y=358 - 56/2 - 6gap - 360/2 = 144), overlays feed top region.' },
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
            status:             { x: 0,    y: -510, w: 688, h: 26, type: 'label',     notes: 'Holdings loaded (...). Sits below squad panel.' },
            // 8d — popover containers + their internal labels/buttons. Each
            // popover is _active=false by default; AppUI toggles per-event.
            // Anchors mechanically follow their triggers (y-shift to match new chip/tab/search y).
            searchSuggestionPopover: { x: -30, y: 345,  w: 560, h: 300, type: 'group',
                notes: '5 SuggestRow children; y = search.y(360) - 15' },
            feedTabDropdownPopover:  { x: -200, y: 135, w: 240, h: 304, type: 'group',
                notes: 'opens DOWN of FeedTabDropdownButton; y = feedTabDropdown.y(300) - 165 = 135' },
            minLiqDropdownPopover:   { x: -32,  y: 152, w: 120, h: 180, type: 'group',
                notes: 'y = minLiqDropdown.y(248) - 96 = 152' },
            // NEW — Liquidity-direction dropdown popover (mirrors minLiqDropdownPopover pattern).
            liqSortDropdownPopover:  { x: -160, y: 152, w: 140, h: 100, type: 'group',
                notes: 'opens DOWN from "Liquidity ▾" chip (anchor x=-160, y=248); 2 rows from liqSortOption template' },
            columnsPopover:          { x: 235,  y: 40,  w: 170, h: 360, type: 'group',
                notes: 'opens DOWN-LEFT of ColumnsButton (now x=270, y=248, w=80)' },
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
        },
        templates: {
            // 4 top-row icon buttons — relocated to a right-side cluster above
            // the Lv/SOL pills. Smaller (36×32 → 32×28) so they don't compete
            // with the pill row at y=575. Right margin 16px (rightmost icon
            // center = 360-16-16 = 328); 38px stride (32w + 6 gap).
            topRowActionBtn: {
                count: 4, w: 32, h: 28, y: 615,
                names:  ['OpenSettingsButton', 'OpenSquadPresetsButton',
                         'SuggestSquadButton', 'HelpButton'],
                labels: ['', '', '', '?'],
                xs:     [214, 252, 290, 328],
            },
            // Sort chips — 2-chip row: [Newest] [Liquidity ▾]. The Liq↓ + Liq↑
            // chips collapsed into a single 'liq' chip that opens
            // liqSortDropdownPopover (mirrors the minLiqDropdown pattern).
            // Filter row reads: [Newest] [Liquidity ▾] [All ▾] ........ [⋮ Cols]
            // ([All ▾] = minLiqDropdown, [⋮ Cols] = columnsBtn — both in elements above.)
            feedFilterChip: {
                count: 2, w: 110, h: 32, y: 248,
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
            // 2026-04-26 redesign — feedRow as a 2-line mobile card.
            //   Top line:    [Avatar 44×44] [SYMBOL bold]   [Score badge]   [+24H% color]
            //   Bottom line:               [name·mint muted]  [Liq] [Vol]   [Price gold right]
            // Avatar bumped 28→44. Row h 66→88, stride 70→92. Age and Dex
            // dropped from view (kept in template at off-screen positions for
            // AppUI binding compatibility, _active=false).
            feedRow: {
                count: 20, w: 688, h: 170,
                baseY: -85, gapY: -174,
                selectedEdge: { x: -334, y: 0,   w: 5,   h: 154, notes: 'left teal stripe; height tracks row h' },
                checkbox:     { x: -320, y: 0,   w: 22,  h: 22,  notes: 'watchlist mode — hidden by default' },
                checkmark:    { x: 0,    y: 1,   w: 22,  h: 22,  notes: 'inside checkbox — hidden by default' },
                logo:         { x: -253, y: 0,   w: 150, h: 150, notes: '3.4× original (44→150) — second bump request 2026-04-26' },
                // Top line (y=36)
                symbol:       { x: -71,  y: 36,  w: 154, h: 26, notes: 'bold 22pt, left-aligned; tight to clear 150px logo' },
                score:        { x: 40,   y: 36,  w: 44,  h: 20, notes: 'small gold chip; subordinate to 24H hero' },
                change:       { x: 280,  y: 36,  w: 90,  h: 30, notes: 'HERO 24H% — 26pt bold right-aligned colored' },
                delta:        { x: 280,  y: 36,  w: 90,  h: 30, notes: 'alternate of change — _active=false' },
                // Bottom line (y=-30)
                name:         { x: -71,  y: -30, w: 154, h: 18, notes: 'name · mint muted, left-aligned' },
                liq:          { x: 80,   y: -30, w: 70,  h: 18 },
                vol:          { x: 160,  y: -30, w: 70,  h: 18 },
                price:        { x: 270,  y: -30, w: 90,  h: 18, notes: 'gold mono, right-aligned, 16pt' },
                // Hidden in card view but kept for binding compat (off-screen)
                age:          { x: -2000, y: 0,  w: 1, h: 1, notes: 'DROPPED FROM CARD; node kept active=false off-screen' },
                dex:          { x: -2000, y: 0,  w: 1, h: 1, notes: 'DROPPED FROM CARD' },
                liveDot:      { x: 320,  y: -64, w: 8,   h: 8 },
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
            // 3 squad slots — pushed down from y=-300 to y=-330 to make room
            // for the action button row + header above.
            squadSlot: {
                count: 3, w: 200, h: 64, y: -330,
                xs: [-220, 0, 220],
                logo:   { x: -76, y: 0,   w: 40,  h: 40 },
                symbol: { x: 14,  y: 10,  w: 130, h: 22 },
                delta:  { x: 14,  y: -14, w: 130, h: 18 },
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
            // TODO 8c: squad/stake intentional overlaps (squad buttons span the
            // stake-control y-range as a layered control panel; revisit then)
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
        elements: {
            historyView: { x: 0, y: 0, w: 720, h: 1280, type: 'group',
                notes: 'PortfolioHistoryView container; hidden until History tab active' },
            backLink: { x: -280, y: 720, w: 110, h: 28, type: 'label' },
            backBtn:  { x: -280, y: 720, w: 140, h: 36, type: 'btnGhost' },
            title:    { x: 0,    y: 680, w: 400, h: 44, type: 'label' },
            // Subtitle eyebrow under title.
            subtitle:    { x: 0,    y: 644, w: 460, h: 18, type: 'label' },
            pubkeyLabel: { x: 0,    y: 612, w: 460, h: 24, type: 'label' },
            // Primary tabs — full-width segmented control.
            statsTab:    { x: -200, y: 560, w: 200, h: 48, type: 'btnPrimary' },
            historyTab:  { x: 0,    y: 560, w: 200, h: 48, type: 'btnGhost' },
            trophiesTab: { x: 200,  y: 560, w: 200, h: 48, type: 'btnGhost' },
            // Secondary mode toggle — smaller, with MODE eyebrow above.
            modeLabel:   { x: 0,    y: 510, w: 100, h: 16, type: 'label' },
            paperTab:    { x: -75,  y: 482, w: 130, h: 36, type: 'btnPrimary' },
            realTab:     { x: 75,   y: 482, w: 130, h: 36, type: 'btnGhost' },
            // Group eyebrow headers (left-aligned).
            groupHeaderPerformance: { x: -290, y: 230,  w: 200, h: 16, type: 'label' },
            groupHeaderActivity:    { x: -290, y: -50,  w: 200, h: 16, type: 'label' },
            // Empty-state container — shown when zero games (hides hero/groups).
            emptyState:         { x: 0,    y: 200,  w: 600, h: 400, type: 'group' },
            emptyStateTitle:    { x: 0,    y: 80,   w: 600, h: 36, type: 'label' },
            emptyStateSubtitle: { x: 0,    y: 30,   w: 600, h: 22, type: 'label' },
            emptyStateCta:      { x: 0,    y: -50,  w: 320, h: 56, type: 'btnPrimary' },
            // Footer.
            hint:   { x: 0, y: -700, w: 620, h: 20, type: 'label' },
            status: { x: 0, y: -740, w: 640, h: 22, type: 'label' },
            // History view internals.
            historyEmpty:    { x: 0, y: 0,    w: 0,   h: 22, type: 'label' },
            historyScroll:   { x: 0, y: 40,   w: 660, h: 780, type: 'scrollview' },
            historyLoadMore: { x: 0, y: -260, w: 400, h: 48, type: 'btnGhost' },
            // Trophies view container + empty label.
            trophiesView:    { x: 0, y: 0,   w: 720, h: 1280, type: 'group' },
            trophiesEmpty:   { x: 0, y: 540, w: 0,   h: 24, type: 'label' },
        },
        templates: {
            // Hero P/L card — focal point. Big colored value + edge accent
            // (green/red/neutral re-tinted at runtime).
            heroPnLCard: {
                x: 0, y: 380, w: 600, h: 160,
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
                    { key: 'wins',    label: 'WINS',   x: -150, y: 168 },
                    { key: 'losses',  label: 'LOSSES', x:  150, y: 168 },
                    { key: 'winrate', label: 'WIN %',  x:    0, y:  78, w: 600 },
                    { key: 'games',   label: 'GAMES',  x: -150, y: -120 },
                ],
                header: { x: 0, y: 22,  w: 270, h: 18 },
                value:  { x: 0, y: -16, w: 270, h: 36 },
            },
            // XP/Level card — gamified progress to next level.
            xpCard: {
                x: 150, y: -120, w: 290, h: 88,
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
                gridYBase: 220,
                gridYStride: -220, // row 0 at y=220, row 1 at y=0
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
                baseY: -36, gapY: -72,
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
    // Phase 9b — Row template migrated. Full chrome (header, close,
    // mark-all, list container, empty label, backdrop) deferred.
    NotificationPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            listContainer: { x: 0, y: -60, w: 460, h: 980, type: 'group' },
            // 9c — NotifPanelCard chrome (the visible card inside the panel).
            cardHeaderLabel: { x: 0,   y: 580, w: 320, h: 36, type: 'label',
                notes: '9c: w 360→320 to clear NotifCloseButton bbox left x=176' },
            cardCloseButton: { x: 200, y: 580, w: 48,  h: 48, type: 'btnGhost' },
            cardMarkAllReadButton: { x: -100, y: 530, w: 200, h: 36, type: 'btnGhost' },
        },
        templates: {
            // 8 reusable rows in NotifListContainer. AppUI activates per
            // unread notification, writes Title/Body/Time labels, toggles
            // unread dot.
            //
            // Phase 9b fix: body.h shrunk 32→30 and y shifted -8→-10 so
            // its top edge clears Title's bottom edge.
            notifRow: {
                count: 8, w: 460, h: 92, gap: 8,
                baseY: 480, gapY: -100,
                stripe: { x: -227, y: 0,   w: 6,   h: 92 },
                icon:   { x: -185, y: 0,   w: 40,  h: 40 },
                title:  { x: -15,  y: 18,  w: 280, h: 22 },
                body:   { x: -15,  y: -8,  w: 270, h: 28, notes: 'Phase 9b: w 280→270 clears Time x[120,220]; h 32→28 clears Title bbox top + Time bbox top' },
                time:   { x: 170,  y: -32, w: 100, h: 16 },
                dot:    { x: 210,  y: 32,  w: 8,   h: 8 },
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
            roster:  { x: 0, y: 150, w: 640, h: 440, type: 'group' },
            // 9c — chrome (back/title) migrated.
            backBtn: { x: -260, y: 600, w: 160, h: 44, type: 'btnGhost' },
            title:   { x: 0,    y: 600, w: 300, h: 40, type: 'label',
                notes: '9c: w 460→300 to clear BackButton bbox right x=-180' },
            // 11 — header strip + join CTA.
            matchLabel:  { x: 0,    y: 558, w: 500, h: 20, type: 'label' },
            statusLabel: { x: 0,    y: 520, w: 500, h: 22, type: 'label' },
            prizeLabel:  { x: 0,    y: 485, w: 600, h: 22, type: 'label' },
            joinBtn:     { x: 0,    y: -460, w: 620, h: 58, type: 'btnPrimary',
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
    // Phase 9c — chrome migrated. Symbol/Name labels shifted right + shrunk
    // to clear back chrome. Body of panel (price chart, stats grid, etc.)
    // deferred to Phase 8e.
    TokenDetailPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:    { x: -280, y: 618, w: 110, h: 28, type: 'label' },
            backBtn:     { x: -280, y: 618, w: 140, h: 36, type: 'btnGhost' },
            // 9c: title fits between back chrome right (x=-210) and mint chip left (x=100).
            symbolLabel: { x: -55,  y: 600, w: 290, h: 36, type: 'label' },
            nameLabel:   { x: -55,  y: 566, w: 290, h: 22, type: 'label' },
            // 11 — body chrome.
            mintChip:        { x: 200, y: 572, w: 200, h: 28, type: 'btnGhost' },
            pickBtn:         { x: 0,   y: 525, w: 620, h: 48, type: 'btnPrimary' },
            chartArea:       { x: 0,   y: 40,  w: 680, h: 640, type: 'group' },
            chartLoadLabel:  { x: 0,   y: 0,   w: 300, h: 22, type: 'label',
                notes: 'rel to ChartArea center; shown while loading' },
            status:          { x: 0,   y: -625, w: 660, h: 22, type: 'label' },
        },
        templates: {
            // 4 safety chips at y=465. Computed: -240 + s * 155.
            safetyChip: {
                count: 4, w: 140, h: 32, y: 465,
                baseX: -240, gapX: 155,
                defs: [
                    { key: 'mint',  label: '◎ Mint' },
                    { key: 'auth',  label: '◎ Auth' },
                    { key: 'lp',    label: '◎ LP' },
                    { key: 'top10', label: '◎ Top10' },
                ],
            },
            // 6 timeframe buttons at y=415. Computed: -275 + t * 90.
            timeframeBtn: {
                count: 6, w: 80, h: 32, y: 415,
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
            // 4 denomination buttons at y=378. Pairs split across center.
            denomBtn: {
                count: 4, w: 90, h: 28, y: 378,
                defs: [
                    { key: 'price', label: 'Price', x: -210 },
                    { key: 'mcap',  label: 'MCap',  x: -110 },
                    { key: 'usd',   label: 'USD',   x:  110 },
                    { key: 'sol',   label: 'SOL',   x:  210 },
                ],
            },
            // 6 stat cards in 3×2 grid (y=-340 / -420). Internal: header + value.
            detailStatCard: {
                count: 6, w: 210, h: 70,
                defs: [
                    { key: 'price',   label: 'PRICE',   x: -225, y: -340 },
                    { key: 'liq',     label: 'LIQ',     x:  0,   y: -340 },
                    { key: 'mcap',    label: 'MCAP',    x:  225, y: -340 },
                    { key: 'vol24h',  label: 'VOL 24H', x: -225, y: -420 },
                    { key: 'change',  label: '24H',     x:  0,   y: -420 },
                    { key: 'holders', label: 'HOLDERS', x:  225, y: -420 },
                ],
                header: { x: 0, y: 16,  w: 200, h: 22 },
                value:  { x: 0, y: -14, w: 200, h: 28 },
            },
        },
        allowedOverlaps: [
            ['BackLinkLabel', 'BackButton'],
        ],
    },

    /* ───── DAILY CHALLENGE ─────────────────────────────────────────── */
    // Phase 9c — chrome migrated + DailyStreakCard internals fixed. Title
    // shrunk to clear back chrome; StreakDayLabel h shrunk to clear
    // StreakBestLabel.
    DailyChallengePanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:        { x: -280, y: 618, w: 110, h: 28, type: 'label' },
            backBtn:         { x: -280, y: 618, w: 140, h: 36, type: 'btnGhost' },
            title:           { x: 0,    y: 600, w: 400, h: 40, type: 'label',
                notes: '9c: w 600→400 to clear BackButton bbox right x=-210' },
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
            backBtn: { x: -260, y: 600, w: 160, h: 44, type: 'btnGhost' },
            title:   { x: 0,    y: 600, w: 300, h: 40, type: 'label',
                notes: '9c: w 460→300 to clear BackButton bbox right x=-180' },
            // 11 — header strip + player/event lists + join CTA.
            matchLabel:      { x: 0, y: 558, w: 500, h: 20, type: 'label' },
            statusLabel:     { x: 0, y: 520, w: 500, h: 22, type: 'label' },
            playerList:      { x: 0, y: 240, w: 620, h: 380, type: 'group' },
            eventList:       { x: 0, y: -170, w: 620, h: 260, type: 'group' },
            eventListHeader: { x: -270, y: 110, w: 300, h: 18, type: 'label' },
            joinBtn:         { x: 0, y: -440, w: 620, h: 56, type: 'btnPrimary' },
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
        canvas: { w: 720, h: 1280 },
        elements: {
            // Bg tint layer — full canvas Graphics rect, alpha 0 by default;
            // AppUI tweens to subtle green/violet based on outcome.
            outcomeBg:       { x: 0,    y: 0,    w: 720, h: 1280, type: 'graphics',
                notes: 'rendered first (behind everything); AppUI fills + fades on show' },
            backBtn:         { x: -260, y: 700, w: 160, h: 44,  type: 'btnGhost' },
            title:           { x: 0,    y: 620, w: 620, h: 80,  type: 'label',
                notes: '56pt bold, color-coded green/rose by outcome' },
            track:           { x: 0,    y: 560, w: 600, h: 22,  type: 'label' },
            // Mascot glow halo behind the centered mascot — radial fill.
            mascotGlow:      { x: 0,    y: 130, w: 480, h: 480, type: 'graphics',
                notes: 'circle fill alpha 0; AppUI tweens to 140 (~0.55) tinted by outcome' },
            // Mascot centered under header, 1.8× current size.
            mascotContainer: { x: 0,    y: 130, w: 360, h: 360, type: 'mascot',
                notes: 'Drifting-gadget redesign: centered, sized for hero impact. Per-state celebrate/lose frames already wired in MascotController.' },
            payoutLabel:     { x: 0,    y: -80, w: 620, h: 96, type: 'label',
                notes: '64pt mono, scale-in + ticker on win, scale-in only on loss' },
            subtitle:        { x: 0,    y: -190, w: 600, h: 44, type: 'label',
                notes: '18pt 2-line; line1 = "You won by X pp" / "They beat you by X pp"; line2 = per-token breakdown' },
            rake:            { x: 0,    y: -250, w: 600, h: 20, type: 'label' },
            // Stat cards in 2×2 grid; row centers below rake.
            // (Card coords below in templates.pmCard.defs.)
            // XP progress bar — three siblings: left label, fill graphics, right label.
            xpBarLabelLeft:  { x: -240, y: -560, w: 200, h: 22, type: 'label',
                notes: '"Lv N → Lv N+1" 14pt mid-grey' },
            xpBarFill:       { x: 0,    y: -560, w: 480, h: 16, type: 'graphics',
                notes: 'Track + accent fill; AppUI tweens fill width on show' },
            xpBarLabelRight: { x: 240,  y: -560, w: 120, h: 22, type: 'label',
                notes: '"+10 XP" 18pt bold accent' },
            sameSquadBtn:    { x: -180, y: -660, w: 320, h: 64, type: 'btnPrimary' },
            againBtn:        { x: 180,  y: -660, w: 320, h: 64, type: 'btnPrimary' },
            shareButton:     { x: 0,    y: -740, w: 280, h: 44, type: 'btnPrimary',
                notes: 'tertiary; only visible for real-track wins' },
            status:          { x: 0,    y: -810, w: 640, h: 20, type: 'label' },
            trophy:          { x: 280,  y: 620, w: 64, h: 64, type: 'label',
                notes: 'corner badge in title row; mascot is now the primary celebration. AppUI attaches rankIcon at show time.' },
        },
        templates: {
            // 4 stat cards in a 2×2 grid (you/opp/xp/lvl). Internal: header
            // label at top + value label below. Coordinates relative to card center.
            // h bumped 92 → 116 for breathing room; value font emitted larger by generator.
            pmCard: {
                count: 4, w: 300, h: 116,
                defs: [
                    { key: 'you', label: 'YOUR DELTA', x: -160, y: -320 },
                    { key: 'opp', label: 'BEST OPP',   x:  160, y: -320 },
                    { key: 'xp',  label: 'XP EARNED',  x: -160, y: -440 },
                    { key: 'lvl', label: 'LEVEL',      x:  160, y: -440 },
                ],
                header: { x: 0, y: 36,  w: 280, h: 22 },
                value:  { x: 0, y: -22, w: 280, h: 44 },
            },
            // 12 confetti shells, child of TrophyLabel; AppUI rebases burst
            // origin to mascot world position at show time so the burst still
            // emanates from the celebrate mascot.
            confetti: {
                count: 12, w: 60, h: 60,
                x: 0, y: 0,
            },
        },
        // Mascot now occupies center (y=130) above payout (y=-80); no overlaps.
        allowedOverlaps: [],
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
