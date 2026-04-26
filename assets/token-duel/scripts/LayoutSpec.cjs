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
    // Pre-connect screen. Title + subtitle + mascot greeter + Connect /
    // Reconnect / Status. Vertical band: y=500 down to y=-240.
    Landing: {
        canvas: { w: 720, h: 1280 },
        bg: { color: '#000000' },
        elements: {
            title:             { x: 0,   y: 460,  w: 680, h: 80,  type: 'label',     notes: 'Token Duel — display font, gold' },
            subtitle:          { x: 0,   y: 370,  w: 680, h: 50,  type: 'label',     notes: 'Portfolio Race on Solana — body font, muted' },
            mascot:            { x: 0,   y: 215,  w: 140, h: 180, type: 'mascot',    notes: 'idle Seedance frames; 40px gap below subtitle, 55px gap above connect' },
            connectBtn:        { x: 0,   y: 20,   w: 680, h: 100, type: 'btnPrimary',notes: 'Connect Wallet primary CTA' },
            reconnBtn:         { x: 0,   y: -90,  w: 680, h: 100, type: 'btnSuccess',notes: 'Reconnect (Cached) — only shown when AuthCache.hasCachedAuth' },
            statusLbl:         { x: 0,   y: -210, w: 680, h: 36,  type: 'label',     notes: 'Tap Connect to link your wallet — body, muted; shrunk h 60→36 to clear Play as Guest button bbox' },
            // Play as Guest — zero-friction try-it-out. Creates a synthetic
            // local-only ID + drops user into paper-bot-only flow. No wallet,
            // no SOL. Sign Out clears local stats.
            playAsGuestBtn:    { x: 0,   y: -320, w: 680, h: 100, type: 'btnSuccess',notes: 'Practice with bots, no wallet needed' },
            playAsGuestSubtitle:{ x: 0,  y: -380, w: 660, h: 22,  type: 'label',     notes: '14pt mid text under PlayAsGuestButton' },
        },
        allowedOverlaps: [],
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
    Home: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // Top bar (y=700) — symmetric Bell ↔ Pubkey ↔ Settings
            notificationBell:    { x: -280, y: 700,  w: 64,  h: 64,  type: 'btnGhost', notes: 'left flank icon' },
            notificationBadge:   { x: -256, y: 722,  w: 24,  h: 24,  type: 'badge',    notes: 'unread count; sits ON the bell intentionally' },
            pubkeyLabel:         { x: 0,    y: 700,  w: 380, h: 40,  type: 'label',    notes: 'centered between bell and settings; w 360→380 since FindMatch icon removed' },
            openSettingsBtn:     { x: 280,  y: 700,  w: 64,  h: 64,  type: 'btnGhost', notes: 'right flank icon' },
            // Stage 2 — Lv/XP chip top-right above the chrome row. Reads
            // on-chain UserStats + local XP via _refreshLevelChip().
            homeLevelChip:       { x: 240,  y: 750,  w: 200, h: 32,  type: 'chip',     notes: '"Lv N · X/Y" gold bold; hidden until UserStats loads' },
            // Chrome strips (alternates — only one active at a time)
            homeRakeChip:        { x: 0,    y: 552,  w: 700, h: 22,  type: 'chip',     notes: 'Phase 22 (B): below-strips position so identity (pubkey) reads first, status next, contextual rake last.' },
            homeMatchTicker:     { x: 0,    y: 660,  w: 700, h: 36,  type: 'chip',     notes: 'shown during active match' },
            homeTournamentBadge: { x: 0,    y: 660,  w: 700, h: 36,  type: 'chip',     notes: 'shown when tournament soon' },
            dailyStreakStrip:    { x: 0,    y: 600,  w: 700, h: 48,  type: 'chip',     notes: 'always-visible streak/season strip' },
            // Primary CTA TRIO — stacked hero buttons + matching subtitle labels.
            // Buttons h=82, subtitles h=20, 6 px gap below button → 108-px unit
            // with 116 px stride. Spans y=540 → y=226 (mascot top y=225).
            startMatchBtn:       { x: 0,    y: 499,  w: 680, h: 82,  type: 'btnPrimary', notes: 'Hero violet — host a real on-chain match' },
            startMatchSubtitle:  { x: 0,    y: 448,  w: 660, h: 20,  type: 'label',      notes: '14pt mid text — subtitle under StartMatchBtn' },
            findMatchBtn:        { x: 0,    y: 383,  w: 680, h: 82,  type: 'btnSuccess', notes: 'Hero teal — browse open lobbies' },
            findMatchSubtitle:   { x: 0,    y: 332,  w: 660, h: 20,  type: 'label',      notes: '14pt mid text — subtitle under FindMatchBtn' },
            findMatchCountBadge: { x: 244,  y: 401,  w: 76,  h: 28,  type: 'badge',      notes: 'live count pill on right side of FindMatchBtn; teal fill, white bold; AppUI subscribes to MatchBrowser' },
            botMatchBtn:         { x: 0,    y: 267,  w: 680, h: 82,  type: 'btnWarn',    notes: 'Warn amber — paper / vs bots / free' },
            botMatchSubtitle:    { x: 0,    y: 216,  w: 660, h: 20,  type: 'label',      notes: '14pt mid text — subtitle under BotMatchBtn' },
            // Mascot (centerpiece) — moved up from y=180 to y=140 to give the
            // CTA trio breathing room. Size shrunk 140×180 → 130×170 (still
            // visually balanced with the new stack).
            mascot:              { x: 0,    y: 140,  w: 130, h: 170, type: 'mascot',     notes: 'idle Seedance frames; CTA trio sits above, account mgmt below' },
            // Account management
            disconnectBtn:       { x: 0,    y: -50,  w: 680, h: 86,  type: 'btnDanger',  notes: 'orange-warning; hidden in guest mode' },
            // Guest mode "Sign Out" — same slot as Disconnect, mutually exclusive.
            signOutGuestBtn:     { x: 0,    y: -50,  w: 680, h: 86,  type: 'btnDanger',  notes: 'guest-only; clears guest_id + paper Stats; replaces DisconnectButton when _isGuest' },
            deleteBtn:           { x: 0,    y: -160, w: 680, h: 86,  type: 'btnDanger',  notes: 'red-danger' },
            // Status footer
            homeStatus:          { x: 0,    y: -300, w: 680, h: 32,  type: 'label',      notes: 'status banner near bottom' },
        },
        allowedOverlaps: [
            ['NotificationBellButton',  'NotificationBellBadge'],   // badge ON bell
            ['DailyStreakStrip',        'HomeMatchTicker'],          // alternates
            ['DailyStreakStrip',        'HomeTournamentBadge'],      // alternates
            ['HomeMatchTicker',         'HomeTournamentBadge'],      // alternates
            ['FindMatchButton',         'FindMatchButtonCountBadge'],// badge sits ON the FindMatch button intentionally
            ['DisconnectButton',        'SignOutGuestButton'],       // alternates per guest/wallet mode
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
    // (oversized for tall device viewports). Layout: TimerRing+countdown
    // top center y=480, hero % y=340, 5 race cards stacked y=50→-470,
    // opponent card/strip at y=-400/-406 (alternates), forfeit y=-560,
    // race mascot bottom-right, vignette overlay.
    RacePanel: {
        canvas: { w: 720, h: 1800 },
        elements: {
            // Timer + countdown (countdown label sits inside the ring)
            timerRing:        { x: 0,    y: 480,  w: 140, h: 140, type: 'graphics' },
            timerPulse:       { x: 0,    y: 0,    w: 110, h: 110, type: 'graphics', notes: 'inside ring; coords relative to ring' },
            countdownLabel:   { x: 0,    y: 480,  w: 110, h: 36,  type: 'label' },
            // Hero portfolio delta
            heroDelta:        { x: 0,    y: 340,  w: 680, h: 140, type: 'label' },
            heroSubtitle:     { x: 0,    y: 250,  w: 600, h: 40,  type: 'label' },
            // Opponent surfaces (alternates: 1v1 shows opponentCard, multi shows oppStrip)
            opponentCard:     { x: 0,    y: -400, w: 640, h: 110, type: 'sprite' },
            opponentStrip:    { x: 0,    y: -406, w: 640, h: 260, type: 'group' },
            // Forfeit + mascot + vignette
            cancelBtn:        { x: 0,    y: -560, w: 200, h: 48,  type: 'btnDanger' },
            mascot:           { x: 260,  y: -620, w: 140, h: 180, type: 'mascot',
                notes: 'Phase 21 (A1): y -680 → -620 (60 px up) per device test feedback' },
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
        },
        allowedOverlaps: [
            ['RaceTimerRing', 'RaceCountdownLabel'],   // label inside ring
            // Card_4 / OpponentCard / OpponentStrip — mutually exclusive
            // visibility (squad size or 1v1 vs multi-player), bbox overlap
            // is harmless because only one is _active at a time.
            ['RaceTokenCard_4', 'RaceOpponentCard'],
            ['RaceTokenCard_4', 'RaceOpponentStrip'],
            ['RaceOpponentCard', 'RaceOpponentStrip'],
            // ScreenVignette is a full-screen alpha overlay drawn beneath
            // race UI; intentional overlap with everything visible.
            ['ScreenVignette', 'RaceTimerRing'],
            ['ScreenVignette', 'RaceCountdownLabel'],
            ['ScreenVignette', 'RaceHeroDeltaLabel'],
            ['ScreenVignette', 'RaceHeroSubtitleLabel'],
            ['ScreenVignette', 'RaceTokenCard_0'],
            ['ScreenVignette', 'RaceTokenCard_1'],
            ['ScreenVignette', 'RaceTokenCard_2'],
            ['ScreenVignette', 'RaceTokenCard_3'],
            ['ScreenVignette', 'RaceTokenCard_4'],
            ['ScreenVignette', 'RaceOpponentCard'],
            ['ScreenVignette', 'RaceOpponentStrip'],
            ['ScreenVignette', 'RaceCancelButton'],
            ['ScreenVignette', 'RaceMascotContainer'],
        ],
    },

    /* ───── SETTINGS ────────────────────────────────────────────────── */
    // Settings hub. Top: Back/Title. WALLET / PROFILE /
    // QUICK PLAY DEFAULTS / AUDIO+HAPTICS cards stacked. Then Fees link,
    // Reconnect / Disconnect / Delete actions, Status footer.
    SettingsPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:        { x: -280, y: 618,  w: 110, h: 28,  type: 'label' },
            backBtn:         { x: -280, y: 618,  w: 140, h: 36,  type: 'btnGhost' },
            title:           { x: 0,    y: 600,  w: 400, h: 40,  type: 'label' },
            walletCard:      { x: 0,    y: 440,  w: 660, h: 130, type: 'group',
                children: {
                    header:        { x: -290, y: 44,  w: 200, h: 16, type: 'label' },
                    walletName:    { x: 0,    y: 14,  w: 600, h: 28, type: 'label' },
                    walletPubkey:  { x: 0,    y: -20, w: 600, h: 22, type: 'label' },
                    walletBalance: { x: 0,    y: -44, w: 600, h: 18, type: 'label' },
                },
            },
            profileCard:     { x: 0,    y: 280,  w: 660, h: 150, type: 'group',
                children: {
                    header:       { x: -290, y: 54,  w: 200, h: 16, type: 'label' },
                    username:     { x: 0,    y: 16,  w: 600, h: 44, type: 'editbox' },
                    usernameSaved:{ x: 0,    y: -26, w: 600, h: 18, type: 'label' },
                    usernameHelp: { x: 0,    y: -50, w: 600, h: 16, type: 'label' },
                },
            },
            // Phase 27 — QuickPlayCard: 13-button strip → 3 dropdown rows + 1 pill toggle.
            // Card grew y=80→60, h=200→240. Internal layout: header on top, 3 rows
            // stacked, track toggle on bottom. Each row = full-width button with
            // two label children (key left, value right + chevron).
            quickPlayCard:   { x: 0,    y: 60,   w: 660, h: 240, type: 'group',
                children: {
                    header: { x: -290, y: 106, w: 400, h: 18, type: 'label' },
                    // 3 dropdown rows. Each row container is a button with 2 label
                    // children (key/value). Rows are siblings under QPCard.
                    qpModeRow:   { x: 0, y: 68,  w: 600, h: 40, type: 'btnGhost',
                        children: {
                            keyLabel:   { x: -270, y: 0, w: 200, h: 20, type: 'label' },
                            valueLabel: { x:  130, y: 0, w: 280, h: 22, type: 'label' },
                        },
                    },
                    qpWindowRow: { x: 0, y: 22,  w: 600, h: 40, type: 'btnGhost',
                        children: {
                            keyLabel:   { x: -270, y: 0, w: 200, h: 20, type: 'label' },
                            valueLabel: { x:  130, y: 0, w: 280, h: 22, type: 'label' },
                        },
                    },
                    qpWagerRow:  { x: 0, y: -24, w: 600, h: 40, type: 'btnGhost',
                        children: {
                            keyLabel:   { x: -270, y: 0, w: 200, h: 20, type: 'label' },
                            valueLabel: { x:  130, y: 0, w: 280, h: 22, type: 'label' },
                        },
                    },
                    // Track pill toggle — 320×44 right-aligned within card. Indicator
                    // sprite slides x=−78 ↔ x=78 between Paper/Real halves. Hit
                    // areas are invisible buttons sitting on top of indicator+labels.
                    qpTrackRow:   { x: -270, y: -78, w: 240, h: 22, type: 'label',
                        notes: 'TRACK key label sibling of toggle' },
                    qpTrackToggle:{ x: 80,  y: -78, w: 320, h: 44, type: 'group',
                        children: {
                            indicator:  { x: -78, y: 0, w: 156, h: 44, type: 'sprite' },
                            paperLabel: { x: -78, y: 0, w: 140, h: 22, type: 'label' },
                            realLabel:  { x:  78, y: 0, w: 140, h: 22, type: 'label' },
                            paperHit:   { x: -78, y: 0, w: 156, h: 44, type: 'btnGhost' },
                            realHit:    { x:  78, y: 0, w: 156, h: 44, type: 'btnGhost' },
                        },
                    },
                },
            },
            // Phase 27 — AudioCard shifted y=-80 → -130 to clear taller QPCard.
            audioCard:       { x: 0,    y: -130, w: 660, h: 70,  type: 'group',
                children: {
                    header:        { x: -290, y: 20,  w: 400, h: 16, type: 'label' },
                    soundToggle:   { x: -150, y: -10, w: 260, h: 38, type: 'btnPrimary' },
                    hapticsToggle: { x: 150,  y: -10, w: 260, h: 38, type: 'btnPrimary' },
                },
            },
            feesLink:        { x: 0,    y: -360, w: 560, h: 52, type: 'btnGhost' },
            reconnectBtn:    { x: 0,    y: -440, w: 660, h: 48, type: 'btnGhost' },
            disconnectBtn:   { x: 0,    y: -500, w: 660, h: 48, type: 'btnDanger' },
            deleteBtn:       { x: 0,    y: -560, w: 660, h: 48, type: 'btnDanger' },
            status:          { x: 0,    y: -610, w: 640, h: 20, type: 'label' },
            // Phase 27 — QP popovers. Direct children of SettingsPanel for z-order
            // (must render on top of all cards). Hidden by default; AppUI shows on
            // dropdown tap. Panel-y positions anchor each popover below its row.
            qpModePopover:   { x: 200, y: 20,  w: 220, h: 174, type: 'group',
                notes: 'opens BELOW QPModeRow (panel y=128); 4 options × 40 + 14 padding' },
            qpWindowPopover: { x: 200, y: -26, w: 220, h: 174, type: 'group',
                notes: 'opens BELOW QPWindowRow (panel y=82)' },
            qpWagerPopover:  { x: 200, y: -92, w: 220, h: 214, type: 'group',
                notes: 'opens BELOW QPWagerRow (panel y=36); 5 options × 40 + 14' },
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
        ],
    },

    // Synthetic top-level entry — verifier matches `Identifier: { ... allowedOverlaps }`
    // by panel name. QPTrackToggle counts as its own panel because it has 5 UI
    // children. The toggle has intentional internal overlaps: indicator sits
    // BEHIND labels (decorative), and invisible hit areas sit ON TOP of both.
    QPTrackToggle: {
        allowedOverlaps: [
            ['QPTrackIndicator', 'QPTrackPaperLabel'],
            ['QPTrackIndicator', 'QPTrackPaperHit'],
            ['QPTrackPaperLabel', 'QPTrackPaperHit'],
            ['QPTrackRealLabel', 'QPTrackRealHit'],
        ],
    },

    /* ───── LEADERBOARD ─────────────────────────────────────────────── */
    // Trophy → top-10 by mode (1v1 / 4p / 8p / BR10 / season). 5 mode tabs
    // y=600, 10 rows y=540→-36 (stride 64), PersonalRankCard footer y=-130
    // (HIDDEN until pubkey connects), Status y=-740. Back/Title at top.
    LeaderboardPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:        { x: -280, y: 720,  w: 110, h: 28,  type: 'label' },
            backBtn:         { x: -280, y: 720,  w: 140, h: 36,  type: 'btnGhost' },
            title:           { x: 0,    y: 680,  w: 400, h: 44,  type: 'label' },
            personalRankCard: { x: 0,   y: -130, w: 660, h: 100, type: 'group',
                children: {
                    header: { x: -290, y: 32,  w: 120, h: 18, type: 'label' },
                    rank:   { x: 0,    y: 6,   w: 600, h: 24, type: 'label' },
                    stats:  { x: 0,    y: -22, w: 600, h: 20, type: 'label' },
                },
            },
            status:          { x: 0,    y: -740, w: 600, h: 22,  type: 'label' },
        },
        templates: {
            // 5 mode tabs at y=600 (Stage 3: br10 → trio).
            lbTab: {
                count: 5, w: 130, h: 44, y: 600,
                keys:   ['1v1', 'trio', '4p', '8p', 'season'],
                labels: ['1v1', 'Trio', '4p', '8p', 'This Week'],
                xs: [-292, -146, 0, 146, 292],
                activeIdx: 0,
            },
            // 10 rank rows. Player h shrunk 28→24 and Elapsed y moved
            // -14→-16 so internal bboxes don't overlap when rows activate.
            lbRow: {
                count: 10, w: 660, h: 54,
                baseY: 540, gapY: -64,
                rank:    { x: -300, y: 0,   w: 50,  h: 30 },
                player:  { x: -110, y: 6,   w: 280, h: 24 },
                height:  { x: 180,  y: 6,   w: 120, h: 28 },
                elapsed: { x: -110, y: -16, w: 280, h: 18 },
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
            backLink:           { x: -280, y: 720,  w: 110, h: 28, type: 'label' },
            backBtn:            { x: -280, y: 720,  w: 140, h: 36, type: 'btnGhost' },
            title:              { x: 0,    y: 700,  w: 280, h: 44, type: 'label' },
            // Stage 2 — Lv/XP chip top-right of TokenDuelPanel header (mirrors Home).
            tokenDuelLevelChip: { x: 240,  y: 750,  w: 200, h: 32, type: 'chip',    notes: '"Lv N · X/Y" gold bold; hidden until UserStats loads' },
            balanceChip:        { x: 230,  y: 700,  w: 180, h: 32, type: 'label' },
            search:             { x: 0,    y: 640,  w: 620, h: 46, type: 'editbox' },
            searchClear:        { x: 285,  y: 640,  w: 40,  h: 40, type: 'btnGhost' },
            feedTabDropdown:    { x: -200, y: 590,  w: 240, h: 40, type: 'btnGhost' },
            watchlistStar:      { x: 10,   y: 590,  w: 170, h: 38, type: 'btnGhost' },
            cancelWatchlist:    { x: 115,  y: 590,  w: 36,  h: 36, type: 'btnGhost' },
            liveIndicator:      { x: 260,  y: 590,  w: 110, h: 40, type: 'label' },
            minLiqDropdown:     { x: 15,   y: 550,  w: 110, h: 34, type: 'btnGhost', notes: 'Phase 24: h 28→34. moved x=-35→15 to clear FilterChip_liq_asc' },
            columnsBtn:         { x: 250,  y: 550,  w: 110, h: 34, type: 'btnGhost' },
            feedColumnHeaders:  { x: 0,    y: 505,  w: 700, h: 24, type: 'group',   notes: 'sticky col headers above feed; cols sourced from templates.feedColHeader' },
            feedScrollView:     { x: 0,    y: 30,   w: 700, h: 820, type: 'scrollview', notes: 'content sized to FEED_ROW_LIMIT × stride = 20 × 70 = 1400' },
            // 8c — Squad header (live; squad slots come from templates.squadSlot).
            squadHeaderLabel:   { x: 0,    y: -510, w: 420, h: 18, type: 'label',   notes: 'YOUR SQUAD — all-caps tracked' },
            // 8c — Wager row (live betting-duel CTA; replaces legacy stake commit).
            wagerValueButton:   { x: -180, y: -640, w: 300, h: 64, type: 'btnGhost',   notes: 'tier selector; opens WagerDropdown upward. Phase 24: h 56→64. _active=false in join-mode (see WagerLockChip).' },
            wagerStartButton:   { x: 180,  y: -640, w: 320, h: 64, type: 'btnPrimary', notes: '▶ Start Match — enabled only when squad full. Phase 24: h 56→64. Relabeled "▶ Join Match" in join-mode.' },
            wagerLockChip:      { x: -180, y: -640, w: 300, h: 64, type: 'chip',       notes: 'JOIN-MODE only — replaces wagerValueButton when _pickerJoinTarget set. "🔒 0.05 SOL · joining 5Ksq…sDst". _active=false by default.' },
            wagerBotChip:       { x: -180, y: -640, w: 300, h: 64, type: 'chip',       notes: 'BOT-MODE only — replaces wagerValueButton when _pickerBotMode true. "🤖 FREE · Bot Match". _active=false by default.' },
            wagerHintLabel:     { x: 0,    y: -684, w: 600, h: 16, type: 'label',      notes: "contextual: Pick X more / Ready / Joining 5Ksq…sDst's match" },
            wagerDropdown:      { x: -180, y: -606, w: 360, h: 360, type: 'group',
                notes: 'anchor (0.5, 0); grows upward; hidden by default; 8 rows from templates.wagerDropdownRow' },
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
            status:             { x: 0,    y: -740, w: 660, h: 22, type: 'label' },
            // 8d — popover containers + their internal labels/buttons. Each
            // popover is _active=false by default; AppUI toggles per-event.
            // Sizes/positions match the inline literals previously hard-coded.
            searchSuggestionPopover: { x: -30, y: 360,  w: 560, h: 300, type: 'group',
                notes: '5 SuggestRow children from templates.suggestRow' },
            feedTabDropdownPopover:  { x: -200, y: 425, w: 240, h: 304, type: 'group',
                notes: 'opens DOWN-LEFT of FeedTabDropdownButton; y = feedTabDropdown.y - 165' },
            minLiqDropdownPopover:   { x: -60,  y: 454, w: 120, h: 180, type: 'group',
                notes: 'y = minLiqDropdown.y - 96' },
            columnsPopover:          { x: 215,  y: 342, w: 170, h: 360, type: 'group',
                notes: 'y = columnsBtn.y - 208; opens DOWN-LEFT of ColumnsButton' },
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
            // 6 top-row icon buttons at y=750. Moved from y=735 to clear
            // TitleLabel's bbox (y=700 h=44 → top=722, button bottom=730 → 8-px gap).
            topRowActionBtn: {
                count: 6, w: 48, h: 40, y: 750,
                names:  ['OpenLeaderboardButton', 'OpenPortfolioButton', 'OpenSettingsButton',
                         'OpenSquadPresetsButton', 'SuggestSquadButton', 'HelpButton'],
                labels: ['', '', '', '', '', '?'],
                xs:     [-180, -128, -76, -24, 28, 80],
            },
            // 3 sort filter chips at y=550 (Newest / Liq↓ / Liq↑).
            feedFilterChip: {
                count: 3, w: 72, h: 34, y: 550,
                keys:   ['newest', 'liq_desc', 'liq_asc'],
                labels: ['Newest', 'Liq↓', 'Liq↑'],
                baseX: -268, gapX: 80,
            },
            // 7 column headers laid out inside FeedColumnHeaders group at y=505.
            // Coordinates relative to group center. align: 0 = left, 1 = center.
            feedColHeader: {
                count: 7, h: 22,
                cols: [
                    { key: 'Token',  text: 'TOKEN',  x: -262, w: 160, align: 0 },
                    { key: 'Score',  text: 'SCORE',  x: -90,  w: 40,  align: 1 },
                    { key: 'Liq',    text: 'LIQ',    x: -40,  w: 60,  align: 1 },
                    { key: 'Vol',    text: 'VOL',    x: 30,   w: 60,  align: 1 },
                    { key: 'Change', text: '24H',    x: 100,  w: 60,  align: 1 },
                    { key: 'Price',  text: 'PRICE',  x: 180,  w: 80,  align: 1 },
                    { key: 'Age',    text: 'AGE',    x: 285,  w: 40,  align: 1 },
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
            feedRow: {
                count: 20, w: 680, h: 66,
                baseY: -33, gapY: -70,
                selectedEdge: { x: -338, y: 0,   w: 3,   h: 60, notes: 'left emerald edge — hidden by default' },
                checkbox:     { x: -320, y: 0,   w: 22,  h: 22, notes: 'watchlist mode — hidden by default' },
                checkmark:    { x: 0,    y: 1,   w: 22,  h: 22, notes: 'inside checkbox — hidden by default' },
                logo:         { x: -310, y: 0,   w: 28,  h: 28 },
                symbol:       { x: -180, y: 12,  w: 140, h: 22, notes: 'top line, left-aligned bold (was w=160 — shrunk to clear Score)' },
                name:         { x: -180, y: -14, w: 200, h: 18, notes: 'bottom line, muted' },
                score:        { x: -90,  y: 12,  w: 40,  h: 22 },
                liq:          { x: -40,  y: 12,  w: 60,  h: 22 },
                vol:          { x: 30,   y: 12,  w: 60,  h: 22 },
                change:       { x: 100,  y: 12,  w: 60,  h: 22 },
                delta:        { x: 100,  y: 12,  w: 60,  h: 22, notes: 'alternate of change — hidden by default' },
                price:        { x: 180,  y: 12,  w: 80,  h: 22 },
                age:          { x: 285,  y: 12,  w: 40,  h: 22 },
                dex:          { x: 80,   y: -14, w: 200, h: 18 },
                liveDot:      { x: 315,  y: -14, w: 8,   h: 8,  notes: 'hidden by default' },
            },
            // 8c — 3 squad action buttons at y=-440.
            // Pick = emerald CTA, Drop = chrome neutral, Run = blue primary.
            squadActionBtn: {
                count: 3, w: 200, h: 60, y: -440,
                names:  ['SquadPickButton', 'SquadDropButton', 'SquadRunButton'],
                labels: ['+ Pick',          'Manage Squad',    '▶ Run Squad'],
                xs:     [-220, 0, 220],
                colors: [[48, 198, 155], [28, 34, 48], [56, 148, 252]],
                bold:   [true, false, true],
            },
            // 8c — 3 squad slots at y=-550. Internals: bg button + Logo (36×36 left)
            // + SymbolLabel (top, bold) + DeltaLabel (bottom, colored). Each slot
            // _active=false initially; AppUI activates per slot when squad fills.
            // logo.x: -squadSlotW/2 + 26 = -64. symbol/delta width: squadSlotW - 60 = 120.
            squadSlot: {
                count: 3, w: 180, h: 54, y: -550,
                xs: [-200, 0, 200],
                logo:   { x: -66, y: 0,   w: 36,  h: 36, notes: 'x shifted -64→-66 so right edge x=-48 clears symbol/delta left' },
                symbol: { x: 12,  y: 8,   w: 120, h: 22 },
                delta:  { x: 12,  y: -12, w: 120, h: 16 },
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
    // Phase 9a — Only the match-history row template migrated. Full
    // PortfolioPanel chrome (tabs, stat cards, trophy grid, headers,
    // status footer) is migrated in a later phase.
    PortfolioPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            historyView: { x: 0, y: 0, w: 720, h: 1280, type: 'group',
                notes: 'PortfolioHistoryView container; hidden until History tab active' },
            // 9c — back chrome migrated.
            backLink: { x: -280, y: 720, w: 110, h: 28, type: 'label' },
            backBtn:  { x: -280, y: 720, w: 140, h: 36, type: 'btnGhost' },
            title:    { x: 0,    y: 680, w: 400, h: 44, type: 'label' },
            // 11 — pubkey + tab row + sub-tab row.
            pubkeyLabel: { x: 0,    y: 630, w: 460, h: 24, type: 'label' },
            statsTab:    { x: -180, y: 580, w: 170, h: 44, type: 'btnPrimary' },
            historyTab:  { x: 0,    y: 580, w: 170, h: 44, type: 'btnGhost' },
            trophiesTab: { x: 180,  y: 580, w: 170, h: 44, type: 'btnGhost' },
            paperTab:    { x: -90,  y: 520, w: 170, h: 44, type: 'btnPrimary' },
            realTab:     { x: 90,   y: 520, w: 170, h: 44, type: 'btnGhost' },
            // 11 — hint + status footer.
            hint:        { x: 0,    y: 160,  w: 620, h: 20, type: 'label' },
            status:      { x: 0,    y: -740, w: 640, h: 22, type: 'label' },
            // 11 — history view internals.
            historyEmpty:    { x: 0, y: 0, w: 0,   h: 22, type: 'label' },
            historyScroll:   { x: 0, y: 40, w: 660, h: 780, type: 'scrollview' },
            historyLoadMore: { x: 0, y: -260, w: 400, h: 48, type: 'btnGhost' },
            // 11 — trophies view container + empty label.
            trophiesView:    { x: 0, y: 0,   w: 720, h: 1280, type: 'group' },
            trophiesEmpty:   { x: 0, y: 540, w: 0,   h: 24, type: 'label' },
        },
        templates: {
            // 11 — 6 stat cards in a 3×2 grid (top row: GAMES/WINS/LOSSES,
            // bottom: WIN%/PNL/XP). Internal: header label (top) + value
            // label (bottom).
            statCard: {
                count: 6, w: 220, h: 96,
                defs: [
                    { key: 'games',   label: 'GAMES',   x: -225, y: 420 },
                    { key: 'wins',    label: 'WINS',    x:  0,   y: 420 },
                    { key: 'losses',  label: 'LOSSES',  x:  225, y: 420 },
                    { key: 'winrate', label: 'WIN %',   x: -225, y: 300 },
                    { key: 'pnl',     label: 'P/L SOL', x:  0,   y: 300 },
                    { key: 'xp',      label: 'XP',      x:  225, y: 300 },
                ],
                header: { x: 0, y: 26,  w: 210, h: 22 },
                value:  { x: 0, y: -18, w: 210, h: 36 },
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
    // Phase 9c — only the elements with overlap fixes are migrated. Full
    // panel chrome (title, track, subtitle, rake, 4 stat cards, CTAs,
    // trophy, confetti, status) deferred.
    PostMatchPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backBtn:         { x: -260, y: 700, w: 160, h: 44,  type: 'btnGhost' },
            title:           { x: 0,    y: 620, w: 620, h: 52,  type: 'label' },
            track:           { x: 0,    y: 560, w: 600, h: 22,  type: 'label' },
            payoutLabel:     { x: 0,    y: 470, w: 620, h: 64,  type: 'label' },
            subtitle:        { x: 0,    y: 400, w: 600, h: 22,  type: 'label' },
            rake:            { x: 0,    y: 376, w: 600, h: 20,  type: 'label' },
            // 9c: Share moved to y=-360 (tertiary action below CTAs at y=-260).
            shareButton:     { x: 0,    y: -360, w: 320, h: 56, type: 'btnPrimary',
                notes: '9c: relocated to bottom-area below CTAs; clears Payout/Track/Subtitle/Rake' },
            sameSquadBtn:    { x: -170, y: -260, w: 320, h: 60, type: 'btnPrimary' },
            againBtn:        { x: 170,  y: -260, w: 320, h: 60, type: 'btnPrimary' },
            trophy:          { x: 0,    y: -80,  w: 200, h: 100, type: 'label',
                notes: 'hidden until placement; AppUI attaches rankIcon at show time' },
            status:          { x: 0,    y: -740, w: 640, h: 20, type: 'label' },
            mascotContainer: { x: 250,  y: -500,  w: 140, h: 180, type: 'mascot',
                notes: 'Phase 21 (A2): y 180 → -500. Was overlapping right-column PMCards (opp/lvl); moved to bottom-right corner clear of cards/trophy/CTAs/status.' },
        },
        templates: {
            // 4 stat cards in a 2×2 grid (you/opp/xp/lvl). Internal: header
            // label at top + value label below. Coordinates relative to card center.
            pmCard: {
                count: 4, w: 300, h: 92,
                defs: [
                    { key: 'you', label: 'YOUR DELTA', x: -160, y: 220 },
                    { key: 'opp', label: 'BEST OPP',   x:  160, y: 220 },
                    { key: 'xp',  label: 'XP EARNED',  x: -160, y: 100 },
                    { key: 'lvl', label: 'LEVEL',      x:  160, y: 100 },
                ],
                header: { x: 0, y: 24,  w: 280, h: 22 },
                value:  { x: 0, y: -18, w: 280, h: 36 },
            },
            // 12 confetti shells, child of TrophyLabel; positioned at (0,0)
            // and tweened by AppUI to slot positions on 1st-place.
            confetti: {
                count: 12, w: 60, h: 60,
                x: 0, y: 0,
            },
        },
        // Phase 21 (A2): mascot moved to bottom-right corner (y -500); no
        // longer overlaps PMCards. Removed [PMCard_*, MascotContainer] pairs.
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
    CountdownOverlay: {
        canvas: { w: 720, h: 1280 },
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
            mascotContainer: { x: 0, y: 200,  w: 140, h: 180, type: 'mascot',
                notes: '5th MascotController instance — idle Seedance frames during load' },
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
