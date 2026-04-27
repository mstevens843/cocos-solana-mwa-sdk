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
    elements: Record<string, ElementSpec>;
    templates?: Record<string, { count: number; baseX?: number; baseY?: number; gapX?: number; gapY?: number; x?: number; y?: number; w: number; h: number }>;
    allowedOverlaps: Array<[string, string]>;
}

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
            title:                { x: 0,   y: 510,  w: 680, h: 72,  type: 'label' },
            subtitle:             { x: 0,   y: 445,  w: 680, h: 30,  type: 'label' },
            mascot:               { x: 0,   y: 280,  w: 260, h: 260, type: 'mascot' },
            tagline:              { x: 0,   y: 110,  w: 680, h: 40,  type: 'label' },
            supportLine:          { x: 0,   y: 66,   w: 660, h: 22,  type: 'label' },
            ctaCardBg:            { x: 0,   y: -185, w: 700, h: 440, type: 'group' },
            connectBtn:           { x: 0,   y: -25,  w: 660, h: 110, type: 'btnPrimary' },
            connectChevron:       { x: 290, y: -25,  w: 24,  h: 28,  type: 'label' },
            trustLine:            { x: 0,   y: -100, w: 640, h: 20,  type: 'label' },
            reconnBtn:            { x: 0,   y: -170, w: 660, h: 80,  type: 'btnGhost' },
            playAsGuestBtn:       { x: 0,   y: -285, w: 660, h: 100, type: 'btnSuccess' },
            connectionStatusPill: { x: 0,   y: -555, w: 200, h: 40,  type: 'chip' },
        },
        allowedOverlaps: [
            ['CTACardBg', 'ConnectButton'],
            ['CTACardBg', 'ConnectChevron'],
            ['CTACardBg', 'TrustLineLabel'],
            ['CTACardBg', 'ReconnectButton'],
            ['CTACardBg', 'PlayAsGuestButton'],
            ['CTACardBg', 'BtnGlow_ConnectButton'],
            ['CTACardBg', 'BtnGlow_PlayAsGuestButton'],
            ['CTACardBg', 'CardEdgeAccent'],
            ['ConnectButton', 'ConnectChevron'],
        ],
    },

    Home: {
        canvas: { w: 720, h: 1280 },
        elements: {
            homeContentScrim:    { x: 0,    y: 0,    w: 720, h: 1280, type: 'sprite' },
            notificationBell:    { x: -330, y: 620,  w: 56,  h: 56,  type: 'btnGhost' },
            notificationBadge:   { x: -308, y: 638,  w: 22,  h: 22,  type: 'badge' },
            walletPill:          { x: 0,    y: 620,  w: 360, h: 60,  type: 'chip' },
            walletPillGlow:      { x: 0,    y: 620,  w: 380, h: 80,  type: 'sprite' },
            walletPillSecureDot: { x: -150, y: 0,    w: 12,  h: 12,  type: 'badge' },
            pubkeyLabel:         { x: -30,  y: 6,    w: 280, h: 24,  type: 'label' },
            walletNameLabel:     { x: 0,    y: -16,  w: 280, h: 14,  type: 'label' },
            // Phase N4: openPortfolioBtn renamed → disconnectBtn; layout reordered
            // to [bell | trophy | wallet | cog | disconnect] with wallet centered.
            openLeaderboardBtn:  { x: -250, y: 620,  w: 56,  h: 56,  type: 'btnGhost' },
            openSettingsBtn:     { x:  250, y: 620,  w: 56,  h: 56,  type: 'btnGhost' },
            disconnectBtn:       { x:  330, y: 620,  w: 56,  h: 56,  type: 'btnGhost' },
            homeLevelChip:       { x: 0,    y: 540,  w: 680, h: 80,  type: 'chip' },
            homeXpProgressLabel: { x: 310,  y: 18,   w: 280, h: 18,  type: 'label' },
            homeXpBarTrack:      { x: 0,    y: -14,  w: 640, h: 14,  type: 'sprite' },
            homeXpBarFill:       { x: -320, y: 0,    w: 0,   h: 14,  type: 'sprite' },
            homeMatchTicker:     { x: 0,    y: 420,  w: 680, h: 140, type: 'chip' },
            homeMatchTickerHeader: { x: 0,  y: 58,   w: 660, h: 16,  type: 'label' },
            homeMatchChipDivider: { x: 0,   y: -7,   w: 600, h: 1,   type: 'sprite' },
            homeTournamentBadge: { x: 0,    y: 420,  w: 680, h: 140, type: 'chip' },
            dailyStreakStrip:    { x: 0,    y: 320,  w: 680, h: 64,  type: 'chip' },
            homeChooseMatchLabel: { x: 0,   y: 260,  w: 680, h: 24,  type: 'label' },
            startMatchBtn:       { x: 0,    y: 196,  w: 680, h: 104, type: 'btnPrimary' },
            startMatchSubtitle:  { x: 0,    y: -22,  w: 620, h: 18,  type: 'label' },
            startMatchChevron:   { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label' },
            findMatchBtn:        { x: 0,    y: 80,   w: 680, h: 92,  type: 'btnSuccess' },
            findMatchSubtitle:   { x: 0,    y: -22,  w: 620, h: 18,  type: 'label' },
            findMatchChevron:    { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label' },
            findMatchCountBadge: { x: 244,  y: 102,  w: 76,  h: 28,  type: 'badge' },
            botMatchBtn:         { x: 0,    y: -28,  w: 680, h: 84,  type: 'btnWarn' },
            botMatchSubtitle:    { x: 0,    y: -22,  w: 620, h: 18,  type: 'label' },
            botMatchChevron:     { x: 310,  y: 0,    w: 24,  h: 24,  type: 'label' },
            homeTrainingCard:    { x: 0,    y: -200, w: 680, h: 196, type: 'group' },
            trainingMascotGlow:  { x: -220, y: 0,    w: 200, h: 200, type: 'sprite' },
            mascot:              { x: -220, y: 0,    w: 160, h: 180, type: 'mascot' },
            homeTrainingTitleLabel: { x: 40, y: 60,  w: 440, h: 24,  type: 'label' },
            homeTrainingBodyLabel:  { x: 40, y: 20,  w: 440, h: 24,  type: 'label' },
            homeTrainingHintLabel:  { x: 40, y: -12, w: 460, h: 18,  type: 'label' },
            trainingCtaHint:     { x: 40,   y: -44,  w: 460, h: 18,  type: 'label' },
            homeStatus:          { x: 40,   y: -76,  w: 460, h: 16,  type: 'label' },
        },
        allowedOverlaps: [
            ['NotificationBellButton',  'NotificationBellBadge'],
            ['HomeMatchTicker',         'HomeTournamentBadge'],
            ['FindMatchButton',         'FindMatchButtonCountBadge'],
            ['StartMatchButton',        'StartMatchSubtitle'],
            ['StartMatchButton',        'StartMatchChevron'],
            ['FindMatchButton',         'FindMatchSubtitle'],
            ['FindMatchButton',         'FindMatchChevron'],
            ['BotMatchButton',          'BotMatchSubtitle'],
            ['BotMatchButton',          'BotMatchChevron'],
            ['WalletPill',              'PubkeyLabel'],
            ['WalletPill',              'WalletNameLabel'],
            ['WalletPill',              'WalletPillSecureDot'],
            ['HomeTrainingCard',        'MascotContainer'],
            ['HomeTrainingCard',        'HomeTrainingTitleLabel'],
            ['HomeTrainingCard',        'HomeTrainingBodyLabel'],
            ['HomeTrainingCard',        'HomeTrainingHintLabel'],
            ['HomeTrainingCard',        'HomeStatusLabel'],
            ['HomeLevelChip',           'HomeLevelChipLabel'],
            ['HomeLevelChip',           'HomeXpProgressLabel'],
            ['HomeLevelChip',           'HomeXpBarTrack'],
            ['HomeXpBarTrack',          'HomeXpBarFill'],
        ],
    },
    ModePickerOverlay: {
        canvas: { w: 720, h: 1280 },
        elements: {
            title:        { x: 0,    y: 500,  w: 500, h: 38, type: 'label' },
            cancelBtn:    { x: 300,  y: 500,  w: 40,  h: 40, type: 'btnGhost' },
            hint:         { x: 0,    y: 460,  w: 600, h: 18, type: 'label' },
            wagerReadout: { x: 0,    y: 230,  w: 600, h: 24, type: 'label' },
            paperToggle:  { x: -80,  y: 90,   w: 150, h: 44, type: 'btnPrimary' },
            realToggle:   { x: 80,   y: 90,   w: 150, h: 44, type: 'btnGhost' },
            startBtn:     { x: 0,    y: -30,  w: 420, h: 60, type: 'btnPrimary' },
            statusLbl:    { x: 0,    y: -100, w: 600, h: 20, type: 'label' },
        },
        allowedOverlaps: [],
    },
    RacePanel: {
        canvas: { w: 720, h: 1800 },
        elements: {
            // Battle-UI top row (2026-04-26): [Lv chip] (Timer) [+0.00%]
            racePlayerLevelChip: { x: -260, y: 720, w: 120, h: 40,   type: 'chip' },
            timerRing:           { x: 0,    y: 720, w: 132, h: 132,  type: 'graphics' },
            countdownLabel:      { x: 0,    y: 720, w: 100, h: 32,   type: 'label' },
            heroDelta:           { x: 240,  y: 720, w: 220, h: 80,   type: 'label' },
            playerTokenRow:      { x: 0,    y: 540, w: 696, h: 110,  type: 'group' },
            opponentSubtitle:    { x: 0,    y: 410, w: 620, h: 64,   type: 'label' },
            duelBarContainer:    { x: 0,    y: 300, w: 680, h: 80,   type: 'group' },
            opponentDelta:       { x: 0,    y: 140, w: 680, h: 96,   type: 'label' },
            opponentIdentityCard:{ x: 0,    y: 40,  w: 280, h: 44,   type: 'sprite' },
            opponentTokenRow:    { x: 0,    y: -90, w: 696, h: 110,  type: 'group' },
            opponentCard:        { x: 0,    y: -400, w: 640, h: 110, type: 'sprite' },
            opponentStrip:       { x: 0,    y: -406, w: 640, h: 260, type: 'group' },
            cancelBtn:           { x: 0,    y: -260, w: 140, h: 36,  type: 'btnGhost' },
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
            backLink:      { x: -280, y: 618,  w: 110, h: 28, type: 'label' },
            backBtn:       { x: -280, y: 618,  w: 140, h: 36, type: 'btnGhost' },
            title:         { x: 0,    y: 612,  w: 400, h: 40, type: 'label' },
            walletCard:    { x: 0,    y: 500,  w: 688, h: 124, type: 'group' },
            profileCard:   { x: 0,    y: 346,  w: 688, h: 148, type: 'group' },
            quickPlayCard: { x: 0,    y: 108,  w: 688, h: 260, type: 'group' },
            audioCard:     { x: 0,    y: -134, w: 688, h: 148, type: 'group' },
            accountCard:   { x: 0,    y: -362, w: 688, h: 232, type: 'group' },
            deleteBtn:     { x: 0,    y: -548, w: 220, h: 32, type: 'btnGhost' },
            status:        { x: 0,    y: -592, w: 640, h: 20, type: 'label' },
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
        ],
    },
    LeaderboardPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:         { x: -280, y: 720,  w: 110, h: 28,  type: 'label' },
            backBtn:          { x: -280, y: 720,  w: 140, h: 36,  type: 'btnGhost' },
            title:            { x: 0,    y: 680,  w: 400, h: 44,  type: 'label' },
            personalRankCard: { x: 0,    y: -130, w: 660, h: 100, type: 'group' },
            status:           { x: 0,    y: -740, w: 600, h: 22,  type: 'label' },
        },
        allowedOverlaps: [['BackLinkLabel', 'BackButton']],
    },
    FindMatchPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backBtn:        { x: -280, y: 700,  w: 160, h: 44, type: 'btnGhost' },
            title:          { x: 0,    y: 700,  w: 400, h: 36, type: 'label' },
            refreshBtn:     { x: 280,  y: 700,  w: 56,  h: 44, type: 'btnGhost' },
            countLabel:     { x: 0,    y: 665,  w: 600, h: 18, type: 'label' },
            hideFullToggle: { x: 0,    y: 445,  w: 220, h: 36, type: 'btnPrimary' },
            tabRowContainer:    { x: 0, y: 628, w: 660, h: 50, type: 'sprite' },
            modeRowContainer:   { x: 0, y: 580, w: 660, h: 50, type: 'sprite' },
            windowRowContainer: { x: 0, y: 535, w: 660, h: 50, type: 'sprite' },
            wagerRowContainer:  { x: 0, y: 490, w: 660, h: 50, type: 'sprite' },
            emptyLabel:     { x: 0,    y: -340, w: 660, h: 22, type: 'label' },
            hostBtn:        { x: 0,    y: -440, w: 540, h: 64, type: 'btnPrimary' },
            status:         { x: 0,    y: -700, w: 660, h: 20, type: 'label' },
        },
        allowedOverlaps: [],
    },
    TokenDuelPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            // 2026-04-26 polish — synced with LayoutSpec.cjs.
            backLink:        { x: -288, y: 575,  w: 100, h: 28, type: 'label' },
            backBtn:         { x: -288, y: 575,  w: 120, h: 40, type: 'btnGhost' },
            title:           { x: 0,    y: 525,  w: 320, h: 36, type: 'label' },
            levelPill:       { x: 113,  y: 575,  w: 185, h: 36, type: 'chip' },
            solPill:         { x: 279,  y: 575,  w: 130, h: 36, type: 'chip' },
            matchSetupCard:  { x: 0,    y: 440,  w: 688, h: 124, type: 'group' },
            feedFrameCard:   { x: 0,    y: 64,   w: 712, h: 532, type: 'sprite' },
            search:          { x: 46,   y: 300,  w: 312, h: 44, type: 'editbox' },
            searchClear:     { x: 188,  y: 300,  w: 32,  h: 32, type: 'btnGhost' },
            feedTabDropdown: { x: -224, y: 300,  w: 200, h: 44, type: 'btnGhost' },
            watchlistStar:   { x: 240,  y: 300,  w: 44,  h: 44, type: 'btnGhost' },
            cancelWatchlist: { x: 240,  y: 300,  w: 36,  h: 36, type: 'btnGhost' },
            liveIndicator:   { x: 314,  y: 300,  w: 80,  h: 24, type: 'label' },
            minLiqDropdown:    { x: -16,  y: 248,  w: 110, h: 32,  type: 'chip' },
            columnsBtn:        { x: 270,  y: 248,  w: 96,  h: 32,  type: 'chip' },
            feedColumnHeaders: { x: 0,    y: 210,  w: 696, h: 24,  type: 'group' },
            feedScrollView:    { x: 0,    y: 0,    w: 696, h: 388, type: 'scrollview' },
            squadPanel:        { x: 0,    y: -345, w: 700, h: 220, type: 'group' },
            squadHeaderLabel:  { x: 0,    y: -280, w: 420, h: 24,  type: 'label' },
            wagerValueButton:  { x: -240, y: -395, w: 200, h: 56,  type: 'btnGhost' },
            wagerStartButton:  { x: 110,  y: -395, w: 460, h: 56,  type: 'btnPrimary' },
            wagerLockChip:     { x: -240, y: -395, w: 200, h: 56,  type: 'chip' },
            wagerBotChip:      { x: -240, y: -395, w: 200, h: 56,  type: 'chip' },
            wagerHintLabel:    { x: 0,    y: -700, w: 600, h: 24,  type: 'label' },
            wagerDropdown:     { x: -240, y: -363, w: 360, h: 360, type: 'group' },
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
            status:            { x: 0,    y: -510, w: 688, h: 26,  type: 'label' },
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
        elements: {
            historyView: { x: 0,    y: 0,   w: 720, h: 1280, type: 'group' },
            backLink:    { x: -280, y: 720, w: 110, h: 28,   type: 'label' },
            backBtn:     { x: -280, y: 720, w: 140, h: 36,   type: 'btnGhost' },
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
            listContainer:   { x: 0,   y: -60, w: 460, h: 980, type: 'group' },
            cardHeaderLabel: { x: 0,   y: 580, w: 320, h: 36,  type: 'label' },
            cardCloseButton: { x: 200, y: 580, w: 48,  h: 48,  type: 'btnGhost' },
        },
        allowedOverlaps: [],
    },
    TournamentPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            roster:  { x: 0,    y: 150, w: 640, h: 440, type: 'group' },
            backBtn: { x: -260, y: 600, w: 160, h: 44,  type: 'btnGhost' },
            title:   { x: 0,    y: 600, w: 300, h: 40,  type: 'label' },
        },
        allowedOverlaps: [],
    },
    TokenDetailPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:    { x: -280, y: 618, w: 110, h: 28, type: 'label' },
            backBtn:     { x: -280, y: 618, w: 140, h: 36, type: 'btnGhost' },
            symbolLabel: { x: -55,  y: 600, w: 290, h: 36, type: 'label' },
            nameLabel:   { x: -55,  y: 566, w: 290, h: 22, type: 'label' },
        },
        allowedOverlaps: [['BackLinkLabel', 'BackButton']],
    },
    DailyChallengePanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backLink:        { x: -280, y: 618, w: 110, h: 28, type: 'label' },
            backBtn:         { x: -280, y: 618, w: 140, h: 36, type: 'btnGhost' },
            title:           { x: 0,    y: 600, w: 400, h: 40, type: 'label' },
            streakDayLabel:  { x: 0,    y: 2,   w: 560, h: 38, type: 'label' },
            streakBestLabel: { x: 0,    y: -28, w: 560, h: 22, type: 'label' },
        },
        allowedOverlaps: [['BackLinkLabel', 'BackButton']],
    },
    SpectatorPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            backBtn: { x: -260, y: 600, w: 160, h: 44, type: 'btnGhost' },
            title:   { x: 0,    y: 600, w: 300, h: 40, type: 'label' },
        },
        allowedOverlaps: [],
    },
    PostMatchPanel: {
        canvas: { w: 720, h: 1280 },
        elements: {
            payoutLabel:     { x: 0, y: -80,  w: 620, h: 96,  type: 'label' },
            shareButton:     { x: 0, y: -740, w: 280, h: 44,  type: 'btnPrimary' },
            mascotContainer: { x: 0, y: 130,  w: 360, h: 360, type: 'mascot' },
        },
        allowedOverlaps: [],
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
