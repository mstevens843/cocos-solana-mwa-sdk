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
            title:               { x: 0, y: 460,  w: 680, h: 80,  type: 'label' },
            subtitle:            { x: 0, y: 370,  w: 680, h: 50,  type: 'label' },
            mascot:              { x: 0, y: 215,  w: 140, h: 180, type: 'mascot' },
            connectBtn:          { x: 0, y: 20,   w: 680, h: 100, type: 'btnPrimary' },
            reconnBtn:           { x: 0, y: -90,  w: 680, h: 100, type: 'btnSuccess' },
            statusLbl:           { x: 0, y: -210, w: 680, h: 36,  type: 'label' },
            playAsGuestBtn:      { x: 0, y: -320, w: 680, h: 100, type: 'btnSuccess' },
            playAsGuestSubtitle: { x: 0, y: -380, w: 660, h: 22,  type: 'label' },
        },
        allowedOverlaps: [],
    },

    Home: {
        canvas: { w: 720, h: 1280 },
        elements: {
            notificationBell:    { x: -280, y: 700,  w: 64,  h: 64,  type: 'btnGhost' },
            notificationBadge:   { x: -256, y: 722,  w: 24,  h: 24,  type: 'badge' },
            pubkeyLabel:         { x: 0,    y: 700,  w: 380, h: 40,  type: 'label' },
            openSettingsBtn:     { x: 280,  y: 700,  w: 64,  h: 64,  type: 'btnGhost' },
            homeLevelChip:       { x: 240,  y: 750,  w: 200, h: 32,  type: 'chip' },
            homeRakeChip:        { x: 0,    y: 552,  w: 700, h: 22,  type: 'chip' },
            homeMatchTicker:     { x: 0,    y: 660,  w: 700, h: 36,  type: 'chip' },
            homeTournamentBadge: { x: 0,    y: 660,  w: 700, h: 36,  type: 'chip' },
            dailyStreakStrip:    { x: 0,    y: 600,  w: 700, h: 48,  type: 'chip' },
            startMatchBtn:       { x: 0,    y: 499,  w: 680, h: 82,  type: 'btnPrimary' },
            startMatchSubtitle:  { x: 0,    y: 448,  w: 660, h: 20,  type: 'label' },
            findMatchBtn:        { x: 0,    y: 383,  w: 680, h: 82,  type: 'btnSuccess' },
            findMatchSubtitle:   { x: 0,    y: 332,  w: 660, h: 20,  type: 'label' },
            findMatchCountBadge: { x: 244,  y: 401,  w: 76,  h: 28,  type: 'badge' },
            botMatchBtn:         { x: 0,    y: 267,  w: 680, h: 82,  type: 'btnWarn' },
            botMatchSubtitle:    { x: 0,    y: 216,  w: 660, h: 20,  type: 'label' },
            mascot:              { x: 0,    y: 140,  w: 130, h: 170, type: 'mascot' },
            disconnectBtn:       { x: 0,    y: -50,  w: 680, h: 86,  type: 'btnDanger' },
            signOutGuestBtn:     { x: 0,    y: -50,  w: 680, h: 86,  type: 'btnDanger' },
            deleteBtn:           { x: 0,    y: -160, w: 680, h: 86,  type: 'btnDanger' },
            homeStatus:          { x: 0,    y: -300, w: 680, h: 32,  type: 'label' },
        },
        allowedOverlaps: [
            ['NotificationBellButton',  'NotificationBellBadge'],
            ['DailyStreakStrip',        'HomeMatchTicker'],
            ['DailyStreakStrip',        'HomeTournamentBadge'],
            ['HomeMatchTicker',         'HomeTournamentBadge'],
            ['FindMatchButton',         'FindMatchButtonCountBadge'],
            ['DisconnectButton',        'SignOutGuestButton'],
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
            timerRing:      { x: 0,    y: 480,  w: 140, h: 140,  type: 'graphics' },
            countdownLabel: { x: 0,    y: 480,  w: 110, h: 36,   type: 'label' },
            heroDelta:      { x: 0,    y: 340,  w: 680, h: 140,  type: 'label' },
            heroSubtitle:   { x: 0,    y: 250,  w: 600, h: 40,   type: 'label' },
            opponentCard:   { x: 0,    y: -400, w: 640, h: 110,  type: 'sprite' },
            opponentStrip:  { x: 0,    y: -406, w: 640, h: 260,  type: 'group' },
            cancelBtn:      { x: 0,    y: -560, w: 200, h: 48,   type: 'btnDanger' },
            mascot:         { x: 260,  y: -680, w: 140, h: 180,  type: 'mascot' },
            vignette:       { x: 0,    y: 0,    w: 720, h: 1280, type: 'graphics' },
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
            backLink:      { x: -280, y: 618,  w: 110, h: 28, type: 'label' },
            backBtn:       { x: -280, y: 618,  w: 140, h: 36, type: 'btnGhost' },
            title:         { x: 0,    y: 600,  w: 400, h: 40, type: 'label' },
            walletCard:    { x: 0,    y: 440,  w: 660, h: 130, type: 'group' },
            profileCard:   { x: 0,    y: 280,  w: 660, h: 150, type: 'group' },
            quickPlayCard: { x: 0,    y: 60,   w: 660, h: 240, type: 'group' },
            audioCard:     { x: 0,    y: -130, w: 660, h: 70,  type: 'group' },
            feesLink:      { x: 0,    y: -360, w: 560, h: 52, type: 'btnGhost' },
            reconnectBtn:  { x: 0,    y: -440, w: 660, h: 48, type: 'btnGhost' },
            disconnectBtn: { x: 0,    y: -500, w: 660, h: 48, type: 'btnDanger' },
            deleteBtn:     { x: 0,    y: -560, w: 660, h: 48, type: 'btnDanger' },
            status:        { x: 0,    y: -610, w: 640, h: 20, type: 'label' },
        },
        allowedOverlaps: [['BackLinkLabel', 'BackButton']],
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
            backLink:        { x: -280, y: 720,  w: 110, h: 28, type: 'label' },
            backBtn:         { x: -280, y: 720,  w: 140, h: 36, type: 'btnGhost' },
            title:           { x: 0,    y: 700,  w: 280, h: 44, type: 'label' },
            balanceChip:     { x: 230,  y: 700,  w: 180, h: 32, type: 'label' },
            search:          { x: 0,    y: 640,  w: 620, h: 46, type: 'editbox' },
            searchClear:     { x: 285,  y: 640,  w: 40,  h: 40, type: 'btnGhost' },
            feedTabDropdown: { x: -200, y: 590,  w: 240, h: 40, type: 'btnGhost' },
            watchlistStar:   { x: 10,   y: 590,  w: 170, h: 38, type: 'btnGhost' },
            cancelWatchlist: { x: 115,  y: 590,  w: 36,  h: 36, type: 'btnGhost' },
            liveIndicator:   { x: 260,  y: 590,  w: 110, h: 40, type: 'label' },
            minLiqDropdown:    { x: 15,   y: 550,  w: 110, h: 28,  type: 'btnGhost' },
            columnsBtn:        { x: 250,  y: 550,  w: 110, h: 28,  type: 'btnGhost' },
            feedColumnHeaders: { x: 0,    y: 505,  w: 700, h: 24,  type: 'group' },
            feedScrollView:    { x: 0,    y: 30,   w: 700, h: 820, type: 'scrollview' },
            squadHeaderLabel:  { x: 0,    y: -510, w: 420, h: 18,  type: 'label' },
            wagerValueButton:  { x: -180, y: -640, w: 300, h: 64,  type: 'btnGhost' },
            wagerStartButton:  { x: 180,  y: -640, w: 320, h: 64,  type: 'btnPrimary' },
            wagerLockChip:     { x: -180, y: -640, w: 300, h: 64,  type: 'chip' },
            wagerBotChip:      { x: -180, y: -640, w: 300, h: 64,  type: 'chip' },
            wagerHintLabel:    { x: 0,    y: -684, w: 600, h: 16,  type: 'label' },
            wagerDropdown:     { x: -180, y: -606, w: 360, h: 360, type: 'group' },
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
            status:            { x: 0,    y: -740, w: 660, h: 22,  type: 'label' },
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
            payoutLabel:     { x: 0,   y: 470, w: 620, h: 64,  type: 'label' },
            shareButton:     { x: 0,   y: -360, w: 320, h: 56,  type: 'btnPrimary' },
            mascotContainer: { x: 250, y: 180, w: 140, h: 180, type: 'mascot' },
        },
        allowedOverlaps: [
            ['PMCard_opp', 'PostMatchMascotContainer'],
            ['PMCard_lvl', 'PostMatchMascotContainer'],
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
        canvas: { w: 720, h: 1280 },
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
            mascotContainer: { x: 0, y: 200,  w: 140, h: 180, type: 'mascot' },
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
