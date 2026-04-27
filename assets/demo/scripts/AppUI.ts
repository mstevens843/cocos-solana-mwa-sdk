/**
 * AppUI.ts — Unified UI controller for Landing + Home panels.
 *
 * Landing: single "Connect Wallet" button → OS picker selects wallet.
 * Home: Sign Message, Sign Tx, Sign & Send, Capabilities, Reconnect, Disconnect, Delete.
 */

import { _decorator, Component, Label, Button, Node, Sprite, Color, EditBox, ScrollView, Slider, SpriteFrame, ImageAsset, Texture2D, assetManager, UITransform, UIOpacity, tween, Vec3, Tween, Graphics, resources, director, Director } from 'cc';
// UX overhaul: Phase 1+2 helpers — central theme, procedural icons, panel
// transitions, mascot. All runtime-only; no asset deps.
import { IconLibrary, IconName } from '../../token-duel/scripts/IconLibrary';
import { swapPanel, popScale, shake } from '../../token-duel/scripts/PanelTransitions';
import { MascotController, MascotState } from '../../token-duel/scripts/MascotController';
import { Palette, themeColor } from '../../token-duel/scripts/Theme';
import { enhancePrimaryCTA, addIdlePulse, addPressPop } from '../../token-duel/scripts/ButtonFX';
import { MWAManager } from '../../solana-mwa/scripts/MWAManager';
import { SolanaRpc } from '../../solana-mwa/scripts/SolanaRpc';
import { buildMemoTransaction } from '../../solana-mwa/scripts/TransactionBuilder';
import { AnchorBackend } from '../../token-duel/scripts/AnchorBackend';
import { STAKE_LAMPORTS, STAKE_MIN_SOL, STAKE_MAX_SOL, STAKE_DEFAULT_SOL, FEED_ROW_LIMIT } from '../../token-duel/scripts/constants';
import { MWA_AUTHORIZED, MWA_AUTH_FAILED, MWA_DISCONNECTED, MWA_STATUS } from '../../solana-mwa/scripts/MWAEvents';
import { getAppIdentity } from '../../solana-mwa/scripts/AppIdentity';
import { TokenDuelRpc, Holding } from '../../token-duel/scripts/TokenDuelRpc';
import { TokenDuelGame, RaceSnapshot } from '../../token-duel/scripts/TokenDuelGame';
import { decodeScore, encodeDeltaPct } from '../../token-duel/scripts/ScoreEncoding';
import { PriceFeed } from '../../token-duel/scripts/PriceFeed';
import { TokenSquad } from '../../token-duel/scripts/TokenSquad';
import { BirdeyeClient } from '../../token-duel/scripts/birdeye/BirdeyeClient';
import { Candle, FeedTab, OhlcvType, TokenRow } from '../../token-duel/scripts/birdeye/types';
import { trendingUrl, gainersUrl, newListingsUrl, smartMoneyUrl, searchUrl, pathOf } from '../../token-duel/scripts/birdeye/endpoints';
import { computeScore, formatScore } from '../../token-duel/scripts/TokenScore';
import { Watchlist } from '../../token-duel/scripts/Watchlist';
import { renderCandles, lookbackFor } from '../../token-duel/scripts/CandlestickChart';
import { Stats } from '../../token-duel/scripts/Stats';
import { runPaperBotMatch, resolveRealMatchAction, waitForOpponent, waitForSettlement, buildSettleMatchTxFor, buildForceSettleTxFor, joinOrCreateWithRetry } from '../../token-duel/scripts/Matchmaker';
import { WAGER_TIERS_LAMPORTS, WAGER_TIERS_LABELS, WAGER_DISPLAY_TO_TIER, MODES, TIME_WINDOWS, TimeWindowId, DEFAULT_TIME_WINDOW, BOT_DIFFICULTY_MULTIPLIERS, streakBonusFor } from '../../token-duel/scripts/ModeDefs';
import { MatchBrowser, MatchBrowserFilters } from '../../token-duel/scripts/MatchBrowser';
import { BotDifficulty, VettedMint } from '../../token-duel/scripts/VettedMints';
import { NotificationStore, Notification, NotificationKind } from '../../token-duel/scripts/Notifications';
import { NotificationToastQueue } from '../../token-duel/scripts/NotificationToast';
import { fetchMatchHistoryPage, MatchHistoryEntry } from '../../token-duel/scripts/MatchHistoryRpc';
import { MatchState } from '../../token-duel/scripts/MatchRpc';
import {
    registerPaperMatchActive,
    updatePaperMatchHeights as patchPaperMatchHeights,
    deletePaperMatchActive,
    listPaperMatchesActive,
    type PaperMatchActiveRow,
} from '../../token-duel/scripts/PaperMatchActiveRpc';
// ReceiptSession / physics-backend flow removed on betting-duel.
// (Previous `import { ReceiptSession } from '../../token-duel/scripts/ReceiptSigner';`)
import { initSound, playSound, setVolume as setSoundVolume, getVolume as getSoundVolume, setEnabled as setSoundEnabled, isEnabled as isSoundEnabled } from '../../token-duel/scripts/Sound';
import { Haptics, HapticType } from '../../token-duel/scripts/Haptics';
import { RECEIPT_BACKEND_URL } from '../../token-duel/scripts/constants';
import { checkUserStatsExists, xpBucketFor, getUserStats, UserStatsState } from '../../token-duel/scripts/UserStatsRpc';
import { loadRealStats } from '../../token-duel/scripts/RealStats';
import { getMatch } from '../../token-duel/scripts/MatchRpc';
import { fetchLeaderboard, LeaderboardEntry as ModeLeaderboardEntry } from '../../token-duel/scripts/LeaderboardRpc';
import { levelFromXp, levelProgress, xpForLevel, computeModePayout, xpForPlacement, rakeBpsForLevel } from '../../token-duel/scripts/PayoutCalc';
import { modeFromU8 } from '../../token-duel/scripts/ModeDefs';
import { getCurrentDailyChallenge, describeChallenge, countCompleted, DailyChallengeState, ChallengeDef } from '../../token-duel/scripts/DailyChallengeRpc';
import { getCurrentSeason, getUserSeasonRank, SeasonState, SeasonEntry } from '../../token-duel/scripts/SeasonRpc';
import { SquadPresets, SquadPreset, SquadPresetSlot } from '../../token-duel/scripts/SquadPresets';
import { VETTED_MINTS, randomVettedTrio } from '../../token-duel/scripts/VettedMints';

/**
 * Session 11: feed-tab union. Extends the Birdeye FeedTab with two virtual
 * tabs that don't map to a single endpoint:
 *   - 'top10' = on-chain leaderboard (existing)
 *   - 'watchlist' = localStorage-backed watchlist (new)
 */
type FeedTabOrVirtual = FeedTab | 'top10' | 'watchlist';

/** Filter chip identifiers — match the node names in `generate-scenes.js`. */
type FilterChipKey = 'newest' | 'liq' | 'liq_desc' | 'liq_asc' | 'all' | 'liq1k' | 'liq5k' | 'liq10k';
import { showToast } from './AndroidToast';

const { ccclass } = _decorator;
const TAG = '[AppUI]';

// ─── DIAGNOSTIC: SIGSEGV @0x28 Thread-2 triangulation ─────────────────────
// Captures uncaught JS exceptions that the normal log flow would miss.
// Apr 25 2026 — same crash repro after WS kill-switch ruled WS out; this
// catches anything that throws on the JS thread post-`start | DONE`.
const _origOnErr = (globalThis as any).onerror;
(globalThis as any).onerror = (msg: any, src: any, line: any, col: any, err: any) => {
    try { console.log(`[ONERROR] msg=${msg} line=${line}:${col} stack=${err?.stack ?? '(no stack)'}`); } catch (_) { /* ignore */ }
    return _origOnErr ? _origOnErr(msg, src, line, col, err) : false;
};
const _origUnhandled = (globalThis as any).onunhandledrejection;
(globalThis as any).onunhandledrejection = (evt: any) => {
    try { console.log(`[UNHANDLED_PROMISE] reason=${evt?.reason?.message ?? evt?.reason} stack=${evt?.reason?.stack ?? '(no stack)'}`); } catch (_) { /* ignore */ }
    return _origUnhandled ? _origUnhandled(evt) : undefined;
};
// ──────────────────────────────────────────────────────────────────────────

@ccclass('AppUI')
export class AppUI extends Component {

    // Panels
    private _landingPanel: Node = null!;
    private _homePanel: Node = null!;
    private _tokenDuelPanel: Node = null!;

    // UX overhaul Phase 2: procedural mascot on HomePanel.
    // Bound in start() via addComponent (the component is added at runtime
    // because the .ts file's UUID isn't known until the editor mints one).
    private _mascot: MascotController | null = null;

    // UX overhaul Phase 2b: second mascot on PostMatchPanel so celebrate/lose
    // is visible on the panel the user is looking at. Home mascot keeps idle/think.
    private _postMatchMascot: MascotController | null = null;

    // 4-state coverage: idle on LandingPanel (greets the user immediately),
    // think on RacePanel (visible during gameplay — _showRacePanel rewires
    // the think state from the hidden HomePanel mascot to this one).
    private _landingMascot: MascotController | null = null;
    private _raceMascot: MascotController | null = null;

    // Landing elements
    private _connectButton: Button = null!;
    private _reconnectButton: Button = null!;
    /** Play as Guest — Landing CTA. Sets _guestId + skips wallet auth. */
    private _playAsGuestButton: Button | null = null;
    /** Sign Out Guest — Home CTA (hidden in real-wallet mode). */
    private _signOutGuestButton: Button | null = null;
    /**
     * Synthetic local-only id for guest sessions. Format `guest_<hex>`.
     * Stored in localStorage as `tokenduel:guest_id`. Cleared on Sign Out
     * AND when a real wallet connects (real wallet wins).
     */
    private _guestId: string | null = null;
    // Footer status pill on Landing — replaces the old StatusLabel + floating
    // debug "Disconnected" indicator. Driven by _setConnectionPill.
    private _connectionStatusPill: Node | null = null;
    private _connectionStatusLabel: Label | null = null;

    // Home elements
    private _pubkeyLabel: Label = null!;
    private _homeStatus: Label = null!;
    private _allHomeButtons: Button[] = [];

    // Token Duel elements
    private _holdingLabels: Label[] = [];
    private _tokenDuelStatus: Label = null!;
    private _tdRpc!: TokenDuelRpc;
    private _cachedHoldings?: Holding[];
    // Session 2: single-button commit replaces Sign + Broadcast. `_signStakeButton`
    // kept as alias for backward compat during the scene-regen transition — it
    // points to whichever of `StakeCommitButton` / `SignStakeButton` the scene
    // exposes. `_signedStakeTx` / `_broadcastStakeButton` deleted — the buffer
    // and second button are no longer needed now that MWAManager.signAndSendTransaction
    // handles sign + broadcast in one wallet prompt.
    private _stakeCommitButton: Button = null!;
    private _signStakeButton: Button = null!; // alias → _stakeCommitButton
    private _stakeCommitSig: string | null = null; // tx signature once committed on-chain
    private _sessionSeed: bigint | null = null; // Phase 6: per-round seed for Anchor PDAs
    private _startGameButton: Button = null!;
    private _gameArea: Node = null!;
    private _heightLabel: Label = null!;
    private _tokenBadgeLabel: Label = null!;
    private _blockTemplate: Sprite = null!;
    private _gameOverLabel: Label = null!;
    private _game: TokenDuelGame | null = null;
    private _priceFeed: PriceFeed | null = null;

    // ── betting-duel Phase 3: RacePanel scene refs ──
    private _racePanel: Node | null = null;
    private _raceCountdownLabel: Label | null = null;
    private _raceHeroDeltaLabel: Label | null = null;
    private _raceHeroSubtitleLabel: Label | null = null;
    private _raceTokenCards: Node[] = [];
    private _raceTokenSymbolLabels: Label[] = [];
    private _raceTokenEntryLabels: Label[] = [];
    private _raceTokenCurrentLabels: Label[] = [];
    private _raceTokenDeltaLabels: Label[] = [];
    private _raceCancelButton: Button | null = null;
    // 2026-04-27 — Multi-player condensed-card grid (RacePanel hybrid layout).
    private _raceMultiGrid: Node | null = null;
    private _raceMultiCardNodes: Node[] = [];
    private _raceMultiCardRankLabels: Label[] = [];
    private _raceMultiCardNameLabels: Label[] = [];
    private _raceMultiCardDeltaLabels: Label[] = [];
    private _raceMultiCardPnlBars: Sprite[] = [];
    private _raceMultiCardTapBtns: Button[] = [];
    private _raceMultiBackBtn: Button | null = null;
    private _raceMultiExpandedIdx: number | null = null;
    // 2026-04-27 — Home-from-race button (non-destructive escape).
    private _raceHomeButton: Button | null = null;
    // True while a race is running in the BACKGROUND (RacePanel hidden but
    // PortfolioRace still ticking). Set when user taps Home from race.
    private _raceRunningInBackground: boolean = false;
    private _raceLastDeltaSign: 1 | -1 | 0 = 0; // tracks zero-crossings for haptic/sound cues
    private _raceActiveHoldings: Holding[] = [];
    private _raceTickBindingGapLogged = false;    // log TICK_BINDING_GAP at most once per race
    private _raceLatestSnapshot: RaceSnapshot | null = null; // for cancel-time introspection
    // Block 2 — opponent card
    private _raceOpponentCard: Node | null = null;
    private _raceOpponentAvatar: Label | null = null;
    private _raceOpponentName: Label | null = null;
    private _raceOpponentSymbols: Label | null = null;
    private _raceOpponentDelta: Label | null = null;
    private _raceOpponentGap: Label | null = null;
    private _liveSquadBot: import('../../token-duel/scripts/SquadBot').LiveSquadBot | null = null;
    // 4p / 8p Paper mode — N-1 bots rendered on a compact leaderboard strip.
    // 1v1 stays on the big `_raceOpponentCard`; this array stays empty then.
    private _liveSquadBots: import('../../token-duel/scripts/SquadBot').LiveSquadBot[] = [];
    private _raceOpponentStrip: Node | null = null;
    private _raceOpponentRows: Node[] = [];
    private _raceOpponentRowNames: Label[] = [];
    private _raceOpponentRowSymbols: Label[] = [];
    private _raceOpponentRowDeltas: Label[] = [];
    private _raceOpponentRowGaps: Label[] = [];
    // betting-duel live opponent delta (Real track): opponent's squad mints
    // arrive via backend WS; entry prices captured when mints land; delta
    // recomputed on each race tick against opponent's entry prices.
    private _opponentMints: string[] | null = null;
    private _opponentEntryPrices: Record<string, number> | null = null;
    private _opponentUnsubscribe: (() => void) | null = null;
    private _opponentDeltaPct: number = 0;
    // One-shot toast flag: if PortfolioRace drops any mint for missing
    // entry price, we tell the user once per race that their portfolio
    // shrank. Reset in `_showRacePanel`.
    private _raceEntryNoticeShown: boolean = false;
    // Confetti — pre-bound Graphics refs so match-end doesn't add/remove 12
    // cc.Graphics components in one frame. See `_bindPostMatchConfetti`.
    private _confettiBound: boolean = false;
    private _confettiShapes: IconName[] = [];
    private _confettiTints: string[] = [];
    // Stage 4K — streak flame on Home.
    private _streakFlameContainer: Node | null = null;
    private _streakFlameIconNode: Node | null = null;
    private _streakCountLabel: Label | null = null;
    private _streakRenderedValue: number = -1;  // last rendered streak; -1 = never rendered
    // Stage 1 game-feel: radial timer ring + vignette + tension helpers.
    private _raceTimerRing: Graphics | null = null;
    private _raceTimerPulseNode: Node | null = null;
    private _raceTimerPulseGraphics: Graphics | null = null;
    // 2026-04-27 — Dedicated 1s UI tick for the radial timer + countdown,
    // decoupled from PortfolioRace's price-poll cadence (which throttles to
    // 10min on 24h/7d matches and would freeze the visible ring).
    private _raceUiTimerStartedAtMs: number = 0;
    private _raceUiTimerDurationMs: number = 0;
    private _raceUiTimerActive: boolean = false;
    private _screenVignetteNode: Node | null = null;
    private _screenVignetteGraphics: Graphics | null = null;
    private _vignetteBaseAlpha: number = 0;
    private _lastRenderedDeltaPct: number = 0;       // Stage 1B hero-delta tween source
    private _lastRenderedOpponentDeltaPct: number = 0; // Phase 22 mirror for duel-layout opp hero
    private _lastFiveActivated: boolean = false;     // Stage 1F last-5s one-shot
    private _lastOvertakeSign: number = 0;           // Stage 1E sign(player - bestOpp)
    // Phase 22 — 1v1 Duel layout refs.
    private _isDuelLayout: boolean = false;
    // Battle-UI polish (2026-04-26): PlayerIdentityCard dropped in favor of
    // a small Lv pill on the top row; wallet shows in post-match summary.
    private _racePlayerLevelChip: Node | null = null;
    private _racePlayerLevelLabel: Label | null = null;
    private _opponentIdentityCard: Node | null = null;
    private _opponentIdentityName: Label | null = null;
    private _opponentIdentityLevel: Label | null = null;
    private _playerTokenRow: Node | null = null;
    private _opponentTokenRow: Node | null = null;
    private _playerDuelTokenCards: Node[] = [];
    private _playerDuelTokenSprites: Sprite[] = [];
    private _playerDuelTokenSyms: Label[] = [];
    private _playerDuelTokenDeltas: Label[] = [];
    private _playerDuelTokenBars: Graphics[] = [];
    private _opponentDuelTokenCards: Node[] = [];
    private _opponentDuelTokenSprites: Sprite[] = [];
    private _opponentDuelTokenSyms: Label[] = [];
    private _opponentDuelTokenDeltas: Label[] = [];
    private _opponentDuelTokenBars: Graphics[] = [];
    /** Per-card last rendered delta — used to detect sign flip / large swings. */
    private _playerLastTokenDelta: number[] = [0, 0, 0];
    private _opponentLastTokenDelta: number[] = [0, 0, 0];
    private _opponentHeroDeltaLabel: Label | null = null;
    private _opponentSubtitleGapLabel: Label | null = null;
    /** Decorative mascot opacity controller (dimmed during duel). */
    private _raceMascotOpacity: UIOpacity | null = null;
    /** Gameplay hint label below Forfeit ("Tap to drop - stack as high as you can"). */
    private _raceHintLabel: Label | null = null;
    // Duel bar — center tug-of-war.
    private _duelBarContainer: Node | null = null;
    private _duelBarFillGraphics: Graphics | null = null;
    private _duelBarGlowGraphics: Graphics | null = null;
    private _duelBarTrackGraphics: Graphics | null = null;
    private _duelBarCenterTickGraphics: Graphics | null = null;
    private _duelBarLeadingPpLabel: Label | null = null;
    private _duelBarOppTagLabel: Label | null = null;
    /** Smoothed bar position ∈ [-1, +1]; spring-integrated each frame. */
    private _duelBarPos: number = 0;
    private _duelBarVel: number = 0;
    private _duelBarTargetPos: number = 0;
    /** Spring tuning. Default ω=6 ζ=1 (~370ms to 90%). Last-5s tightens to ω=9. */
    private _duelBarOmega: number = 6.0;
    private _duelBarZeta: number = 1.0;
    private _duelBarLastTickAt: number = 0;
    private _duelBarOvertakeUntil: number = 0; // ms epoch — when the overtake transient ends
    private _duelBarLastSignSnap: 1 | -1 | 0 = 0; // tracks Bar zero-cross for color crossfade
    /** Per-opponent-token deltas captured by _updateOpponentDeltaTick (Real). */
    private _opponentPerTokenDeltas: Record<string, number> = {};
    // Block 3 — countdown overlay
    private _countdownOverlay: Node | null = null;
    private _countdownBigLabel: Label | null = null;
    private _countdownSquadLabel: Label | null = null;
    // Block 8 — signing overlay
    private _signingOverlay: Node | null = null;
    private _signingSpinnerLabel: Label | null = null;
    private _signingStatusLabel: Label | null = null;
    private _signingHintLabel: Label | null = null;
    /** Phase G4 — action-specific copy populated by callers before signing. */
    private _signingActionHint: string = '';

    // Phase 19 — LoadingOverlay (post-connect / reconnect gap polish).
    private _loadingOverlay: Node | null = null;
    /** Phase 20 — cold-start asset gate: captures the phase3 art-load promise
     *  so _gateColdStartLoad() can race it against a 3s timeout. */
    private _phase3LoadPromise: Promise<void> | null = null;
    private _loadingSpinnerLabel: Label | null = null;
    private _loadingStatusLabel: Label | null = null;
    private _loadingTipLabel: Label | null = null;
    private _loadingTipIndex: number = 0;
    private _loadingTipTimer: number | null = null;

    private static readonly LOADING_TIPS = [
        'Pick 3 tokens you think will pump.',
        'Matches settle in ~400ms on Solana.',
        'Stake some SOL, race the % delta.',
        'First match is on the house.',
        'Watch the live timer — last 5s pulse.',
        'Tournament mode rewards top-3 every week.',
    ];
    // Phase H4 — LevelUpOverlay bindings.
    private _levelUpOverlay: Node | null = null;
    private _levelUpTitleLabel: Label | null = null;
    private _levelUpBigLevel: Label | null = null;
    private _levelUpCaptionLabel: Label | null = null;
    private _levelUpRakeLabel: Label | null = null;
    /** Idempotence guard: don't fire the cinematic twice for the same level. */
    private _lastShownLevelUp: number = 0;

    // ── Phase III + Session 3: full Birdeye picker with native Cocos widgets ──
    private _squad: TokenSquad = new TokenSquad();
    private _birdeye: BirdeyeClient | null = null;
    // Balance chip (top-right of panel)
    private _balanceChipLabel: Label | null = null;
    // Search
    private _searchEditBox: EditBox | null = null;
    private _searchClearButton: Button | null = null;
    private _searchDebounceHandle: number | null = null;
    private _searchMode: boolean = false; // true while a search query is active (non-empty)
    // Session 11: feed tab dropdown — replaces the 4 inline tab buttons.
    // Tab values extend to cover smart_money + watchlist (previously 4-tab only).
    private _feedTabDropdownButton: Button | null = null;
    private _feedTabDropdownLabel: Label | null = null;
    private _feedTabDropdownPopover: Node | null = null;
    private _feedTabOptionButtons: Map<FeedTabOrVirtual, Button> = new Map();
    private _currentFeedTab: FeedTabOrVirtual = 'trending';
    private _watchlistStarButton: Button | null = null;
    private _watchlistStarLabel: Label | null = null;
    private _liveIndicatorLabel: Label | null = null;
    // Filter chip row (7 chips + Columns button stub).
    private _filterChipButtons: Map<FilterChipKey, Button> = new Map();
    private _columnsButton: Button | null = null;
    private _sortCol: 'age' | 'liq' | 'vol' = 'age';
    private _sortDir: 'asc' | 'desc' = 'desc';
    private _minLiq: number = 0;
    // Feed row pool — expanded from 3 labels to 10 (Session 11).
    private _feedScrollView: ScrollView | null = null;
    private _feedContent: Node | null = null;
    private _feedRowNodes: Node[] = [];
    private _feedRowButtons: Button[] = [];
    private _feedRowSprites: Sprite[] = [];
    private _feedRowLogoSprites: Sprite[] = [];
    private _feedRowSymbolLabels: Label[] = [];
    private _feedRowDeltaLabels: Label[] = [];    // back-compat alias of ChangeLabel
    private _feedRowNameLabels: Label[] = [];
    private _feedRowScoreLabels: Label[] = [];
    private _feedRowLiqLabels: Label[] = [];
    private _feedRowVolLabels: Label[] = [];
    private _feedRowChangeLabels: Label[] = [];
    private _feedRowPriceLabels: Label[] = [];
    private _feedRowDexLabels: Label[] = [];
    private _feedRowAgeLabels: Label[] = [];
    private _feedRowLiveDots: Node[] = [];
    private _currentFeedRows: TokenRow[] = [];
    private _lastFetchedRows: TokenRow[] = []; // unsorted raw result; filter chips re-derive from this
    private _feedPollTimer: number | null = null;
    // Search suggestion popover (5 rows).
    private _searchPopoverNode: Node | null = null;
    private _searchSuggestNodes: Node[] = [];
    private _searchSuggestLogos: Sprite[] = [];
    private _searchSuggestSymbols: Label[] = [];
    private _searchSuggestMints: Label[] = [];
    private _searchSuggestPrices: Label[] = [];
    private _searchSuggestVols: Label[] = [];
    private _searchSuggestChanges: Label[] = [];
    // Session 13 — per-row checkbox + selection edge (for watchlist multi-select + tap highlight).
    private _feedRowCheckboxes: Sprite[] = [];
    private _feedRowSelectedEdges: Node[] = [];
    private _selectedRowMint: string | null = null;
    // Session 13 A1 — MinLiq dropdown.
    private _minLiqDropdownButton: Button | null = null;
    private _minLiqDropdownLabel: Label | null = null;
    private _minLiqPopoverNode: Node | null = null;
    private _minLiqOptionButtons: Map<string, Button> = new Map();
    // 2026-04-26 polish — LiqSort dropdown (replaces standalone Liq↓/Liq↑ chips).
    private _liqSortPopoverNode: Node | null = null;
    private _liqSortOptionButtons: Map<'desc' | 'asc', Button> = new Map();
    // Session 13 A3 — Columns popover.
    private _columnsPopoverNode: Node | null = null;
    private _columnsPopoverOpen: boolean = false;
    private _colToggleButtons: Map<string, Button> = new Map();
    private _colToggleLabels: Map<string, Label> = new Map();
    private _visibleCols: Set<string> = new Set(['score', 'liq', 'vol', 'change', 'age']);
    private readonly _colMax: number = 6;
    private readonly _hiddenByFeed: Record<string, string[]> = {
        new: ['mc', 'fdv', 'holders', 'source'],
        trending: ['source', 'holders'],
        gainers: ['source'],
        smart_money: ['source', 'fdv', 'holders'],
        watchlist: ['mc', 'fdv', 'holders'],
        top10: ['score', 'liq', 'vol', 'change', 'mc', 'fdv', 'price', 'holders', 'source', 'age'],
    };
    // Session 13 A6 — Watchlist multi-select mode.
    private _watchlistMode: boolean = false;
    private _watchlistChecked: Set<string> = new Set();
    private _watchlistCancelButton: Button | null = null;
    // Session 13 Phase B — Token detail panel.
    private _tokenDetailPanel: Node | null = null;
    private _detailSymbolLabel: Label | null = null;
    private _detailNameLabel: Label | null = null;
    private _detailMintChipLabel: Label | null = null;
    private _detailPickUnpickButton: Button | null = null;
    private _detailPickUnpickLabel: Label | null = null;
    private _detailBackButton: Button | null = null;
    private _detailChartGraphics: Graphics | null = null;
    private _detailChartStatusLabel: Label | null = null;
    private _detailTimeframeButtons: Map<OhlcvType, Button> = new Map();
    private _detailDenomButtons: Map<string, Button> = new Map();
    private _detailSafetyChipLabels: Map<string, Label> = new Map();
    private _detailStatValueLabels: Map<string, Label> = new Map();
    private _detailStatusLabel: Label | null = null;
    private _detailCurrentRow: TokenRow | null = null;
    private _detailActiveTimeframe: OhlcvType = '15m';
    private _detailPriceMode: 'price' | 'mcap' = 'price';
    private _detailDenom: 'USD' | 'SOL' = 'USD';
    private _detailChartLoading: boolean = false;
    private _detailChartDebounceHandle: number | null = null;

    // Session 14 A4: tap-outside-close backdrop.
    private _backdropButton: Button | null = null;
    private _backdropNode: Node | null = null;

    // 2026-04-27 — Row-tap popover (Pick + / View Chart).
    private _rowActionPopover: Node | null = null;
    private _rowActionPickBtn: Button | null = null;
    private _rowActionChartBtn: Button | null = null;
    private _rowActionPendingRow: TokenRow | null = null;

    // Session 14 B1-B5: squad action buttons + pick mode state.
    private _squadPickButton: Button | null = null;
    private _squadPickLabel: Label | null = null;
    private _squadDropButton: Button | null = null;
    private _squadDropLabel: Label | null = null;
    // SquadRunButton removed 2026-04-26 — redundant with WagerStartButton (Pick 3 more → ▶ Start Match);
    // both handlers route to the same _onWagerStartTap → ModePicker flow.
    private _squadPickMode: boolean = false;
    private _squadPickChecked: Set<string> = new Set();
    private _squadLocked: boolean = false; // true after Run Squad → stake cluster revealed

    // Session 14 B3: drop overlay.
    private _squadDropOverlay: Node | null = null;
    private _squadDropOverlayBackdrop: Button | null = null;
    private _squadDropPills: Button[] = [];
    private _squadDropPillLabels: Label[] = [];

    // Session 14 C: leaderboard + portfolio panel bindings.
    private _leaderboardPanel: Node | null = null;
    private _portfolioPanel: Node | null = null;
    private _openLeaderboardButton: Button | null = null;
    // Phase N4: Disconnect entry on Home (replaces former Portfolio open button).
    private _disconnectHomeButton: Button | null = null;
    // Phase N4: merged Portfolio/Leaderboard hub — top-level tab strip mounted
    // on both panels at identical local coords so swapping which panel is
    // active reads as a tab change inside one container.
    private _hubActiveTab: 'portfolio' | 'leaderboard' = 'portfolio';
    private _lbHubPortfolioTab: Button | null = null;
    private _lbHubLeaderboardTab: Button | null = null;
    private _pfHubPortfolioTab: Button | null = null;
    private _pfHubLeaderboardTab: Button | null = null;
    private _lbHubHighlight: Node | null = null;
    private _pfHubHighlight: Node | null = null;
    private _lbHubGlow: Node | null = null;
    private _pfHubGlow: Node | null = null;
    private _lbRowNodes: Node[] = [];
    // Session D Part 7: mode-filter tabs on LeaderboardPanel.
    private _lbTabButtons: Map<string, Button> = new Map();
    private _lbFilterMode: number = 0; // 0=1v1, 1=4p, 2=8p, 3=BR10

    // Session D Part 8: Settings panel bindings.
    private _settingsPanel: Node | null = null;
    private _settingsWalletNameLabel: Label | null = null;
    private _settingsWalletPubkeyLabel: Label | null = null;
    private _settingsWalletBalanceLabel: Label | null = null;
    private _settingsUsernameEditBox: EditBox | null = null;
    private _settingsUsernameSavedLabel: Label | null = null;
    private _settingsStatusLabel: Label | null = null;
    private _settingsReturnPanel: 'home' | 'tokenDuel' = 'home';
    private _pfPubkeyLabel: Label | null = null;
    private _pfPaperTab: Button | null = null;
    private _pfRealTab: Button | null = null;
    private _pfStatValues: Map<string, Label> = new Map();
    private _pfActiveTab: 'paper' | 'real' = 'paper';
    // Part 9: top-level Stats / History switch + Match-history pool state.
    private _pfStatsTab: Button | null = null;
    private _pfHistoryTab: Button | null = null;
    private _pfHistoryView: Node | null = null;
    private _pfHistoryEmptyLabel: Label | null = null;
    private _pfHistoryLoadMoreButton: Button | null = null;
    private _pfHistoryRows: Node[] = [];
    private _pfTopLevelTab: 'stats' | 'history' | 'trophies' = 'stats';
    // Part 11 B: trophy tab bindings + cached entries.
    private _pfTrophiesTab: Button | null = null;
    private _pfTrophyTiles: Node[] = [];
    private _pfTrophyEntries: import('../../token-duel/scripts/TrophyRpc').Trophy[] = [];
    private _matchHistoryEntries: MatchHistoryEntry[] = [];
    private _matchHistoryCursor: string | null = null;
    private _matchHistoryCache: Map<string, MatchState | null> = new Map();
    private _matchHistoryLoading: boolean = false;
    // Dashboard redesign (foamy-sphinx): hero P/L card, XP progress bar, empty-state.
    private _pfHeroPnLValue: Label | null = null;
    private _pfHeroPnLSubtitle: Label | null = null;
    private _pfHeroPnLEdge: Sprite | null = null;
    private _pfXpValueLabel: Label | null = null;
    private _pfXpProgressFill: Node | null = null;
    private _pfXpFooter: Label | null = null;
    private _pfEmptyState: Node | null = null;
    private _pfStatsViewNodes: Node[] = [];

    // Part 9 / Phase 28: tutorial overlay (gamified card carousel).
    private _tutorialOverlay: Node | null = null;
    private _tutorialCards: Node[] = [];
    private _tutorialGlows: Node[] = [];
    private _tutorialMascots: (MascotController | null)[] = [];
    private _tutorialStep: number = 0;
    private _tutorialAnimating: boolean = false;
    private _tutorialDismissed: (() => void) | null = null;
    private readonly _TUTORIAL_FLAG = 'tokenduel:tutorialSeen';
    /** Per-step mascot state — matches LayoutSpec.tutorialCard.mascotStates. */
    private readonly _TUTORIAL_MASCOT_STATES: MascotState[] = ['idle', 'celebrate', 'think', 'celebrate'];

    // Part 10 Bundle 3 / pt2: DailyChallengePanel + SquadPresetsOverlay + QP-defaults.
    private _dailyChallengePanel: Node | null = null;
    private _squadPresetsOverlay: Node | null = null;
    private _presetRowNodes: Node[] = [];
    private _presetNameModal: Node | null = null;
    private _presetNameEditBox: EditBox | null = null;
    /** Presets currently rendered into the overlay; indexed parallel to _presetRowNodes. */
    private _renderedPresets: SquadPreset[] = [];
    /** Phase 27 — QuickPlay defaults dropdowns + pill toggle. */
    private _qpModeRow: Node | null = null;
    private _qpWindowRow: Node | null = null;
    private _qpWagerRow: Node | null = null;
    private _qpModeValueLabel: Label | null = null;
    private _qpWindowValueLabel: Label | null = null;
    private _qpWagerValueLabel: Label | null = null;
    private _qpModePopover: Node | null = null;
    private _qpWindowPopover: Node | null = null;
    private _qpWagerPopover: Node | null = null;
    private _qpModeOptionButtons: Map<string, Button> = new Map();
    private _qpWindowOptionButtons: Map<string, Button> = new Map();
    private _qpWagerOptionButtons: Map<string, Button> = new Map();
    /** Track pill toggle — sliding indicator + Paper/Real labels + invisible hit areas. */
    private _qpTrackIndicator: Node | null = null;
    private _qpTrackPaperLabel: Label | null = null;
    private _qpTrackRealLabel: Label | null = null;

    // Part 11 A: cached share-summary query string for the last displayed
    // PostMatchPanel. `null` when no shareable match is in view (e.g. paper).
    private _lastShareQuery: string | null = null;
    private _lastShareMatchPda: string | null = null;

    // Part 12 C: live match ticker state.
    private _tickerEntries: import('../../token-duel/scripts/MatchTickerRpc').MatchTickerEntry[] = [];
    private _tickerRotateIdx: number = 0;
    private _tickerPollTimer: number | null = null;
    private _tickerRotateTimer: number | null = null;
    /** The ticker entry most-recently rendered onto HomeMatchTicker. Used when
     *  the user taps the ticker to open the spectator view. */
    private _tickerDisplayedEntry: import('../../token-duel/scripts/MatchTickerRpc').MatchTickerEntry | null = null;

    // Part 13: rake surfacing. Caches the last-fetched level for quick UI
    // updates without re-polling UserStats on every panel transition.
    // 2026-04-26 lobby restructure: HomeRakeChip removed; rake now lives in
    // the ChallengeSeasonCard's RAKE chip. _homeRakeChip stays as a no-op
    // ref for backward compat (always null) so tsc remains happy.
    private _homeRakeChip: Label | null = null;
    private _waitingRakeLabel: Label | null = null;
    private _postMatchRakeLabel: Label | null = null;
    private _cachedLevel: number = 1;
    /** 2026-04-26 lobby restructure: WalletPill + new chip + training fields. */
    private _walletPill: Node | null = null;
    private _walletNameLabel: Label | null = null;
    private _walletPillSecureDot: Node | null = null;
    private _homeXpBarFill: Node | null = null;
    private _homeXpProgressLabel: Label | null = null;
    private _homeMatchTickerHeader: Label | null = null;
    private _homeMatchChips: { mode: Label | null; players: Label | null; stake: Label | null; duration: Label | null; created: Label | null } = { mode: null, players: null, stake: null, duration: null, created: null };
    private _homeChalChips: { day: Label | null; challenges: Label | null; season: Label | null; pool: Label | null; rake: Label | null } = { day: null, challenges: null, season: null, pool: null, rake: null };
    private _homeTrainingTitleLabel: Label | null = null;
    private _homeTrainingBodyLabel: Label | null = null;
    private _homeTrainingHintLabel: Label | null = null;
    private _homeChooseMatchLabel: Label | null = null;
    private _cachedRakeText: string = '—';

    // Part 14: tournament discovery + countdown state.
    private _tournamentBadge: Node | null = null;
    private _tournamentPollTimer: number | null = null;
    private _tournamentCountdownTimer: number | null = null;
    private _nextTournamentMatchPda: string | null = null;
    private _nextTournamentCreatedAt: number = 0; // unix sec of match.createdAt
    private _nextTournamentIsActive: boolean = false;
    private _nextTournamentPlayerCount: number = 0;       // Phase H1
    private _nextTournamentRequiredPlayers: number = 10;  // Phase H1
    private _nextTournamentWagerLamports: number = 0;     // Phase H1
    private _tournamentCadenceMs: number = 15 * 60_000;
    private _tournamentHostFetched: boolean = false;

    // Part 14 C: TournamentPanel bindings.
    private _tournamentPanel: Node | null = null;
    private _tournamentTitleLabel: Label | null = null;
    private _tournamentMatchLabel: Label | null = null;
    private _tournamentStatusLabel: Label | null = null;
    private _tournamentPrizeLabel: Label | null = null;
    private _tournamentSlotNodes: Node[] = [];
    private _tournamentJoinButton: Button | null = null;
    private _tournamentUnsubscribe: (() => void) | null = null;
    private _tournamentActiveMatchPda: string | null = null;
    private _tournamentLastMatchState: MatchState | null = null;

    // Part 12 D: spectator mode state.
    private _spectatorPanel: Node | null = null;
    private _spectatorTitleLabel: Label | null = null;
    private _spectatorMatchLabel: Label | null = null;
    private _spectatorStatusLabel: Label | null = null;
    private _spectatorPlayerRows: Node[] = [];
    private _spectatorEventRows: Node[] = [];
    private _spectatorJoinButton: Button | null = null;
    /** Cleanup fn returned by `subscribeToMatch`. Null when not spectating. */
    private _spectatorUnsubscribe: (() => void) | null = null;
    private _spectatorMatchPda: string | null = null;
    private _spectatorLastMatch: MatchState | null = null;
    /** Ring buffer (10-max) of formatted event lines, newest first. */
    private _spectatorEventLines: string[] = [];

    // Part 10 Bundle 1: receipt-signer session for cheat-resistant settles.
    // private _receiptSession removed on betting-duel.
    /** True when the current real match started a verified session successfully.
     *  If false at settle time, client falls back to legacy settle_match. */
    private _useVerifiedPath: boolean = false;
    /** Surfaces as a yellow "Unverified" badge on PostMatchPanel for real matches. */
    private _lastMatchUnverifiedReason: string | null = null;

    // Session D Part 2: ModePickerOverlay state.
    private _modePickerOverlay: Node | null = null;
    private _pickerModeButtons: Map<string, Button> = new Map();
    private _pickerWagerButtons: Map<string, Button> = new Map();
    private _pickerPaperToggle: Button | null = null;
    private _pickerRealToggle: Button | null = null;
    private _pickerStartButton: Button | null = null;
    private _pickerCancelButton: Button | null = null;
    private _pickerStatusLabel: Label | null = null;
    private _pickerWagerReadout: Label | null = null;
    private _pickerSelectedMode: string = 'oneVone';
    private _pickerSelectedWagerIndex: number = 1; // default 0.05 SOL
    private _pickerSelectedTrack: 'paper' | 'real' = 'paper';
    // betting-duel polish — Wager control row on TokenDuelPanel.
    private _wagerValueButton: Button | null = null;
    private _wagerValueLabel: Label | null = null;
    private _wagerStartButton: Button | null = null;
    private _wagerStartLabel: Label | null = null;
    private _wagerHintLabel: Label | null = null;
    // 2026-04-26 redesign — MatchSetupCard labels.
    private _matchSetupSquadLabel: Label | null = null;
    private _matchSetupStakeLabel: Label | null = null;
    private _matchSetupHintLabel: Label | null = null;
    private _wagerDropdown: Node | null = null;
    private _wagerDropdownRows: Button[] = [];
    /** Phase A — JOIN mode: locked-wager chip; replaces WagerValueButton when _pickerJoinTarget set. */
    private _wagerLockChip: Node | null = null;
    private _wagerLockChipLabel: Label | null = null;
    /** Stage 1 — BOT mode: rose "FREE · Bot Match" chip; replaces WagerValueButton when _pickerBotMode true. */
    private _wagerBotChip: Node | null = null;
    private _wagerBotChipLabel: Label | null = null;
    // Part 9: TimeWindow axis — stored as TimeWindowId, mapped to u8 at tx-build time.
    private _pickerWindowButtons: Map<string, Button> = new Map();
    private _pickerSelectedWindow: TimeWindowId = DEFAULT_TIME_WINDOW;
    // Phase E — bot difficulty (paper-track + real-track timeout fallback).
    private _pickerDifficultyButtons: Map<BotDifficulty, Button> = new Map();
    private _pickerSelectedDifficulty: BotDifficulty = 'medium';
    /** Cached Birdeye gainers snapshot for Hard bot squad picks. Refreshed
     *  lazily before a Hard match — empty array → SquadBot falls back to
     *  the vetted whitelist. */
    private _hardGainersSnapshot: VettedMint[] = [];
    // Phase B — host mode flag. When true, _onPickerStart calls
    // joinOrCreateWithRetry with forceCreate=true so the player ALWAYS
    // becomes the lobby creator (no auto-search).
    private _pickerHostMode: boolean = false;
    // ── Phase N — Notification system bindings ──────────────────────
    private _notifBellButton: Button | null = null;
    private _notifBellBadge: Node | null = null;
    private _notifBadgeLabel: Label | null = null;
    private _notifPanel: Node | null = null;
    private _notifPanelCard: Node | null = null;
    private _notifCloseButton: Button | null = null;
    private _notifMarkAllReadButton: Button | null = null;
    private _notifEmptyLabel: Label | null = null;
    private _notifRows: Node[] = [];
    /** Row idx → currently bound notification id (null if row inactive). */
    private _notifRowIds: (string | null)[] = [];
    private _notifToastSlots: Node[] = [];
    private _notifToastQueue: import('../../token-duel/scripts/NotificationToast').NotificationToastQueue | null = null;
    private _notifStoreUnsub: (() => void) | null = null;
    private _notifLastUnread: number = 0; // for pulse-on-increment
    /** Phase N4 — track previous daily challenge bitmask to detect new completions. -1 = never read. */
    private _lastDailyChallengeMask: number = -1;
    /** Phase N6 — backend notification feed subscriber unsubscribe fn. */
    private _notifFeedUnsub: (() => void) | null = null;
    /** Phase N6 — last subscribed pubkey, to detect wallet swaps. */
    private _notifFeedPubkey: string | null = null;

    // Phase A — FindMatchPanel browser state.
    private _findMatchPanel: Node | null = null;
    private _findMatchTitleLabel: Label | null = null;
    private _findMatchCountLabel: Label | null = null;
    private _findMatchEmptyLabel: Label | null = null;
    private _findMatchStatusLabel: Label | null = null;
    private _findMatchHostButton: Button | null = null;
    private _findMatchBackButton: Button | null = null;
    private _findMatchRefreshButton: Button | null = null;
    private _findMatchHideFullToggle: Button | null = null;
    // Phase H2 — Open Lobbies / Live Now tab toggle on FindMatchPanel.
    private _findMatchTabOpenBtn: Button | null = null;
    private _findMatchTabLiveBtn: Button | null = null;
    private _filterModeButtons: Map<string, Button> = new Map();
    private _filterWindowButtons: Map<string, Button> = new Map();
    private _filterWagerButtons: Map<string, Button> = new Map();
    /** Phase 2b — previous-active chip key per row, for tween dedupe. */
    private _filterActiveChip: Map<'mode' | 'window' | 'wager' | 'tab', string> = new Map();
    /** Each row container — children include mode/wager/window/sub labels + Join button. */
    private _matchCardRows: Node[] = [];
    /** Per-row Join buttons; row index → matchPda last bound, used by the click handler. */
    private _matchCardRowMatchPdas: (string | null)[] = [];
    /** Mirrors `_matchCardRowMatchPdas`; true when the bound lobby is hosted by us. */
    private _matchCardRowMine: boolean[] = [];
    private _matchBrowser: MatchBrowser | null = null;
    private _matchBrowserUnsubscribe: (() => void) | null = null;
    /** Home-screen FindMatch button live count badge + label + 2nd subscription. */
    private _findMatchCountBadge: Node | null = null;
    private _findMatchCountBadgeLabel: Label | null = null;

    // 2026-04-27 — Matches In Progress panel + HomePanel CTA bindings.
    private _mipPanel: Node = null!;
    private _mipRowNodes: Node[] = [];
    private _mipRingGraphics: Graphics[] = [];
    private _mipWinLineLabels: Label[] = [];
    private _mipWindowLineLabels: Label[] = [];
    private _mipStakeChipLabels: Label[] = [];
    private _mipOpponentChipLabels: Label[] = [];
    private _mipTimeLabels: Label[] = [];
    private _mipTapButtons: Button[] = [];
    private _mipEmptyState: Node | null = null;
    private _mipSubtitleLabel: Label | null = null;
    private _mipMatches: MatchState[] = [];
    // 2026-04-27 — Local (paper / bot) matches don't have on-chain accounts.
    // Tracked in-memory so they show up in MIP + the home count badge.
    private _localActiveMatches: MatchState[] = [];
    private _currentLocalMatchPda: string | null = null;
    /** Cache of last on-chain fetch — used to rebuild merged display on local change without re-querying RPC. */
    private _mipOnChainCache: MatchState[] = [];
    /** Cache of last backend fetch (paper_match_active rows belonging to this user). */
    private _mipBackendCache: MatchState[] = [];
    /** Throttle for backend height-PATCH writes during a race tick. */
    private _lastPaperMatchHeightsPostMs: number = 0;
    private _mipTickHandle: number | null = null;
    private _matchesInProgressCountBadge: Node | null = null;
    private _matchesInProgressCountLabel: Label | null = null;
    private _matchesInProgressSubtitleLabel: Label | null = null;
    private _findMatchCountUnsubscribe: (() => void) | null = null;
    private _findMatchCountLastValue: number = 0;
    /** Phase A2 — FindMatchPanel polish: Lv/XP chip + empty-state cluster + per-row edge stripes + capacity bars. */
    private _findMatchLvXpChip: Node | null = null;
    private _findMatchLvXpChipLabel: Label | null = null;
    /** Stage 2 — Top-right Level chips on Home + TokenDuel (FindMatch reuses _findMatchLvXpChip relocated). */
    private _homeLevelChip: Node | null = null;
    private _homeLevelChipLabel: Label | null = null;
    private _tokenDuelLevelChip: Node | null = null;
    private _tokenDuelLevelChipLabel: Label | null = null;
    /** Last computed level — drives pulse animation when level changes. */
    private _lastDisplayedLevel: number = 0;
    /** DB Stage 2 — sync cache of pubkey → resolved username (empty string = no name set). */
    private _displayNameCache: Map<string, string> = new Map();
    /** Pubkeys with an in-flight fetch — prevents duplicate roundtrips. */
    private _displayNameInflight: Set<string> = new Set();
    private _findMatchEmptyMascotNode: Node | null = null;
    private _findMatchEmptyMascot: MascotController | null = null;
    private _findMatchEmptyTitle: Label | null = null;
    private _findMatchEmptySubtitle: Label | null = null;
    private _findMatchEmptyHostBtn: Button | null = null;
    private _findMatchEmptyBotBtn: Button | null = null;
    /** Per-row edge stripes (mode-color) + capacity bar fills (tweened scaleX). */
    private _matchCardEdgeStripes: Node[] = [];
    private _matchCardCapBarFills: Node[] = [];
    private _matchCardTrackChips: Node[] = [];

    /** Phase A — JoinMatchConfirmOverlay node refs. */
    private _joinConfirmOverlay: Node | null = null;
    private _joinConfirmCard: Node | null = null;
    private _joinConfirmModeLabel: Label | null = null;
    private _joinConfirmModeBadge: Node | null = null;
    private _joinConfirmTrackChip: Node | null = null;
    private _joinConfirmTrackLabel: Label | null = null;
    private _joinConfirmWagerHero: Label | null = null;
    private _joinConfirmWindowLabel: Label | null = null;
    private _joinConfirmCapacityLabel: Label | null = null;
    private _joinConfirmHostLabel: Label | null = null;
    private _joinConfirmAgeLabel: Label | null = null;
    private _joinConfirmCapacityBarFill: Node | null = null;
    private _joinConfirmCancelButton: Button | null = null;
    private _joinConfirmGoButton: Button | null = null;
    private _joinConfirmScrimButton: Button | null = null;
    /** Match the user is about to join — set when overlay opens, cleared on Cancel/Go. */
    private _joinConfirmTarget: import('../../token-duel/scripts/MatchRpc').MatchState | null = null;
    /** Connected-screen browser interval — slow on Home, full speed when in lobby. */
    private static readonly HOME_BROWSER_INTERVAL_MS = 15_000;
    private static readonly LOBBY_BROWSER_INTERVAL_MS = 5_000;
    /**
     * Phase A — when set, the next picker submission joins this open match
     * instead of creating a new one. Set by _onJoinMatchConfirmed; cleared
     * after submission, on race end, or on back-out to home.
     */
    private _pickerJoinTarget: import('../../token-duel/scripts/MatchRpc').MatchState | null = null;
    /**
     * Stage 1 — when true, the picker is in BOT mode. Set by _onBotMatch;
     * cleared on _showHome / on Race start. Drives the rose "FREE" chip in
     * the wager slot + relabels WagerStartButton to "Start Bot Match" +
     * skips ModePicker on tap (track is already locked to paper).
     */
    private _pickerBotMode: boolean = false;
    // Last match outcome — set when a bot match resolves so post-game flow can use it.
    private _lastMatchOutcome: { won: boolean; opponentHeight: number; xp: number; track: 'paper' | 'real' } | null = null;

    // Session D Part 4: real-mode on-chain state.
    /** Phase F8 — backing field for the active real match. The getter/setter
     *  below mirrors writes into localStorage so a mid-match crash recovery
     *  can prompt "Resume your active match?" on cold launch. */
    private _activeRealMatchPda_: string | null = null;
    private get _activeRealMatchPda(): string | null { return this._activeRealMatchPda_; }
    private set _activeRealMatchPda(v: string | null) {
        this._activeRealMatchPda_ = v;
        try {
            if (typeof localStorage === 'undefined') return;
            if (v) localStorage.setItem('tokenduel:activeMatch', v);
            else localStorage.removeItem('tokenduel:activeMatch');
        } catch (_) { /* ignore */ }
    }
    private _pendingRealMatch: boolean = false;
    private _realMatchMode: number = 0;          // 0 = OneVOne
    private _realMatchWagerTier: number = 0;
    private _realMatchWagerLamports: number = 0;
    private _realPollAbortFlag: boolean = false; // set true to short-circuit an in-flight poll

    // Session D Part 3: Waiting + PostMatch panel bindings.
    private _waitingPanel: Node | null = null;
    private _waitingTitleLabel: Label | null = null;
    private _waitingModeLabel: Label | null = null;
    private _waitingProgressLabel: Label | null = null;
    private _waitingStatusLabel: Label | null = null;
    private _waitingCancelButton: Button | null = null;
    private _waitingPlayBotButton: Button | null = null;
    // Part 9: force-settle UI state.
    private _waitingForceSettleButton: Button | null = null;
    private _realMatchStartedAt: number = 0;       // Date.now() when WaitingPanel saw status=Active
    private _forceSettleWatchTimer: number | null = null;
    /** Cached MatchState from the latest poll — used by the force-settle handler. */
    private _latestRealMatchState: MatchState | null = null;
    private _postMatchPanel: Node | null = null;
    private _postMatchTitleLabel: Label | null = null;
    private _postMatchTrackLabel: Label | null = null;
    private _postMatchPayoutLabel: Label | null = null;
    private _postMatchSubtitleLabel: Label | null = null;
    private _postMatchBackButton: Button | null = null;
    private _postMatchAgainButton: Button | null = null;
    private _postMatchCardValues: Map<string, Label> = new Map();
    private _postMatchCardSubs: Map<string, Label> = new Map();
    // Drifting-gadget redesign — outcome-bg tint, mascot glow halo, XP bar refs.
    private _postMatchOutcomeBgGfx: Graphics | null = null;
    private _postMatchOutcomeBgOpacity: UIOpacity | null = null;
    private _postMatchMascotGlowGfx: Graphics | null = null;
    private _postMatchMascotGlowOpacity: UIOpacity | null = null;
    private _postMatchXPBarLabelLeft: Label | null = null;
    private _postMatchXPBarLabelRight: Label | null = null;
    private _postMatchXPBarFillGfx: Graphics | null = null;
    private _postMatchCardEdges: Map<string, Sprite> = new Map();
    // Squad slot buttons (3) — label child shows symbol or "+"
    private _squadSlotButtons: Button[] = [];
    private _squadSlotLabels: Label[] = [];
    private _squadSlotLogoSprites: Sprite[] = [];
    private _squadSlotSymbolLabels: Label[] = [];
    private _squadSlotDeltaLabels: Label[] = [];
    // Tracks per-slot filled state across renders so we can pop only on
    // empty → filled transitions (game-feel polish 2026-04-26).
    private _squadSlotPrevFilled: boolean[] = [false, false, false];
    // Whether the WagerStartButton has the idle-pulse tween attached.
    private _wagerStartPulsing: boolean = false;
    // Per-slot pick targeting — set by tapping an empty slot ("Pick +"); the
    // next tapped feed row goes into that slot. Cleared after one placement.
    private _pickTargetSlot: number | null = null;
    private _lastSquadDeltas: number[] = [0, 0, 0]; // for pulse diff detection
    // Stake controls — slider is primary; chips snap to presets.
    private _stakeSlider: Slider | null = null;
    private _stakeValueLabel: Label | null = null;
    private _stakeChipButtons: Map<'001' | '010' | '100', Button> = new Map();
    private _selectedStakeLamports: bigint = STAKE_LAMPORTS;
    // Remote logo cache: url → SpriteFrame.
    private _logoCache: Map<string, SpriteFrame> = new Map();
    // Logos in flight: sprite instance → url. Guards against races when a
    // row gets re-rendered before a pending fetch resolves.
    private _logoPending: WeakMap<Sprite, string> = new WeakMap();
    // Known-failed URLs: .svg + 403s + decode errors. Skipped on future
    // calls so we don't re-fetch 80+ times per poll.
    private _logoFailedUrls: Set<string> = new Set();
    private _claimButton: Button = null!;
    private _lastGameHeight: number = 0;
    private _heroTileButtons: Button[] = [];
    private _heroTileLabels: Label[] = [];
    private _pickedHeroSymbol: string | null = null;
    private _pickedHeroSig: string | null = null;
    private _sessionDeltas: Record<string, number> | null = null;

    // RPC
    private _rpc!: SolanaRpc;

    start(): void {
        console.log(`${TAG} BUILD_STAMP v=2026-04-25-T0330-mascot-4state — Landing+Race mascots, instant-ref reveal, CC strip`);
        // SURGICAL BISECT: NotificationToastOverlay is the ONLY new always-active
        // top-level panel since master (16 other new panels are active=False).
        // Disable it BEFORE any wiring runs — if crash gone, this overlay (or
        // its runtime Button wiring in NotificationToastQueue._buildSlot) is the
        // culprit. Confirmation = absence of SIGSEGV at fault addr 0x28 on the
        // first DRAW frame.
        try {
            const toastOverlay = this.node.getChildByName('NotificationToastOverlay');
            console.log(`${TAG} BISECT | NotificationToastOverlay found=${!!toastOverlay} active_before=${toastOverlay?.active} children=${toastOverlay?.children?.length ?? -1}`);
            if (toastOverlay) {
                toastOverlay.active = false;
                console.log(`${TAG} BISECT | NotificationToastOverlay -> active=false (will not render)`);
            }
        } catch (e: any) {
            console.log(`${TAG} BISECT | overlay toggle THREW ${e?.message ?? e}`);
        }
        console.log(`${TAG} start | START`);
        console.log(`${TAG} start | CHK1 — entered start()`);
        // Frame heartbeat: log director update + draw ticks so we can see
        // whether the JS thread runs ANY frame after start() returns and
        // which engine phase the SIGSEGV occurs in.
        try {
            let beforeUpdN = 0, afterUpdN = 0, beforeDrawN = 0, afterDrawN = 0;
            const onBeforeUpd = () => { beforeUpdN++; if (beforeUpdN <= 6) console.log(`${TAG} DIR_BEFORE_UPDATE n=${beforeUpdN}`); };
            const onAfterUpd  = () => { afterUpdN++;  if (afterUpdN  <= 6) console.log(`${TAG} DIR_AFTER_UPDATE  n=${afterUpdN}`); };
            const onBeforeDraw = () => { beforeDrawN++; if (beforeDrawN <= 6) console.log(`${TAG} DIR_BEFORE_DRAW   n=${beforeDrawN}`); };
            const onAfterDraw  = () => { afterDrawN++;  if (afterDrawN  <= 6) console.log(`${TAG} DIR_AFTER_DRAW    n=${afterDrawN}`); };
            director.on(Director.EVENT_BEFORE_UPDATE, onBeforeUpd);
            director.on(Director.EVENT_AFTER_UPDATE, onAfterUpd);
            director.on(Director.EVENT_BEFORE_DRAW, onBeforeDraw);
            director.on(Director.EVENT_AFTER_DRAW, onAfterDraw);
            console.log(`${TAG} start | DIRECTOR hooks installed (before/after update + draw)`);
        } catch (e: any) {
            console.log(`${TAG} start | DIRECTOR hook EXCEPTION ${e?.message ?? e}`);
        }

        // Phase F8 — match-stuck recovery. If a prior session crashed mid-
        // match, the active match PDA is in localStorage. Restore the field
        // (without surfacing UI yet — that fires after wallet connects).
        try {
            if (typeof localStorage !== 'undefined') {
                const stored = localStorage.getItem('tokenduel:activeMatch');
                if (stored && stored.length >= 32 && stored.length <= 44) {
                    this._activeRealMatchPda_ = stored;
                    console.log(`${TAG} start | restored_active_match_pda=${stored.slice(0, 8)}... (will verify status post-wallet-connect)`);
                }
            }
        } catch (_) { /* ignore */ }

        // Part 11 C: initialize Sound subsystem. Idempotent; loads 5 AudioClips
        // from `resources/audio/`. Missing clips no-op silently.
        initSound(this.node);

        // Find panels
        this._landingPanel = this.node.getChildByName('LandingPanel')!;
        this._homePanel = this.node.getChildByName('HomePanel')!;
        this._tokenDuelPanel = this.node.getChildByName('TokenDuelPanel')!;
        this._mipPanel = this.node.getChildByName('MatchesInProgressPanel')!;

        if (!this._landingPanel || !this._homePanel || !this._tokenDuelPanel) {
            console.log(`${TAG} start | FAIL panels not found landing=${!!this._landingPanel} home=${!!this._homePanel} tokenDuel=${!!this._tokenDuelPanel}`);
            return;
        }

        // Stage 2 — TokenDuel Lv chip + balance now live INSIDE PlayerStatusPill
        // (combined into one horizontal pill in the 2026-04-26 redesign). Use
        // descendant lookup since they're no longer direct children of the panel.
        this._tokenDuelLevelChip = this._findDescendantByName(this._tokenDuelPanel, 'TokenDuelLevelChip') ?? null;
        this._tokenDuelLevelChipLabel = this._tokenDuelLevelChip
            ? this._findDescendantByName(this._tokenDuelLevelChip, 'TokenDuelLevelChipLabel')?.getComponent(Label) ?? null
            : null;

        // ── Landing elements ──
        this._connectButton = this._landingPanel.getChildByName('ConnectButton')?.getComponent(Button)!;
        this._reconnectButton = this._landingPanel.getChildByName('ReconnectButton')?.getComponent(Button)!;
        this._connectionStatusPill = this._landingPanel.getChildByName('ConnectionStatusPill') ?? null;
        this._connectionStatusLabel = this._connectionStatusPill?.getChildByName('Label')?.getComponent(Label) ?? null;
        console.log(`${TAG} start | ConnectButton=${!!this._connectButton} ReconnectButton=${!!this._reconnectButton} StatusPill=${!!this._connectionStatusPill}`);

        this._connectButton?.node.on(Button.EventType.CLICK, this._onConnect, this);
        this._reconnectButton?.node.on(Button.EventType.CLICK, this._onReconnect, this);

        // Guest mode — Landing entry. 2026-04-26 lobby restructure: Home's
        // SignOutGuestButton was removed; sign-out now happens via the
        // SettingsPanel's DisconnectSettingsButton (which already routes
        // through _onDisconnect → _onSignOutGuest for guests).
        this._playAsGuestButton = this._landingPanel.getChildByName('PlayAsGuestButton')?.getComponent(Button) ?? null;
        this._playAsGuestButton?.node.on(Button.EventType.CLICK, this._onPlayAsGuest, this);
        // Cold-start hydration: if a guest_id is in localStorage and no
        // wallet is connected, restore guest mode and skip Landing.
        try {
            const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
            const cachedGuest = ls?.getItem?.('tokenduel:guest_id');
            if (typeof cachedGuest === 'string' && cachedGuest.startsWith('guest_')) {
                this._guestId = cachedGuest;
                console.log(`${TAG} start | guest_session restored id=${cachedGuest}`);
            }
        } catch (_) { /* ignore */ }

        // ── Wire home buttons ──
        // 2026-04-26 lobby restructure: Disconnect / Delete / SignOutGuest
        // were removed from Home; SettingsPanel hosts those flows now.
        // Home is intent-first: Start (host) / Find (browse) / Bot (paper).
        const homeBtnNames = [
            'StartMatchButton',
            'FindMatchButton',
            'MatchesInProgressButton',
            'BotMatchButton',
        ];
        const homeHandlers = [
            this._onStartMatch,
            this._showFindMatchPanel,
            this._showMatchesInProgressPanel,
            this._onBotMatch,
        ];

        // Part 10 Bundle 3: streak strip tap → opens DailyChallengePanel (or
        // placeholder toast until the panel is wired).
        const streakStrip = this._homePanel.getChildByName('DailyStreakStrip');
        const streakBtn = streakStrip?.getComponent(Button);
        if (streakBtn) {
            streakBtn.node.on(Button.EventType.CLICK, this._onOpenDailyChallenges, this);
        }

        // Part 12 D: HomeMatchTicker tap → SpectatorPanel for the rendered entry.
        const tickerNode = this._homePanel.getChildByName('HomeMatchTicker');
        const tickerBtn = tickerNode?.getComponent(Button);
        if (tickerBtn) {
            tickerBtn.node.on(Button.EventType.CLICK, () => {
                const e = this._tickerDisplayedEntry;
                if (!e) return;
                this._onOpenSpectator(e.pda);
            }, this);
        }

        // Part 14: HomeTournamentBadge tap → TournamentPanel (or SpectatorPanel
        // as a fallback if TournamentPanel isn't yet discovered).
        this._tournamentBadge = this._homePanel.getChildByName('HomeTournamentBadge') ?? null;
        const tbBtn = this._tournamentBadge?.getComponent(Button);
        if (tbBtn) {
            tbBtn.node.on(Button.EventType.CLICK, () => {
                if (this._nextTournamentMatchPda) {
                    this._onOpenTournament(this._nextTournamentMatchPda);
                }
            }, this);
        }

        // 2026-04-26 lobby restructure: PubkeyLabel reparented INSIDE
        // WalletPill (HUD header), HomeStatusLabel reparented INSIDE
        // HomeTrainingCard. getChildByName is shallow → use descendant
        // search for both.
        this._walletPill = this._homePanel.getChildByName('WalletPill') ?? null;
        this._walletNameLabel = this._walletPill?.getChildByName('WalletNameLabel')?.getComponent(Label) ?? null;
        this._walletPillSecureDot = this._walletPill?.getChildByName('WalletPillSecureDot') ?? null;
        this._pubkeyLabel = (this._walletPill?.getChildByName('PubkeyLabel')?.getComponent(Label)
            ?? this._findDescendantByName(this._homePanel, 'PubkeyLabel')?.getComponent(Label))!;
        this._homeStatus = this._findDescendantByName(this._homePanel, 'HomeStatusLabel')?.getComponent(Label)!;

        // Stage 2 — Lv/XP chip top-right on Home + TokenDuel. 2026-04-26:
        // chip widened to full panel width; new XP progress bar + label
        // children bound here.
        this._homeLevelChip = this._homePanel.getChildByName('HomeLevelChip') ?? null;
        this._homeLevelChipLabel = this._homeLevelChip?.getChildByName('HomeLevelChipLabel')?.getComponent(Label) ?? null;
        this._homeXpProgressLabel = this._homeLevelChip?.getChildByName('HomeXpProgressLabel')?.getComponent(Label) ?? null;
        const xpTrack = this._homeLevelChip?.getChildByName('HomeXpBarTrack');
        this._homeXpBarFill = xpTrack?.getChildByName('HomeXpBarFill') ?? null;

        // 2026-04-26 lobby restructure: bind chip references for MatchStatus
        // + ChallengeSeason cards + training-card labels.
        this._bindHomeChips();

        // Stage 4K — streak flame. Container hidden until UserStats loads and
        // reports currentStreak > 0. `_updateStreakFlame` is idempotent.
        this._streakFlameContainer = this._homePanel.getChildByName('StreakFlameContainer') ?? null;
        if (this._streakFlameContainer) {
            const iconN = this._streakFlameContainer.getChildByName('StreakFlameIcon');
            if (iconN) IconLibrary.attach(iconN, 'flame', { size: 32 });
            this._streakFlameIconNode = iconN ?? null;
            this._streakCountLabel = this._streakFlameContainer.getChildByName('StreakCountLabel')?.getComponent(Label) ?? null;
        }

        // UX overhaul Phase 2: bind the procedural mascot. Add the controller
        // at runtime since the .ts file's UUID isn't baked into the scene.
        // 2026-04-26 lobby restructure: MascotContainer reparented inside
        // HomeTrainingCard; descendant-walk to find it.
        const mascotN = this._findDescendantByName(this._homePanel, 'MascotContainer');
        if (mascotN) {
            this._mascot = mascotN.getComponent(MascotController) ?? mascotN.addComponent(MascotController);
            console.log(`${TAG} start | mascot bound state=idle`);
        } else {
            console.log(`${TAG} start | MascotContainer not found — Phase 2 mascot disabled`);
        }

        // UX overhaul Phase 2b: attach IconBadges to every emoji-stripped scene
        // label/button. Called after panel bindings so descendants exist.
        // Badges render as procedural cc.Graphics shapes at first; the Phase 3
        // load below swaps them for real PNGs once resources finish loading.
        this._attachStaticIconBadges();
        // Phase 29 — Settings card row icons attach to pre-positioned children
        // (NOT IconBadge offset children). Must run after panel bindings.
        this._attachSettingsRowIcons();

        // UX overhaul Phase 3: load real PNG icons + mascot from
        // assets/demo/resources/{icons,mascot}/ and re-attach badges so they
        // render as cc.Sprite instead of procedural Graphics.
        // Phase 20: capture the promise so _gateColdStartLoad() can race it
        // against a timeout and gate Landing's reveal on full art.
        this._phase3LoadPromise = this._loadPhase3Art();

        // UX overhaul Phase 2d: tactile polish on the 4 primary CTAs — idle
        // pulse + press pop + stronger zoomScale. Applied AFTER panels are
        // bound so nodes exist.
        this._enhancePrimaryCTAs();
        // v2 Landing: override _zoomScale to 0.97 for landing CTAs so the
        // press feedback SHRINKS (industry-standard mobile idiom) instead of
        // growing. Other panels keep the grow-on-press behavior.
        this._setLandingPressScale();

        // Phase 16 — animation polish item 1: starfield twinkle. Picks 16 of
        // the 64 BackgroundFX stars and oscillates their UIOpacity so the
        // background reads as alive instead of painted.
        this._initStarfieldTwinkle();

        // Belt-and-suspenders: hide stale ReconnectHomeButton if the scene
        // JSON wasn't regenerated after generate-scenes.js removed it.
        const staleReconnect = this._homePanel.getChildByName('ReconnectHomeButton');
        if (staleReconnect) {
            staleReconnect.active = false;
            console.log(`${TAG} start | hid stale ReconnectHomeButton from scene (scene not yet regenerated)`);
        }

        for (let i = 0; i < homeBtnNames.length; i++) {
            const node = this._homePanel.getChildByName(homeBtnNames[i]);
            if (node) {
                const btn = node.getComponent(Button);
                if (btn) {
                    this._allHomeButtons.push(btn);
                    btn.node.on(Button.EventType.CLICK, homeHandlers[i], this);
                }
            }
        }

        // ── Token Duel panel: just the Back button for iteration 2 ──
        const tdBackNode = this._tokenDuelPanel.getChildByName('BackButton');
        const tdBack = tdBackNode?.getComponent(Button);
        if (tdBack) {
            tdBack.node.on(Button.EventType.CLICK, this._onTokenDuelBack, this);
            console.log(`${TAG} start | wired TokenDuel BackButton`);
        } else {
            console.log(`${TAG} start | WARN TokenDuel BackButton not found`);
        }

        // MWAManager events
        const mwa = MWAManager.instance;
        if (mwa) {
            mwa.node.on(MWA_STATUS, this._onStatus, this);
            mwa.node.on(MWA_DISCONNECTED, this._showLanding, this);
            // Phase N6 — subscribe to backend notification feed on wallet connect.
            mwa.node.on(MWA_AUTHORIZED, this._onMwaAuthorized, this);
            mwa.node.on(MWA_DISCONNECTED, this._onMwaDisconnected, this);
        }

        // Init RPC
        const identity = getAppIdentity();
        this._rpc = new SolanaRpc(
            identity.cluster === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com'
        );

        // Init Token Duel RPC + find holding labels / status.
        this._tdRpc = new TokenDuelRpc();
        const h1 = this._tokenDuelPanel.getChildByName('Holding1Label')?.getComponent(Label);
        const h2 = this._tokenDuelPanel.getChildByName('Holding2Label')?.getComponent(Label);
        const h3 = this._tokenDuelPanel.getChildByName('Holding3Label')?.getComponent(Label);
        this._holdingLabels = [h1, h2, h3].filter((l): l is Label => !!l);
        this._tokenDuelStatus = this._tokenDuelPanel.getChildByName('StatusLabel')?.getComponent(Label)!;
        console.log(`${TAG} start | TokenDuel wiring — holding_labels=${this._holdingLabels.length}/3 statusLabel=${!!this._tokenDuelStatus}`);

        // Stake flow buttons (Phase C)
        // Session 2: resolve commit button under either the new name
        // (StakeCommitButton) or the legacy name (SignStakeButton). After the
        // scene regen only the former exists; keeping the fallback means this
        // code keeps running even if the user rebuilds an old scene.
        const commitNode = this._tokenDuelPanel.getChildByName('StakeCommitButton')
            ?? this._tokenDuelPanel.getChildByName('SignStakeButton');
        this._stakeCommitButton = commitNode?.getComponent(Button)!;
        this._signStakeButton = this._stakeCommitButton; // legacy alias
        this._stakeCommitButton?.node.on(Button.EventType.CLICK, this._onCommitStake, this);
        // Hide any lingering BroadcastStakeButton from a stale scene — handler removed.
        const staleBroadcast = this._tokenDuelPanel.getChildByName('BroadcastStakeButton');
        if (staleBroadcast) {
            staleBroadcast.active = false;
            console.log(`${TAG} start | hid stale BroadcastStakeButton — flow is now single-tap signAndSend`);
        }
        console.log(`${TAG} start | TokenDuel commit button — wired=${!!this._stakeCommitButton} resolved_name=${commitNode?.name ?? '(none)'} stale_broadcast_hidden=${!!staleBroadcast}`);

        // Game loop wiring (Phase D): Start button, GameArea + HUD, BlockTemplate sprite, GameOverLabel.
        this._startGameButton = this._tokenDuelPanel.getChildByName('StartGameButton')?.getComponent(Button)!;
        this._startGameButton?.node.on(Button.EventType.CLICK, this._onStartGame, this);
        this._gameArea = this._tokenDuelPanel.getChildByName('GameArea')!;
        this._heightLabel = this._gameArea?.getChildByName('HeightLabel')?.getComponent(Label)!;
        this._tokenBadgeLabel = this._gameArea?.getChildByName('TokenBadgeLabel')?.getComponent(Label)!;
        this._blockTemplate = this._gameArea?.getChildByName('BlockTemplate')?.getComponent(Sprite)!;
        this._gameOverLabel = this._tokenDuelPanel.getChildByName('GameOverLabel')?.getComponent(Label)!;
        console.log(`${TAG} start | TokenDuel game wiring — start=${!!this._startGameButton} gameArea=${!!this._gameArea} height=${!!this._heightLabel} badge=${!!this._tokenBadgeLabel} blockTpl=${!!this._blockTemplate} gameOver=${!!this._gameOverLabel}`);

        // Tap-to-drop: forward GameArea touches to the active TokenDuelGame.
        this._gameArea?.on(Node.EventType.TOUCH_START, () => {
            if (this._game) this._game.onTap();
        }, this);

        // ── betting-duel Phase 3: RacePanel binding ──
        this._racePanel = this._tokenDuelPanel.getChildByName('RacePanel') ?? null;
        if (this._racePanel) {
            this._raceCountdownLabel     = this._racePanel.getChildByName('RaceCountdownLabel')?.getComponent(Label) ?? null;
            this._raceHeroDeltaLabel     = this._racePanel.getChildByName('RaceHeroDeltaLabel')?.getComponent(Label) ?? null;
            // Battle-UI polish: heroSubtitle removed in favor of compact top row.
            this._raceHeroSubtitleLabel  = null;
            this._racePlayerLevelChip    = this._racePanel.getChildByName('RacePlayerLevelChip') ?? null;
            this._racePlayerLevelLabel   = this._racePlayerLevelChip?.getChildByName('RacePlayerLevelChipLabel')?.getComponent(Label) ?? null;
            for (let i = 0; i < 5; i++) {
                const card = this._racePanel.getChildByName(`RaceTokenCard_${i}`);
                if (card) {
                    this._raceTokenCards.push(card);
                    this._raceTokenSymbolLabels.push(card.getChildByName(`TokenSymbolLabel_${i}`)?.getComponent(Label) as Label);
                    this._raceTokenEntryLabels.push(card.getChildByName(`TokenEntryLabel_${i}`)?.getComponent(Label) as Label);
                    this._raceTokenCurrentLabels.push(card.getChildByName(`TokenCurrentLabel_${i}`)?.getComponent(Label) as Label);
                    this._raceTokenDeltaLabels.push(card.getChildByName(`TokenDeltaLabel_${i}`)?.getComponent(Label) as Label);
                }
            }
            this._raceCancelButton = this._racePanel.getChildByName('RaceCancelButton')?.getComponent(Button) ?? null;
            this._raceCancelButton?.node.on(Button.EventType.CLICK, () => this._onRaceCancel(), this);
            // Stage 1A/C — radial timer ring + screen vignette (Graphics nodes).
            const ringNode = this._racePanel.getChildByName('RaceTimerRing');
            this._raceTimerRing = ringNode?.getComponent(Graphics) ?? null;
            this._raceTimerPulseNode = ringNode?.getChildByName('RaceTimerPulse') ?? null;
            this._raceTimerPulseGraphics = this._raceTimerPulseNode?.getComponent(Graphics) ?? null;
            this._screenVignetteNode = this._racePanel.getChildByName('ScreenVignette') ?? null;
            this._screenVignetteGraphics = this._screenVignetteNode?.getComponent(Graphics) ?? null;
            // Block 2 — opponent card (1v1 big card)
            this._raceOpponentCard = this._racePanel.getChildByName('RaceOpponentCard') ?? null;
            if (this._raceOpponentCard) {
                this._raceOpponentAvatar  = this._raceOpponentCard.getChildByName('OpponentAvatarLabel')?.getComponent(Label) ?? null;
                this._raceOpponentName    = this._raceOpponentCard.getChildByName('OpponentNameLabel')?.getComponent(Label) ?? null;
                this._raceOpponentSymbols = this._raceOpponentCard.getChildByName('OpponentSymbolsLabel')?.getComponent(Label) ?? null;
                this._raceOpponentDelta   = this._raceOpponentCard.getChildByName('OpponentDeltaLabel')?.getComponent(Label) ?? null;
                this._raceOpponentGap     = this._raceOpponentCard.getChildByName('OpponentGapLabel')?.getComponent(Label) ?? null;
            }
            // 4p / 8p Paper — N-bot leaderboard strip (7 rows pre-allocated).
            this._raceOpponentStrip = this._racePanel.getChildByName('RaceOpponentStrip') ?? null;
            if (this._raceOpponentStrip) {
                for (let i = 0; i < 7; i++) {
                    const row = this._raceOpponentStrip.getChildByName(`RaceOpponentRow_${i}`);
                    if (!row) continue;
                    this._raceOpponentRows.push(row);
                    this._raceOpponentRowNames.push(row.getChildByName('NameLabel')?.getComponent(Label) as Label);
                    this._raceOpponentRowSymbols.push(row.getChildByName('SymbolsLabel')?.getComponent(Label) as Label);
                    this._raceOpponentRowDeltas.push(row.getChildByName('DeltaLabel')?.getComponent(Label) as Label);
                    this._raceOpponentRowGaps.push(row.getChildByName('GapLabel')?.getComponent(Label) as Label);
                }
            }
            // Phase 22 — 1v1 duel-format surfaces. Battle-UI polish (2026-04-26):
            // PlayerIdentityCard dropped — replaced by RacePlayerLevelChip on top row.
            this._opponentIdentityCard = this._racePanel.getChildByName('OpponentIdentityCard') ?? null;
            if (this._opponentIdentityCard) {
                this._opponentIdentityName  = this._opponentIdentityCard.getChildByName('OpponentIdentityNameLabel')?.getComponent(Label) ?? null;
                this._opponentIdentityLevel = this._opponentIdentityCard.getChildByName('OpponentIdentityLevelLabel')?.getComponent(Label) ?? null;
            }
            this._playerTokenRow   = this._racePanel.getChildByName('PlayerTokenCardsRow')   ?? null;
            this._opponentTokenRow = this._racePanel.getChildByName('OpponentTokenCardsRow') ?? null;
            for (let i = 0; i < 3; i++) {
                const pCard = this._playerTokenRow?.getChildByName(`PlayerTokenCard_${i}`);
                if (pCard) {
                    this._playerDuelTokenCards.push(pCard);
                    const pSpr = pCard.getComponent(Sprite);
                    if (pSpr) this._playerDuelTokenSprites.push(pSpr);
                    this._playerDuelTokenSyms.push(pCard.getChildByName(`PlayerTokenSymLabel_${i}`)?.getComponent(Label) as Label);
                    this._playerDuelTokenDeltas.push(pCard.getChildByName(`PlayerTokenDeltaLabel_${i}`)?.getComponent(Label) as Label);
                    const pBar = pCard.getChildByName(`PlayerTokenContributionBar_${i}`)?.getComponent(Graphics);
                    if (pBar) this._playerDuelTokenBars.push(pBar);
                }
                const oCard = this._opponentTokenRow?.getChildByName(`OpponentTokenCard_${i}`);
                if (oCard) {
                    this._opponentDuelTokenCards.push(oCard);
                    const oSpr = oCard.getComponent(Sprite);
                    if (oSpr) this._opponentDuelTokenSprites.push(oSpr);
                    this._opponentDuelTokenSyms.push(oCard.getChildByName(`OpponentTokenSymLabel_${i}`)?.getComponent(Label) as Label);
                    this._opponentDuelTokenDeltas.push(oCard.getChildByName(`OpponentTokenDeltaLabel_${i}`)?.getComponent(Label) as Label);
                    const oBar = oCard.getChildByName(`OpponentTokenContributionBar_${i}`)?.getComponent(Graphics);
                    if (oBar) this._opponentDuelTokenBars.push(oBar);
                }
            }
            this._opponentHeroDeltaLabel    = this._racePanel.getChildByName('OpponentDeltaHeroLabel')?.getComponent(Label) ?? null;
            this._opponentSubtitleGapLabel  = this._racePanel.getChildByName('OpponentSubtitleGapLabel')?.getComponent(Label) ?? null;
            // Duel bar.
            this._duelBarContainer = this._racePanel.getChildByName('RaceDuelBarContainer') ?? null;
            if (this._duelBarContainer) {
                this._duelBarTrackGraphics       = this._duelBarContainer.getChildByName('DuelBarTrack')?.getComponent(Graphics) ?? null;
                this._duelBarFillGraphics        = this._duelBarContainer.getChildByName('DuelBarFill')?.getComponent(Graphics) ?? null;
                this._duelBarGlowGraphics        = this._duelBarContainer.getChildByName('DuelBarGlow')?.getComponent(Graphics) ?? null;
                this._duelBarCenterTickGraphics  = this._duelBarContainer.getChildByName('DuelBarCenterTick')?.getComponent(Graphics) ?? null;
                this._duelBarLeadingPpLabel      = this._duelBarContainer.getChildByName('DuelBarLeadingPpLabel')?.getComponent(Label) ?? null;
                this._duelBarOppTagLabel         = this._duelBarContainer.getChildByName('DuelBarOppTagLabel')?.getComponent(Label) ?? null;
            }
            // 2026-04-27 — Multi-player condensed grid + 7 card pool + back btn.
            this._raceMultiGrid = this._racePanel.getChildByName('RaceMultiOppGrid') ?? null;
            if (this._raceMultiGrid) {
                for (let i = 0; i < 7; i++) {
                    const card = this._raceMultiGrid.getChildByName(`MultiOppCard_${i}`);
                    if (!card) continue;
                    this._raceMultiCardNodes.push(card);
                    const rankL = card.getChildByName(`MultiOppRankChip_${i}`)?.getComponent(Label);
                    const nameL = card.getChildByName(`MultiOppName_${i}`)?.getComponent(Label);
                    const deltaL = card.getChildByName(`MultiOppDelta_${i}`)?.getComponent(Label);
                    const barS = card.getChildByName(`MultiOppPnlBar_${i}`)?.getComponent(Sprite);
                    if (rankL) this._raceMultiCardRankLabels.push(rankL);
                    if (nameL) this._raceMultiCardNameLabels.push(nameL);
                    if (deltaL) this._raceMultiCardDeltaLabels.push(deltaL);
                    if (barS) this._raceMultiCardPnlBars.push(barS);
                    const tap = card.getChildByName(`MultiOppCardTap_${i}`)?.getComponent(Button);
                    if (tap) {
                        this._raceMultiCardTapBtns.push(tap);
                        const idx = i;
                        tap.node.on(Button.EventType.CLICK, () => this._onMultiOppCardTap(idx), this);
                    }
                }
            }
            this._raceMultiBackBtn = this._racePanel.getChildByName('RaceMultiBackButton')?.getComponent(Button) ?? null;
            this._raceMultiBackBtn?.node.on(Button.EventType.CLICK, () => this._onMultiOppBackTap(), this);
            // 2026-04-27 — Home-from-race button (non-destructive escape).
            this._raceHomeButton = this._racePanel.getChildByName('RaceHomeButton')?.getComponent(Button) ?? null;
            this._raceHomeButton?.node.on(Button.EventType.CLICK, () => this._onRaceHomeTap(), this);
            // 2026-04-27 — Force-hide legacy 7-row opponent strip (replaced by MultiOppGrid).
            if (this._raceOpponentStrip) this._raceOpponentStrip.active = false;

            console.log(`${TAG} start | RacePanel wired cards=${this._raceTokenCards.length} countdown=${!!this._raceCountdownLabel} hero=${!!this._raceHeroDeltaLabel} cancel=${!!this._raceCancelButton} opp_card=${!!this._raceOpponentCard} opp_strip=${!!this._raceOpponentStrip} opp_rows=${this._raceOpponentRows.length}/7 duel_bar=${!!this._duelBarContainer} duel_player_cards=${this._playerDuelTokenCards.length} duel_opp_cards=${this._opponentDuelTokenCards.length} duel_player_chip=${!!this._racePlayerLevelChip} duel_opp_id=${!!this._opponentIdentityCard} multi_grid=${!!this._raceMultiGrid} multi_cards=${this._raceMultiCardNodes.length}/7 home_btn=${!!this._raceHomeButton}`);
        }

        // Phase E: Claim Payout button (revealed on game-over).
        this._claimButton = this._tokenDuelPanel.getChildByName('ClaimPayoutButton')?.getComponent(Button)!;
        this._claimButton?.node.on(Button.EventType.CLICK, this._onClaim, this);
        console.log(`${TAG} start | TokenDuel claim button — wired=${!!this._claimButton}`);

        // Phase F: hero-pick tiles (wallet-gated by sign_messages support).
        for (let i = 1; i <= 3; i++) {
            const node = this._tokenDuelPanel.getChildByName(`HeroTile${i}Button`);
            const btn = node?.getComponent(Button);
            const lbl = node?.getChildByName('Label')?.getComponent(Label);
            if (btn && lbl) {
                this._heroTileButtons.push(btn);
                this._heroTileLabels.push(lbl);
                const idx = i - 1;
                btn.node.on(Button.EventType.CLICK, () => this._onHeroTileClick(idx), this);
            }
        }
        console.log(`${TAG} start | TokenDuel hero tiles — wired=${this._heroTileButtons.length}/3`);

        // ── Session 2 — Phase III wiring: balance chip, feed tabs, feed rows,
        //    squad slots, stake chips. Any missing child is tolerated (scene
        //    regen drift); AppUI simply skips features whose nodes aren't there.
        // BalanceChipLabel now lives inside PlayerStatusPill > BalanceChip.
        const balanceNode = this._findDescendantByName(this._tokenDuelPanel, 'BalanceChipLabel');
        this._balanceChipLabel = balanceNode?.getComponent(Label) ?? null;

        // Session 11: dropdown replaces the 4 inline tab buttons. 6 options,
        // each a child of FeedTabDropdownPopover (hidden by default).
        const tabDropdownNode = this._tokenDuelPanel.getChildByName('FeedTabDropdownButton');
        this._feedTabDropdownButton = tabDropdownNode?.getComponent(Button) ?? null;
        this._feedTabDropdownLabel = tabDropdownNode?.getChildByName('Label')?.getComponent(Label) ?? null;
        if (this._feedTabDropdownButton) {
            this._feedTabDropdownButton.node.on(Button.EventType.CLICK, () => this._onFeedTabDropdownClick(), this);
        }
        this._feedTabDropdownPopover = this._tokenDuelPanel.getChildByName('FeedTabDropdownPopover') ?? null;
        const popOptDefs: Array<{ name: string; tab: FeedTabOrVirtual }> = [
            { name: 'FeedTabOption_new',       tab: 'new'         },
            { name: 'FeedTabOption_trending',  tab: 'trending'    },
            { name: 'FeedTabOption_gainers',   tab: 'gainers'     },
            { name: 'FeedTabOption_volume',    tab: 'trending'    }, // volume is a solpulse-style synonym for trending-by-vol — map to trending for v1
            { name: 'FeedTabOption_smart',     tab: 'smart_money' },
            { name: 'FeedTabOption_watchlist', tab: 'watchlist'   },
        ];
        let feedTabsWired = 0;
        for (const def of popOptDefs) {
            const optNode = this._feedTabDropdownPopover?.getChildByName(def.name);
            const optBtn = optNode?.getComponent(Button);
            if (optBtn) {
                this._feedTabOptionButtons.set(def.tab, optBtn);
                optBtn.node.on(Button.EventType.CLICK, () => this._onFeedTabOptionClick(def.tab), this);
                feedTabsWired++;
            } else {
                console.log(`${TAG} start | WARN dropdown option missing name=${def.name}`);
            }
        }
        console.log(`${TAG} start | TokenDuel feed_tab_dropdown button=${!!this._feedTabDropdownButton} popover=${!!this._feedTabDropdownPopover} options=${feedTabsWired}/6`);

        // Live indicator label (decorative, no handler).
        this._liveIndicatorLabel = this._tokenDuelPanel.getChildByName('LiveIndicatorLabel')?.getComponent(Label) ?? null;

        // Watchlist star button (header) — toggles all squad tokens in/out of watchlist.
        const watchStarNode = this._tokenDuelPanel.getChildByName('WatchlistStarButton');
        this._watchlistStarButton = watchStarNode?.getComponent(Button) ?? null;
        this._watchlistStarLabel = watchStarNode?.getChildByName('Label')?.getComponent(Label) ?? null;
        if (this._watchlistStarButton) {
            this._watchlistStarButton.node.on(Button.EventType.CLICK, () => this._onWatchlistStarClick(), this);
        }
        console.log(`${TAG} start | TokenDuel watchlist_star wired=${!!this._watchlistStarButton}`);

        // Filter chip row — 2 chips ([Newest] [Liquidity ▾]) emitted by the
        // feedFilterChip template. Liq↓ + Liq↑ collapsed into a 'liq' chip
        // that opens LiqSortDropdownPopover (created in scene-gen). The
        // 'liq_desc'/'liq_asc' keys remain in FilterChipKey because
        // _onFilterChipClick still dispatches to them when a popover row is
        // selected — the chip just changes its trigger.
        const filterChipDefs: Array<{ name: string; key: FilterChipKey }> = [
            { name: 'FilterChip_newest', key: 'newest' },
            { name: 'FilterChip_liq',    key: 'liq'    },
        ];
        let chipsWired = 0;
        for (const def of filterChipDefs) {
            const cNode = this._tokenDuelPanel.getChildByName(def.name);
            const cBtn = cNode?.getComponent(Button);
            if (cBtn) {
                this._filterChipButtons.set(def.key, cBtn);
                cBtn.node.on(Button.EventType.CLICK, () => this._onFilterChipClick(def.key), this);
                chipsWired++;
            }
        }
        const columnsBtnNode = this._tokenDuelPanel.getChildByName('ColumnsButton');
        this._columnsButton = columnsBtnNode?.getComponent(Button) ?? null;
        if (this._columnsButton) {
            this._columnsButton.node.on(Button.EventType.CLICK, () => this._onColumnsButtonClick(), this);
        }
        console.log(`${TAG} start | TokenDuel filter_chips wired=${chipsWired}/2 columns_btn=${!!this._columnsButton}`);

        // Feed rows live inside the ScrollView's content node.
        const feedSvNode = this._tokenDuelPanel.getChildByName('FeedScrollView');
        this._feedScrollView = feedSvNode?.getComponent(ScrollView) ?? null;
        // content is nested under 'view' (see mkScrollView layout) — locate both.
        const viewNode = feedSvNode?.getChildByName('view');
        this._feedContent = viewNode?.getChildByName('content') ?? null;
        const rowsHost = this._feedContent ?? this._tokenDuelPanel;
        let rowsMissingCols = 0;
        for (let i = 0; i < FEED_ROW_LIMIT; i++) {
            const rowNode = rowsHost.getChildByName(`FeedRow_${i}`);
            if (!rowNode) continue;
            const btn = rowNode.getComponent(Button);
            const spr = rowNode.getComponent(Sprite);
            const logoSpr = rowNode.getChildByName('LogoSprite')?.getComponent(Sprite);
            const symL = rowNode.getChildByName('SymbolLabel')?.getComponent(Label);
            const dltL = rowNode.getChildByName('DeltaLabel')?.getComponent(Label);
            if (!btn || !spr || !symL || !dltL) {
                console.log(`${TAG} start | WARN FeedRow_${i} missing children btn=${!!btn} spr=${!!spr} sym=${!!symL} delta=${!!dltL} logo=${!!logoSpr}`);
                continue;
            }
            this._feedRowNodes.push(rowNode);
            this._feedRowButtons.push(btn);
            this._feedRowSprites.push(spr);
            this._feedRowLogoSprites.push(logoSpr!);
            this._feedRowSymbolLabels.push(symL);
            this._feedRowDeltaLabels.push(dltL);

            // Session 11: extended column labels. Missing is tolerated (older scene
            // builds don't have them) but logged so we know why new columns show '—'.
            const nameL  = rowNode.getChildByName('NameLabel')?.getComponent(Label) ?? null;
            const scoreL = rowNode.getChildByName('ScoreLabel')?.getComponent(Label) ?? null;
            const liqL   = rowNode.getChildByName('LiqLabel')?.getComponent(Label) ?? null;
            const volL   = rowNode.getChildByName('VolLabel')?.getComponent(Label) ?? null;
            const changeL = rowNode.getChildByName('ChangeLabel')?.getComponent(Label) ?? dltL; // fall back to delta alias
            const priceL = rowNode.getChildByName('PriceLabel')?.getComponent(Label) ?? null;
            const dexL   = rowNode.getChildByName('DexLabel')?.getComponent(Label) ?? null;
            const ageL   = rowNode.getChildByName('AgeLabel')?.getComponent(Label) ?? null;
            const liveN  = rowNode.getChildByName('LiveDot') ?? null;
            this._feedRowNameLabels.push(nameL!);
            this._feedRowScoreLabels.push(scoreL!);
            this._feedRowLiqLabels.push(liqL!);
            this._feedRowVolLabels.push(volL!);
            this._feedRowChangeLabels.push(changeL);
            this._feedRowPriceLabels.push(priceL!);
            this._feedRowDexLabels.push(dexL!);
            this._feedRowAgeLabels.push(ageL!);
            this._feedRowLiveDots.push(liveN!);
            if (!nameL || !scoreL || !liqL || !volL || !priceL || !dexL || !ageL) rowsMissingCols++;

            const idx = i;
            btn.node.on(Button.EventType.CLICK, () => this._onFeedRowTap(idx), this);
        }
        console.log(`${TAG} start | TokenDuel row_extended_cols rows=${this._feedRowNodes.length} missing_cols_on=${rowsMissingCols} (0 = all new columns found)`);

        // Phase 17 (item 2) — wire tap-down glow on each FeedRow. Must run
        // AFTER the FeedRow node array is populated (above). Adds TOUCH_START/
        // END/CANCEL handlers alongside the existing Button CLICK handler.
        this._initFeedRowTactile();

        // Session 11: Search suggestion popover — 5 pre-instantiated rows.
        this._searchPopoverNode = this._tokenDuelPanel.getChildByName('SearchSuggestionPopover') ?? null;
        if (this._searchPopoverNode) {
            for (let s = 0; s < 5; s++) {
                const sNode = this._searchPopoverNode.getChildByName(`Suggest_${s}`);
                if (!sNode) { console.log(`${TAG} start | WARN Suggest_${s} missing`); continue; }
                const sBtn = sNode.getComponent(Button);
                const sLogo = sNode.getChildByName('LogoSprite')?.getComponent(Sprite) ?? null;
                const sSym  = sNode.getChildByName('SymbolLabel')?.getComponent(Label) ?? null;
                const sMint = sNode.getChildByName('MintLabel')?.getComponent(Label) ?? null;
                const sPrc  = sNode.getChildByName('PriceLabel')?.getComponent(Label) ?? null;
                const sVol  = sNode.getChildByName('VolLabel')?.getComponent(Label) ?? null;
                const sChg  = sNode.getChildByName('ChangeLabel')?.getComponent(Label) ?? null;
                this._searchSuggestNodes.push(sNode);
                this._searchSuggestLogos.push(sLogo!);
                this._searchSuggestSymbols.push(sSym!);
                this._searchSuggestMints.push(sMint!);
                this._searchSuggestPrices.push(sPrc!);
                this._searchSuggestVols.push(sVol!);
                this._searchSuggestChanges.push(sChg!);
                if (sBtn) {
                    const idx = s;
                    sBtn.node.on(Button.EventType.CLICK, () => this._onSearchSuggestTap(idx), this);
                }
            }
        }
        console.log(`${TAG} start | TokenDuel search_popover wired=${!!this._searchPopoverNode} rows=${this._searchSuggestNodes.length}/5`);

        // Session 13 A1: MinLiq dropdown wiring.
        const minLiqNode = this._tokenDuelPanel.getChildByName('MinLiqDropdownButton');
        this._minLiqDropdownButton = minLiqNode?.getComponent(Button) ?? null;
        this._minLiqDropdownLabel = minLiqNode?.getChildByName('Label')?.getComponent(Label) ?? null;
        if (this._minLiqDropdownButton) {
            this._minLiqDropdownButton.node.on(Button.EventType.CLICK, () => this._onMinLiqDropdownClick(), this);
        }
        this._minLiqPopoverNode = this._tokenDuelPanel.getChildByName('MinLiqDropdownPopover') ?? null;
        const minLiqOptDefs: Array<{ name: string; key: string; val: number }> = [
            { name: 'MinLiqOption_all', key: 'all', val: 0 },
            { name: 'MinLiqOption_1k',  key: '1k',  val: 1000 },
            { name: 'MinLiqOption_5k',  key: '5k',  val: 5000 },
            { name: 'MinLiqOption_10k', key: '10k', val: 10000 },
        ];
        for (const d of minLiqOptDefs) {
            const optN = this._minLiqPopoverNode?.getChildByName(d.name);
            const optB = optN?.getComponent(Button);
            if (optB) {
                this._minLiqOptionButtons.set(d.key, optB);
                optB.node.on(Button.EventType.CLICK, () => this._onMinLiqOptionClick(d.key, d.val), this);
            }
        }
        console.log(`${TAG} start | TokenDuel min_liq_dropdown button=${!!this._minLiqDropdownButton} options=${this._minLiqOptionButtons.size}/4`);

        // LiqSort dropdown wiring (2 options: liq_desc / liq_asc).
        // Trigger is the FilterChip_liq button (already wired above via filterChipDefs).
        this._liqSortPopoverNode = this._tokenDuelPanel.getChildByName('LiqSortDropdownPopover') ?? null;
        const liqSortOptDefs: Array<{ name: string; key: 'desc' | 'asc' }> = [
            { name: 'LiqSortOption_liq_desc', key: 'desc' },
            { name: 'LiqSortOption_liq_asc',  key: 'asc'  },
        ];
        for (const d of liqSortOptDefs) {
            const optN = this._liqSortPopoverNode?.getChildByName(d.name);
            const optB = optN?.getComponent(Button);
            if (optB) {
                this._liqSortOptionButtons.set(d.key, optB);
                optB.node.on(Button.EventType.CLICK, () => this._onLiqSortOptionClick(d.key), this);
            }
        }
        console.log(`${TAG} start | TokenDuel liq_sort_dropdown popover=${!!this._liqSortPopoverNode} options=${this._liqSortOptionButtons.size}/2`);

        // Session 13 A3: Columns popover wiring.
        this._columnsPopoverNode = this._tokenDuelPanel.getChildByName('ColumnsPopover') ?? null;
        const colKeys = ['score', 'liq', 'vol', 'change', 'age', 'mc', 'fdv', 'price', 'holders', 'source'];
        for (const k of colKeys) {
            const tN = this._columnsPopoverNode?.getChildByName(`ColToggle_${k}`);
            const tB = tN?.getComponent(Button);
            const tL = tN?.getChildByName('Label')?.getComponent(Label) ?? null;
            if (tB) {
                this._colToggleButtons.set(k, tB);
                if (tL) this._colToggleLabels.set(k, tL);
                tB.node.on(Button.EventType.CLICK, () => this._onColumnToggleClick(k), this);
            }
        }
        console.log(`${TAG} start | TokenDuel columns_popover wired=${!!this._columnsPopoverNode} toggles=${this._colToggleButtons.size}/10`);

        // Session 13 A6: watchlist cancel button (hidden outside multi-select mode).
        const wCancelNode = this._tokenDuelPanel.getChildByName('CancelWatchlistButton');
        this._watchlistCancelButton = wCancelNode?.getComponent(Button) ?? null;
        if (this._watchlistCancelButton) {
            this._watchlistCancelButton.node.on(Button.EventType.CLICK, () => this._onWatchlistCancelClick(), this);
        }
        console.log(`${TAG} start | TokenDuel watchlist_cancel wired=${!!this._watchlistCancelButton}`);

        // Session 13 per-row extensions: CheckboxSprite + SelectedEdge (already
        // instantiated by generate-scenes.js; collected here for runtime toggling).
        for (const rowNode of this._feedRowNodes) {
            const chkN = rowNode.getChildByName('CheckboxSprite');
            const selEdgeN = rowNode.getChildByName('SelectedEdge');
            this._feedRowCheckboxes.push(chkN?.getComponent(Sprite) ?? null as any);
            this._feedRowSelectedEdges.push(selEdgeN ?? null as any);
        }
        console.log(`${TAG} start | TokenDuel row_extras checkboxes=${this._feedRowCheckboxes.filter(Boolean).length}/${this._feedRowNodes.length} selected_edges=${this._feedRowSelectedEdges.filter(Boolean).length}/${this._feedRowNodes.length}`);

        // Session 13 Phase B: TokenDetailPanel bindings.
        this._tokenDetailPanel = (this.node.getChildByName('TokenDetailPanel') ?? this.node.parent?.getChildByName('TokenDetailPanel')) ?? null;
        if (this._tokenDetailPanel) {
            this._detailSymbolLabel = this._tokenDetailPanel.getChildByName('DetailSymbolLabel')?.getComponent(Label) ?? null;
            this._detailNameLabel = this._tokenDetailPanel.getChildByName('DetailNameLabel')?.getComponent(Label) ?? null;
            const mintChipNode = this._tokenDetailPanel.getChildByName('DetailMintChip');
            this._detailMintChipLabel = mintChipNode?.getChildByName('Label')?.getComponent(Label) ?? null;
            mintChipNode?.getComponent(Button)?.node.on(Button.EventType.CLICK, () => this._onDetailMintChipClick(), this);
            const pickN = this._tokenDetailPanel.getChildByName('DetailPickUnpickButton');
            this._detailPickUnpickButton = pickN?.getComponent(Button) ?? null;
            this._detailPickUnpickLabel = pickN?.getChildByName('Label')?.getComponent(Label) ?? null;
            this._detailPickUnpickButton?.node.on(Button.EventType.CLICK, () => this._onDetailPickUnpickClick(), this);
            const detBackNode = this._tokenDetailPanel.getChildByName('BackButton');
            this._detailBackButton = detBackNode?.getComponent(Button) ?? null;
            this._detailBackButton?.node.on(Button.EventType.CLICK, () => this._onDetailBackClick(), this);
            // Chart
            const chartNode = this._tokenDetailPanel.getChildByName('ChartArea');
            this._detailChartGraphics = chartNode?.getComponent(Graphics) ?? null;
            this._detailChartStatusLabel = chartNode?.getChildByName('ChartStatusLabel')?.getComponent(Label) ?? null;
            // Timeframe buttons.
            for (const tf of ['1m', '5m', '15m', '1H', '4H', '1D'] as OhlcvType[]) {
                const tfN = this._tokenDetailPanel.getChildByName(`TF_${tf}`);
                const tfB = tfN?.getComponent(Button);
                if (tfB) {
                    this._detailTimeframeButtons.set(tf, tfB);
                    tfB.node.on(Button.EventType.CLICK, () => this._onDetailTimeframeClick(tf), this);
                }
            }
            // Denom buttons.
            for (const key of ['price', 'mcap', 'usd', 'sol']) {
                const dN = this._tokenDetailPanel.getChildByName(`Denom_${key}`);
                const dB = dN?.getComponent(Button);
                if (dB) {
                    this._detailDenomButtons.set(key, dB);
                    dB.node.on(Button.EventType.CLICK, () => this._onDetailDenomClick(key as any), this);
                }
            }
            // Safety chips.
            for (const key of ['mint', 'auth', 'lp', 'top10']) {
                const sN = this._tokenDetailPanel.getChildByName(`SafetyChip_${key}`);
                const sL = sN?.getChildByName('Label')?.getComponent(Label) ?? null;
                if (sL) this._detailSafetyChipLabels.set(key, sL);
            }
            // Stat cards.
            for (const key of ['price', 'liq', 'mcap', 'vol24h', 'change', 'holders']) {
                const cN = this._tokenDetailPanel.getChildByName(`StatCard_${key}`);
                const vL = cN?.getChildByName('Value')?.getComponent(Label) ?? null;
                if (vL) this._detailStatValueLabels.set(key, vL);
            }
            this._detailStatusLabel = this._tokenDetailPanel.getChildByName('DetailStatusLabel')?.getComponent(Label) ?? null;
        }
        console.log(`${TAG} start | TokenDetailPanel wired=${!!this._tokenDetailPanel} chart=${!!this._detailChartGraphics} tfs=${this._detailTimeframeButtons.size}/6 denoms=${this._detailDenomButtons.size}/4 safety=${this._detailSafetyChipLabels.size}/4 stats=${this._detailStatValueLabels.size}/6`);

        // Session 14 A4: Backdrop tap-outside handler.
        this._backdropNode = this._tokenDuelPanel.getChildByName('BackdropButton') ?? null;
        this._backdropButton = this._backdropNode?.getComponent(Button) ?? null;
        if (this._backdropButton) {
            this._backdropButton.node.on(Button.EventType.CLICK, () => this._onBackdropTap(), this);
        }

        // 2026-04-27 — Row-tap popover (Pick + / View Chart) bindings.
        this._rowActionPopover = this._tokenDuelPanel.getChildByName('RowActionPopover') ?? null;
        this._rowActionPickBtn = this._rowActionPopover?.getChildByName('RowActionPickButton')?.getComponent(Button) ?? null;
        this._rowActionChartBtn = this._rowActionPopover?.getChildByName('RowActionChartButton')?.getComponent(Button) ?? null;
        this._rowActionPickBtn?.node.on(Button.EventType.CLICK, () => this._onRowActionPick(), this);
        this._rowActionChartBtn?.node.on(Button.EventType.CLICK, () => this._onRowActionChart(), this);

        // 2026-04-26 — Global Pick / Manage Squad bindings REMOVED.
        // Each empty squad slot now shows "Pick +" and acts as the pick
        // affordance (see _onSquadSlotTap → _pickTargetSlot). The per-slot
        // RemoveButton (×) replaces the Manage Squad modal. Field
        // declarations (_squadPickButton, _squadDropButton, etc.) stay in
        // place; downstream null-guarded references in
        // _refreshSquadActionButtons no-op safely. Legacy multi-pick code
        // (_squadPickMode, _squadPickChecked, _onSquadPickClick) is
        // unreferenced from UI but kept for back-compat.

        // Session 14 B3: Drop overlay.
        this._squadDropOverlay = this._tokenDuelPanel.getChildByName('SquadDropOverlay') ?? null;
        this._squadDropOverlayBackdrop = this._squadDropOverlay?.getComponent(Button) ?? null;
        this._squadDropOverlayBackdrop?.node.on(Button.EventType.CLICK, () => this._onSquadDropOverlayDismiss(), this);
        if (this._squadDropOverlay) {
            for (let d = 0; d < 3; d++) {
                const pN = this._squadDropOverlay.getChildByName(`DropPill_${d}`);
                const pB = pN?.getComponent(Button);
                const pL = pN?.getChildByName('Label')?.getComponent(Label);
                if (pB && pL) {
                    this._squadDropPills.push(pB);
                    this._squadDropPillLabels.push(pL);
                    const idx = d;
                    pB.node.on(Button.EventType.CLICK, () => this._onSquadDropPillClick(idx), this);
                }
            }
        }
        console.log(`${TAG} start | TokenDuel squad_actions drop=${!!this._squadDropButton} drop_overlay=${!!this._squadDropOverlay} pills=${this._squadDropPills.length}/3`);

        // Phase N4: trophy on Home opens the merged Portfolio+Leaderboard hub
        // (defaults to Portfolio tab). Disconnect button replaces the old
        // user-icon Portfolio shortcut and sits to the left of the trophy.
        const lbOpenNode = this._homePanel.getChildByName('OpenLeaderboardButton');
        this._openLeaderboardButton = lbOpenNode?.getComponent(Button) ?? null;
        this._openLeaderboardButton?.node.on(Button.EventType.CLICK, () => this._onOpenHub(), this);
        const disconnectNode = this._homePanel.getChildByName('DisconnectButton');
        this._disconnectHomeButton = disconnectNode?.getComponent(Button) ?? null;
        this._disconnectHomeButton?.node.on(Button.EventType.CLICK, () => this._onDisconnectFromHome(), this);

        // Part 10 Bundle 2: Presets (📚) + Suggest (💡) top-bar icons.
        const presetsBtn = this._tokenDuelPanel.getChildByName('OpenSquadPresetsButton')?.getComponent(Button);
        presetsBtn?.node.on(Button.EventType.CLICK, () => this._onOpenSquadPresets(), this);
        const suggestBtn = this._tokenDuelPanel.getChildByName('SuggestSquadButton')?.getComponent(Button);
        suggestBtn?.node.on(Button.EventType.CLICK, () => this._onSuggestSquad(), this);
        // betting-duel polish: `?` replays the first-run tutorial on demand.
        const helpBtn = this._tokenDuelPanel.getChildByName('HelpButton')?.getComponent(Button);
        helpBtn?.node.on(Button.EventType.CLICK, () => this._showTutorial(), this);

        this._leaderboardPanel = this.node.getChildByName('LeaderboardPanel') ?? null;
        if (this._leaderboardPanel) {
            const lbBack = this._leaderboardPanel.getChildByName('BackButton')?.getComponent(Button);
            lbBack?.node.on(Button.EventType.CLICK, () => this._onLeaderboardBackClick(), this);
            // Rows hold ranks 2..10 (LBRow_1..LBRow_9). Rank-1 is rendered into
            // TopPlayerCard separately so the leader visually pops.
            for (let r = 1; r <= 9; r++) {
                const rN = this._leaderboardPanel.getChildByName(`LBRow_${r}`);
                if (rN) this._lbRowNodes.push(rN);
            }
            // 4 mode tabs (segmented control) at y=590 + standalone season chip
            // (LBTab_season) — moved to its own row at y=534 so all five fit on
            // the canvas without overflowing the right edge.
            const tabKeys: { key: string; modeU8: number }[] = [
                { key: '1v1', modeU8: 0 },
                { key: 'trio', modeU8: 1 },
                { key: '4p',  modeU8: 2 },
                { key: '8p',  modeU8: 3 },
                { key: 'season', modeU8: 4 },
            ];
            for (const t of tabKeys) {
                const btnN = this._leaderboardPanel.getChildByName(`LBTab_${t.key}`);
                const btn = btnN?.getComponent(Button);
                if (btn) {
                    this._lbTabButtons.set(t.key, btn);
                    btn.node.on(Button.EventType.CLICK, () => this._onLeaderboardTabClick(t.modeU8, t.key), this);
                }
                if (t.key === 'season' && btnN) {
                    btnN.setPosition(new Vec3(0, 534, 0));
                }
            }
            // Empty-state CTA → close leaderboard, open FindMatchPanel.
            const emptyCta = this._leaderboardPanel.getChildByName('EmptyStateGroup')
                ?.getChildByName('EmptyStartMatchButton')?.getComponent(Button);
            emptyCta?.node.on(Button.EventType.CLICK, () => this._onLeaderboardCTAToFindMatch(), this);
            // PersonalRankCard CTA — same destination, only visible when not in top-10.
            const playCta = this._leaderboardPanel.getChildByName('PersonalRankCard')
                ?.getChildByName('PlayCTAButton')?.getComponent(Button);
            playCta?.node.on(Button.EventType.CLICK, () => this._onLeaderboardCTAToFindMatch(), this);
            // Phase N4: build hub-tab strip (Portfolio | Leaderboard) at top.
            const lbHub = this._buildHubTabs(this._leaderboardPanel);
            this._lbHubPortfolioTab = lbHub.portfolio;
            this._lbHubLeaderboardTab = lbHub.leaderboard;
        }

        // Part 10 pt2: DailyChallengePanel bindings.
        this._dailyChallengePanel = this.node.getChildByName('DailyChallengePanel') ?? null;
        if (this._dailyChallengePanel) {
            const dcBack = this._dailyChallengePanel.getChildByName('BackButton')?.getComponent(Button);
            dcBack?.node.on(Button.EventType.CLICK, () => this._onDailyChallengeBackClick(), this);
        }

        // Part 10 pt2: SquadPresetsOverlay bindings (inside TokenDuelPanel).
        this._squadPresetsOverlay = this._tokenDuelPanel.getChildByName('SquadPresetsOverlay') ?? null;
        if (this._squadPresetsOverlay) {
            const scrim = this._squadPresetsOverlay.getChildByName('PresetsScrim')?.getComponent(Button);
            scrim?.node.on(Button.EventType.CLICK, () => this._onPresetsClose(), this);
            for (let i = 0; i < 5; i++) {
                const rN = this._squadPresetsOverlay.getChildByName(`PresetRow_${i}`);
                if (rN) {
                    this._presetRowNodes.push(rN);
                    const rBtn = rN.getComponent(Button);
                    const idx = i;
                    rBtn?.node.on(Button.EventType.CLICK, () => this._onPresetRowTap(idx), this);
                    const delBtn = rN.getChildByName(`PresetDeleteButton_${i}`)?.getComponent(Button);
                    delBtn?.node.on(Button.EventType.CLICK, () => this._onPresetDeleteTap(idx), this);
                }
            }
            const saveBtn = this._squadPresetsOverlay.getChildByName('PresetSaveButton')?.getComponent(Button);
            saveBtn?.node.on(Button.EventType.CLICK, () => this._onPresetSavePrompt(), this);
            this._presetNameModal = this._squadPresetsOverlay.getChildByName('PresetNameModal') ?? null;
            this._presetNameEditBox = this._presetNameModal?.getChildByName('PresetNameEditBox')?.getComponent(EditBox) ?? null;
            const confirmBtn = this._presetNameModal?.getChildByName('PresetSaveConfirmButton')?.getComponent(Button);
            confirmBtn?.node.on(Button.EventType.CLICK, () => this._onPresetSaveConfirm(), this);
            const cancelBtn = this._presetNameModal?.getChildByName('PresetSaveCancelButton')?.getComponent(Button);
            cancelBtn?.node.on(Button.EventType.CLICK, () => this._onPresetSaveCancel(), this);
        }

        // Phase 28: TutorialOverlay bindings (4 themed cards + glows + mascots).
        this._tutorialOverlay = this.node.getChildByName('TutorialOverlay') ?? null;
        if (this._tutorialOverlay) {
            for (let i = 0; i < 4; i++) {
                const card = this._tutorialOverlay.getChildByName(`TutorialCard_${i}`);
                const glow = this._tutorialOverlay.getChildByName(`TutorialCardGlow_${i}`);
                if (card) this._tutorialCards.push(card);
                if (glow) this._tutorialGlows.push(glow);
                // Add MascotController to each card's mascot slot.
                const mascN = card?.getChildByName(`TutorialCard_${i}_Mascot`);
                if (mascN) {
                    const m = mascN.getComponent(MascotController) ?? mascN.addComponent(MascotController);
                    this._tutorialMascots.push(m);
                } else {
                    this._tutorialMascots.push(null);
                }
            }
            const scrimBtn = this._tutorialOverlay.getComponent(Button);
            scrimBtn?.node.on(Button.EventType.CLICK, () => this._onTutorialTap(), this);
        }

        // Session D Part 8: Settings panel bindings.
        this._settingsPanel = this.node.getChildByName('SettingsPanel') ?? null;
        if (this._settingsPanel) {
            const stBack = this._settingsPanel.getChildByName('BackButton')?.getComponent(Button);
            stBack?.node.on(Button.EventType.CLICK, () => this._onSettingsBackClick(), this);
            const walletCard = this._settingsPanel.getChildByName('WalletCard');
            this._settingsWalletNameLabel = walletCard?.getChildByName('WalletNameLabel')?.getComponent(Label) ?? null;
            this._settingsWalletPubkeyLabel = walletCard?.getChildByName('WalletPubkeyLabel')?.getComponent(Label) ?? null;
            this._settingsWalletBalanceLabel = walletCard?.getChildByName('WalletBalanceLabel')?.getComponent(Label) ?? null;
            // Phase 29 — copy-to-clipboard button next to truncated pubkey.
            const copyPubkeyBtn = walletCard?.getChildByName('CopyPubkeyButton')?.getComponent(Button);
            copyPubkeyBtn?.node.on(Button.EventType.CLICK, () => this._onCopyPubkey(), this);
            const profileCard = this._settingsPanel.getChildByName('ProfileCard');
            this._settingsUsernameEditBox = profileCard?.getChildByName('UsernameEditBox')?.getComponent(EditBox) ?? null;
            this._settingsUsernameSavedLabel = profileCard?.getChildByName('UsernameSaveLabel')?.getComponent(Label) ?? null;
            this._settingsStatusLabel = this._settingsPanel.getChildByName('SettingsStatusLabel')?.getComponent(Label) ?? null;

            if (this._settingsUsernameEditBox) {
                // Cocos 3.8 emits EditBox events under both kebab + camelCase
                // forms across point releases — register both so neither build
                // surprises us.
                this._bindEvent(this._settingsUsernameEditBox.node, ['editing-did-ended', 'editingDidEnded'], this._onUsernameCommit, 'username_commit');
                this._bindEvent(this._settingsUsernameEditBox.node, ['editing-return', 'editingReturn'], this._onUsernameCommit, 'username_return');
                this._bindEvent(this._settingsUsernameEditBox.node, ['text-changed', 'textChanged'], this._onUsernameTyping, 'username_typing');
                // Phase 30 — fade the violet focus ring in on focus, out on blur.
                const focusRing = profileCard?.getChildByName('UsernameFocusRing');
                const ringOpacity = focusRing?.getComponent(UIOpacity);
                if (ringOpacity) {
                    const fadeRing = (toAlpha: number) => {
                        Tween.stopAllByTarget(ringOpacity);
                        tween(ringOpacity).to(0.18, { opacity: toAlpha }, { easing: 'sineOut' }).start();
                    };
                    this._bindEvent(this._settingsUsernameEditBox.node, ['editing-did-began', 'editingDidBegan'], () => fadeRing(80), 'username_focus');
                    this._bindEvent(this._settingsUsernameEditBox.node, ['editing-did-ended', 'editingDidEnded'], () => fadeRing(0), 'username_blur');
                }
            }
            // Phase 29 — Fees / Reconnect / Disconnect now nest inside AccountSettingsCard.
            const accountCard = this._settingsPanel.getChildByName('AccountSettingsCard');
            const reconnBtn = accountCard?.getChildByName('ReconnectSettingsButton')?.getComponent(Button);
            reconnBtn?.node.on(Button.EventType.CLICK, () => this._onReconnect(), this);
            const disconnBtn = accountCard?.getChildByName('DisconnectSettingsButton')?.getComponent(Button);
            disconnBtn?.node.on(Button.EventType.CLICK, () => this._onDisconnect(), this);
            const delBtn = this._settingsPanel.getChildByName('DeleteAccountSettingsButton')?.getComponent(Button);
            delBtn?.node.on(Button.EventType.CLICK, () => this._onDelete(), this);

            // Part 13 D: Fee schedule link. Opens /fees page externally.
            const feesBtn = accountCard?.getChildByName('FeesLinkButton')?.getComponent(Button);
            feesBtn?.node.on(Button.EventType.CLICK, () => this._onOpenFees(), this);

            // Phase 30 — press-pop scale flash on every chevron / dropdown row.
            if (feesBtn) addPressPop(feesBtn);
            if (reconnBtn) addPressPop(reconnBtn);
            if (disconnBtn) addPressPop(disconnBtn);

            // Part 11 C: AudioSettingsCard toggles.
            const audioCard = this._settingsPanel.getChildByName('AudioSettingsCard');
            if (audioCard) {
                const soundBtn = audioCard.getChildByName('SoundToggleButton')?.getComponent(Button);
                soundBtn?.node.on(Button.EventType.CLICK, () => this._onToggleSound(), this);
                const hapBtn = audioCard.getChildByName('HapticsToggleButton')?.getComponent(Button);
                hapBtn?.node.on(Button.EventType.CLICK, () => this._onToggleHaptics(), this);
                this._refreshAudioCard();
            }

            // Phase 27 — Quick Play defaults: 3 dropdowns + 1 pill toggle.
            const qpCard = this._settingsPanel.getChildByName('QuickPlayDefaultsCard');
            if (qpCard) {
                // Row buttons + their value labels (children of each row).
                this._qpModeRow   = qpCard.getChildByName('QPModeRow');
                this._qpWindowRow = qpCard.getChildByName('QPWindowRow');
                this._qpWagerRow  = qpCard.getChildByName('QPWagerRow');
                this._qpModeValueLabel   = this._qpModeRow?.getChildByName('QPModeRowValueLabel')?.getComponent(Label) ?? null;
                this._qpWindowValueLabel = this._qpWindowRow?.getChildByName('QPWindowRowValueLabel')?.getComponent(Label) ?? null;
                this._qpWagerValueLabel  = this._qpWagerRow?.getChildByName('QPWagerRowValueLabel')?.getComponent(Label) ?? null;
                // Popovers — direct children of SettingsPanel for z-order.
                this._qpModePopover   = this._settingsPanel.getChildByName('QPModePopover');
                this._qpWindowPopover = this._settingsPanel.getChildByName('QPWindowPopover');
                this._qpWagerPopover  = this._settingsPanel.getChildByName('QPWagerPopover');
                // Row taps → toggle popover with mutual exclusivity.
                const qpModeBtn = this._qpModeRow?.getComponent(Button);
                const qpWindowBtn = this._qpWindowRow?.getComponent(Button);
                const qpWagerBtn = this._qpWagerRow?.getComponent(Button);
                qpModeBtn?.node.on(Button.EventType.CLICK, () => this._toggleQPPopover('mode'), this);
                qpWindowBtn?.node.on(Button.EventType.CLICK, () => this._toggleQPPopover('window'), this);
                qpWagerBtn?.node.on(Button.EventType.CLICK, () => this._toggleQPPopover('wager'), this);
                // Phase 30 — press-pop scale flash on each dropdown row.
                if (qpModeBtn) addPressPop(qpModeBtn);
                if (qpWindowBtn) addPressPop(qpWindowBtn);
                if (qpWagerBtn) addPressPop(qpWagerBtn);
                // Mode options. Stage 3: trio replaces br10.
                const modeKeys: Array<[string, string]> = [['1v1','oneVone'],['trio','trio'],['4p','fourPlayer'],['8p','eightPlayer']];
                for (const [ui, logical] of modeKeys) {
                    const b = this._qpModePopover?.getChildByName(`QPModePopover_${ui}`)?.getComponent(Button);
                    if (b) {
                        this._qpModeOptionButtons.set(ui, b);
                        b.node.on(Button.EventType.CLICK, () => this._onQPModeClick(ui, logical), this);
                    }
                }
                // Window options.
                for (const w of ['30s','1m','5m','1h','24h','7d']) {
                    const b = this._qpWindowPopover?.getChildByName(`QPWindowPopover_${w}`)?.getComponent(Button);
                    if (b) {
                        this._qpWindowOptionButtons.set(w, b);
                        b.node.on(Button.EventType.CLICK, () => this._onQPWindowClick(w), this);
                    }
                }
                // Wager options.
                for (let i = 0; i < 5; i++) {
                    const key = ['001','005','01','025','05'][i];
                    const b = this._qpWagerPopover?.getChildByName(`QPWagerPopover_${key}`)?.getComponent(Button);
                    if (b) {
                        this._qpWagerOptionButtons.set(key, b);
                        const idx = i;
                        b.node.on(Button.EventType.CLICK, () => this._onQPWagerClick(key, idx), this);
                    }
                }
                // Track pill toggle.
                const tt = qpCard.getChildByName('QPTrackToggle');
                this._qpTrackIndicator  = tt?.getChildByName('QPTrackIndicator') ?? null;
                this._qpTrackPaperLabel = tt?.getChildByName('QPTrackPaperLabel')?.getComponent(Label) ?? null;
                this._qpTrackRealLabel  = tt?.getChildByName('QPTrackRealLabel')?.getComponent(Label) ?? null;
                tt?.getChildByName('QPTrackPaperHit')?.getComponent(Button)?.node
                    .on(Button.EventType.CLICK, () => this._onQPTrackClick('paper'), this);
                tt?.getChildByName('QPTrackRealHit')?.getComponent(Button)?.node
                    .on(Button.EventType.CLICK, () => this._onQPTrackClick('real'), this);
            }
        }
        const homeSettingsBtn = this._homePanel.getChildByName('OpenSettingsButton')?.getComponent(Button);
        homeSettingsBtn?.node.on(Button.EventType.CLICK, () => this._onOpenSettingsClick('home'), this);
        const tdSettingsBtn = this._tokenDuelPanel.getChildByName('OpenSettingsButton')?.getComponent(Button);
        tdSettingsBtn?.node.on(Button.EventType.CLICK, () => this._onOpenSettingsClick('tokenDuel'), this);

        this._portfolioPanel = this.node.getChildByName('PortfolioPanel') ?? null;
        if (this._portfolioPanel) {
            const pfBack = this._portfolioPanel.getChildByName('BackButton')?.getComponent(Button);
            pfBack?.node.on(Button.EventType.CLICK, () => this._onPortfolioBackClick(), this);
            this._pfPubkeyLabel = this._portfolioPanel.getChildByName('PortfolioPubkeyLabel')?.getComponent(Label) ?? null;
            this._pfPaperTab = this._portfolioPanel.getChildByName('PortfolioPaperTab')?.getComponent(Button) ?? null;
            this._pfRealTab = this._portfolioPanel.getChildByName('PortfolioRealTab')?.getComponent(Button) ?? null;
            this._pfPaperTab?.node.on(Button.EventType.CLICK, () => this._onPortfolioTabClick('paper'), this);
            this._pfRealTab?.node.on(Button.EventType.CLICK, () => this._onPortfolioTabClick('real'), this);
            // Part 9: top-level Stats / History tabs.
            this._pfStatsTab    = this._portfolioPanel.getChildByName('PortfolioStatsTab')?.getComponent(Button) ?? null;
            this._pfHistoryTab  = this._portfolioPanel.getChildByName('PortfolioHistoryTab')?.getComponent(Button) ?? null;
            this._pfTrophiesTab = this._portfolioPanel.getChildByName('PortfolioTrophiesTab')?.getComponent(Button) ?? null;
            this._pfStatsTab?.node.on(Button.EventType.CLICK, () => this._onPortfolioTopLevelTab('stats'), this);
            this._pfHistoryTab?.node.on(Button.EventType.CLICK, () => this._onPortfolioTopLevelTab('history'), this);
            this._pfTrophiesTab?.node.on(Button.EventType.CLICK, () => this._onPortfolioTopLevelTab('trophies'), this);
            // Part 11 B: cache the 6 trophy tile nodes for reuse.
            const trophiesView = this._portfolioPanel.getChildByName('PortfolioTrophiesView');
            if (trophiesView) {
                for (let i = 0; i < 6; i++) {
                    const tile = trophiesView.getChildByName(`TrophyTile_${i}`);
                    if (tile) this._pfTrophyTiles.push(tile);
                }
            }
            this._pfHistoryView = this._portfolioPanel.getChildByName('PortfolioHistoryView') ?? null;
            if (this._pfHistoryView) {
                this._pfHistoryEmptyLabel = this._pfHistoryView.getChildByName('PortfolioHistoryEmptyLabel')?.getComponent(Label) ?? null;
                this._pfHistoryLoadMoreButton = this._pfHistoryView.getChildByName('PortfolioHistoryLoadMoreButton')?.getComponent(Button) ?? null;
                this._pfHistoryLoadMoreButton?.node.on(Button.EventType.CLICK, () => this._onHistoryLoadMore(), this);
                const scroll = this._pfHistoryView.getChildByName('PortfolioHistoryScroll');
                const content = scroll?.getChildByName('view')?.getChildByName('content');
                if (content) {
                    for (let i = 0; i < 30; i++) {
                        const row = content.getChildByName(`MatchHistoryRow_${i}`);
                        if (row) this._pfHistoryRows.push(row);
                    }
                }
                this._pfHistoryView.active = false;
            }
            for (const key of ['games', 'wins', 'losses', 'winrate']) {
                const cN = this._portfolioPanel.getChildByName(`PFStatCard_${key}`);
                const vL = cN?.getChildByName('Value')?.getComponent(Label) ?? null;
                if (vL) this._pfStatValues.set(key, vL);
            }
            // Dashboard redesign: hero P/L card resolution (extends PFStatCard_pnl).
            const heroCard = this._portfolioPanel.getChildByName('PFStatCard_pnl');
            this._pfHeroPnLValue = heroCard?.getChildByName('Value')?.getComponent(Label) ?? null;
            this._pfHeroPnLSubtitle = heroCard?.getChildByName('Subtitle')?.getComponent(Label) ?? null;
            this._pfHeroPnLEdge = heroCard?.getChildByName('CardEdgeAccent')?.getComponent(Sprite) ?? null;
            // XP card progress-bar wiring.
            const xpCard = this._portfolioPanel.getChildByName('PFStatCard_xp');
            this._pfXpValueLabel = xpCard?.getChildByName('Value')?.getComponent(Label) ?? null;
            this._pfXpProgressFill = xpCard?.getChildByName('PFXpProgressBarFill') ?? null;
            this._pfXpFooter = xpCard?.getChildByName('PFXpFooterLabel')?.getComponent(Label) ?? null;
            // Empty-state container + CTA.
            this._pfEmptyState = this._portfolioPanel.getChildByName('PortfolioEmptyState') ?? null;
            const emptyCta = this._pfEmptyState?.getChildByName('PortfolioEmptyStateCta')?.getComponent(Button);
            emptyCta?.node.on(Button.EventType.CLICK, () => this._onPortfolioEmptyStateStart(), this);
            // Batch-toggle list — every node that participates in the populated Stats body.
            // Excludes Paper/Real toggle buttons (already handled by the existing
            // _pfPaperTab/_pfRealTab show/hide path in _refreshPortfolioTopLevel)
            // and excludes the empty-state container (driven by _applyPortfolioRecord).
            this._pfStatsViewNodes = [];
            for (const name of [
                'PortfolioSubtitleLabel', 'PortfolioModeLabel',
                'PortfolioGroupHeaderPerformance', 'PortfolioGroupHeaderActivity',
                'PFStatCard_pnl', 'PFStatCard_wins', 'PFStatCard_losses',
                'PFStatCard_winrate', 'PFStatCard_games', 'PFStatCard_xp',
            ]) {
                const n = this._portfolioPanel.getChildByName(name);
                if (n) this._pfStatsViewNodes.push(n);
            }
            // Phase N4: build hub-tab strip mirror so Portfolio panel can swap
            // back to Leaderboard without leaving the hub.
            const pfHub = this._buildHubTabs(this._portfolioPanel);
            this._pfHubPortfolioTab = pfHub.portfolio;
            this._pfHubLeaderboardTab = pfHub.leaderboard;
        }
        console.log(`${TAG} start | TokenDuel lb_panel=${!!this._leaderboardPanel} rows=${this._lbRowNodes.length}/9 pf_panel=${!!this._portfolioPanel} stats=${this._pfStatValues.size}/4 hero=${!!this._pfHeroPnLValue} xp_fill=${!!this._pfXpProgressFill} empty=${!!this._pfEmptyState}`);

        // Session 14 B5: start with empty squad + stake cluster hidden; Run Squad reveals it.
        this._setStakeClusterVisible(false);
        this._refreshSquadActionButtons();

        // Session D Part 2: ModePickerOverlay bindings.
        this._modePickerOverlay = this._tokenDuelPanel.getChildByName('ModePickerOverlay') ?? null;
        if (this._modePickerOverlay) {
            // Scrim button (tap-outside to cancel)
            const scrimBtn = this._modePickerOverlay.getComponent(Button);
            scrimBtn?.node.on(Button.EventType.CLICK, () => this._onPickerCancel(), this);
            // Mode buttons (Stage 3: keys are now ModeId strings directly).
            for (const key of ['oneVone', 'trio', 'fourPlayer', 'eightPlayer']) {
                const n = this._modePickerOverlay.getChildByName(`Mode_${key}`);
                const b = n?.getComponent(Button);
                if (b) {
                    this._pickerModeButtons.set(key, b);
                    b.node.on(Button.EventType.CLICK, () => this._onPickerModeClick(key), this);
                }
            }
            // Wager chips. Scene order: ['0001', '001', '005', '01', '025', '05']
            // Part 11 D2: wagerKeys[0] is the INTRO tier which maps to on-chain
            // WAGER_TIERS index 5 (appended to preserve legacy Match PDA bytes).
            // The parallel sceneToTierIdx array translates scene-position → on-chain idx.
            // betting-duel: 8 chips. Order: INTRO · 0.01 · 0.05 · 0.1 · 0.25 · 0.5 · 1 · 5 SOL.
            // Maps to on-chain WAGER_TIERS indices [5, 0, 1, 2, 3, 4, 6, 7].
            const wagerKeys = ['0001', '001', '005', '01', '025', '05', '1', '5'];
            const sceneToTierIdx = [5, 0, 1, 2, 3, 4, 6, 7];
            for (let w = 0; w < wagerKeys.length; w++) {
                const n = this._modePickerOverlay.getChildByName(`Wager_${wagerKeys[w]}`);
                const b = n?.getComponent(Button);
                if (b) {
                    const idx = sceneToTierIdx[w];
                    this._pickerWagerButtons.set(wagerKeys[w], b);
                    b.node.on(Button.EventType.CLICK, () => this._onPickerWagerClick(idx), this);
                }
            }
            // Part 9: TimeWindow chip row
            const windowKeys: TimeWindowId[] = ['30s', '1m', '5m', '1h', '24h', '7d'];
            for (const wk of windowKeys) {
                const n = this._modePickerOverlay.getChildByName(`Window_${wk}`);
                const b = n?.getComponent(Button);
                if (b) {
                    this._pickerWindowButtons.set(wk, b);
                    b.node.on(Button.EventType.CLICK, () => this._onPickerWindowClick(wk), this);
                }
            }
            // Paper / Real toggle
            this._pickerPaperToggle = this._modePickerOverlay.getChildByName('PickerPaperToggle')?.getComponent(Button) ?? null;
            this._pickerRealToggle = this._modePickerOverlay.getChildByName('PickerRealToggle')?.getComponent(Button) ?? null;
            this._pickerPaperToggle?.node.on(Button.EventType.CLICK, () => this._onPickerTrackClick('paper'), this);
            this._pickerRealToggle?.node.on(Button.EventType.CLICK, () => this._onPickerTrackClick('real'), this);
            // Start / Cancel
            this._pickerStartButton = this._modePickerOverlay.getChildByName('PickerStartButton')?.getComponent(Button) ?? null;
            this._pickerStartButton?.node.on(Button.EventType.CLICK, () => this._onPickerStart(), this);
            this._pickerCancelButton = this._modePickerOverlay.getChildByName('PickerCancelButton')?.getComponent(Button) ?? null;
            this._pickerCancelButton?.node.on(Button.EventType.CLICK, () => this._onPickerCancel(), this);
            this._pickerStatusLabel = this._modePickerOverlay.getChildByName('PickerStatusLabel')?.getComponent(Label) ?? null;
            this._pickerWagerReadout = this._modePickerOverlay.getChildByName('PickerWagerReadout')?.getComponent(Label) ?? null;
            // Phase E — difficulty toggle.
            const diffMap: Array<[BotDifficulty, string]> = [
                ['easy',   'PickerDifficultyEasy'],
                ['medium', 'PickerDifficultyMedium'],
                ['hard',   'PickerDifficultyHard'],
            ];
            for (const [d, name] of diffMap) {
                const b = this._modePickerOverlay.getChildByName(name)?.getComponent(Button);
                if (b) {
                    this._pickerDifficultyButtons.set(d, b);
                    b.node.on(Button.EventType.CLICK, () => this._onPickerDifficultyClick(d), this);
                }
            }
            // Restore persisted difficulty.
            try {
                const saved = (typeof localStorage !== 'undefined') ? localStorage.getItem('tokenduel:botDifficulty') : null;
                if (saved === 'easy' || saved === 'medium' || saved === 'hard') {
                    this._pickerSelectedDifficulty = saved;
                }
            } catch (_) { /* localStorage unavailable in edge envs */ }
        }
        console.log(`${TAG} start | ModePickerOverlay wired=${!!this._modePickerOverlay} modes=${this._pickerModeButtons.size} wagers=${this._pickerWagerButtons.size} toggles=${!!this._pickerPaperToggle}/${!!this._pickerRealToggle} difficulty=${this._pickerDifficultyButtons.size} cta=${!!this._pickerStartButton} wager_readout=${!!this._pickerWagerReadout}`);

        // betting-duel polish — Wager control row bindings (TokenDuelPanel).
        this._wagerValueButton = this._tokenDuelPanel.getChildByName('WagerValueButton')?.getComponent(Button) ?? null;
        if (this._wagerValueButton) {
            this._wagerValueLabel = this._wagerValueButton.node.getChildByName('Label')?.getComponent(Label) ?? null;
            this._wagerValueButton.node.on(Button.EventType.CLICK, () => this._onWagerValueTap(), this);
        }
        this._wagerStartButton = this._tokenDuelPanel.getChildByName('WagerStartButton')?.getComponent(Button) ?? null;
        if (this._wagerStartButton) {
            this._wagerStartLabel = this._wagerStartButton.node.getChildByName('Label')?.getComponent(Label) ?? null;
            this._wagerStartButton.node.on(Button.EventType.CLICK, () => this._onWagerStartTap(), this);
        }
        this._wagerHintLabel = this._tokenDuelPanel.getChildByName('WagerHintLabel')?.getComponent(Label) ?? null;
        // 2026-04-26 redesign — MatchSetupCard labels (squad/stake/hint).
        // Hint moves here from WagerHintLabel; squad + stake are derived state.
        const matchSetupCardNode = this._tokenDuelPanel.getChildByName('MatchSetupCard');
        this._matchSetupSquadLabel = matchSetupCardNode?.getChildByName('MatchSetupSquadLabel')?.getComponent(Label) ?? null;
        this._matchSetupStakeLabel = matchSetupCardNode?.getChildByName('MatchSetupStakeLabel')?.getComponent(Label) ?? null;
        this._matchSetupHintLabel  = matchSetupCardNode?.getChildByName('MatchSetupHintLabel')?.getComponent(Label) ?? null;
        this._wagerLockChip = this._tokenDuelPanel.getChildByName('WagerLockChip') ?? null;
        if (this._wagerLockChip) {
            this._wagerLockChipLabel = this._wagerLockChip.getChildByName('WagerLockChipLabel')?.getComponent(Label) ?? null;
        }
        this._wagerBotChip = this._tokenDuelPanel.getChildByName('WagerBotChip') ?? null;
        if (this._wagerBotChip) {
            this._wagerBotChipLabel = this._wagerBotChip.getChildByName('WagerBotChipLabel')?.getComponent(Label) ?? null;
        }
        this._wagerDropdown = this._tokenDuelPanel.getChildByName('WagerDropdown') ?? null;
        if (this._wagerDropdown) {
            for (let i = 0; i < 8; i++) {
                const rowN = this._wagerDropdown.getChildByName(`WagerDropdownRow_${i}`);
                const b = rowN?.getComponent(Button);
                if (b) {
                    const idx = i;
                    this._wagerDropdownRows.push(b);
                    b.node.on(Button.EventType.CLICK, () => this._onWagerRowTap(idx), this);
                }
            }
        }
        console.log(`${TAG} start | WagerControlRow value_btn=${!!this._wagerValueButton} start_btn=${!!this._wagerStartButton} dropdown=${!!this._wagerDropdown} rows=${this._wagerDropdownRows.length}/8`);
        this._refreshWagerControlRow();

        // Session D Part 3: WaitingPanel + PostMatchPanel bindings.
        this._waitingPanel = this.node.getChildByName('WaitingPanel') ?? null;
        if (this._waitingPanel) {
            this._waitingTitleLabel    = this._waitingPanel.getChildByName('WaitingTitleLabel')?.getComponent(Label) ?? null;
            this._waitingModeLabel     = this._waitingPanel.getChildByName('WaitingModeLabel')?.getComponent(Label) ?? null;
            this._waitingProgressLabel = this._waitingPanel.getChildByName('WaitingProgressLabel')?.getComponent(Label) ?? null;
            this._waitingStatusLabel   = this._waitingPanel.getChildByName('WaitingStatusLabel')?.getComponent(Label) ?? null;
            this._waitingCancelButton  = this._waitingPanel.getChildByName('WaitingCancelButton')?.getComponent(Button) ?? null;
            this._waitingPlayBotButton = this._waitingPanel.getChildByName('WaitingPlayBotButton')?.getComponent(Button) ?? null;
            this._waitingForceSettleButton = this._waitingPanel.getChildByName('WaitingForceSettleButton')?.getComponent(Button) ?? null;
            this._waitingCancelButton?.node.on(Button.EventType.CLICK, () => this._onWaitingCancel(), this);
            this._waitingPlayBotButton?.node.on(Button.EventType.CLICK, () => this._onWaitingPlayBot(), this);
            this._waitingForceSettleButton?.node.on(Button.EventType.CLICK, () => this._onWaitingForceSettle(), this);
        }
        // Part 13: rake labels across panels. 2026-04-26: HomeRakeChip
        // removed from Home; rake now lives inside the ChallengeSeasonCard's
        // RAKE chip — see _refreshRakeChip + _setChallengeChips.
        if (this._waitingPanel) {
            this._waitingRakeLabel = this._waitingPanel.getChildByName('WaitingRakeLabel')?.getComponent(Label) ?? null;
        }

        this._postMatchPanel = this.node.getChildByName('PostMatchPanel') ?? null;
        if (this._postMatchPanel) {
            this._postMatchRakeLabel     = this._postMatchPanel.getChildByName('PostMatchRakeLabel')?.getComponent(Label) ?? null;
            this._postMatchTitleLabel    = this._postMatchPanel.getChildByName('PostMatchTitleLabel')?.getComponent(Label) ?? null;
            this._postMatchTrackLabel    = this._postMatchPanel.getChildByName('PostMatchTrackLabel')?.getComponent(Label) ?? null;
            this._postMatchPayoutLabel   = this._postMatchPanel.getChildByName('PostMatchPayoutLabel')?.getComponent(Label) ?? null;
            this._postMatchSubtitleLabel = this._postMatchPanel.getChildByName('PostMatchSubtitleLabel')?.getComponent(Label) ?? null;
            this._postMatchBackButton    = this._postMatchPanel.getChildByName('PostMatchBackButton')?.getComponent(Button) ?? null;
            this._postMatchAgainButton   = this._postMatchPanel.getChildByName('PostMatchAgainButton')?.getComponent(Button) ?? null;
            this._postMatchBackButton?.node.on(Button.EventType.CLICK, () => this._onPostMatchBack(), this);
            this._postMatchAgainButton?.node.on(Button.EventType.CLICK, () => this._onPostMatchAgain(), this);
            // Block 6 — Same Squad shortcut
            const sameSquadBtn = this._postMatchPanel.getChildByName('PostMatchSameSquadButton')?.getComponent(Button);
            sameSquadBtn?.node.on(Button.EventType.CLICK, () => this._onPostMatchSameSquad(), this);
            // Part 11 A: share-to-X button.
            const shareBtn = this._postMatchPanel.getChildByName('PostMatchShareButton')?.getComponent(Button);
            shareBtn?.node.on(Button.EventType.CLICK, () => this._onPostMatchShare(), this);
            for (const key of ['you', 'opp', 'xp', 'lvl']) {
                const cN = this._postMatchPanel.getChildByName(`PMCard_${key}`);
                const vL = cN?.getChildByName('Value')?.getComponent(Label) ?? null;
                if (vL) this._postMatchCardValues.set(key, vL);
                // 2026-04-27 — value sub-line (multiplier / breakdown).
                const sL = cN?.getChildByName('ValueSub')?.getComponent(Label) ?? null;
                if (sL) this._postMatchCardSubs.set(key, sL);
                // Drifting-gadget: card-edge accents are now runtime-tinted by outcome.
                const edge = cN?.getChildByName(`PMCardEdge_${key}`)?.getComponent(Sprite) ?? null;
                if (edge) this._postMatchCardEdges.set(key, edge);
            }
            // Drifting-gadget: bg-tint + mascot glow + XP bar refs.
            const bgN = this._postMatchPanel.getChildByName('OutcomeBgTint');
            this._postMatchOutcomeBgGfx     = bgN?.getComponent(Graphics) ?? null;
            this._postMatchOutcomeBgOpacity = bgN?.getComponent(UIOpacity) ?? null;
            const glowN = this._postMatchPanel.getChildByName('MascotGlow');
            this._postMatchMascotGlowGfx     = glowN?.getComponent(Graphics) ?? null;
            this._postMatchMascotGlowOpacity = glowN?.getComponent(UIOpacity) ?? null;
            this._postMatchXPBarLabelLeft  = this._postMatchPanel.getChildByName('PostMatchXPBarLabelLeft')?.getComponent(Label) ?? null;
            this._postMatchXPBarLabelRight = this._postMatchPanel.getChildByName('PostMatchXPBarLabelRight')?.getComponent(Label) ?? null;
            this._postMatchXPBarFillGfx    = this._postMatchPanel.getChildByName('PostMatchXPBarFill')?.getComponent(Graphics) ?? null;
            // UX Phase 2b: bind second mascot on PostMatchPanel.
            const pmMascotN = this._postMatchPanel.getChildByName('PostMatchMascotContainer');
            if (pmMascotN) {
                this._postMatchMascot = pmMascotN.getComponent(MascotController) ?? pmMascotN.addComponent(MascotController);
                console.log(`${TAG} start | postMatchMascot bound`);
            }
        }
        // 4-state coverage: bind LandingMascotContainer + RaceMascotContainer.
        // LandingMascot greets the user on the Connect/Reconnect screen
        // (idle); RaceMascot animates 'think' during gameplay (set in
        // _showRacePanel). Both are populated by phase3's setSpriteSheet.
        const landingMascotN = this._landingPanel?.getChildByName('LandingMascotContainer');
        if (landingMascotN) {
            this._landingMascot = landingMascotN.getComponent(MascotController) ?? landingMascotN.addComponent(MascotController);
            console.log(`${TAG} start | landingMascot bound`);
        }
        const raceMascotN = this._racePanel?.getChildByName('RaceMascotContainer');
        if (raceMascotN) {
            this._raceMascot = raceMascotN.getComponent(MascotController) ?? raceMascotN.addComponent(MascotController);
            this._raceMascotOpacity = raceMascotN.getComponent(UIOpacity) ?? raceMascotN.addComponent(UIOpacity);
            console.log(`${TAG} start | raceMascot bound`);
        }
        const raceHintN = this._racePanel?.getChildByName('RaceHintLabel');
        this._raceHintLabel = raceHintN?.getComponent(Label) ?? null;
        if (this._postMatchPanel) {
            // (post-match mascot bind already happened above; this trailing
            // brace closes the original `if (this._postMatchPanel)` block).
            // Pre-allocate confetti Graphics once (fixes native render-thread
            // crash on Seeker/Android from spawning 12 cc.Graphics in one frame).
            this._bindPostMatchConfetti();
        }
        console.log(`${TAG} start | Phase D panels waiting=${!!this._waitingPanel} postmatch=${!!this._postMatchPanel} post_cards=${this._postMatchCardValues.size}/4`);

        // Part 12 D: SpectatorPanel bindings.
        this._spectatorPanel = this.node.getChildByName('SpectatorPanel') ?? null;
        if (this._spectatorPanel) {
            this._spectatorTitleLabel  = this._spectatorPanel.getChildByName('SpectatorTitleLabel')?.getComponent(Label) ?? null;
            this._spectatorMatchLabel  = this._spectatorPanel.getChildByName('SpectatorMatchLabel')?.getComponent(Label) ?? null;
            this._spectatorStatusLabel = this._spectatorPanel.getChildByName('SpectatorStatusLabel')?.getComponent(Label) ?? null;
            const specBack = this._spectatorPanel.getChildByName('SpectatorBackButton')?.getComponent(Button);
            specBack?.node.on(Button.EventType.CLICK, () => this._onSpectatorBack(), this);
            this._spectatorJoinButton = this._spectatorPanel.getChildByName('SpectatorJoinButton')?.getComponent(Button) ?? null;
            this._spectatorJoinButton?.node.on(Button.EventType.CLICK, () => this._onSpectatorJoin(), this);
            const playerList = this._spectatorPanel.getChildByName('SpectatorPlayerList');
            if (playerList) {
                for (let i = 0; i < 10; i++) {
                    const row = playerList.getChildByName(`SpectatorPlayerRow_${i}`);
                    if (row) this._spectatorPlayerRows.push(row);
                }
            }
            const eventList = this._spectatorPanel.getChildByName('SpectatorEventList');
            if (eventList) {
                for (let i = 0; i < 10; i++) {
                    const row = eventList.getChildByName(`SpectatorEventRow_${i}`);
                    if (row) this._spectatorEventRows.push(row);
                }
            }
            console.log(`${TAG} start | SpectatorPanel wired=true player_rows=${this._spectatorPlayerRows.length}/10 event_rows=${this._spectatorEventRows.length}/10`);
        } else {
            console.log(`${TAG} start | WARN SpectatorPanel missing — regenerate scene`);
        }

        // Part 14 C: TournamentPanel bindings.
        // Block 3 + 8 — countdown & signing overlays
        this._countdownOverlay = this.node.getChildByName('CountdownOverlay') ?? null;
        if (this._countdownOverlay) {
            this._countdownBigLabel    = this._countdownOverlay.getChildByName('CountdownBigLabel')?.getComponent(Label) ?? null;
            this._countdownSquadLabel  = this._countdownOverlay.getChildByName('CountdownSquadPreviewLabel')?.getComponent(Label) ?? null;
        }
        this._signingOverlay = this.node.getChildByName('SigningOverlay') ?? null;
        if (this._signingOverlay) {
            this._signingSpinnerLabel = this._signingOverlay.getChildByName('SigningSpinnerLabel')?.getComponent(Label) ?? null;
            this._signingStatusLabel  = this._signingOverlay.getChildByName('SigningStatusLabel')?.getComponent(Label) ?? null;
            this._signingHintLabel    = this._signingOverlay.getChildByName('SigningHintLabel')?.getComponent(Label) ?? null;
        }

        // Phase 19 — LoadingOverlay bindings.
        this._loadingOverlay = this.node.getChildByName('LoadingOverlay') ?? null;
        if (this._loadingOverlay) {
            this._loadingSpinnerLabel = this._loadingOverlay.getChildByName('LoadingSpinnerLabel')?.getComponent(Label) ?? null;
            this._loadingStatusLabel  = this._loadingOverlay.getChildByName('LoadingStatusLabel')?.getComponent(Label) ?? null;
            this._loadingTipLabel     = this._loadingOverlay.getChildByName('LoadingTipLabel')?.getComponent(Label) ?? null;
            // Spawn a 5th MascotController instance for the loading greeter.
            const loadingMascotContainer = this._loadingOverlay.getChildByName('LoadingMascotContainer');
            if (loadingMascotContainer && !loadingMascotContainer.getComponent(MascotController)) {
                loadingMascotContainer.addComponent(MascotController);
            }
        }

        // Phase H4 — LevelUpOverlay bindings.
        this._levelUpOverlay = this.node.getChildByName('LevelUpOverlay') ?? null;
        if (this._levelUpOverlay) {
            this._levelUpTitleLabel   = this._levelUpOverlay.getChildByName('LevelUpTitleLabel')?.getComponent(Label) ?? null;
            this._levelUpBigLevel     = this._levelUpOverlay.getChildByName('LevelUpBigLevel')?.getComponent(Label) ?? null;
            this._levelUpCaptionLabel = this._levelUpOverlay.getChildByName('LevelUpCaptionLabel')?.getComponent(Label) ?? null;
            this._levelUpRakeLabel    = this._levelUpOverlay.getChildByName('LevelUpRakeLabel')?.getComponent(Label) ?? null;
            const luBtn = this._levelUpOverlay.getComponent(Button);
            luBtn?.node.on(Button.EventType.CLICK, () => this._hideLevelUpOverlay(), this);
            console.log(`${TAG} start | LevelUpOverlay wired=${!!this._levelUpOverlay}`);
        }
        console.log(`${TAG} start | overlays countdown=${!!this._countdownOverlay} signing=${!!this._signingOverlay}`);

        this._tournamentPanel = this.node.getChildByName('TournamentPanel') ?? null;
        if (this._tournamentPanel) {
            this._tournamentTitleLabel  = this._tournamentPanel.getChildByName('TournamentTitleLabel')?.getComponent(Label) ?? null;
            this._tournamentMatchLabel  = this._tournamentPanel.getChildByName('TournamentMatchLabel')?.getComponent(Label) ?? null;
            this._tournamentStatusLabel = this._tournamentPanel.getChildByName('TournamentStatusLabel')?.getComponent(Label) ?? null;
            this._tournamentPrizeLabel  = this._tournamentPanel.getChildByName('TournamentPrizePoolLabel')?.getComponent(Label) ?? null;
            const backBtn = this._tournamentPanel.getChildByName('TournamentBackButton')?.getComponent(Button);
            backBtn?.node.on(Button.EventType.CLICK, () => this._onTournamentBack(), this);
            this._tournamentJoinButton = this._tournamentPanel.getChildByName('TournamentJoinButton')?.getComponent(Button) ?? null;
            this._tournamentJoinButton?.node.on(Button.EventType.CLICK, () => this._onTournamentJoin(), this);
            const roster = this._tournamentPanel.getChildByName('TournamentRoster');
            if (roster) {
                for (let i = 0; i < 10; i++) {
                    const slot = roster.getChildByName(`TournamentSlot_${i}`);
                    if (slot) this._tournamentSlotNodes.push(slot);
                }
            }
            console.log(`${TAG} start | TournamentPanel wired=true slots=${this._tournamentSlotNodes.length}/10`);
        } else {
            console.log(`${TAG} start | WARN TournamentPanel missing — regenerate scene`);
        }

        // Phase A — FindMatchPanel + filter bindings + 8 row pool.
        this._findMatchPanel = this.node.getChildByName('FindMatchPanel') ?? null;
        if (this._findMatchPanel) {
            this._findMatchTitleLabel  = this._findMatchPanel.getChildByName('FindMatchTitleLabel')?.getComponent(Label) ?? null;
            this._findMatchCountLabel  = this._findMatchPanel.getChildByName('FindMatchCountLabel')?.getComponent(Label) ?? null;
            this._findMatchEmptyLabel  = this._findMatchPanel.getChildByName('FindMatchEmptyLabel')?.getComponent(Label) ?? null;
            this._findMatchStatusLabel = this._findMatchPanel.getChildByName('FindMatchStatusLabel')?.getComponent(Label) ?? null;
            this._findMatchBackButton  = this._findMatchPanel.getChildByName('FindMatchBackButton')?.getComponent(Button) ?? null;
            this._findMatchRefreshButton = this._findMatchPanel.getChildByName('FindMatchRefreshButton')?.getComponent(Button) ?? null;
            this._findMatchHostButton  = this._findMatchPanel.getChildByName('FindMatchHostButton')?.getComponent(Button) ?? null;
            this._findMatchHideFullToggle = this._findMatchPanel.getChildByName('FilterHideFullToggle')?.getComponent(Button) ?? null;
            // Phase H2 — Open / Live tab buttons.
            this._findMatchTabOpenBtn = this._findMatchPanel.getChildByName('FindMatchTab_Open')?.getComponent(Button) ?? null;
            this._findMatchTabLiveBtn = this._findMatchPanel.getChildByName('FindMatchTab_Live')?.getComponent(Button) ?? null;
            this._findMatchTabOpenBtn?.node.on(Button.EventType.CLICK, () => this._onFindMatchTabClick('open'), this);
            this._findMatchTabLiveBtn?.node.on(Button.EventType.CLICK, () => this._onFindMatchTabClick('live'), this);
            this._findMatchBackButton?.node.on(Button.EventType.CLICK, () => this._hideFindMatchPanel(), this);
            this._findMatchRefreshButton?.node.on(Button.EventType.CLICK, () => { void this._matchBrowser?.refresh(); }, this);
            this._findMatchHostButton?.node.on(Button.EventType.CLICK, () => this._onFindMatchHostTap(), this);
            this._findMatchHideFullToggle?.node.on(Button.EventType.CLICK, () => this._onToggleHideFull(), this);
            // Filter chips (Stage 3: trio replaces br10).
            const modeKeys = ['all', 'oneVone', 'trio', '4p', '8p'];
            for (const k of modeKeys) {
                const b = this._findMatchPanel.getChildByName(`FilterMode_${k}`)?.getComponent(Button);
                if (b) {
                    this._filterModeButtons.set(k, b);
                    b.node.on(Button.EventType.CLICK, () => this._onFilterModeClick(k), this);
                }
            }
            const winKeys = ['all', '30s', '1m', '5m', '1h', '24h', '7d'];
            for (const k of winKeys) {
                const b = this._findMatchPanel.getChildByName(`FilterWindow_${k}`)?.getComponent(Button);
                if (b) {
                    this._filterWindowButtons.set(k, b);
                    b.node.on(Button.EventType.CLICK, () => this._onFilterWindowClick(k), this);
                }
            }
            const wagerKeys = ['all', 'low', 'mid', 'high', 'whale'];
            for (const k of wagerKeys) {
                const b = this._findMatchPanel.getChildByName(`FilterWager_${k}`)?.getComponent(Button);
                if (b) {
                    this._filterWagerButtons.set(k, b);
                    b.node.on(Button.EventType.CLICK, () => this._onFilterWagerClick(k), this);
                }
            }
            // 8 row pool — Phase A2 redesign: edge stripes + capacity bar fills + track chips.
            for (let i = 0; i < 8; i++) {
                const row = this._findMatchPanel.getChildByName(`MatchCardRow_${i}`);
                if (!row) continue;
                this._matchCardRows.push(row);
                this._matchCardRowMatchPdas.push(null);
                this._matchCardEdgeStripes.push(row.getChildByName(`MatchCardEdgeStripe_${i}`) as Node);
                this._matchCardCapBarFills.push(row.getChildByName(`MatchCardCapBarFill_${i}`) as Node);
                this._matchCardTrackChips.push(row.getChildByName(`MatchCardTrackChip_${i}`) as Node);
                const joinBtn = row.getChildByName(`MatchCardJoinButton_${i}`)?.getComponent(Button);
                joinBtn?.node.on(Button.EventType.CLICK, () => this._onMatchCardJoinClick(i), this);
            }
            // Phase A2 — header polish + empty-state cluster bindings.
            this._findMatchLvXpChip = this._findMatchPanel.getChildByName('FindMatchLvXpChip') ?? null;
            this._findMatchLvXpChipLabel = this._findMatchLvXpChip?.getChildByName('FindMatchLvXpChipLabel')?.getComponent(Label) ?? null;
            if (this._findMatchCountLabel) {
                try { addIdlePulse(this._findMatchCountLabel.node, 1.04); } catch (_) { /* ignore */ }
            }
            this._findMatchEmptyMascotNode = this._findMatchPanel.getChildByName('FindMatchEmptyMascot') ?? null;
            if (this._findMatchEmptyMascotNode) {
                this._findMatchEmptyMascot = this._findMatchEmptyMascotNode.getComponent(MascotController) ?? this._findMatchEmptyMascotNode.addComponent(MascotController);
            }
            this._findMatchEmptyTitle    = this._findMatchPanel.getChildByName('FindMatchEmptyTitle')?.getComponent(Label) ?? null;
            this._findMatchEmptySubtitle = this._findMatchPanel.getChildByName('FindMatchEmptySubtitle')?.getComponent(Label) ?? null;
            this._findMatchEmptyHostBtn  = this._findMatchPanel.getChildByName('FindMatchEmptyHostButton')?.getComponent(Button) ?? null;
            this._findMatchEmptyBotBtn   = this._findMatchPanel.getChildByName('FindMatchEmptyBotButton')?.getComponent(Button) ?? null;
            this._findMatchEmptyHostBtn?.node.on(Button.EventType.CLICK, () => this._onFindMatchHostTap(), this);
            this._findMatchEmptyBotBtn?.node.on(Button.EventType.CLICK, () => {
                this._hideFindMatchPanel();
                void this._onBotMatch();
            }, this);
            // Refresh button — 360° spin tween on tap (gives the icon a "refreshing" feel).
            this._findMatchRefreshButton?.node.on(Button.EventType.CLICK, () => {
                const n = this._findMatchRefreshButton!.node;
                Tween.stopAllByTarget(n);
                n.eulerAngles = new Vec3(0, 0, 0);
                tween(n).to(0.45, { eulerAngles: new Vec3(0, 0, -360) }, { easing: 'cubicOut' }).start();
            }, this);
            // Construct the browser; default 5000ms but throttled to
            // HOME_BROWSER_INTERVAL_MS while user is on the home screen so
            // the count badge stays warm without hammering RPC.
            this._matchBrowser = new MatchBrowser(this._tdRpc, AppUI.HOME_BROWSER_INTERVAL_MS);
            this._matchBrowserUnsubscribe = this._matchBrowser.subscribe(() => this._renderMatchList());
            console.log(`${TAG} start | FindMatchPanel wired=true rows=${this._matchCardRows.length}/8 mode_chips=${this._filterModeButtons.size} window_chips=${this._filterWindowButtons.size} wager_chips=${this._filterWagerButtons.size}`);
        } else {
            console.log(`${TAG} start | WARN FindMatchPanel missing — regenerate scene`);
        }

        // ── FindMatchButton live count badge on HomePanel ───────────────
        // Subscribes a second listener on the existing _matchBrowser so the
        // home-screen Find Match button shows current open-lobby count
        // ("Find Match · 5"). Auto-refresh runs at HOME_BROWSER_INTERVAL_MS
        // (15s) to keep RPC traffic light; flips to 5s when the lobby opens.
        this._findMatchCountBadge = this._homePanel?.getChildByName('FindMatchButtonCountBadge') ?? null;
        if (this._findMatchCountBadge) {
            this._findMatchCountBadgeLabel = this._findMatchCountBadge.getChildByName('FindMatchButtonCountLabel')?.getComponent(Label) ?? null;
        }
        if (this._matchBrowser && this._findMatchCountBadge) {
            this._findMatchCountUnsubscribe = this._matchBrowser.subscribe((rows) => this._renderFindMatchCount(rows.length));
            // Kick the home-browser into life so the badge populates without
            // the user having to enter the lobby first.
            this._matchBrowser.start();
            console.log(`${TAG} start | FindMatchButton wired=true count_badge=true`);
        }

        // ── 2026-04-27 — MatchesInProgress count badge + subtitle on Home ──
        this._matchesInProgressCountBadge = this._homePanel?.getChildByName('MatchesInProgressCountBadge') ?? null;
        if (this._matchesInProgressCountBadge) {
            this._matchesInProgressCountLabel = this._matchesInProgressCountBadge.getChildByName('MatchesInProgressCountLabel')?.getComponent(Label) ?? null;
            this._matchesInProgressCountBadge.active = false;
        }
        const mipBtnNode = this._homePanel?.getChildByName('MatchesInProgressButton');
        this._matchesInProgressSubtitleLabel = mipBtnNode?.getChildByName('MatchesInProgressSubtitle')?.getComponent(Label) ?? null;
        // 2026-04-27 — guarantee MIP button is interactable regardless of count.
        // Tap always opens panel; empty state renders when 0 matches.
        const mipBtnComp = mipBtnNode?.getComponent(Button);
        if (mipBtnComp) mipBtnComp.interactable = true;

        // ── 2026-04-27 — MatchesInProgressPanel + 30-row pool bindings ──
        if (this._mipPanel) {
            this._mipSubtitleLabel = this._mipPanel.getChildByName('MatchesInProgressSubtitleLabel')?.getComponent(Label) ?? null;
            this._mipEmptyState = this._mipPanel.getChildByName('MIPEmptyState') ?? null;
            const mipBackBtn = this._mipPanel.getChildByName('BackButton')?.getComponent(Button);
            mipBackBtn?.node.on(Button.EventType.CLICK, () => this._setActivePanel('home'), this);
            const emptyCta = this._mipEmptyState?.getChildByName('MIPEmptyCtaButton')?.getComponent(Button);
            emptyCta?.node.on(Button.EventType.CLICK, () => this._showFindMatchPanel(), this);
            const mipScrollSV = this._mipPanel.getChildByName('MIPScrollView')?.getComponent(ScrollView);
            const mipContent = mipScrollSV?.content;
            if (mipContent) {
                for (let i = 0; i < 30; i++) {
                    const rowN = mipContent.getChildByName(`MIPRow_${i}`);
                    if (!rowN) continue;
                    this._mipRowNodes.push(rowN);
                    const ringG = rowN.getChildByName(`MIPRing_${i}`)?.getComponent(Graphics);
                    if (ringG) this._mipRingGraphics.push(ringG);
                    const winL = rowN.getChildByName(`MIPWinLine_${i}`)?.getComponent(Label);
                    if (winL) this._mipWinLineLabels.push(winL);
                    const windowL = rowN.getChildByName(`MIPWindowLine_${i}`)?.getComponent(Label);
                    if (windowL) this._mipWindowLineLabels.push(windowL);
                    const stakeL = rowN.getChildByName(`MIPStakeChip_${i}`)?.getComponent(Label);
                    if (stakeL) this._mipStakeChipLabels.push(stakeL);
                    const oppL = rowN.getChildByName(`MIPOpponentChip_${i}`)?.getComponent(Label);
                    if (oppL) this._mipOpponentChipLabels.push(oppL);
                    const timeL = rowN.getChildByName(`MIPTimeLabel_${i}`)?.getComponent(Label);
                    if (timeL) this._mipTimeLabels.push(timeL);
                    const tap = rowN.getChildByName(`MIPTapTarget_${i}`)?.getComponent(Button);
                    if (tap) {
                        this._mipTapButtons.push(tap);
                        const idx = i;
                        tap.node.on(Button.EventType.CLICK, () => this._onMipRowTap(idx), this);
                    }
                }
            }
            console.log(`${TAG} start | MatchesInProgressPanel wired=true rows=${this._mipRowNodes.length}/30`);
        } else {
            console.log(`${TAG} start | WARN MatchesInProgressPanel missing — regenerate scene`);
        }

        // ── Phase A — JoinMatchConfirmOverlay bindings ──────────────────
        this._joinConfirmOverlay = this.node.getChildByName('JoinMatchConfirmOverlay') ?? null;
        if (this._joinConfirmOverlay) {
            this._joinConfirmCard = this._joinConfirmOverlay.getChildByName('JoinConfirmCard') ?? null;
            const card = this._joinConfirmCard;
            const scrim = this._joinConfirmOverlay.getChildByName('JoinConfirmScrim');
            this._joinConfirmScrimButton = scrim?.getComponent(Button) ?? null;
            if (card) {
                this._joinConfirmModeBadge = card.getChildByName('JoinConfirmModeBadge') ?? null;
                this._joinConfirmModeLabel = this._joinConfirmModeBadge?.getChildByName('JoinConfirmModeBadgeLabel')?.getComponent(Label) ?? null;
                this._joinConfirmTrackChip = card.getChildByName('JoinConfirmTrackChip') ?? null;
                this._joinConfirmTrackLabel = this._joinConfirmTrackChip?.getChildByName('JoinConfirmTrackChipLabel')?.getComponent(Label) ?? null;
                this._joinConfirmWagerHero = card.getChildByName('JoinConfirmWagerHeroLabel')?.getComponent(Label) ?? null;
                this._joinConfirmWindowLabel = card.getChildByName('JoinConfirmWindowLabel')?.getComponent(Label) ?? null;
                this._joinConfirmCapacityLabel = card.getChildByName('JoinConfirmCapacityLabel')?.getComponent(Label) ?? null;
                this._joinConfirmHostLabel = card.getChildByName('JoinConfirmHostLabel')?.getComponent(Label) ?? null;
                this._joinConfirmAgeLabel = card.getChildByName('JoinConfirmAgeLabel')?.getComponent(Label) ?? null;
                this._joinConfirmCapacityBarFill = card.getChildByName('JoinConfirmCapacityBarFill') ?? null;
                this._joinConfirmCancelButton = card.getChildByName('JoinConfirmCancelButton')?.getComponent(Button) ?? null;
                this._joinConfirmGoButton = card.getChildByName('JoinConfirmGoButton')?.getComponent(Button) ?? null;
            }
            this._joinConfirmCancelButton?.node.on(Button.EventType.CLICK, () => this._hideJoinConfirmOverlay(), this);
            this._joinConfirmScrimButton?.node.on(Button.EventType.CLICK, () => this._hideJoinConfirmOverlay(), this);
            this._joinConfirmGoButton?.node.on(Button.EventType.CLICK, () => this._onJoinConfirmGoTap(), this);
            console.log(`${TAG} start | JoinMatchConfirmOverlay wired=true card=${!!this._joinConfirmCard}`);
        } else {
            console.log(`${TAG} start | WARN JoinMatchConfirmOverlay missing — regenerate scene`);
        }

        // ── Phase N — Notification bell, badge, panel, toast queue. ─────
        this._notifBellButton = this._homePanel?.getChildByName('NotificationBellButton')?.getComponent(Button) ?? null;
        if (this._notifBellButton) {
            this._notifBellButton.node.on(Button.EventType.CLICK, () => this._showNotificationPanel(), this);
        }
        this._notifBellBadge = this._homePanel?.getChildByName('NotificationBellBadge') ?? null;
        if (this._notifBellBadge) {
            this._notifBadgeLabel = this._notifBellBadge.getChildByName('NotificationBadgeLabel')?.getComponent(Label) ?? null;
        }
        this._notifPanel = this.node.getChildByName('NotificationPanel') ?? null;
        if (this._notifPanel) {
            this._notifPanelCard = this._notifPanel.getChildByName('NotifPanelCard') ?? null;
            this._notifCloseButton = this._notifPanelCard?.getChildByName('NotifCloseButton')?.getComponent(Button) ?? null;
            this._notifMarkAllReadButton = this._notifPanelCard?.getChildByName('NotifMarkAllReadButton')?.getComponent(Button) ?? null;
            this._notifEmptyLabel = this._notifPanelCard?.getChildByName('NotifEmptyLabel')?.getComponent(Label) ?? null;
            const listN = this._notifPanelCard?.getChildByName('NotifListContainer');
            if (listN) {
                for (let i = 0; i < 8; i++) {
                    const row = listN.getChildByName(`NotifRow_${i}`);
                    if (!row) continue;
                    this._notifRows.push(row);
                    this._notifRowIds.push(null);
                    const rb = row.getComponent(Button);
                    rb?.node.on(Button.EventType.CLICK, () => this._onNotifRowTap(i), this);
                }
            }
            // Tap-outside-to-dismiss via the panel root's Button (added in scene gen).
            const npRoot = this._notifPanel.getComponent(Button);
            npRoot?.node.on(Button.EventType.CLICK, () => this._hideNotificationPanel(), this);
            this._notifCloseButton?.node.on(Button.EventType.CLICK, () => this._hideNotificationPanel(), this);
            this._notifMarkAllReadButton?.node.on(Button.EventType.CLICK, () => this._onNotifMarkAllReadTap(), this);
            console.log(`${TAG} start | NotificationPanel wired=true rows=${this._notifRows.length}/8`);
        } else {
            console.log(`${TAG} start | WARN NotificationPanel missing`);
        }
        // Toast slots (3 stacked).
        const toastOverlay = this.node.getChildByName('NotificationToastOverlay');
        if (toastOverlay) {
            for (let i = 0; i < 3; i++) {
                const slot = toastOverlay.getChildByName(`NotificationToastSlot_${i}`);
                if (slot) this._notifToastSlots.push(slot);
            }
            this._notifToastQueue = new NotificationToastQueue();
            this._notifToastQueue.bind(this._notifToastSlots);
            this._notifToastQueue.setTapResolver((n) => this._resolveNotifTapHandler(n));
            this._notifToastQueue.attachStore(NotificationStore.instance);
            console.log(`${TAG} start | NotificationToastQueue wired slots=${this._notifToastSlots.length}/3`);
        }
        // Subscribe to store for bell/badge/panel re-renders.
        this._notifStoreUnsub = NotificationStore.instance.subscribe(() => {
            this._refreshNotificationBadge();
            if (this._notifPanel?.active) this._renderNotificationList();
        });

        console.log(`${TAG} start | TokenDuel feed_scrollview wired=${!!this._feedScrollView} content=${!!this._feedContent} rows_collected=${this._feedRowNodes.length}/${FEED_ROW_LIMIT}`);

        // Search EditBox (Session 3 A1 / Session 4 A1).
        const searchNode = this._tokenDuelPanel.getChildByName('SearchEditBox');
        this._searchEditBox = searchNode?.getComponent(EditBox) ?? null;
        if (this._searchEditBox) {
            // Cocos 3.8 emits EditBox events under inconsistent names across point
            // releases — 'text-changed' in some, 'textChanged' in others. Register
            // both so neither build surprises us. Logs tell us which fired.
            this._bindEvent(this._searchEditBox.node, ['text-changed', 'textChanged'], this._onSearchTextChanged, 'search_text');
            this._bindEvent(this._searchEditBox.node, ['editing-did-ended', 'editingDidEnded'], this._onSearchTextChanged, 'search_end');
            this._bindEvent(this._searchEditBox.node, ['editing-return', 'editingReturn'], this._onSearchTextChanged, 'search_return');
            console.log(`${TAG} start | TokenDuel search_editbox wired=true dual_name_events=true`);
        } else {
            console.log(`${TAG} start | TokenDuel search_editbox wired=false — fall back to tab-only browsing`);
        }

        // Session 4 B3 — Search clear (×) button.
        const clearNode = this._tokenDuelPanel.getChildByName('SearchClearButton');
        this._searchClearButton = clearNode?.getComponent(Button) ?? null;
        if (this._searchClearButton) {
            this._searchClearButton.node.on(Button.EventType.CLICK, this._onSearchClear, this);
            console.log(`${TAG} start | TokenDuel search_clear_button wired=true`);
        } else {
            console.log(`${TAG} start | TokenDuel search_clear_button wired=false`);
        }

        // Stake slider (Session 3 A3). Chips remain as snap-to presets.
        const sliderNode = this._tokenDuelPanel.getChildByName('StakeSlider');
        this._stakeSlider = sliderNode?.getComponent(Slider) ?? null;
        const stakeValueNode = this._tokenDuelPanel.getChildByName('StakeValueLabel');
        this._stakeValueLabel = stakeValueNode?.getComponent(Label) ?? null;
        if (this._stakeSlider) {
            // Dual-name events (see EditBox comment above).
            this._bindEvent(this._stakeSlider.node, ['slide', 'slidechange'], this._onStakeSliderSlide, 'stake_slide');
            // Initialize progress to default stake (0.01 SOL within MIN/MAX).
            const defaultProgress = (STAKE_DEFAULT_SOL - STAKE_MIN_SOL) / (STAKE_MAX_SOL - STAKE_MIN_SOL);
            this._stakeSlider.progress = defaultProgress;
            this._selectedStakeLamports = BigInt(Math.floor(STAKE_DEFAULT_SOL * 1_000_000_000));
            this._syncStakeValueLabel(STAKE_DEFAULT_SOL);
            console.log(`${TAG} start | TokenDuel stake_slider wired=true default_progress=${defaultProgress.toFixed(3)} default_sol=${STAKE_DEFAULT_SOL} dual_name_events=true`);
        } else {
            console.log(`${TAG} start | TokenDuel stake_slider wired=false — falling back to chip-only stake selection`);
        }

        // Squad slot buttons — 3 slots. Each button has a child `Label` node
        // carrying the display string (symbol or "+"). We mirror the pattern
        // used by HeroTile buttons.
        for (let i = 0; i < 3; i++) {
            const node = this._tokenDuelPanel.getChildByName(`SquadSlot_${i}`);
            const btn = node?.getComponent(Button);
            // Back-compat: older scene has symbol in a child `Label`; new scene
            // uses `SymbolLabel` + `LogoSprite` + `DeltaLabel`. Prefer the
            // composite path when present.
            const lbl = node?.getChildByName('Label')?.getComponent(Label);
            const symLbl = node?.getChildByName('SymbolLabel')?.getComponent(Label) ?? lbl;
            const logoSpr = node?.getChildByName('LogoSprite')?.getComponent(Sprite) ?? null;
            const dltLbl = node?.getChildByName('DeltaLabel')?.getComponent(Label) ?? null;
            if (btn && symLbl) {
                this._squadSlotButtons.push(btn);
                this._squadSlotLabels.push(symLbl);
                this._squadSlotSymbolLabels.push(symLbl);
                this._squadSlotLogoSprites.push(logoSpr!);
                this._squadSlotDeltaLabels.push(dltLbl!);
                const idx = i;
                btn.node.on(Button.EventType.CLICK, () => this._onSquadSlotTap(idx), this);
                // RemoveButton (×) — appears only on filled slots; clears the slot.
                const rmBtn = node?.getChildByName('RemoveButton')?.getComponent(Button);
                rmBtn?.node.on(Button.EventType.CLICK, () => this._onSquadSlotRemove(idx), this);
            }
        }

        // Stake chips — 3 preset amounts. Default selection is 0.01 SOL (middle).
        const chipDefs: Array<{ name: string; kind: '001' | '010' | '100'; sol: number }> = [
            { name: 'StakeChip_001', kind: '001', sol: 0.001 },
            { name: 'StakeChip_010', kind: '010', sol: 0.01  },
            { name: 'StakeChip_100', kind: '100', sol: 0.1   },
        ];
        // Renamed from `chipsWired` to avoid SyntaxError — the filter-chips block
        // above already declared that identifier in this function scope.
        let stakeChipsWired = 0;
        for (const def of chipDefs) {
            const node = this._tokenDuelPanel.getChildByName(def.name);
            const btn = node?.getComponent(Button);
            if (btn) {
                this._stakeChipButtons.set(def.kind, btn);
                btn.node.on(Button.EventType.CLICK, () => this._onStakeChipTap(def.kind, def.sol), this);
                stakeChipsWired++;
            }
        }
        // Initial render + highlight defaults.
        this._renderSquad();
        this._highlightActiveStakeChip('010');
        this._updateFeedTabDropdownLabel('trending');
        this._highlightActiveFeedTabOption('trending');
        this._highlightActiveFilterChip('newest');
        this._applyFeedColumnDefaults();
        this._refreshWatchlistStarTint();

        // Price feed → squad change pulses → squad re-render.
        this._squad.onChange(() => {
            this._renderSquad();
            this._refreshWatchlistStarTint();
            this._refreshSquadActionButtons();
            this._refreshWagerControlRow();
        });

        console.log(`${TAG} start | TokenDuel Phase III — balance_chip=${!!this._balanceChipLabel} feed_tabs=${feedTabsWired}/6 feed_rows=${this._feedRowNodes.length}/${FEED_ROW_LIMIT} squad_slots=${this._squadSlotButtons.length}/3 stake_chips=${stakeChipsWired}/3 filter_chips=${this._filterChipButtons.size}/7 watchlist_cached=${Watchlist.size()}`);

        // Pass 10: extensible auth-cache cold-start auto-sign-in. If the
        // user was signed in (not disconnected) when the app was last
        // killed, restore their session silently and land on Home. Any
        // other state (fresh install, explicit disconnect, deleted account)
        // falls through to the Landing panel. See KNOWN_ISSUES.md #15.
        if (mwa?.cache?.hasAutoLoginAuth()) {
            console.log(`${TAG} start | AUTO_SIGN_IN_CANDIDATE cache.hasAutoLoginAuth=true — attempting reauthorize`);
            this._attemptAutoSignIn();
        } else {
            console.log(`${TAG} start | AUTO_SIGN_IN_SKIP cache.hasAutoLoginAuth=false — showing Landing`);
            this._showLanding();
        }

        console.log(`${TAG} start | DONE`);
        // POST-START PULSE — fires at each interval after start completes.
        // Last printed pulse before silence pinpoints WHEN the crash happens.
        // If no pulse prints: crash is on the very first render frame.
        // If pulses print up to N ms then stop: crash is at ~N ms post-start.
        const startedAt = Date.now();
        const pulseAt = (delayMs: number) => setTimeout(() => {
            console.log(`${TAG} pulse | t=+${Date.now() - startedAt}ms (target=${delayMs}ms) — alive`);
        }, delayMs);
        for (const ms of [0, 8, 16, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048]) {
            pulseAt(ms);
        }
        // FRAME-LEVEL PROBE — schedule via cc.director's frame loop.
        // Will only fire if the render thread is alive. Last frame log before
        // silence = the frame on which the engine native-crashed.
        try {
            const { director, Director } = require('cc');
            let frameNum = 0;
            const frameHandler = () => {
                frameNum++;
                if (frameNum <= 5 || frameNum % 30 === 0) {
                    console.log(`${TAG} frame | n=${frameNum} t=+${Date.now() - startedAt}ms — render alive`);
                }
            };
            director.on(Director.EVENT_AFTER_DRAW, frameHandler);
        } catch (e) {
            console.log(`${TAG} frame | probe install ERROR ${e}`);
        }

        // Phase 20 — cold-start asset gate. Runs fire-and-forget; the
        // LoadingOverlay covers Landing while Phase 3 art (icons + mascot
        // frames) loads. Dismisses on assets-done OR 3s timeout, with a
        // 600ms minimum display floor so the mascot+tip greeting registers.
        // Reveals Landing with full art instead of a procedural-to-PNG pop.
        void this._gateColdStartLoad();
    }

    /**
     * Restore a signed-in session from the extensible auth cache on cold
     * start. Runs asynchronously so `start()` can return immediately.
     * On success: show Home with a toast acknowledging the cache hit.
     * On failure: fall through to the Landing panel — the cache entry was
     * present but `reauthorize()` couldn't validate it (cleared keys,
     * expired token, etc.). The user can still tap Reconnect from Landing
     * if they want to retry manually.
     */
    private async _attemptAutoSignIn(): Promise<void> {
        console.log(`${TAG} _attemptAutoSignIn | ENTRY`);
        const mwa = MWAManager.instance;
        if (!mwa) {
            console.log(`${TAG} _attemptAutoSignIn | NO_MWA — showing Landing`);
            this._showLanding();
            return;
        }
        try {
            console.log(`${TAG} _attemptAutoSignIn | BEFORE_AWAIT_REAUTHORIZE`);
            const result = await mwa.reauthorize();
            console.log(`${TAG} _attemptAutoSignIn | AFTER_AWAIT_REAUTHORIZE hasResult=${!!result} pubkey=${result?.pubkey?.slice(0, 8) ?? '(none)'}`);
            if (result) {
                console.log(`${TAG} _attemptAutoSignIn | SUCCESS pubkey=${result.pubkey} — showing Home`);
                showToast('Extensible auth cache — session restored', true);
                this._showHome();
                console.log(`${TAG} _attemptAutoSignIn | AFTER_SHOW_HOME`);
            } else {
                console.log(`${TAG} _attemptAutoSignIn | FAIL reauthorize returned null — showing Landing`);
                this._showLanding();
            }
        } catch (e: any) {
            console.log(`${TAG} _attemptAutoSignIn | EXCEPTION err=${e?.message || e} stack=${e?.stack ?? '(no stack)'} — showing Landing`);
            this._showLanding();
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PANEL SWITCHING
    // ═══════════════════════════════════════════════════════════════════

    private _showLanding(): void {
        const hasCached = MWAManager.instance?.cache?.hasCachedAuth() ?? false;
        console.log(`${TAG} _showLanding | hasCached=${hasCached}`);
        this._setActivePanel('landing');
        this._cachedHoldings = undefined; // invalidate — fresh fetch on next Token Duel entry
        if (this._game) {
            this._game.destroy();
            this._game = null;
        }
        this._setConnectionPill('disconnected');
        if (this._reconnectButton) this._reconnectButton.node.active = hasCached;
        this._setLandingEnabled(true);
    }

    /**
     * Drive the Landing footer status pill. Replaces the old StatusLabel-as-
     * connection-readout pattern. Three states cover every Landing path:
     *   disconnected — idle, fresh or returning user (gray)
     *   connecting   — wallet picker open, mid-authorize/reauthorize (amber)
     *   failed       — last attempt errored; user can retry (rose)
     */
    private _setConnectionPill(state: 'disconnected' | 'connecting' | 'failed'): void {
        if (!this._connectionStatusLabel) return;
        const map = {
            disconnected: { text: '● Disconnected', color: themeColor.neutral() },
            connecting:   { text: '● Connecting…', color: themeColor.warn() },
            failed:       { text: '● Auth failed', color: themeColor.loss() },
        };
        this._connectionStatusLabel.string = map[state].text;
        this._connectionStatusLabel.color = map[state].color;
    }

    private _showHome(): void {
        console.log(`${TAG} _showHome | ENTRY`);
        console.log(`${TAG} _showHome | switching to home panel`);
        // Clear any stale picker mode flags — back-out from a join confirm
        // or bot match shouldn't leak into a fresh "Start Match" tap.
        this._pickerJoinTarget = null;
        this._pickerBotMode = false;
        this._setActivePanel('home');
        console.log(`${TAG} _showHome | AFTER_setActivePanel`);
        // Stage 2 — refresh top-right Level chip on Home arrival.
        void this._refreshLevelChip();
        // UX overhaul Phase 2: mascot greets on Home arrival.
        this._setMascotState('idle');
        console.log(`${TAG} _showHome | AFTER_setMascotState`);
        const mwa = MWAManager.instance;
        const pubkey = mwa?.connectedPubkey ?? '';
        if (this._pubkeyLabel) {
            if (this._isGuest()) {
                this._pubkeyLabel.string = 'Guest';
                this._setWalletPillName('Play as Guest');
            } else {
                const short = pubkey.length > 8
                    ? pubkey.substring(0, 4) + '...' + pubkey.substring(pubkey.length - 4)
                    : pubkey || 'Not connected';
                this._pubkeyLabel.string = short;
                this._setWalletPillName(mwa?.walletDisplayName() ?? '');
            }
        }
        // Apply guest-mode hiding rules — must run AFTER pubkey label set so
        // the guest label sticks even if other refresh paths overwrite it.
        this._applyGuestModeUiHiding();
        // 2026-04-26 lobby restructure: training-card body line + thin
        // status-footer messaging. Body = free-match counter; status line
        // is short hint when training, otherwise generic.
        const paperRec = Stats.load('paper');
        const botGamesRemaining = Math.max(0, 5 - paperRec.games);
        this._setHomeTrainingBody(botGamesRemaining);
        if (this._homeStatus) {
            this._homeStatus.string = botGamesRemaining > 0
                ? 'Tap Bot Match to practice'
                : 'Connected \u2014 choose an action';
        }
        this._setHomeEnabled(true);

        // Part 10 pt2: hydrate the DailyStreakStrip from UserStats+DC+Season.
        void this._hydrateDailyChallengeWidget();

        // Part 12 C: start the live match ticker.
        this._startMatchTicker();

        // Part 13: refresh rake-tier chip (async; hides when not connected).
        void this._refreshRakeChip();

        // Part 14: ensure we know the tournament host pubkey (one-shot),
        // then start the countdown polling + 1s badge repaint.
        void this._fetchTournamentHostOnce().then(() => this._startTournamentCountdown());

        console.log(`${TAG} _showHome | DONE pubkey=${this._pubkeyLabel?.string}`);
    }

    private _showTokenDuel(): void {
        console.log(`${TAG} _showTokenDuel | switching to Token Duel panel`);
        this._setActivePanel('tokenDuel');
        this._resetStakeFlow();
        this._hideLegacyBettingDuelNodes();
        // Stage 2 — refresh top-right Level chip whenever this panel opens.
        void this._refreshLevelChip();
        // betting-duel round-4: tutorial NO LONGER auto-fires — it dulled the
        // screen every panel open and users found it annoying. Still reachable
        // on-demand via the top-right `?` HelpButton.

        // Phase III — kick off Birdeye feed fetch + balance chip refresh. Both
        // run async; the panel opens instantly and rows populate when ready.
        this._refreshFeed().catch((e) => console.log(`${TAG} _showTokenDuel | feed_refresh_error=${e}`));
        const mwa = MWAManager.instance;
        if (mwa?.connectedPubkey) {
            this._refreshBalanceChip(mwa.connectedPubkey).catch((e) =>
                console.log(`${TAG} _showTokenDuel | balance_refresh_error=${e}`)
            );
        }
        // Session 3 A7: per-tab cadence (15s for trending/gainers, 30s for new/top10).
        this._restartFeedPoll();

        if (this._cachedHoldings) {
            this._renderHoldings(this._cachedHoldings);
            this._offerHeroPickIfSupported();
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Pick a squad and stake — feed is live';
            return;
        }

        this._resetHoldingLabels('--');
        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Pick a squad and stake — feed is loading';
        this._loadHoldings();
    }

    private _resetStakeFlow(): void {
        const hadCommitted = !!this._stakeCommitSig;
        const hadHero = !!this._pickedHeroSymbol;
        const hadGame = !!this._game;
        const hadSessionSeed = this._sessionSeed !== null;
        console.log(`${TAG} _resetStakeFlow | START had_committed_sig=${hadCommitted} had_hero=${hadHero} had_game=${hadGame} had_session_seed=${hadSessionSeed} last_height=${this._lastGameHeight}`);
        this._stakeCommitSig = null;
        // betting-duel: legacy commit button stays hidden (solo-commit flow
        // is dead on this branch). Previously this was `active = true` —
        // that's what let the user hit Start Game from the old flow.
        if (this._stakeCommitButton) {
            this._stakeCommitButton.node.active = false;
            this._stakeCommitButton.interactable = false;
        }
        // Phase D: also reset game state / visuals.
        if (this._startGameButton) this._startGameButton.node.active = false;
        if (this._gameArea) this._gameArea.active = false;
        if (this._gameOverLabel) this._gameOverLabel.node.active = false;
        if (this._claimButton) this._claimButton.node.active = false;
        this._lastGameHeight = 0;
        this._sessionSeed = null; // Phase 6: clear per-round Anchor PDA seed.
        this._setPreGameContextActive(true);
        // Phase F: reset hero-pick state.
        for (const b of this._heroTileButtons) {
            b.node.active = false;
            b.interactable = true;
        }
        this._pickedHeroSymbol = null;
        this._pickedHeroSig = null;
        this._sessionDeltas = null;
        if (this._game) {
            this._game.destroy();
            this._game = null;
        }
        console.log(`${TAG} _resetStakeFlow | DONE commit_btn_visible=${this._stakeCommitButton?.node.active === true} start_btn_visible=${this._startGameButton?.node.active === true} claim_btn_visible=${this._claimButton?.node.active === true} game_area_visible=${this._gameArea?.active === true} hero_tiles_visible=${this._heroTileButtons.filter(b => b.node.active).length}`);
    }

    private _setPreGameContextActive(active: boolean): void {
        const sub = this._tokenDuelPanel?.getChildByName('SubtitleLabel');
        const subToggled = !!sub;
        if (sub) sub.active = active;
        for (const lbl of this._holdingLabels) lbl.node.active = active;
        console.log(`${TAG} _setPreGameContextActive | DONE active=${active} subtitle_toggled=${subToggled} holding_labels_count=${this._holdingLabels.length}`);
    }

    private async _loadHoldings(): Promise<void> {
        const pubkey = MWAManager.instance?.connectedPubkey ?? '';
        if (!pubkey) {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Not connected';
            return;
        }
        try {
            const holdings = await this._tdRpc.getTopHoldings(pubkey);
            if (!this._tokenDuelPanel.active) {
                console.log(`${TAG} _loadHoldings | panel no longer active — dropping result`);
                return;
            }
            this._cachedHoldings = holdings;
            this._renderHoldings(holdings);
            this._offerHeroPickIfSupported();
            const short = `${pubkey.substring(0, 4)}…${pubkey.substring(pubkey.length - 4)}`;
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = `Holdings loaded (${short})`;
            console.log(`${TAG} _loadHoldings | SUCCESS symbols=[${holdings.map(h => h.symbol).join(', ')}]`);
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            const stack = e?.stack ? String(e.stack).split('\n')[0] : '(no stack)';
            const name = e?.name ?? '(no name)';
            console.log(`${TAG} _loadHoldings | FAIL err_name="${name}" err_msg="${msg}" first_frame="${stack}"`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Failed to load holdings';
        }
    }

    private _renderHoldings(holdings: Holding[]): void {
        const symbols = holdings.map(h => h?.symbol ?? '---').join(',');
        for (let i = 0; i < this._holdingLabels.length; i++) {
            const h = holdings[i];
            this._holdingLabels[i].string = h?.symbol ?? '---';
        }
        console.log(`${TAG} _renderHoldings | DONE label_count=${this._holdingLabels.length} symbols="${symbols}"`);
    }

    private _resetHoldingLabels(placeholder: string): void {
        for (const lbl of this._holdingLabels) lbl.string = placeholder;
        console.log(`${TAG} _resetHoldingLabels | DONE placeholder="${placeholder}" label_count=${this._holdingLabels.length}`);
    }

    private _offerHeroPickIfSupported(): void {
        const mwa = MWAManager.instance;
        const supports = mwa ? mwa.supportsSignMessages() : false;
        const stakeSigned = !!this._stakeCommitSig;
        const heroPicked = !!this._pickedHeroSymbol;
        const squadFilled = this._squad.filled;
        const hasHoldings = !!this._cachedHoldings;
        console.log(`${TAG} _offerHeroPickIfSupported | START mwa_ready=${!!mwa} supports_sign_messages=${supports} squad_filled=${squadFilled} has_holdings=${hasHoldings} stake_signed=${stakeSigned} hero_picked=${heroPicked} tiles_wired=${this._heroTileButtons.length}`);
        if (!mwa || !supports) {
            for (const b of this._heroTileButtons) b.node.active = false;
            console.log(`${TAG} _offerHeroPickIfSupported | DONE path=hidden reason=unsupported`);
            return;
        }
        if (stakeSigned || heroPicked) {
            console.log(`${TAG} _offerHeroPickIfSupported | DONE path=skip reason=already_past_stake`);
            return;
        }

        // Session 4 B1 — prefer the squad as hero-pick source. When the squad
        // is non-empty we pick from it (aligns the hero bonus with the tokens
        // the player actually staked on). Fallback to wallet holdings only
        // when the squad is empty — preserves pre-Session-3 behavior.
        let source: 'squad' | 'wallet' | 'none' = 'none';
        let symbols: string[] = [];
        if (squadFilled > 0) {
            source = 'squad';
            symbols = this._squad.slots.map((s) => s?.symbol ?? '');
        } else if (hasHoldings) {
            source = 'wallet';
            symbols = this._cachedHoldings!.map((h) => h?.symbol ?? '');
        } else {
            console.log(`${TAG} _offerHeroPickIfSupported | DONE path=skip reason=no_source`);
            return;
        }

        let shown = 0;
        let empty = 0;
        let missingBindings = 0;
        for (let i = 0; i < 3; i++) {
            const sym = symbols[i];
            const btn = this._heroTileButtons[i];
            const lbl = this._heroTileLabels[i];
            if (!btn || !lbl) { missingBindings++; continue; }
            if (!sym || sym === '---') {
                btn.node.active = false;
                btn.interactable = false;
                empty++;
                continue;
            }
            lbl.string = `Pick ${sym}`;
            btn.node.active = true;
            btn.interactable = true;
            shown++;
        }
        console.log(`${TAG} _offerHeroPickIfSupported | DONE path=shown source=${source} tiles_shown=${shown} tiles_empty=${empty} bindings_missing=${missingBindings} symbols=[${symbols.join(',')}]`);
    }

    private _setActivePanel(which: 'landing' | 'home' | 'tokenDuel' | 'mip'): void {
        // UX overhaul Phase 1F: smooth fade+scale swap instead of instant
        // active-toggle. swapPanel handles UIOpacity setup + tween cleanup.
        const target = which === 'landing' ? this._landingPanel
                     : which === 'home'    ? this._homePanel
                     : which === 'mip'     ? this._mipPanel
                                           : this._tokenDuelPanel;
        const others = [this._landingPanel, this._homePanel, this._tokenDuelPanel, this._mipPanel]
            .filter((p) => p && p !== target);
        const wasActive = others.find((p) => p && p.active) ?? null;
        // Hide siblings instantly (no double-fade), then transition target in.
        for (const p of others) if (p && p !== wasActive) p.active = false;
        swapPanel(wasActive, target, 'forward');
        // Part 12 C: stop ticker timers when Home is not the active panel.
        if (which !== 'home') this._stopMatchTicker();
        // Part 14: stop tournament countdown when leaving Home.
        if (which !== 'home') this._stopTournamentCountdown();
        // 2026-04-27 — stop MIP 1-s tick when leaving the MIP panel.
        if (which !== 'mip') this._stopMipTick();
        // 2026-04-27 — When home becomes active, paint the MIP count badge
        // immediately from in-memory local matches + cached on-chain, then
        // kick off an async on-chain refresh in the background.
        if (which === 'home') {
            this._rebuildMipDisplay();
            void this._refreshMipMatches();
        }
        console.log(`${TAG} _setActivePanel | DONE which=${which} target=${target?.name}`);
    }

    /* ── 2026-04-27 — Matches In Progress ─────────────────────────────── */

    /**
     * Open the MatchesInProgressPanel, fetch user's active matches, populate
     * rows, and start the 1-s ring/time refresh tick.
     */
    private async _showMatchesInProgressPanel(): Promise<void> {
        console.log(`${TAG} _showMatchesInProgressPanel | TAP_RECEIVED matches=${this._mipMatches.length}`);
        if (!this._mipPanel) {
            console.log(`${TAG} _showMatchesInProgressPanel | ABORT_NO_PANEL`);
            return;
        }
        this._setActivePanel('mip');
        await this._refreshMipMatches();
        this._startMipTick();
    }

    /**
     * Fetch all status=Active matches and filter to ones the connected pubkey
     * is a participant in. Sort by remaining time ascending (most urgent first).
     */
    private async _refreshMipMatches(): Promise<void> {
        const me = MWAManager.instance?.connectedPubkey;
        if (!me || !this._tdRpc) {
            this._mipOnChainCache = [];
            this._mipBackendCache = [];
            this._rebuildMipDisplay();
            return;
        }
        try {
            const all = await (await import('../../token-duel/scripts/MatchRpc'))
                .findActiveMatchesUnfiltered(this._tdRpc);
            this._mipOnChainCache = all.filter((m) => m.players.includes(me));
        } catch (e) {
            console.log(`${TAG} _refreshMipMatches | ERR_ONCHAIN ${e}`);
            this._mipOnChainCache = [];
        }
        // 2026-04-27 — Fetch the user's persisted paper / bot matches from
        // the backend so MIP shows them cross-device. Guests skip this.
        if (this._shouldHitBackend()) {
            try {
                const rows = await listPaperMatchesActive(me);
                this._mipBackendCache = rows.map((r) => this._paperMatchToMatchState(r, me));
            } catch (e) {
                console.log(`${TAG} _refreshMipMatches | ERR_BACKEND ${e}`);
                this._mipBackendCache = [];
            }
        } else {
            this._mipBackendCache = [];
        }
        this._rebuildMipDisplay();
    }

    /**
     * 2026-04-27 — Adapt a backend `paper_match_active` row into the
     * MatchState shape the MIP renderer expects. Bots get pubkeys ending in
     * `BOT` so the existing `vs BOT` chip detection (AppUI.ts:3189) fires.
     */
    private _paperMatchToMatchState(r: PaperMatchActiveRow, me: string): MatchState {
        const players: string[] = [me];
        for (let i = 1; i < r.requiredPlayers; i++) players.push(`BOT_${i}_BOT`);
        const heights = players.map(() => 0);
        heights[0] = r.lastHeight;
        for (let i = 0; i < r.lastBotHeights.length && i + 1 < heights.length; i++) {
            heights[i + 1] = r.lastBotHeights[i];
        }
        const startedAtSec = BigInt(Math.floor(new Date(r.startedAt).getTime() / 1000));
        return {
            pda: r.id,
            mode: r.modeU8,
            wagerTier: 0,
            wagerLamports: 0n,
            xpBucket: 0,
            requiredPlayers: r.requiredPlayers,
            playerCount: r.requiredPlayers,
            players,
            heights,
            settledCount: 0,
            createdAt: startedAtSec,
            startedAt: startedAtSec,
            closedAt: 0n,
            status: 1,
            seq: 0n,
            bump: 0,
            escrowBump: 0,
            timeWindow: r.timeWindow,
        };
    }

    /**
     * 2026-04-27 — Merge in-memory local matches with the cached on-chain
     * fetch and re-render. Called on RPC return + on local push/pop so the
     * MIP rows + home count badge always reflect the current truth without
     * needing an RPC roundtrip.
     */
    private _rebuildMipDisplay(): void {
        // Local in-memory wins over backend cache when ids collide (the local
        // copy has fresher heights from the live tick). Backend rows show up
        // for matches started on other devices or before app restart.
        const localIds = new Set(this._localActiveMatches.map((m) => m.pda));
        const backendOnly = this._mipBackendCache.filter((m) => !localIds.has(m.pda));
        this._mipMatches = [...this._localActiveMatches, ...backendOnly, ...this._mipOnChainCache]
            .sort((a, b) => Number(this._mipRemainingMs(a) - this._mipRemainingMs(b)));
        this._renderMipRows();
        this._renderMipHomeBadge();
    }

    /**
     * Repaint all 30 row nodes from the current `_mipMatches` snapshot.
     * Activates rows up to N, deactivates the rest.
     */
    private _renderMipRows(): void {
        const n = this._mipMatches.length;
        if (this._mipEmptyState) this._mipEmptyState.active = (n === 0);
        if (this._mipSubtitleLabel) {
            this._mipSubtitleLabel.string = n === 0 ? 'All clear' : `${n} game${n > 1 ? 's' : ''} running`;
        }
        const me = MWAManager.instance?.connectedPubkey ?? '';
        for (let i = 0; i < this._mipRowNodes.length; i++) {
            const m = this._mipMatches[i];
            const row = this._mipRowNodes[i];
            if (!row) continue;
            if (!m) { row.active = false; continue; }
            row.active = true;

            // Win line (delta + sign vs leader)
            const myIdx = m.players.indexOf(me);
            const myHeight = myIdx >= 0 ? (m.heights[myIdx] ?? 0) : 0;
            const leaderHeight = Math.max(...m.heights);
            const isWinning = myHeight === leaderHeight && myHeight > 0;
            const myDeltaPct = decodeScore(myHeight);
            const winLbl = this._mipWinLineLabels[i];
            if (winLbl) {
                if (myHeight === 0 && leaderHeight === 0) {
                    winLbl.string = 'Round just started';
                    winLbl.color = new Color(168, 174, 201, 255);
                } else if (isWinning) {
                    winLbl.string = `YOU ${myDeltaPct >= 0 ? '+' : ''}${myDeltaPct.toFixed(2)}%`;
                    winLbl.color = new Color(48, 198, 155, 255);
                } else {
                    const leaderDeltaPct = decodeScore(leaderHeight);
                    winLbl.string = `OPP ${leaderDeltaPct >= 0 ? '+' : ''}${leaderDeltaPct.toFixed(2)}%`;
                    winLbl.color = new Color(236, 88, 122, 255);
                }
            }

            // Window / age line
            const wndLbl = this._mipWindowLineLabels[i];
            if (wndLbl) wndLbl.string = this._mipFormatWindow(m);

            // Stake chip
            const stakeLbl = this._mipStakeChipLabels[i];
            if (stakeLbl) {
                const isPaper = m.wagerLamports === 0n;
                if (isPaper) {
                    stakeLbl.string = 'PAPER';
                    stakeLbl.color = new Color(48, 198, 155, 255);
                } else {
                    const sol = Number(m.wagerLamports) / 1e9;
                    stakeLbl.string = `${sol < 0.01 ? sol.toFixed(4) : sol.toFixed(2)} SOL`;
                    stakeLbl.color = new Color(255, 210, 74, 255);
                }
            }

            // Opponent chip
            const oppLbl = this._mipOpponentChipLabels[i];
            if (oppLbl) {
                const oppPubkey = m.players.find((p) => p !== me) ?? '';
                const isBot = !oppPubkey || oppPubkey.endsWith('BOT') || /bot/i.test(oppPubkey);
                if (isBot || !oppPubkey) {
                    oppLbl.string = 'vs BOT';
                    oppLbl.color = new Color(232, 176, 70, 255);
                } else {
                    const display = this._getDisplayName ? this._getDisplayName(oppPubkey) : `${oppPubkey.slice(0, 4)}…${oppPubkey.slice(-4)}`;
                    oppLbl.string = `vs ${display}`;
                    oppLbl.color = new Color(244, 245, 249, 255);
                }
            }

            // Ring + time
            const remainingMs = this._mipRemainingMs(m);
            const totalMs = this._mipWindowDurationMs(m.timeWindow);
            this._updateMipRing(i, totalMs > 0 ? remainingMs / totalMs : 0);
            const timeLbl = this._mipTimeLabels[i];
            if (timeLbl) timeLbl.string = this._formatRemainingTime(remainingMs);
        }
    }

    /**
     * 2026-04-27 — Build a synthetic MatchState representing the current local
     * race (paper / bot). Pushed to `_localActiveMatches` so MIP can render it
     * + count it in the home badge alongside on-chain matches.
     */
    private _registerLocalMatch(): void {
        const me = MWAManager.instance?.connectedPubkey ?? '';
        if (!me) return;
        const modeDef = MODES[this._pickerSelectedMode as keyof typeof MODES] ?? MODES.oneVone;
        const windowDef = TIME_WINDOWS[this._pickerSelectedWindow] ?? TIME_WINDOWS[DEFAULT_TIME_WINDOW];
        const syntheticPda = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const players: string[] = [me];
        for (let i = 1; i < modeDef.requiredPlayers; i++) players.push(`BOT_${i}_BOT`);
        const local: MatchState = {
            pda: syntheticPda,
            mode: modeDef.modeU8,
            wagerTier: 0,
            wagerLamports: 0n,
            xpBucket: 0,
            requiredPlayers: modeDef.requiredPlayers,
            playerCount: modeDef.requiredPlayers,
            players,
            heights: players.map(() => 0),
            settledCount: 0,
            createdAt: BigInt(Math.floor(Date.now() / 1000)),
            startedAt: BigInt(Math.floor(Date.now() / 1000)),
            closedAt: 0n,
            status: 1,
            seq: 0n,
            bump: 0,
            escrowBump: 0,
            timeWindow: windowDef.windowU8,
        };
        this._localActiveMatches.push(local);
        this._currentLocalMatchPda = syntheticPda;
        console.log(`${TAG} _registerLocalMatch | pda=${syntheticPda} mode=${modeDef.id} window=${windowDef.id} players=${players.length}`);
        this._rebuildMipDisplay();
        // 2026-04-27 — Persist to backend for signed-in users so MIP shows
        // the match cross-device. Guests stay in-memory only.
        if (this._shouldHitBackend()) {
            const track: 'bot' | 'paper-real' = this._pickerBotMode ? 'bot' : 'paper-real';
            this._lastPaperMatchHeightsPostMs = 0; // reset throttle so first tick posts
            void registerPaperMatchActive({
                id: syntheticPda,
                pubkey: me,
                modeU8: modeDef.modeU8,
                timeWindow: windowDef.windowU8,
                requiredPlayers: modeDef.requiredPlayers,
                track,
                durationMs: windowDef.durationMs,
            });
        }
    }

    /** Remove the in-flight local match (called on settle / forfeit / natural finish). */
    private _clearCurrentLocalMatch(): void {
        if (!this._currentLocalMatchPda) return;
        const pda = this._currentLocalMatchPda;
        this._localActiveMatches = this._localActiveMatches.filter((m) => m.pda !== pda);
        this._mipBackendCache = this._mipBackendCache.filter((m) => m.pda !== pda);
        this._currentLocalMatchPda = null;
        console.log(`${TAG} _clearCurrentLocalMatch | removed pda=${pda} remaining_local=${this._localActiveMatches.length}`);
        this._rebuildMipDisplay();
        // Best-effort backend delete for signed-in users.
        if (this._shouldHitBackend() && pda.startsWith('local-')) {
            void deletePaperMatchActive(pda);
        }
    }

    /** Re-paint home button subtitle + count badge based on _mipMatches. */
    private _renderMipHomeBadge(): void {
        const n = this._mipMatches.length;
        if (this._matchesInProgressSubtitleLabel) {
            this._matchesInProgressSubtitleLabel.string = n === 0 ? '0 games running' : `${n} game${n > 1 ? 's' : ''} running`;
        }
        if (this._matchesInProgressCountBadge) {
            this._matchesInProgressCountBadge.active = n > 0;
            if (n > 0 && this._matchesInProgressCountLabel) {
                this._matchesInProgressCountLabel.string = String(n);
            }
        }
    }

    /** Draw the time-remaining arc on row `idx`. fraction ∈ [0,1]. */
    private _updateMipRing(idx: number, fraction: number): void {
        const g = this._mipRingGraphics[idx];
        if (!g) return;
        const f = Math.max(0, Math.min(1, fraction));
        const col = f > 0.5 ? new Color(48, 198, 155, 255)
                  : f > 0.2 ? new Color(232, 176, 70, 255)
                            : new Color(236, 88, 122, 255);
        g.clear();
        g.lineWidth = 5;
        g.strokeColor = new Color(col.r, col.g, col.b, 60);
        g.circle(0, 0, 22);
        g.stroke();
        if (f > 0) {
            g.strokeColor = col;
            const start = -Math.PI / 2;
            const end = start + f * Math.PI * 2;
            g.arc(0, 0, 22, start, end, false);
            g.stroke();
        }
    }

    /** Format remaining ms as "Xd Yh left", "Yh Zm left", "Zm Ws left", "Ws left". */
    private _formatRemainingTime(ms: number): string {
        if (ms <= 0) return '0s left';
        const totalSec = Math.floor(ms / 1000);
        const d = Math.floor(totalSec / 86400);
        const h = Math.floor((totalSec % 86400) / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (d > 0) return `${d}d ${h}h left`;
        if (h > 0) return `${h}h ${m}m left`;
        if (m > 0) return `${m}m ${s}s left`;
        return `${s}s left`;
    }

    /** Window duration in ms based on the on-chain timeWindow byte. */
    private _mipWindowDurationMs(window: number): number {
        // 2026-04-27 — 6-window scheme: 0=30s, 1=1m, 2=5m, 3=1h, 4=24h, 5=7d.
        return window === 0 ? 30_000
             : window === 1 ? 60_000
             : window === 2 ? 300_000
             : window === 3 ? 3_600_000
             : window === 4 ? 86_400_000
             :                604_800_000;
    }

    /** Compute remaining ms for a match given its startedAt + timeWindow. */
    private _mipRemainingMs(m: MatchState): number {
        const startedMs = Number(m.startedAt) * 1000;
        return Math.max(0, startedMs + this._mipWindowDurationMs(m.timeWindow) - Date.now());
    }

    /** "24h match · started 12m ago" */
    private _mipFormatWindow(m: MatchState): string {
        const windowLabel = m.timeWindow === 0 ? '30s'
                          : m.timeWindow === 1 ? '1m'
                          : m.timeWindow === 2 ? '5m'
                          : m.timeWindow === 3 ? '1h'
                          : m.timeWindow === 4 ? '24h' : '7d';
        const elapsedMs = Date.now() - Number(m.startedAt) * 1000;
        const ageStr = elapsedMs < 60_000   ? `${Math.floor(elapsedMs / 1000)}s ago`
                     : elapsedMs < 3_600_000 ? `${Math.floor(elapsedMs / 60_000)}m ago`
                     : elapsedMs < 86_400_000 ? `${Math.floor(elapsedMs / 3_600_000)}h ago`
                     : `${Math.floor(elapsedMs / 86_400_000)}d ago`;
        return `${windowLabel} match · started ${ageStr}`;
    }

    /** Start the 1-s tick that re-paints rows + rings. Idempotent. */
    private _startMipTick(): void {
        if (this._mipTickHandle != null) return;
        this._mipTickHandle = setInterval(() => {
            this._renderMipRows();
        }, 1000) as unknown as number;
    }

    /** Stop the 1-s tick. */
    private _stopMipTick(): void {
        if (this._mipTickHandle != null) {
            clearInterval(this._mipTickHandle as unknown as ReturnType<typeof setInterval>);
            this._mipTickHandle = null;
        }
    }

    /** Tap a row → log the match PDA. (Routing to RacePanel needs follow-up:
     *  RacePanel is currently singleton-tied to one active match handle. We'd
     *  need to refactor RacePanel + PortfolioRace to accept a match parameter.) */
    private _onMipRowTap(idx: number): void {
        const m = this._mipMatches[idx];
        if (!m) return;
        console.log(`${TAG} _onMipRowTap | TODO route to RacePanel pda=${m.pda} mode=${m.mode} window=${m.timeWindow}`);
    }

    /* ── UX overhaul Phase 1: helpers ───────────────────────────────── */

    /**
     * Find or create an IconBadge sibling node on `parentNode` and attach the
     * named procedural icon. Used to replace emoji prefixes on persistent UI
     * labels (Daily Streak, Tournament Badge, Wager value, etc.). Idempotent.
     */
    private _ensureIconBadge(parentNode: Node | null, iconName: IconName, opts: { size?: number; offsetX?: number; offsetY?: number } = {}): Node | null {
        if (!parentNode) return null;
        const size = opts.size ?? 22;
        let badge = parentNode.getChildByName('IconBadge');
        if (!badge) {
            badge = new Node('IconBadge');
            badge.parent = parentNode;
        }
        badge.setPosition(opts.offsetX ?? 0, opts.offsetY ?? 0, 0);
        IconLibrary.attach(badge, iconName, { size });
        return badge;
    }

    /**
     * UX Phase 2b: comprehensive bind-time icon attachment for every panel-
     * level label/button whose scene-baked emoji has been stripped. Idempotent
     * (safe to call multiple times). Table-driven so we don't re-list paths.
     *
     * Solo-emoji chrome buttons use offsetX=0 (centered); prefix-emoji labels
     * use a negative offsetX (icon sits left of the text).
     */
    /**
     * 2026-04-26 lobby restructure: bind the 5+5 chip Val labels inside
     * HomeMatchTicker + DailyStreakStrip, plus the training-card labels +
     * choose-match section title. Idempotent. Called from start() after panel
     * lookups complete.
     */
    private _bindHomeChips(): void {
        const ticker = this._homePanel?.getChildByName('HomeMatchTicker');
        if (ticker) {
            this._homeMatchTickerHeader = ticker.getChildByName('HomeMatchTickerHeader')?.getComponent(Label) ?? null;
            const matchKeys: Array<keyof typeof this._homeMatchChips> = ['mode', 'players', 'stake', 'duration', 'created'];
            for (const k of matchKeys) {
                const chip = ticker.getChildByName(`HomeMatchChip_${k}`);
                this._homeMatchChips[k] = chip?.getChildByName(`HomeMatchChipVal_${k}`)?.getComponent(Label) ?? null;
            }
        }
        const strip = this._homePanel?.getChildByName('DailyStreakStrip');
        if (strip) {
            // V2: SEASON chip dropped to slim the secondary stats card. The
            // _homeChalChips.season slot stays in the type for back-compat —
            // it just stays null at runtime, and _setChallengeChips no-ops on
            // the season field since c.season is null.
            const chalKeys: Array<keyof typeof this._homeChalChips> = ['day', 'challenges', 'pool', 'rake'];
            for (const k of chalKeys) {
                const chip = strip.getChildByName(`HomeChalChip_${k}`);
                this._homeChalChips[k] = chip?.getChildByName(`HomeChalChipVal_${k}`)?.getComponent(Label) ?? null;
            }
        }
        const trainingCard = this._homePanel?.getChildByName('HomeTrainingCard');
        if (trainingCard) {
            this._homeTrainingTitleLabel = trainingCard.getChildByName('HomeTrainingTitleLabel')?.getComponent(Label) ?? null;
            this._homeTrainingBodyLabel = trainingCard.getChildByName('HomeTrainingBodyLabel')?.getComponent(Label) ?? null;
            this._homeTrainingHintLabel = trainingCard.getChildByName('HomeTrainingHintLabel')?.getComponent(Label) ?? null;
        }
        this._homeChooseMatchLabel = this._homePanel?.getChildByName('HomeChooseMatchLabel')?.getComponent(Label) ?? null;
        console.log(`${TAG} _bindHomeChips | match=${Object.values(this._homeMatchChips).filter(Boolean).length}/5 chal=${Object.values(this._homeChalChips).filter(Boolean).length}/5 training=${[this._homeTrainingTitleLabel, this._homeTrainingBodyLabel, this._homeTrainingHintLabel].filter(Boolean).length}/3`);
    }

    /** Set the 5 MatchStatus chip values from a TickerParts payload. */
    private _setMatchStatusChips(parts: { mode: string; players: string; stake: string; duration: string; created: string }): void {
        const c = this._homeMatchChips;
        if (c.mode) c.mode.string = parts.mode;
        if (c.players) c.players.string = parts.players;
        if (c.stake) c.stake.string = parts.stake;
        if (c.duration) c.duration.string = parts.duration;
        if (c.created) c.created.string = parts.created;
    }

    /** Set ChallengeSeason chip values. Accepts a partial — only writes
     *  fields present in the payload (so _refreshRakeChip can update RAKE
     *  without clobbering the other 4). */
    private _setChallengeChips(parts: Partial<{ day: string; challenges: string; season: string; pool: string; rake: string }>): void {
        const c = this._homeChalChips;
        if (parts.day !== undefined && c.day) c.day.string = parts.day;
        if (parts.challenges !== undefined && c.challenges) c.challenges.string = parts.challenges;
        if (parts.season !== undefined && c.season) c.season.string = parts.season;
        if (parts.pool !== undefined && c.pool) c.pool.string = parts.pool;
        if (parts.rake !== undefined && c.rake) c.rake.string = parts.rake;
    }

    /** Update the XP progress label + tween the progress bar fill width.
     *  V2: Bar track is 640px wide (from LayoutSpec, was 360); fill grows
     *  leftward-anchored so width=640 = 100%. Tween is 600ms cubicOut so
     *  the fill noticeably *animates* on first show / level-up. */
    private _setLevelProgress(curr: number, max: number): void {
        if (this._homeXpProgressLabel) {
            this._homeXpProgressLabel.string = max > 0 ? `${curr} / ${max} XP` : '— XP';
        }
        const fill = this._homeXpBarFill;
        if (!fill) return;
        const ut = fill.getComponent(UITransform);
        if (!ut) return;
        const targetW = max > 0 ? Math.max(0, Math.min(1, curr / max)) * 640 : 0;
        try {
            tween(ut).to(0.6, { width: targetW }, { easing: 'cubicOut' as any }).start();
        } catch (_) {
            // tween may not be loaded in some contexts — fall back to instant set.
            ut.width = targetW;
        }
    }

    /** Set the wallet name line under the address inside WalletPill, and
     *  toggle the secure-connected dot's visibility based on whether a name
     *  is present. */
    private _setWalletPillName(name: string): void {
        if (this._walletNameLabel) {
            this._walletNameLabel.string = name || 'Wallet';
        }
        if (this._walletPillSecureDot) {
            this._walletPillSecureDot.active = !!name;
        }
    }

    /** Update the training-card body line. Falls back to "Practice mode" if
     *  no free-bot games remain. */
    private _setHomeTrainingBody(freeMatchesLeft: number): void {
        if (!this._homeTrainingBodyLabel) return;
        if (freeMatchesLeft > 0) {
            this._homeTrainingBodyLabel.string = `${freeMatchesLeft} free match${freeMatchesLeft === 1 ? '' : 'es'} left`;
        } else {
            this._homeTrainingBodyLabel.string = 'Practice mode';
        }
    }

    private _attachStaticIconBadges(): void {
        type Def = { panel: Node | null; name: string; icon: IconName; size?: number; offsetX?: number };
        const root = this.node;
        const defs: Def[] = [
            // Home chrome — 2026-04-26 lobby restructure: cards widened to
            // 680, chips occupy x∈[-240,+240]. Flame/sword icons sit at
            // -310 (just left of the leftmost chip).
            { panel: this._homePanel, name: 'DailyStreakStrip',       icon: 'flame',  size: 36, offsetX: -310 },
            { panel: this._homePanel, name: 'HomeTournamentBadge',    icon: 'sword',  size: 36, offsetX: -310 },
            // CTA trio — IconBadge sits left of each label so the icon reads first.
            { panel: this._homePanel, name: 'StartMatchButton',       icon: 'sword',  size: 72, offsetX: -200 },
            { panel: this._landingPanel, name: 'ConnectButton',       icon: 'sword',  size: 72, offsetX: -200 },
            { panel: this._homePanel, name: 'FindMatchButton',        icon: 'flag',   size: 72, offsetX: -200 },
            { panel: this._homePanel, name: 'BotMatchButton',         icon: 'robot',  size: 72, offsetX: -200 },
            // Right cluster (Disconnect · Hub · Settings · Bell). Phase N4:
            // Disconnect (power) replaces the former user-icon Portfolio
            // shortcut; trophy now opens the merged Portfolio+Leaderboard hub.
            { panel: this._homePanel, name: 'DisconnectButton',       icon: 'disconnect', size: 30, offsetX: 0 },
            { panel: this._homePanel, name: 'OpenLeaderboardButton',  icon: 'trophy', size: 30, offsetX: 0 },
            { panel: this._homePanel, name: 'OpenSettingsButton',     icon: 'cog',    size: 30, offsetX: 0 },  // home top-right gear, 64×64
            { panel: this._homePanel, name: 'NotificationBellButton', icon: 'bell',   size: 30, offsetX: 0 },

            // TokenDuel top-bar (3 solo-icon buttons + Help glyph, 40×36 cells) —
            // icons 28 so they stop reading as dots inside the button. Leaderboard
            // and Portfolio moved to Home global-nav; Settings stays duplicated.
            { panel: this._tokenDuelPanel, name: 'OpenSettingsButton',     icon: 'cog',    size: 42, offsetX: 0 },
            { panel: this._tokenDuelPanel, name: 'OpenSquadPresetsButton', icon: 'book',   size: 42, offsetX: 0 },
            { panel: this._tokenDuelPanel, name: 'SuggestSquadButton',     icon: 'bulb',   size: 42, offsetX: 0 },
            // HelpButton stays '?' text glyph — no IconBadge.

            // Feed chrome
            // ColumnsButton no longer gets a cog badge — the dropdown caret lives
            // in the label text ("Columns  ▾") so it scales with the font and
            // can't overlap.
            // FeedTabDropdownButton + WatchlistStarButton icons are state-driven; see _refreshFeedTabDropdown / _refreshWatchlistStarLabel.

            // Wager
            { panel: this._tokenDuelPanel, name: 'WagerValueButton',       icon: 'coin',   size: 26, offsetX: -70 },

            // Leaderboard / Portfolio / DailyChallenge / Spectator / Tournament panels — titles
            { panel: root, name: 'LeaderboardTitleLabel',       icon: 'trophy', size: 28, offsetX: -150 },
            { panel: root, name: 'DailyChallengeTitleLabel',    icon: 'flame',  size: 26, offsetX: -200 },
            { panel: root, name: 'PortfolioTitleLabel',         icon: 'user',   size: 28, offsetX: -110 },
            { panel: root, name: 'PortfolioTrophiesTab',        icon: 'trophy', size: 20, offsetX: -55 },
            { panel: root, name: 'SettingsTitleLabel',          icon: 'cog',    size: 40, offsetX: -90 },
            { panel: root, name: 'SpectatorTitleLabel',         icon: 'eye',    size: 26, offsetX: -130 },
            { panel: root, name: 'TournamentTitleLabel',        icon: 'sword',  size: 26, offsetX: -130 },
            { panel: root, name: 'TournamentJoinButton',        icon: 'sword',  size: 22, offsetX: -150 },

            // Waiting panel
            { panel: root, name: 'WaitingForceSettleButton',    icon: 'bolt',   size: 22, offsetX: -130 },
            { panel: root, name: 'WaitingStreakBanner',         icon: 'flame',  size: 20, offsetX: -270 },

            // Settings card buttons — Phase 29 redesign attaches icons to pre-
            // positioned child nodes (PrefSoundIcon / PrefHapticsIcon /
            // AccountFeesIcon / AccountReconnectIcon / AccountDisconnectIcon /
            // CopyPubkeyButton) directly via _attachSettingsRowIcons() so the
            // icons land at the row's local x-offset, not at the button center.
            // SoundToggleButton / HapticsToggleButton glyphs are state-driven.

            // Presets overlay
            { panel: root, name: 'PresetSaveButton',            icon: 'save',   size: 22, offsetX: -170 },

            // Personal rank header (inside leaderboard)
            { panel: root, name: 'HeaderLabel',                 icon: 'user',   size: 14, offsetX: -36 },
            // Note: 'HeaderLabel' name collides across panels — findByName depth-first will hit
            // the first one (Leaderboard PersonalRankCard). Section headers on other panels
            // share the name but their emoji has already been stripped; icon attachment to
            // their first node only is acceptable visual polish. If more precision needed
            // later, add per-panel section scoping.
        ];

        for (const d of defs) {
            if (!d.panel) continue;
            const node = this._findDescendantByName(d.panel, d.name);
            console.log(`${TAG} _attachStaticIconBadges | bind name=${d.name} icon=${d.icon} found=${!!node}`);
            if (!node) continue;
            try {
                this._ensureIconBadge(node, d.icon, { size: d.size ?? 22, offsetX: d.offsetX ?? 0 });
                console.log(`${TAG} _attachStaticIconBadges | bind DONE name=${d.name} icon=${d.icon}`);
            } catch (e: any) {
                console.log(`${TAG} _attachStaticIconBadges | bind THREW name=${d.name} icon=${d.icon} err=${e?.message ?? e} stack=${e?.stack ?? '(no stack)'}`);
                throw e;
            }
        }

        // PresetDeleteButton_0..4 — pooled, each gets a trash icon.
        const presetsOv = this.node.getChildByName('SquadPresetsOverlay');
        if (presetsOv) {
            for (let i = 0; i < 5; i++) {
                const delBtn = this._findDescendantByName(presetsOv, `PresetDeleteButton_${i}`);
                if (delBtn) this._ensureIconBadge(delBtn, 'trash', { size: 20, offsetX: 0 });
            }
        }

        // Phase 2b — FindMatchPanel filter chips. Every chip gets a 16px icon
        // prefix at offsetX=-42 so the existing label stays readable.
        const fmPanel = this._findMatchPanel ?? this.node.getChildByName('FindMatchPanel');
        if (fmPanel) {
            const chipIcons: Array<{ name: string; icon: IconName }> = [
                { name: 'FindMatchTab_Open',   icon: 'sword' },
                { name: 'FindMatchTab_Live',   icon: 'eye' },
                { name: 'FilterMode_all',      icon: 'cog' },
                { name: 'FilterMode_oneVone',  icon: 'sword' },
                { name: 'FilterMode_trio',     icon: 'user' },
                { name: 'FilterMode_4p',       icon: 'user' },
                { name: 'FilterMode_8p',       icon: 'flag' },
                { name: 'FilterWindow_all',    icon: 'clock' },
                { name: 'FilterWindow_1h',     icon: 'clock' },
                { name: 'FilterWindow_1d',     icon: 'clock' },
                { name: 'FilterWindow_3d',     icon: 'clock' },
                { name: 'FilterWindow_7d',     icon: 'clock' },
                { name: 'FilterWager_all',     icon: 'coin' },
                { name: 'FilterWager_low',     icon: 'coin' },
                { name: 'FilterWager_mid',     icon: 'coin' },
                { name: 'FilterWager_high',    icon: 'coin' },
                { name: 'FilterWager_whale',   icon: 'coin' },
            ];
            for (const c of chipIcons) {
                const n = fmPanel.getChildByName(c.name);
                if (n) this._ensureIconBadge(n, c.icon, { size: 22, offsetX: -42 });
            }
        }

        // Feed tab dropdown rows (6 rows) — per-row icons.
        const tabIcon: Record<string, IconName> = {
            new: 'bolt', trending: 'flame', gainers: 'chart',
            volume: 'chart', smart: 'brain', watchlist: 'star',
        };
        for (const key of Object.keys(tabIcon)) {
            const optN = this._tokenDuelPanel?.getChildByName(`FeedTabOption_${key}`);
            if (optN) this._ensureIconBadge(optN, tabIcon[key], { size: 22, offsetX: -90 });
        }

        console.log(`${TAG} _attachStaticIconBadges | bound ${defs.length} + preset 5 + feed_tab 6`);
    }

    /** Depth-first search for a named descendant; returns first match. */
    private _findDescendantByName(root: Node, name: string): Node | null {
        if (root.name === name) return root;
        for (const c of root.children) {
            const hit = this._findDescendantByName(c, name);
            if (hit) return hit;
        }
        return null;
    }

    /** Mascot state helper — silent no-op when mascot binding failed. */
    private _setMascotState(s: MascotState): void {
        this._mascot?.setState(s);
    }

    /**
     * Phase 29 — attach IconLibrary glyphs to the Settings card icon
     * placeholder children. Unlike _ensureIconBadge (which creates a child
     * IconBadge inside the parent at an offset), these icons attach directly
     * to nodes that have already been positioned by the scene generator —
     * so the icon lands at the row's left-side gutter position.
     */
    private _attachSettingsRowIcons(): void {
        if (!this._settingsPanel) return;
        type Pair = { parent: string | null; name: string; icon: IconName; size: number };
        const pairs: Pair[] = [
            // Wallet card
            { parent: 'WalletCard',          name: 'CopyPubkeyButton',       icon: 'clipboard', size: 18 },
            // Account card rows
            { parent: 'AccountSettingsCard', name: 'AccountFeesIcon',        icon: 'chart',     size: 22 },
            { parent: 'AccountSettingsCard', name: 'AccountReconnectIcon',   icon: 'lightning', size: 22 },
            { parent: 'AccountSettingsCard', name: 'AccountDisconnectIcon',  icon: 'lock',      size: 22 },
            // Preference rows — initial state mirrors current toggle state.
            // _setPrefRowState refreshes them on every toggle.
            { parent: 'AudioSettingsCard',   name: 'PrefSoundIcon',          icon: isSoundEnabled() ? 'speaker'   : 'speakerMuted', size: 22 },
            { parent: 'AudioSettingsCard',   name: 'PrefHapticsIcon',        icon: Haptics.isEnabled() ? 'vibration' : 'hand',       size: 22 },
        ];
        for (const p of pairs) {
            const card = p.parent ? this._settingsPanel.getChildByName(p.parent) : this._settingsPanel;
            const target = this._findDescendantByName(card ?? this._settingsPanel, p.name);
            if (!target) {
                console.log(`${TAG} _attachSettingsRowIcons | NOT FOUND ${p.parent}/${p.name}`);
                continue;
            }
            try { IconLibrary.attach(target, p.icon, { size: p.size }); }
            catch (e) { console.log(`${TAG} _attachSettingsRowIcons | attach FAIL ${p.name} ${e}`); }
        }
    }

    /**
     * UX Phase 2d: apply idle-pulse + press-pop + stronger zoomScale to the
     * primary CTA buttons. Idle-pulse draws the eye to the action; press-pop
     * gives a satisfying tap response (layered on top of cc.Button's native
     * zoomScale). Silent no-op for any button that isn't found in the scene.
     */
    private _enhancePrimaryCTAs(): void {
        // Phase 13 (B3): Connect is the gateway action — first thing in any
        // demo recording. It must breathe.
        enhancePrimaryCTA(this._landingPanel?.getChildByName('ConnectButton') ?? null);
        enhancePrimaryCTA(this._landingPanel?.getChildByName('ReconnectButton') ?? null);
        enhancePrimaryCTA(this._landingPanel?.getChildByName('PlayAsGuestButton') ?? null);
        enhancePrimaryCTA(this._homePanel?.getChildByName('StartMatchButton') ?? null);
        enhancePrimaryCTA(this._homePanel?.getChildByName('FindMatchButton') ?? null);
        enhancePrimaryCTA(this._homePanel?.getChildByName('BotMatchButton') ?? null);
        enhancePrimaryCTA(this._tokenDuelPanel?.getChildByName('WagerStartButton') ?? null);
        enhancePrimaryCTA(this._tokenDuelPanel?.getChildByName('StartGameButton') ?? null);
        enhancePrimaryCTA(this._tokenDuelPanel?.getChildByName('StakeCommitButton') ?? null);
        // PickerStartButton (inside the ModePicker modal) — find via Canvas lookup
        // since ModePicker can be deeply nested.
        enhancePrimaryCTA(this._findDescendantByName(this.node, 'PickerStartButton'));
    }

    /**
     * v2 Landing — squeeze-on-press feedback (0.97 scale) for the 3 landing
     * CTAs. Cocos's Button.transition=2 (SCALE) multiplies normal scale by
     * _zoomScale at press time; 0.97 means press shrinks node to 97%.
     * Mirrors iOS/Android conventions for entry buttons. Other panels keep
     * the grow-on-press (1.05) default.
     */
    private _setLandingPressScale(): void {
        const set = (name: string) => {
            const btn = this._landingPanel?.getChildByName(name)?.getComponent(Button);
            if (btn) (btn as any)._zoomScale = 0.97;
        };
        set('ConnectButton');
        set('ReconnectButton');
        set('PlayAsGuestButton');
    }

    /**
     * UX overhaul Phase 3: load all 26 icon PNGs + mascot reference image
     * from assets/demo/resources/{icons,mascot}/, register each SpriteFrame
     * in IconLibrary, then re-attach badges so they render as cc.Sprite
     * instead of procedural cc.Graphics.
     *
     * resources.load auto-discovers the spriteFrame sub-asset under each
     * PNG via the `/spriteFrame` suffix. No UUID pasting per icon needed.
     *
     * Loads run in parallel; total time is bounded by the slowest single load
     * (~100-200ms on a warm APK). Icons render procedurally in the meantime
     * and pop to PNG once loaded — one-shot refresh.
     */
    private async _loadPhase3Art(): Promise<void> {
        console.log(`${TAG} phase3 | ENTRY — starting asset load`);
        const iconNames: IconName[] = [
            'trophy', 'medalGold', 'medalSilver', 'medalBronze',
            'cog', 'user', 'book', 'bulb', 'robot',
            'trash', 'save', 'speaker', 'speakerMuted',
            'vibration', 'hand', 'flame', 'bolt', 'sword',
            'coin', 'chart', 'brain', 'star', 'starOutline',
            'sparkle', 'starBurst', 'flag', 'eye',
            'bell', 'check', 'clock', 'crown',
            // Phase N4 — disconnect.png in resources/icons.
            'disconnect',
        ];

        // Kill switches — flip a flag to bypass each loader path. Default ALL
        // off except mascot frames (currently confirmed-or-suspect culprit).
        // The LAST `phase3 | loading=...` log without a paired `loaded=...`
        // is the exact asset whose native load crashed the engine.
        const skipIconsLoad = (globalThis as any).TD_DISABLE_ICON_LOAD === true;
        const skipMascotRefLoad = (globalThis as any).TD_DISABLE_MASCOT_REF === true;

        let loaded = 0;
        let failed = 0;
        // Serialize the icon loads — parallel hides which one crashes.
        const loadOneSerial = async (name: IconName): Promise<void> => {
            console.log(`${TAG} phase3 | icon LOADING name=${name}`);
            await new Promise<void>((resolve) => {
                resources.load<SpriteFrame>(`icons/${name}/spriteFrame`, SpriteFrame, (err, frame) => {
                    const tex: any = (frame as any)?.texture;
                    console.log(`${TAG} phase3 | icon CB_ENTER name=${name} hasErr=${!!err} hasFrame=${!!frame} frame.name=${frame?.name ?? '(none)'} hasTexture=${!!tex} texW=${tex?.width ?? -1} texH=${tex?.height ?? -1} packable=${(frame as any)?.packable ?? '(?)'}`);
                    if (err || !frame) {
                        failed++;
                        console.log(`${TAG} phase3 | icon LOAD_FAIL name=${name} err=${err?.message ?? err}`);
                    } else {
                        const hasTex = !!tex;
                        if (!hasTex) {
                            failed++;
                            console.log(`${TAG} phase3 | icon LOAD_FAIL name=${name} reason=no_texture`);
                        } else {
                            console.log(`${TAG} phase3 | icon CALL_REGISTER name=${name}`);
                            try {
                                IconLibrary.register(name, frame);
                                console.log(`${TAG} phase3 | icon DID_REGISTER name=${name}`);
                            } catch (regErr: any) {
                                console.log(`${TAG} phase3 | icon REGISTER_THREW name=${name} err=${regErr?.message ?? regErr} stack=${regErr?.stack ?? '(no stack)'}`);
                            }
                            loaded++;
                            console.log(`${TAG} phase3 | icon LOADED name=${name} loaded=${loaded}/${iconNames.length}`);
                        }
                    }
                    resolve();
                });
            });
        };

        let mascotFrame: SpriteFrame | null = null;
        const loadMascot = async (): Promise<void> => {
            if (skipMascotRefLoad) {
                console.log(`${TAG} phase3 | mascot_ref LOAD_SKIPPED (TD_DISABLE_MASCOT_REF=true)`);
                return;
            }
            console.log(`${TAG} phase3 | mascot_ref LOADING`);
            await new Promise<void>((resolve) => {
                resources.load<SpriteFrame>('mascot/mascot-ref/spriteFrame', SpriteFrame, (err, frame) => {
                    if (err || !frame) {
                        console.log(`${TAG} phase3 | mascot_ref LOAD_FAIL err=${err?.message ?? err}`);
                    } else {
                        const hasTex = !!(frame as any).texture;
                        if (!hasTex) {
                            console.log(`${TAG} phase3 | mascot_ref LOAD_FAIL reason=no_texture`);
                        } else {
                            mascotFrame = frame;
                            console.log(`${TAG} phase3 | mascot_ref LOADED`);
                        }
                    }
                    resolve();
                });
            });
        };

        // Per-state Seedance frame sequences from assets/demo/resources/mascot/frames/
        // Filenames are <state>_NNN.png — group by state prefix, sort by name
        // (zero-padded → lex sort = numeric sort).
        let mascotFramesByState: Partial<Record<MascotState, SpriteFrame[]>> = {};
        const skipFramesLoad = (globalThis as any).TD_DISABLE_MASCOT_FRAMES === true;
        const loadMascotFrames = (): Promise<void> => new Promise((resolve) => {
            if (skipFramesLoad) {
                console.log(`${TAG} phase3 | mascot_frames LOAD_DIR_SKIPPED (TD_DISABLE_MASCOT_FRAMES=true)`);
                resolve();
                return;
            }
            console.log(`${TAG} phase3 | mascot_frames LOAD_DIR_START`);
            resources.loadDir<SpriteFrame>('mascot/frames', SpriteFrame, (err, frames) => {
                if (err || !frames?.length) {
                    console.log(`${TAG} phase3 | mascot_frames_load_fail err=${err?.message ?? err} got=${frames?.length ?? 0}`);
                    resolve();
                    return;
                }
                console.log(`${TAG} phase3 | mascot_frames LOAD_DIR_RAW count=${frames.length}`);
                const groups: Partial<Record<MascotState, SpriteFrame[]>> = {};
                let nullCount = 0;
                let noTexCount = 0;
                for (const f of frames) {
                    if (!f) { nullCount++; continue; }
                    if (!(f as any).texture) { noTexCount++; continue; }
                    const m = f.name.match(/^(idle|celebrate|think|lose)_/);
                    if (!m) continue;
                    const state = m[1] as MascotState;
                    (groups[state] ??= []).push(f);
                }
                for (const state of Object.keys(groups) as MascotState[]) {
                    groups[state]!.sort((a, b) => a.name.localeCompare(b.name));
                }
                mascotFramesByState = groups;
                console.log(`${TAG} phase3 | mascot_frames groups idle=${groups.idle?.length ?? 0} celebrate=${groups.celebrate?.length ?? 0} think=${groups.think?.length ?? 0} lose=${groups.lose?.length ?? 0} null=${nullCount} no_tex=${noTexCount}`);
                resolve();
            });
        });

        // MASCOT-FIRST + INSTANT_REF order — Two-step reveal so the mascot
        // appears within ~150ms of launch instead of waiting ~1s on the
        // mascot frames LOAD_DIR. Step 1: static ref loads fast (~100ms) →
        // setSpriteSheet({idle:[ref]}) → mascot visible. Step 2: per-state
        // frames load (~900ms) → setSpriteSheet(framesByState) → animation
        // kicks in. The transition is invisible because both steps use the
        // same mascot art; only the loop count changes.
        console.log(`${TAG} phase3 | MASCOT_FIRST start skipMascotRef=${skipMascotRefLoad} skipFrames=${skipFramesLoad}`);
        const killMascot = (globalThis as any).TD_DISABLE_MASCOT_FRAMES === true;

        // Step 1 — static ref first (fast).
        await loadMascot();
        if (mascotFrame && !killMascot) {
            console.log(`${TAG} phase3 | mascot INSTANT_REF applied (single static frame)`);
            this._mascot?.setSpriteSheet({ idle: [mascotFrame] });
            this._postMatchMascot?.setSpriteSheet({ idle: [mascotFrame] });
            this._landingMascot?.setSpriteSheet({ idle: [mascotFrame] });
            this._raceMascot?.setSpriteSheet({ idle: [mascotFrame] });
            // Phase 28 — tutorial card mascots (4 instances).
            for (const tm of this._tutorialMascots) tm?.setSpriteSheet({ idle: [mascotFrame] });
        }

        // Step 2 — per-state frames upgrade.
        await loadMascotFrames();
        const hasFrames = Object.values(mascotFramesByState).some(arr => (arr?.length ?? 0) > 0);
        console.log(`${TAG} phase3 | mascot DONE ref=${!!mascotFrame} hasFrames=${hasFrames}`);

        if (killMascot) {
            console.log(`${TAG} phase3 | mascot SKIPPED (TD_DISABLE_MASCOT_FRAMES=true)`);
        } else if (hasFrames) {
            console.log(`${TAG} phase3 | mascot_apply CALLING setSpriteSheet (per-state)`);
            this._mascot?.setSpriteSheet(mascotFramesByState);
            this._postMatchMascot?.setSpriteSheet(mascotFramesByState);
            this._landingMascot?.setSpriteSheet(mascotFramesByState);
            this._raceMascot?.setSpriteSheet(mascotFramesByState);
            for (const tm of this._tutorialMascots) tm?.setSpriteSheet(mascotFramesByState);
            console.log(`${TAG} phase3 | mascot UPGRADED to per-state frame sequences (4 + tutorial)`);
        } else if (!mascotFrame) {
            console.log(`${TAG} phase3 | mascot FAILED — falling back to procedural body`);
            this._mascot?.showProceduralFallback();
            this._postMatchMascot?.showProceduralFallback();
            this._landingMascot?.showProceduralFallback();
            this._raceMascot?.showProceduralFallback();
            for (const tm of this._tutorialMascots) tm?.showProceduralFallback();
        }

        // Now load icons serially in the background. Mascot is already showing.
        console.log(`${TAG} phase3 | icons starting count=${iconNames.length} skipIcons=${skipIconsLoad}`);
        if (!skipIconsLoad) {
            for (const name of iconNames) {
                await loadOneSerial(name);
            }
        } else {
            console.log(`${TAG} phase3 | icons SKIPPED (TD_DISABLE_ICON_LOAD=true)`);
        }
        console.log(`${TAG} phase3 | icons DONE loaded=${loaded} failed=${failed}`);
        console.log(`${TAG} phase3 | DONE icons_loaded=${loaded}/${iconNames.length} failed=${failed} mascot=${!!mascotFrame || hasFrames}`);

        // Re-attach all bind-time IconBadges now that sprite frames are
        // registered. IconLibrary.attach checks the registry first —
        // registered icons get cc.Sprite path, unregistered stay blank.
        console.log(`${TAG} phase3 | step=_attachStaticIconBadges`);
        this._attachStaticIconBadges();
        // Phase 29 — Settings card row icons (clipboard, chart, lightning,
        // lock, speaker/vibration) re-attach so they pop from procedural to
        // PNG sprite once the asset bundle finishes loading.
        this._attachSettingsRowIcons();
        console.log(`${TAG} phase3 | step=_refreshAudioCard`);
        this._refreshAudioCard();
        console.log(`${TAG} phase3 | step=_refreshWatchlistStarTint`);
        this._refreshWatchlistStarTint();
        if (this._feedTabDropdownLabel) {
            console.log(`${TAG} phase3 | step=_updateFeedTabDropdownLabel`);
            this._updateFeedTabDropdownLabel(this._currentFeedTab as any);
        }
        console.log(`${TAG} phase3 | EXIT — all assets applied`);
    }

    /**
     * betting-duel polish: force-hide every top-level panel except the named
     * one. Prevents stale panel content (e.g. TokenDuelPanel's "Token Duel"
     * title) from bleeding behind sibling panels like Leaderboard / Portfolio.
     * _setActivePanel only toggles landing/home/tokenDuel; this covers the
     * full sibling set including Leaderboard/Portfolio/Settings/Daily/Spec.
     */
    private _hideAllTopLevelPanelsExcept(keep: 'leaderboard' | 'portfolio' | 'settings'): void {
        const candidateNames = ['LandingPanel', 'HomePanel', 'TokenDuelPanel', 'TokenDetailPanel',
            'LeaderboardPanel', 'PortfolioPanel', 'SettingsPanel', 'DailyChallengePanel',
            'SpectatorPanel', 'TournamentPanel', 'PostMatchPanel', 'WaitingPanel'];
        const keepMap: Record<string, string> = {
            leaderboard: 'LeaderboardPanel',
            portfolio:   'PortfolioPanel',
            settings:    'SettingsPanel',
        };
        const keepName = keepMap[keep];
        let hidden = 0;
        for (const name of candidateNames) {
            if (name === keepName) continue;
            const n = this.node.getChildByName(name);
            if (n && n.active) { n.active = false; hidden++; }
        }
        console.log(`${TAG} _hideAllTopLevelPanelsExcept | keep=${keep} hidden=${hidden}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  LANDING HANDLERS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Play as Guest — zero-friction entry. Generates a synthetic local-only
     * id (`guest_<hex>`), persists it in localStorage, and drops the user
     * straight into Home in guest mode (paper-bot only, no SOL, no wallet).
     */
    private _onPlayAsGuest(): void {
        // Clear any stale wallet state so the guest flow doesn't conflict.
        const id = `guest_${Date.now().toString(16)}${Math.floor(Math.random() * 0xFFFF).toString(16)}`;
        this._guestId = id;
        try {
            const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
            ls?.setItem?.('tokenduel:guest_id', id);
        } catch (_) { /* ignore */ }
        console.log(`${TAG} _onPlayAsGuest | id=${id}`);
        this._showHome();
    }

    /**
     * Sign Out (guest) — clears guest_id + paper Stats, returns to Landing.
     * No backend calls because guests never had any DB rows to clean up.
     */
    private _onSignOutGuest(): void {
        const previousId = this._guestId;
        console.log(`${TAG} _onSignOutGuest | clearing guest_id=${previousId}`);
        this._guestId = null;
        try {
            const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
            ls?.removeItem?.('tokenduel:guest_id');
        } catch (_) { /* ignore */ }
        // Per plan section F: paper Stats wiped on sign-out so next guest starts fresh.
        try { Stats.clear('paper'); } catch (_) { /* ignore */ }
        this._displayNameCache.clear();
        this._displayNameInflight.clear();
        this._setActivePanel('landing');
    }

    /**
     * Resolve the active session id — real wallet pubkey first, then guest
     * synthetic id, then empty string. Used everywhere we need an identity.
     */
    private _currentPubkey(): string {
        return MWAManager.instance?.connectedPubkey || this._guestId || '';
    }

    /** True when running in guest mode (no real wallet, but a guest_id is set). */
    private _isGuest(): boolean {
        return !!this._guestId && !MWAManager.instance?.connectedPubkey;
    }

    /** True only when a REAL wallet is connected — gate for backend writes. */
    private _shouldHitBackend(): boolean {
        const pk = MWAManager.instance?.connectedPubkey;
        return !!pk && pk.length >= 32 && !this._isGuest();
    }

    private async _onConnect(): Promise<void> {
        console.log(`${TAG} onConnect | START — opening OS wallet picker`);
        this._setLandingEnabled(false);
        this._setConnectionPill('connecting');

        const result = await MWAManager.instance?.authorize();
        if (result) {
            // Pass 10: `authorize()` delegates to `authorizeSiws()` when a
            // SIWS identity is configured (DemoAppConfig enables this). The
            // returned shape may include `signInResult` — if it does, the
            // wallet produced a CAIP-122 proof-of-ownership signature (native
            // from Backpack; fallback from Jupiter / Seed Vault). Phantom and
            // Solflare degrade to a plain authorize session without SIWS
            // (sign_messages fallback times out at 15 s — KNOWN_ISSUES #11).
            const siwsResult = (result as any).signInResult;
            const hasSiws = siwsResult && siwsResult.signature && siwsResult.signature.length > 0;
            console.log(`${TAG} onConnect | SUCCESS pubkey=${result.pubkey} authToken_len=${result.authToken?.length ?? 0} siws=${hasSiws ? 'yes' : 'no'} siws_sig_len=${siwsResult?.signature?.length ?? 0}`);
            // Real wallet wins — guest_id retired. Paper Stats stay (device-keyed) so
            // any guest progress carries forward.
            if (this._guestId) {
                console.log(`${TAG} onConnect | retiring guest_id=${this._guestId} for real wallet`);
                this._guestId = null;
                try {
                    const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
                    ls?.removeItem?.('tokenduel:guest_id');
                } catch (_) { /* ignore */ }
            }
            const shortPk = `${result.pubkey.substring(0, 4)}...${result.pubkey.substring(result.pubkey.length - 4)}`;
            if (hasSiws) {
                showToast(`Signed in with Solana: ${shortPk}`, true);
            } else {
                showToast(`Connected: ${shortPk}`);
                showToast('Auth cached');
            }
            // DB Stage 9 — bind cross-device sync + hydrate user collections
            // (squad presets + watchlist) before rendering Home. Hydrate is
            // best-effort: backend offline ⇒ keep using local copies.
            this._bindUserCollectionsSync(result.pubkey);
            void this._hydrateUserCollections(result.pubkey);
            // Phase 19 — cover the post-auth → home-render gap with the
            // LoadingOverlay. Wraps _showHome so the overlay shows while
            // the home panel finishes binding/rendering, then dismisses.
            this._showLoadingOverlay('Loading your dashboard…');
            this._showHome();
            this._hideLoadingOverlay();
        } else {
            console.log(`${TAG} onConnect | FAIL result=null`);
            showToast('Authorization failed');
            this._setConnectionPill('failed');
            this._setLandingEnabled(true);
        }
    }

    private async _onReconnect(): Promise<void> {
        console.log(`${TAG} onReconnect | START`);
        this._setLandingEnabled(false);
        this._setConnectionPill('connecting');

        // Phase 19 — cover the silent reauth + data-fetch gap (~300-1500ms).
        this._showLoadingOverlay('Reconnecting your wallet…');
        const result = await MWAManager.instance?.reauthorize();
        if (result) {
            console.log(`${TAG} onReconnect | SUCCESS pubkey=${result.pubkey}`);
            showToast('Reconnected');
            this._bindUserCollectionsSync(result.pubkey);
            void this._hydrateUserCollections(result.pubkey);
            this._showHome();
        } else {
            console.log(`${TAG} onReconnect | FAIL result=null`);
            showToast('Reconnect failed');
            this._setConnectionPill('failed');
            this._setLandingEnabled(true);
        }
        this._hideLoadingOverlay();
    }

    /** DB Stage 9/10 — wire local stores to push mutations through to the
     *  backend mirror for the connected wallet. Pass null to detach on
     *  disconnect / guest mode. */
    private _bindUserCollectionsSync(pubkey: string | null): void {
        try { SquadPresets.setSyncPubkey(pubkey); } catch (_) { /* defensive */ }
        try { Watchlist.setSyncPubkey(pubkey); } catch (_) { /* defensive */ }
        try { NotificationStore.instance.setSyncPubkey(pubkey); } catch (_) { /* defensive */ }
        // Sound + Haptics imported lazily to avoid pulling AudioSource init
        // into modules that don't need it.
        void (async () => {
            try {
                const { setSoundSyncPubkey } = await import('../../token-duel/scripts/Sound');
                setSoundSyncPubkey(pubkey);
            } catch (_) { /* ignore */ }
            try {
                const { Haptics: H } = await import('../../token-duel/scripts/Haptics');
                H.setSyncPubkey(pubkey);
            } catch (_) { /* ignore */ }
        })();
    }

    /** DB Stage 9/10 — pull presets + watchlist + notifications + preferences
     *  from backend, merge per the per-feature conflict strategy. Best-effort;
     *  logs and returns on failure. */
    private async _hydrateUserCollections(pubkey: string): Promise<void> {
        if (!pubkey) return;
        try {
            await Promise.all([
                SquadPresets.hydrateFromBackend(pubkey).catch((e) => {
                    console.log(`${TAG} hydrate_presets | ${e}`);
                    return false;
                }),
                Watchlist.hydrateFromBackend(pubkey).catch((e) => {
                    console.log(`${TAG} hydrate_watchlist | ${e}`);
                }),
                NotificationStore.instance.hydrateFromBackend(pubkey).catch((e) => {
                    console.log(`${TAG} hydrate_notifications | ${e}`);
                }),
                this._hydratePreferences(pubkey).catch((e) => {
                    console.log(`${TAG} hydrate_prefs | ${e}`);
                }),
            ]);
        } catch (e) {
            console.log(`${TAG} _hydrateUserCollections | ${e}`);
        }
    }

    /** DB Stage 10 — pull preferences from backend and apply to localStorage
     *  + live UI controls. Server is authoritative on hydrate (preferences
     *  are explicit user choices, not device-relative). */
    private async _hydratePreferences(pubkey: string): Promise<void> {
        try {
            const { fetchPreferences } = await import('../../token-duel/scripts/PreferencesRpc');
            const remote = await fetchPreferences(pubkey);
            if (!remote || !remote.preferences) return;
            const p = remote.preferences as any;
            const ls = this._readLocalStorage();
            if (typeof p.botDifficulty === 'string') {
                ls?.setItem?.('tokenduel:botDifficulty', p.botDifficulty);
                this._pickerSelectedDifficulty = p.botDifficulty;
            }
            if (typeof p.qpMode === 'string')   ls?.setItem?.('tokenduel:qp.mode', p.qpMode);
            if (typeof p.qpWindow === 'string') ls?.setItem?.('tokenduel:qp.window', p.qpWindow);
            if (typeof p.qpWager === 'string')  ls?.setItem?.('tokenduel:qp.wager', p.qpWager);
            if (typeof p.qpTrack === 'string')  ls?.setItem?.('tokenduel:qp.track', p.qpTrack);
            // Audio + haptics — apply via their own hydrate hooks so the live
            // AudioSource volume + cached _enabled flag track the new value.
            try {
                const { applySoundPreferences } = await import('../../token-duel/scripts/Sound');
                applySoundPreferences({
                    soundEnabled: typeof p.soundEnabled === 'boolean' ? p.soundEnabled : undefined,
                    soundVolume: typeof p.soundVolume === 'number' ? p.soundVolume : undefined,
                });
            } catch (_) { /* ignore */ }
            try {
                const { Haptics: H } = await import('../../token-duel/scripts/Haptics');
                H.applyPreference({
                    hapticsEnabled: typeof p.hapticsEnabled === 'boolean' ? p.hapticsEnabled : undefined,
                });
            } catch (_) { /* ignore */ }
            // Refresh any UI surface that reads from localStorage (QP card,
            // settings card icons, etc).
            try { this._refreshQPCard?.(); } catch (_) { /* ignore */ }
            console.log(`${TAG} _hydratePreferences | applied keys=[${Object.keys(p).join(',')}]`);
        } catch (e) {
            console.log(`${TAG} _hydratePreferences | ${e}`);
        }
    }

    /** DB Stage 10 — fire-and-forget merge-patch of user preferences to the
     *  backend mirror. No-op for guests (no users row to attach to) or
     *  pre-connect. */
    private _syncPreference(patch: Record<string, unknown>): void {
        const pubkey = MWAManager.instance?.connectedPubkey;
        if (!pubkey || this._isGuest()) return;
        void (async () => {
            try {
                const { putPreferences } = await import('../../token-duel/scripts/PreferencesRpc');
                await putPreferences(pubkey, patch as any);
            } catch (e) {
                console.log(`${TAG} _syncPreference | NET_ERR ${e}`);
            }
        })();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  HOME HANDLERS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Start Match — host a real on-chain match. Routes to TokenDuelPanel in
     * "create" mode (no _pickerJoinTarget set) where the user picks 3 tokens
     * + selects wager tier + opens ModePicker. Same flow the legacy
     * "Play Token Duel" button used to invoke.
     */
    private _onStartMatch(): void {
        console.log(`${TAG} _onStartMatch | host new match — clearing join + bot flags`);
        this._pickerJoinTarget = null;
        this._pickerBotMode = false;
        this._showTokenDuel();
        this._refreshWagerControlRow();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Part 10 Bundle 2 — Bot Match (formerly Quick Play) + Squad Presets + Suggested Squad
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Bot Match — opens TokenDuelPanel in BOT mode so the user picks tokens
     * manually (mirror of Start Match flow). Track is pre-set to paper, no
     * wager dropdown is shown (free practice), and the WagerStartButton
     * routes straight to the paper bot flow without going through ModePicker.
     *
     * Phase A2: previously this auto-filled the squad and skipped the picker
     * entirely (legacy Quick Play behavior). User asked for picker to open
     * so they can choose tokens like a real match.
     */
    private _onBotMatch(): void {
        console.log(`${TAG} _onBotMatch | open_token_picker bot_mode=true`);
        // Read user's last-used Bot defaults.
        const ls = this._readLocalStorage();
        const modeId = (ls?.getItem?.('tokenduel:qp.mode') as keyof typeof MODES) ?? 'oneVone';
        const windowId = (ls?.getItem?.('tokenduel:qp.window') as TimeWindowId) ?? DEFAULT_TIME_WINDOW;

        this._pickerJoinTarget = null;
        this._pickerHostMode = false;
        this._pickerSelectedMode = MODES[modeId] ? modeId : 'oneVone';
        this._pickerSelectedTrack = 'paper';
        this._pickerSelectedWindow = windowId;
        this._pickerBotMode = true;

        // 2026-04-27 — Bot Match opens TokenDuelPanel (token picker) FIRST.
        // The ModePicker is opened later by _onWagerStartTap when the user
        // has picked 3 tokens and tapped "▶ Start Duel".
        this._showTokenDuel();
        this._refreshWagerControlRow();
    }

    private _applySquadFromRows(rows: TokenRow[]): void {
        for (let i = 0; i < Math.min(3, rows.length); i++) {
            this._squad.setAt(i, rows[i]);
        }
    }

    private _applySquadFromSlots(slots: Array<{ mint: string; symbol: string; logoUri?: string }>): void {
        for (let i = 0; i < Math.min(3, slots.length); i++) {
            const row: TokenRow = {
                address: slots[i].mint,
                symbol: slots[i].symbol,
                name: slots[i].symbol,
                priceUsd: 0, change24hPct: 0, volume24hUsd: 0,
                decimals: -1, logoUri: slots[i].logoUri ?? '',
                liquidity: 0, marketCap: 0, fdv: 0, holders: 0,
                blockUnixTime: 0, source: '', smartTraders: 0, netFlow: 0,
            };
            this._squad.setAt(i, row);
        }
    }

    private _ensureBirdeye(): void {
        if (!this._birdeye) this._birdeye = new BirdeyeClient();
    }

    private _readLocalStorage(): Storage | null {
        try {
            const s = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
            return s && typeof s.getItem === 'function' ? s : null;
        } catch (_) { return null; }
    }

    /**
     * Suggest Squad (💡): fill all 3 slots from the current window's top gainers.
     * Differs from Quick-Play: doesn't auto-start the match, just pre-populates.
     */
    private async _onSuggestSquad(): Promise<void> {
        console.log(`${TAG} _onSuggestSquad | window=${this._pickerSelectedWindow}`);
        try {
            this._ensureBirdeye();
            const rows = await this._birdeye!.getTrending('gainers', 10);
            const filtered = this._pickerSelectedWindow === '24h' || this._pickerSelectedWindow === '7d'
                ? rows.filter((r) => r.liquidity > 50_000)
                : rows;
            const picks = filtered.slice(0, 3);
            if (picks.length < 3) {
                showToast('Not enough gainers — try a shorter window');
                return;
            }
            this._applySquadFromRows(picks);
            showToast(`Suggested: ${picks.map((r) => r.symbol).join(' · ')}`);
        } catch (e) {
            console.log(`${TAG} _onSuggestSquad | ERROR ${e}`);
            showToast('Suggestion failed — pick tokens manually');
        }
    }

    /**
     * Presets (📚): open the SquadPresetsOverlay — user can tap a row to load
     * a saved preset, tap 🗑️ to delete, or "💾 Save current squad" to persist
     * the current filled squad under a custom name (via PresetNameModal EditBox).
     */
    private _onOpenSquadPresets(): void {
        if (!this._squadPresetsOverlay) {
            showToast('Presets overlay not available');
            return;
        }
        console.log(`${TAG} _onOpenSquadPresets | OPEN`);
        this._squadPresetsOverlay.active = true;
        // Hide the modal on fresh open (it may have been left active from a prior session).
        if (this._presetNameModal) this._presetNameModal.active = false;
        this._renderPresetRows();
    }

    /**
     * Streak strip tap → open DailyChallengePanel (full retention UI).
     */
    private _onOpenDailyChallenges(): void {
        if (!this._dailyChallengePanel) {
            showToast('Daily challenges not available');
            return;
        }
        console.log(`${TAG} _onOpenDailyChallenges | OPEN`);
        this._homePanel.active = false;
        this._dailyChallengePanel.active = true;
        void this._refreshDailyChallengePanel();
    }

    private _onDailyChallengeBackClick(): void {
        if (!this._dailyChallengePanel) return;
        console.log(`${TAG} _onDailyChallengeBackClick | CLOSE`);
        this._dailyChallengePanel.active = false;
        this._homePanel.active = true;
    }

    private _onTokenDuelBack(): void {
        console.log(`${TAG} onTokenDuelBack | returning to Home panel feed_poll_was_active=${this._feedPollTimer !== null} squad_filled=${this._squad.filled}`);
        if (this._game) {
            this._game.destroy();
            this._game = null;
        }
        // Phase III teardown — stop feed poll + price feed, but keep the squad
        // in memory so re-entering the panel restores the user's picks.
        if (this._feedPollTimer !== null) {
            clearInterval(this._feedPollTimer as unknown as number);
            this._feedPollTimer = null;
        }
        this._priceFeed?.stop();
        this._showHome();
    }

    private _onStartGame(): void {
        console.log(`${TAG} onStartGame | START squad_filled=${this._squad.filled}`);

        // Phase III: prefer the squad's picks. Fallback to the wallet's top
        // holdings when the squad is empty (no squad tokens → game skin uses
        // the user's SPL balances, same as v1 behavior).
        const squadHoldings: Holding[] = [];
        for (const s of this._squad.slots) {
            if (s) squadHoldings.push({ mint: s.address, symbol: s.symbol, uiAmount: 0 });
        }
        // Pad to 3 for the game loop's assumption. If the squad had 1 pick we
        // repeat it so blocks don't cycle through empty '---' tiles.
        while (squadHoldings.length > 0 && squadHoldings.length < 3) {
            squadHoldings.push(squadHoldings[squadHoldings.length % Math.max(1, this._squad.filled)]);
        }

        let gameHoldings: Holding[];
        if (squadHoldings.length === 3) {
            gameHoldings = squadHoldings;
            console.log(`${TAG} onStartGame | source=squad symbols=[${gameHoldings.map(h => h.symbol).join(', ')}]`);
        } else if (this._cachedHoldings && this._cachedHoldings.length >= 3) {
            gameHoldings = this._cachedHoldings;
            console.log(`${TAG} onStartGame | source=wallet_holdings symbols=[${gameHoldings.map(h => h.symbol).join(', ')}]`);
        } else {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Pick a squad or wait for holdings — tap Back and retry';
            console.log(`${TAG} onStartGame | FAIL no_source cached=${this._cachedHoldings?.length ?? 0} squad=${this._squad.filled}`);
            return;
        }
        // Stash for downstream (claim flow reads from _cachedHoldings for hero display).
        this._cachedHoldings = gameHoldings;

        // Hide pre-game UI and stake controls.
        this._setPreGameContextActive(false);
        if (this._startGameButton) this._startGameButton.node.active = false;
        if (this._stakeCommitButton) this._stakeCommitButton.node.active = false;
        if (this._gameOverLabel) this._gameOverLabel.node.active = false;

        // Show game area.
        if (this._gameArea) this._gameArea.active = true;
        if (this._tokenDuelStatus) this._tokenDuelStatus.string = '';
        if (this._raceHintLabel) this._raceHintLabel.string = 'Tap to drop - stack as high as you can';

        // Lazy-init PriceFeed once per session. Creating it is cheap (constructs
        // a BirdeyeClient with an embedded API key), so this could move to ctor,
        // but we defer so users who never enter Token Duel don't pay the cost.
        const priceFeedExisted = !!this._priceFeed;
        if (!this._priceFeed) this._priceFeed = new PriceFeed();
        console.log(`${TAG} onStartGame | priceFeed_lazy_init=${!priceFeedExisted} reused=${priceFeedExisted}`);
        // Part 9: pin the session's timeframe to the window selected in
        // ModePicker. Real matches honor the on-chain time_window field
        // directly; paper matches use whatever's currently selected.
        this._priceFeed.setTimeframe(this._pickerSelectedWindow);

        // betting-duel Block 9: ReceiptSession / physics-backend flow is dead
        // code on this branch (races are price-deterministic; no gameplay
        // physics to validate). Settles always use the legacy `settle_match`
        // path with the client-computed encoded delta as the score.
        this._useVerifiedPath = false;
        this._lastMatchUnverifiedReason = null;

        // betting-duel Phase 3: show RacePanel before the race starts so entry
        // state renders at t=0 instead of popping in after the first tick.
        this._showRacePanel(gameHoldings);

        // betting-duel Phase 5: pick up race duration from the ModePicker window row.
        const windowDef = TIME_WINDOWS[this._pickerSelectedWindow] ?? TIME_WINDOWS[DEFAULT_TIME_WINDOW];
        const windowMs = windowDef.durationMs;

        // betting-duel bug bash: thread the squad's cached feed-row prices
        // into PortfolioRace as fallback. Handles the case where Birdeye's
        // multi_price endpoint doesn't index a mint (common for new pump.fun
        // tokens) — race uses the trending-feed snapshot instead of aborting
        // with NO_ENTRY_PRICES and instant-completing with 0% delta.
        const fallbackEntryPrices: Record<string, number> = {};
        for (const slot of this._squad.slots) {
            if (slot && slot.address && Number.isFinite(slot.priceUsd) && slot.priceUsd > 0) {
                fallbackEntryPrices[slot.address] = slot.priceUsd;
            }
        }
        console.log(`${TAG} onStartGame | fallback_entry_prices count=${Object.keys(fallbackEntryPrices).length}`);

        // Instantiate and start the game.
        this._game = new TokenDuelGame({
            gameArea: this._gameArea,
            blockTemplate: this._blockTemplate,
            heightLabel: this._heightLabel,
            tokenBadgeLabel: this._tokenBadgeLabel,
            holdings: gameHoldings,
            priceFeed: this._priceFeed,
            windowMs,
            fallbackEntryPrices,
            // betting-duel polish: tutorial no longer fires during race; it
            // runs on first TokenDuelPanel open and via the `?` HelpButton.
            // ReceiptSession removed on betting-duel — no block-drop events.
            onRaceTick: (snap) => this._onRaceTick(snap),
            onGameOver: (h, d) => this._onGameOver(h, d),
            // Phase F5/F6 — connection state + price-feed quality callbacks.
            onPriceFallback: (mint, fb) => this._onPriceFallback(mint, fb),
            onStalePrice: (mint, ticks) => this._onStalePrice(mint, ticks),
            onPriceRecovered: (mint) => this._onPriceRecovered(mint),
            onConnectionState: (state) => this._onConnectionState(state),
        });
        // Block 3: 3-2-1-GO countdown before race starts. Race is shown
        // (via _showRacePanel above) so the user sees entry state in the
        // background; countdown is the top-of-stack attention grabber.
        const squadSyms = gameHoldings.map((h) => h?.symbol || '?').filter((s) => s !== '?');
        this._showCountdown(squadSyms, () => {
            // Stage 2G — fly-in cinematic (~800ms) before PortfolioRace.start().
            this._playRaceStartCinematic();
            // SQUADS_HIDDEN_UNTIL_RACE_START — flush any queued opponent
            // squad payloads now that the race is actually starting. Real
            // matches buffer them from join-time; paper matches no-op.
            if (this._activeRealMatchPda) {
                void import('../../token-duel/scripts/SpectatorRpc')
                    .then((m) => m.releasePreRaceBuffer(this._activeRealMatchPda as string))
                    .catch(() => { /* dynamic-import error already logged */ });
            }
            // `start()` is async (awaits Birdeye). Fire-and-forget; any tap
            // events before entry prices resolve are gated by the PortfolioRace
            // `_running` flag. Defer start by the cinematic duration so the
            // race doesn't tick during the reveal.
            setTimeout(() => {
                this._game?.start().catch((e) => console.log(`${TAG} onStartGame | START_ERROR error=${e}`));
            }, 800);
        });
    }

    private _onGameOver(height: number, deltas: Record<string, number>): void {
        console.log(`${TAG} onGameOver | height=${height} deltas=${JSON.stringify(deltas)}`);
        this._sessionDeltas = deltas;
        // 2026-04-27 (DB Stage 8) — Snapshot the in-flight local match BEFORE
        // _clearCurrentLocalMatch() drops the entry, so the paper-bot branch
        // below can POST a paper_match_history row using its synthetic id +
        // started_at + final heights. Saved fields are read at most once
        // by the history POST closure and ignored otherwise.
        const savedLocalPda = this._currentLocalMatchPda;
        const savedLocal = savedLocalPda
            ? this._localActiveMatches.find((m) => m.pda === savedLocalPda) ?? null
            : null;
        const savedTrack: 'bot' | 'paper-real' = this._pickerBotMode ? 'bot' : 'paper-real';
        // 2026-04-27 — Local race ended (settle / forfeit / natural finish).
        // Drop it from MIP. No-op for real matches (no local entry was registered).
        this._clearCurrentLocalMatch();
        // betting-duel: the stack-jump legacy overlay (`GameOverLabel` with
        // "Game Over — Height: …" + `ClaimPayoutButton` + "Tap Claim Payout"
        // status) must NOT show on this branch. The match path is paper-bot
        // or real-settle → PostMatchPanel, never legacy solo-settle-by-click.
        if (this._gameOverLabel) this._gameOverLabel.node.active = false;
        if (this._gameArea) this._gameArea.active = false;
        this._hideRacePanel();
        this._lastGameHeight = height;
        if (this._claimButton) {
            this._claimButton.node.active = false;
            this._claimButton.interactable = false;
        }
        if (this._tokenDuelStatus) {
            this._tokenDuelStatus.string = '';
        }

        const tierKey = this._tierKey(height);
        const stakeLamports = Number(this._selectedStakeLamports);

        // Session D Part 4/5: real on-chain match — capture pre-settle level so
        // PostMatchPanel can flash level-up correctly, then submit + readback.
        if (this._pendingRealMatch && this._activeRealMatchPda) {
            this._pendingRealMatch = false;
            const matchPda = this._activeRealMatchPda;
            console.log(`${TAG} onGameOver | pending_real=true match=${matchPda} height=${height}`);
            (async () => {
                const pubkey = MWAManager.instance?.connectedPubkey ?? '';
                const preStats = pubkey ? await loadRealStats(this._tdRpc, pubkey) : null;
                const previousLevel = preStats?.level ?? 0;
                const previousXp = preStats?.xp ?? 0;

                const ok = await this._submitSettleMatch(matchPda, height);
                if (!ok) {
                    // Phase G7 — surface the specific MWA error rather than a generic line.
                    const mwa = MWAManager.instance;
                    const friendly = this._friendlyMwaError(mwa?.lastError?.code, mwa?.lastError?.message);
                    if (this._tokenDuelStatus) this._tokenDuelStatus.string = `Settle failed — ${friendly}`;
                    return;
                }
                const result = await this._readRealMatchResult(matchPda, previousLevel, previousXp);
                if (!result) {
                    // Other player hasn't settled yet. Show a partial PostMatchPanel.
                    this._showPostMatchPanel({
                        won: false,
                        playerHeight: height,
                        opponentHeight: 0,
                        xpGained: 0,
                        newLevel: previousLevel,
                        previousLevel,
                        totalXp: previousXp,
                        payoutLamports: 0,
                        track: 'real',
                    });
                    if (this._postMatchSubtitleLabel) this._postMatchSubtitleLabel.string = 'Submitted — awaiting opponent\'s settlement.';
                    return;
                }
                this._activeRealMatchPda = null;
                this._showPostMatchPanel({
                    won: result.won,
                    // Tie iff scores are equal AND nobody is the declared winner
                    // (on-chain settlement may already encode that as `!won && payout=0`).
                    tie: !result.won && result.playerHeight === result.opponentHeight,
                    playerHeight: result.playerHeight,
                    opponentHeight: result.opponentHeight,
                    xpGained: result.xpGained,
                    newLevel: result.newLevel,
                    previousLevel: result.previousLevel,
                    totalXp: result.totalXp,
                    payoutLamports: result.payoutLamports,
                    track: 'real',
                    placement: result.placement,
                    totalPlayers: result.totalPlayers,
                    modeLabel: result.modeLabel,
                });
                // Phase N4 — settled + (if won) payout notifications.
                this._emitNotification('match_settled', result.won ? 'You won!' : 'Match settled',
                    `${result.modeLabel} · placement ${(result.placement ?? 0) + 1}/${result.totalPlayers ?? '?'}`,
                    { payload: { matchPda }, dedupeKey: matchPda, quietToast: true });
                if (result.won && result.payoutLamports > 0) {
                    const sol = result.payoutLamports / 1e9;
                    this._emitNotification('payout', `You won ${sol.toFixed(3)} SOL!`,
                        `Payout from ${result.modeLabel} · landed in your wallet.`,
                        { payload: { matchPda, lamports: result.payoutLamports }, dedupeKey: `${matchPda}:payout` });
                }
                // Stage 2 — refresh top-right Level chip after Real settle.
                void this._refreshLevelChip();
                // DB Stage 4 — persist match record to backend for cross-device
                // history lookup. Both winner and loser POST; backend dedupes
                // on matchPda. Squad mints come from the player's local squad
                // (other players' squads aren't known here; backend can later
                // merge if other client posts with their squad).
                const myPubkeyRS = MWAManager.instance?.connectedPubkey;
                if (myPubkeyRS && matchPda) {
                    (async () => {
                        try {
                            const { postMatchRecord } = await import('../../token-duel/scripts/MatchHistoryDbRpc');
                            const mySquadMints = this._squad.slots
                                .map((s) => s?.address ?? '')
                                .filter((m) => m.length >= 32);
                            // Result shape doesn't carry the full match — the
                            // resolver computes payouts in-memory but keeps
                            // typed surface narrow. Pull extra context off the
                            // resolver result via dynamic access, then fall
                            // back to single-player snapshot. Backend dedupes.
                            const r: any = result;
                            const players: string[] = Array.isArray(r.players) && r.players.length > 0
                                ? r.players
                                : [myPubkeyRS];
                            const heights: number[] = Array.isArray(r.heights) && r.heights.length === players.length
                                ? r.heights
                                : players.map((p) => p === myPubkeyRS ? height : 0);
                            const winnerPubkey: string | null = r.winnerPubkey ?? (result.won ? myPubkeyRS : null);
                            await postMatchRecord({
                                matchPda,
                                modeU8: this._realMatchMode,
                                wagerTier: this._realMatchWagerTier,
                                wagerLamports: this._realMatchWagerLamports,
                                timeWindow: TIME_WINDOWS[this._pickerSelectedWindow]?.windowU8 ?? 0,
                                players,
                                heights,
                                winnerPubkey,
                                payouts: Array.isArray(r.payouts) ? r.payouts : [],
                                rakeLamports: typeof r.rakeLamports === 'number' ? r.rakeLamports : 0,
                                status: 2,
                                createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
                                startedAt: typeof r.startedAt === 'string' ? r.startedAt : null,
                                settledAt: new Date().toISOString(),
                                squadMintsByPlayer: { [myPubkeyRS]: mySquadMints },
                            });
                        } catch (e) {
                            console.log(`${TAG} match_history_post_err | ${e}`);
                        }
                    })();
                }
            })().catch((e) => {
                console.log(`${TAG} onGameOver | REAL_SETTLE_ERROR error=${e}`);
            });
            return;
        }

        // Session D Part 2/3/6: paper+bot match — any mode now. Samples N-1
        // bots, ranks player among them, awards payout + XP per mode table.
        if ((this as any)._pendingPaperBotMatch) {
            (this as any)._pendingPaperBotMatch = false;
            const paperRecBefore = Stats.load('paper');
            const previousLevel = levelFromXp(paperRecBefore.xp);
            const botGamesRemaining = Math.max(0, 5 - paperRecBefore.games);
            const lbHeights: number[] = []; // BotOpponent falls back to fixed params when empty
            const modeId = (this._pickerSelectedMode || 'oneVone') as any;
            const outcome = runPaperBotMatch({
                mode: modeId,
                wagerTierLamports: stakeLamports,
                playerHeight: height,
                leaderboardHeights: lbHeights,
                botGamesRemaining,
                windowMs: TIME_WINDOWS[this._pickerSelectedWindow]?.durationMs ?? TIME_WINDOWS[DEFAULT_TIME_WINDOW].durationMs,
                // Phase E — bot difficulty + Hard gainers snapshot.
                difficulty: this._pickerSelectedDifficulty,
                hardGainersSnapshot: this._hardGainersSnapshot,
            });
            this._lastMatchOutcome = {
                won: outcome.playerWon,
                opponentHeight: outcome.opponentHeight,
                xp: outcome.xpGained,
                track: 'paper',
            };
            // Session D Part 3/5/6: derive new level + show PostMatchPanel with placement info.
            const paperRecAfter = Stats.load('paper');
            const newLevel = levelFromXp(paperRecAfter.xp);
            const modeDef = MODES[modeId as keyof typeof MODES] ?? MODES.oneVone;
            this._showPostMatchPanel({
                won: outcome.playerWon,
                // Paper-bot tie: deterministic encoded scores from
                // runPaperBotMatch (see Matchmaker.ts) — equal scores with no
                // payout means the match drew. Map → think mascot.
                tie: !outcome.playerWon && height === outcome.opponentHeight,
                playerHeight: height,
                opponentHeight: outcome.opponentHeight,
                xpGained: outcome.xpGained,
                newLevel,
                previousLevel,
                totalXp: paperRecAfter.xp,
                payoutLamports: outcome.payoutLamports,
                track: 'paper',
                placement: outcome.placement,
                totalPlayers: outcome.totalPlayers,
                modeLabel: modeDef.label,
            });
            const placementDisplay = (outcome.placement ?? 0) + 1;
            const totalDisplay = outcome.totalPlayers ?? '?';
            console.log(`${TAG} onGameOver | PAPER_BOT_SETTLED mode=${modeId} placement=${placementDisplay}/${totalDisplay} won=${outcome.playerWon} xp=${outcome.xpGained} prev_level=${previousLevel} new_level=${newLevel}`);
            // DB Stage 3 — sync paper XP delta to backend (cross-device). Fire-
            // and-forget; localStorage Stats is still authoritative per-device.
            // Guest mode skips backend (synthetic IDs would break FK constraints).
            // DB Stage 9 — also includes signed profit delta so lifetime PnL
            // survives device wipes. pnl mirrors what Stats.record stored
            // locally inside runPaperBotMatch (Matchmaker.ts:100).
            const myPubkey = MWAManager.instance?.connectedPubkey;
            const pnlLamports = outcome.payoutLamports - stakeLamports;
            if (myPubkey && !this._isGuest() && outcome.xpGained > 0) {
                (async () => {
                    try {
                        const { postPaperXpDelta } = await import('../../token-duel/scripts/PaperXpRpc');
                        await postPaperXpDelta(myPubkey, outcome.xpGained, 'bot', outcome.playerWon, pnlLamports);
                    } catch (e) {
                        console.log(`${TAG} paper_xp_post_err | ${e}`);
                    }
                })();
            }
            // DB Stage 10 — match-end notification so the user sees a record
            // of every match they've played even if they close the app
            // mid-cinematic or come back days later. Real-mode is handled
            // server-side by notification_listener; paper has no chain
            // footprint, so the client emits here. NotificationStore handles
            // the fire-and-forget POST when a sync pubkey is bound.
            // Deterministic id so a re-emit (e.g. WS hydrate echo) collapses on
            // the local store via upsert-by-id. Falls back to a timestamp suffix
            // for guests where there's no synthetic match id and no pubkey.
            const notifId = savedLocalPda
                ? `paper-bot:${savedLocalPda}`
                : `paper-bot:${myPubkey ?? 'guest'}:${Date.now()}`;
            this._emitNotification(
                'match_settled',
                outcome.playerWon ? 'Bot match · Win!' : 'Bot match · Loss',
                `${modeDef.label} · ${placementDisplay} of ${totalDisplay} · +${outcome.xpGained} XP`,
                {
                    id: notifId,
                    payload: {
                        track: 'bot',
                        mode: modeId,
                        modeLabel: modeDef.label,
                        placement: outcome.placement,
                        totalPlayers: outcome.totalPlayers,
                        won: outcome.playerWon,
                        xpGained: outcome.xpGained,
                        pnlLamports,
                    },
                    quietToast: true, // PostMatchPanel is the cinematic; toast would feel spammy
                },
            );
            // 2026-04-27 (DB Stage 8) — persist per-match history for signed-in
            // users so a future "Match History" UI can list every paper / bot
            // match they've finished. Synthetic id matches the paper_match_active
            // row we just deleted, so a single id traces both states.
            if (myPubkey && !this._isGuest() && savedLocalPda && savedLocal) {
                const finalHeights = savedLocal.heights;
                const winnerIdx = finalHeights.indexOf(Math.max(...finalHeights));
                const winnerPubkey = winnerIdx >= 0 && finalHeights[winnerIdx] > 0
                    ? savedLocal.players[winnerIdx]
                    : null;
                const startedAtIso = new Date(Number(savedLocal.startedAt) * 1000).toISOString();
                (async () => {
                    try {
                        const { postPaperMatchHistory } = await import('../../token-duel/scripts/PaperMatchHistoryRpc');
                        await postPaperMatchHistory({
                            id: savedLocalPda,
                            pubkey: myPubkey,
                            modeU8: MODES[modeId as keyof typeof MODES]?.modeU8 ?? 0,
                            timeWindow: TIME_WINDOWS[this._pickerSelectedWindow]?.windowU8 ?? 0,
                            requiredPlayers: MODES[modeId as keyof typeof MODES]?.requiredPlayers ?? 2,
                            track: savedTrack,
                            players: savedLocal.players.slice(),
                            heights: finalHeights.slice(),
                            myHeight: height,
                            winnerPubkey,
                            placement: outcome.placement ?? 0,
                            totalPlayers: outcome.totalPlayers ?? (MODES[modeId as keyof typeof MODES]?.requiredPlayers ?? 2),
                            won: outcome.playerWon,
                            xpGained: outcome.xpGained,
                            startedAt: startedAtIso,
                            settledAt: new Date().toISOString(),
                        });
                    } catch (e) {
                        console.log(`${TAG} paper_match_history_post_err | ${e}`);
                    }
                })();
            }
            // Stage 2 — refresh top-right Level chip after paper-bot match.
            void this._refreshLevelChip();
            return;
        }

        // Legacy solo tier settlement (unchanged).
        const win = tierKey !== 'forfeit';
        const pnl = tierKey === 'double' ? stakeLamports
                  : tierKey === 'full' ? Math.round(stakeLamports * 0.5)
                  : tierKey === 'half' ? -Math.round(stakeLamports * 0.5)
                  : -stakeLamports;
        Stats.record('paper', win, pnl);
        console.log(`${TAG} onGameOver | STATS_RECORDED mode=paper win=${win} tier=${tierKey} pnl_lamports=${pnl}`);
    }

    // CI7: tier thresholds centralized. These MUST mirror the on-chain logic in
    // `programs/token-duel/src/instructions/settle.rs::compute_payout`. If Rust
    // changes, update these in lockstep.
    private readonly TIER_HALF_MIN = 11;
    private readonly TIER_FULL_MIN = 21;
    private readonly TIER_DOUBLE_MIN = 36;

    private _tierInfo(height: number): { key: string; label: string } {
        let info: { key: string; label: string };
        if (height >= this.TIER_DOUBLE_MIN)       info = { key: 'double',  label: '2× payout' };
        else if (height >= this.TIER_FULL_MIN)    info = { key: 'full',    label: 'Full refund + bonus' };
        else if (height >= this.TIER_HALF_MIN)    info = { key: 'half',    label: 'Half refund' };
        else                                      info = { key: 'forfeit', label: 'Forfeit' };
        console.log(`${TAG} _tierInfo | DONE height=${height} key=${info.key} label="${info.label}" thresholds_half=${this.TIER_HALF_MIN}/full=${this.TIER_FULL_MIN}/double=${this.TIER_DOUBLE_MIN}`);
        return info;
    }

    private _tierFor(height: number): string { return this._tierInfo(height).label; }
    private _tierKey(height: number): string { return this._tierInfo(height).key; }

    // ── betting-duel Phase 3: RacePanel show/hide + tick + cancel ──────────────

    private _showRacePanel(holdings: Holding[]): void {
        if (!this._racePanel) {
            console.log(`${TAG} _showRacePanel | ABORT_NO_PANEL tokens=${holdings.length} — scene binding missing, race screen will not render`);
            return;
        }
        // 2026-04-27 — _setRaceLayoutForRequiredPlayers call moved BELOW the
        // duel-layout-setup block so the layout switcher gets the final word
        // on opponent-side visibility (was being overwritten by lines ~4635+).
        // Coming back from a background-runaway state: clear flag.
        this._raceRunningInBackground = false;
        // UX overhaul Phase 2: mascot starts thinking when race begins.
        // The HomePanel mascot is inactive during the race, so the 'think'
        // animation needs to land on the RacePanel mascot to be visible.
        this._raceMascot?.setState('think');
        // 2026-04-27: mascot stays full color during duel (was dimmed to 140 ≈ 55%
        // pre-revert; user feedback was that the desaturated tone looked broken).
        if (this._raceMascotOpacity) {
            const op = this._raceMascotOpacity;
            Tween.stopAllByTarget(op);
            tween(op).to(0.25, { opacity: 255 }, { easing: 'cubicOut' }).start();
        }
        this._raceActiveHoldings = holdings.slice();
        this._raceLastDeltaSign = 0;
        this._raceTickBindingGapLogged = false;
        this._raceLatestSnapshot = null;
        this._raceEntryNoticeShown = false;
        // Stage 1 game-feel — reset ring / vignette / overtake / last-5s state.
        this._lastRenderedDeltaPct = 0;
        this._lastFiveActivated = false;
        this._lastOvertakeSign = 0;
        this._vignetteBaseAlpha = 0;
        if (this._raceTimerRing) this._raceTimerRing.clear();
        if (this._raceTimerPulseGraphics) this._raceTimerPulseGraphics.clear();
        if (this._raceTimerPulseNode) {
            Tween.stopAllByTarget(this._raceTimerPulseNode);
            this._raceTimerPulseNode.active = false;
            this._raceTimerPulseNode.setScale(new Vec3(1, 1, 1));
        }
        if (this._screenVignetteGraphics) this._screenVignetteGraphics.clear();
        if (this._raceHeroDeltaLabel) {
            Tween.stopAllByTarget(this._raceHeroDeltaLabel.node);
            this._raceHeroDeltaLabel.node.setScale(new Vec3(1, 1, 1));
        }

        // Block 2: opponent card — Paper gets a LiveSquadBot, Real hides
        // the card (no WS broadcast path yet; opponent revealed at end).
        // Round 4: Paper now dispatches on mode.requiredPlayers — 1v1 uses
        // the big card; 4p/8p use the 7-row leaderboard strip.
        const isPaper = this._pickerSelectedTrack === 'paper';
        const modeDef = MODES[this._pickerSelectedMode as keyof typeof MODES] ?? MODES.oneVone;
        const botCount = Math.max(0, modeDef.requiredPlayers - 1);

        // 2026-04-27 — Duel layout (Lv chip + player 3-token row + duel bar +
        // lead-state subtitle) now always on. Opponent-side nodes are toggled
        // by _setRaceLayoutForRequiredPlayers (1v1 = show 3 opp tokens;
        // multi-collapsed = show MultiOppGrid; multi-expanded = show 3 opp
        // tokens of tapped opp). Was: requiredPlayers === 2.
        this._isDuelLayout = true;
        // Reset duel bar state on every race start.
        this._duelBarPos = 0;
        this._duelBarVel = 0;
        this._duelBarTargetPos = 0;
        this._duelBarOmega = 6.0;
        this._duelBarZeta = 1.0;
        this._duelBarOvertakeUntil = 0;
        this._duelBarLastSignSnap = 0;
        this._lastRenderedOpponentDeltaPct = 0;
        this._opponentPerTokenDeltas = {};

        // 2026-04-27 — Player-side duel surfaces always on (Lv chip, player
        // token row, duel bar, subtitle gap). Opponent-side surfaces
        // (opponentIdentityCard, opponentTokenRow, opponentHeroDeltaLabel)
        // are owned by _setRaceLayoutForRequiredPlayers below.
        if (this._racePlayerLevelChip)      this._racePlayerLevelChip.active      = true;
        if (this._playerTokenRow)           this._playerTokenRow.active           = true;
        if (this._duelBarContainer)         this._duelBarContainer.active         = true;
        if (this._opponentSubtitleGapLabel) this._opponentSubtitleGapLabel.node.active = true;

        // Run AFTER the duel-layout-setup block so it gets the final word
        // on opponent-side visibility for 1v1 vs multi-collapsed vs multi-expanded.
        const reqPlayers = this._pickerJoinTarget?.requiredPlayers
            ?? (MODES[this._pickerSelectedMode as keyof typeof MODES]?.requiredPlayers ?? 2);
        this._setRaceLayoutForRequiredPlayers(reqPlayers);

        // 2026-04-27 — Start dedicated UI timer (decoupled from price poll
        // cadence) so the radial ring + countdown drain smoothly on long
        // (1h / 24h / 7d) matches.
        const windowDef = TIME_WINDOWS[this._pickerSelectedWindow] ?? TIME_WINDOWS[DEFAULT_TIME_WINDOW];
        this._raceUiTimerStartedAtMs = Date.now();
        this._raceUiTimerDurationMs = windowDef.durationMs;
        this._raceUiTimerActive = true;
        this.unschedule(this._onRaceUiTimerTick);
        this.schedule(this._onRaceUiTimerTick, 1.0);
        this._onRaceUiTimerTick();

        // 2026-04-27 — Track paper / bot races in-memory so they show up in
        // Matches-In-Progress + the home count badge. Real (SOL) matches are
        // tracked on-chain via _activeRealMatchPda and don't need this.
        if (this._pickerSelectedTrack !== 'real') {
            this._registerLocalMatch();
        }

        // Clear prior bot state on every race start.
        this._liveSquadBot = null;
        this._liveSquadBots = [];
        if (this._raceOpponentCard) this._raceOpponentCard.active = false;
        if (this._raceOpponentStrip) this._raceOpponentStrip.active = false;
        for (const row of this._raceOpponentRows) row.active = false;

        // Battle-UI polish: only seed the small Lv pill (wallet name shows in
        // post-match summary, not gameplay top row).
        if (this._isDuelLayout && this._racePlayerLevelLabel) {
            const lvlSrc = this.node.getChildByName('HomePanel')?.getChildByName('HomeLevelChip')?.getChildByName('HomeLevelChipLabel')?.getComponent(Label);
            this._racePlayerLevelLabel.string = lvlSrc?.string || 'Lv 1';
        }

        if (isPaper && botCount === 1) {
            // 1v1 — legacy big opponent card stays HIDDEN in duel layout (the
            // duel surfaces — OpponentIdentityCard + OpponentTokenCardsRow —
            // already cover everything that card showed). Only re-show in the
            // 4p/8p Paper fallback path.
            if (this._raceOpponentCard) this._raceOpponentCard.active = !this._isDuelLayout;
            const windowMs = TIME_WINDOWS[this._pickerSelectedWindow]?.durationMs ?? TIME_WINDOWS[DEFAULT_TIME_WINDOW].durationMs;
            if (this._raceOpponentName) this._raceOpponentName.string = 'Bot';
            // UX Phase 2b: procedural robot icon on the avatar node (replaces emoji label).
            if (this._raceOpponentAvatar) {
                this._raceOpponentAvatar.string = '';
                IconLibrary.attach(this._raceOpponentAvatar.node, 'robot', { size: 48 });
            }
            if (this._raceOpponentSymbols) this._raceOpponentSymbols.string = 'picking squad…';
            import('../../token-duel/scripts/SquadBot').then(({ LiveSquadBot }) => {
                const bot = new LiveSquadBot(windowMs, this._pickerSelectedDifficulty, this._hardGainersSnapshot);
                this._liveSquadBot = bot;
                this._liveSquadBots = [bot];
                if (this._priceFeed) {
                    bot.start(this._priceFeed).then(() => {
                        const squad = bot.getSquad();
                        const syms = squad.map((s) => s.symbol).filter(Boolean);
                        if (this._raceOpponentSymbols) {
                            this._raceOpponentSymbols.string = syms.length > 0 ? syms.join(' · ') : '— · — · —';
                        }
                        // Phase 22 — duel layout: populate opponent token card symbols.
                        if (this._isDuelLayout) {
                            for (let i = 0; i < this._opponentDuelTokenSyms.length; i++) {
                                const lbl = this._opponentDuelTokenSyms[i];
                                if (lbl) lbl.string = syms[i] ?? '—';
                            }
                        }
                        console.log(`${TAG} _showRacePanel | live_bot ready squad=[${syms.join(',')}]`);
                    }).catch((e) => console.log(`${TAG} _showRacePanel | live_bot_start_error ${e}`));
                }
            }).catch((e) => console.log(`${TAG} _showRacePanel | squadbot_import_error ${e}`));
        } else if (isPaper && botCount > 1) {
            // 4p / 8p — bot match. 2026-04-27 — legacy strip is force-hidden
            // (replaced by RaceMultiOppGrid + tap-to-expand wired earlier).
            // Just spawn the LiveSquadBot instances; tick handler renders
            // them to the multi-cards.
            const windowMs = TIME_WINDOWS[this._pickerSelectedWindow]?.durationMs ?? TIME_WINDOWS[DEFAULT_TIME_WINDOW].durationMs;
            const visibleRows = Math.min(botCount, this._raceOpponentRows.length);
            for (let i = 0; i < visibleRows; i++) {
                const row = this._raceOpponentRows[i];
                if (row) row.active = true;
                if (this._raceOpponentRowNames[i]) this._raceOpponentRowNames[i].string = `Bot ${i + 1}`;
                // UX Phase 2b: procedural robot icon on each bot row's avatar.
                const avN = row?.getChildByName('AvatarLabel');
                if (avN) IconLibrary.attach(avN, 'robot', { size: 20 });
                if (this._raceOpponentRowSymbols[i]) this._raceOpponentRowSymbols[i].string = 'picking squad…';
                if (this._raceOpponentRowDeltas[i]) this._raceOpponentRowDeltas[i].string = '0.00%';
                if (this._raceOpponentRowGaps[i]) this._raceOpponentRowGaps[i].string = '';
            }
            console.log(`${TAG} _showRacePanel | STRIP_MODE mode=${this._pickerSelectedMode} bots=${visibleRows}/${botCount} (truncated=${botCount > visibleRows})`);
            import('../../token-duel/scripts/SquadBot').then(({ LiveSquadBot }) => {
                for (let i = 0; i < visibleRows; i++) {
                    const bot = new LiveSquadBot(windowMs, this._pickerSelectedDifficulty, this._hardGainersSnapshot);
                    this._liveSquadBots.push(bot);
                    if (!this._priceFeed) continue;
                    const slot = i; // capture for closure
                    bot.start(this._priceFeed).then(() => {
                        const syms = bot.getSquad().map((s) => s.symbol).filter(Boolean);
                        if (this._raceOpponentRowSymbols[slot]) {
                            this._raceOpponentRowSymbols[slot].string = syms.length > 0 ? syms.slice(0, 3).join(' · ') : '— · — · —';
                        }
                        console.log(`${TAG} _showRacePanel | live_bot[${slot}] ready squad=[${syms.join(',')}]`);
                    }).catch((e) => console.log(`${TAG} _showRacePanel | live_bot[${slot}]_start_error ${e}`));
                }
            }).catch((e) => console.log(`${TAG} _showRacePanel | squadbot_import_error ${e}`));
        } else {
            this._liveSquadBot = null;
            if (this._raceOpponentName) this._raceOpponentName.string = 'Opponent';
            // UX Phase 2b: procedural user icon for real-opponent avatar.
            if (this._raceOpponentAvatar) {
                this._raceOpponentAvatar.string = '';
                IconLibrary.attach(this._raceOpponentAvatar.node, 'user', { size: 48 });
            }
            if (this._raceOpponentSymbols) this._raceOpponentSymbols.string = 'waiting for squad…';
            if (this._raceOpponentDelta) this._raceOpponentDelta.string = '—';
            if (this._raceOpponentGap) this._raceOpponentGap.string = '';
            // Opponent card visible on Real ONLY in legacy layout (4p/8p
            // doesn't yet support Real). Phase 22 duel layout owns its own
            // opponent surfaces, so the legacy big card stays hidden.
            if (this._raceOpponentCard && !this._isDuelLayout) this._raceOpponentCard.active = true;
            this._subscribeOpponentSquad();
        }

        // Populate + activate N cards (legacy 5-stack — only in 4p/8p).
        const n = Math.min(holdings.length, this._raceTokenCards.length);
        for (let i = 0; i < this._raceTokenCards.length; i++) {
            const card = this._raceTokenCards[i];
            if (!card) continue;
            const show = !this._isDuelLayout && i < n;
            card.active = show;
            if (show && this._raceTokenSymbolLabels[i]) {
                this._raceTokenSymbolLabels[i].string = holdings[i]?.symbol || '---';
            }
            if (show && this._raceTokenEntryLabels[i])   this._raceTokenEntryLabels[i].string   = 'entry —';
            if (show && this._raceTokenCurrentLabels[i]) this._raceTokenCurrentLabels[i].string = '—';
            if (show && this._raceTokenDeltaLabels[i]) {
                this._raceTokenDeltaLabels[i].string = '0.00%';
                this._raceTokenDeltaLabels[i].color = new Color(200, 200, 210);
            }
        }

        // Phase 22 — populate duel-layout player token cards (3 horizontal).
        if (this._isDuelLayout) {
            for (let i = 0; i < this._playerDuelTokenCards.length; i++) {
                const show = i < n;
                this._playerDuelTokenCards[i].active = show;
                if (show) {
                    if (this._playerDuelTokenSyms[i])   this._playerDuelTokenSyms[i].string   = holdings[i]?.symbol || '---';
                    if (this._playerDuelTokenDeltas[i]) {
                        this._playerDuelTokenDeltas[i].string = '+0.00%';
                        this._playerDuelTokenDeltas[i].color = new Color(168, 174, 201);
                    }
                }
            }
            // Reset opponent-side duel cards (populated when bot picks land or WS arrives).
            for (let i = 0; i < this._opponentDuelTokenCards.length; i++) {
                this._opponentDuelTokenCards[i].active = true;
                if (this._opponentDuelTokenSyms[i])   this._opponentDuelTokenSyms[i].string   = '—';
                if (this._opponentDuelTokenDeltas[i]) {
                    this._opponentDuelTokenDeltas[i].string = '+0.00%';
                    this._opponentDuelTokenDeltas[i].color = new Color(168, 174, 201);
                }
            }
            // Opponent identity card — combined "BOT · Lv 3" copy in NameLabel
            // (LevelLabel hidden) so the smaller card doesn't stack two lines.
            const oppLv = isPaper
                ? (this._pickerSelectedDifficulty === 'easy' ? 1 : this._pickerSelectedDifficulty === 'hard' ? 5 : 3)
                : 0;
            if (this._opponentIdentityName) {
                this._opponentIdentityName.string = isPaper
                    ? `BOT · Lv ${oppLv}`
                    : 'OPPONENT';
            }
            if (this._opponentIdentityLevel) {
                this._opponentIdentityLevel.string = '';
                this._opponentIdentityLevel.node.active = false;
            }
            // Opponent hero label seed.
            if (this._opponentHeroDeltaLabel) {
                this._opponentHeroDeltaLabel.string = '+0.00%';
                this._opponentHeroDeltaLabel.color = new Color(168, 174, 201);
                Tween.stopAllByTarget(this._opponentHeroDeltaLabel.node);
                this._opponentHeroDeltaLabel.node.setScale(new Vec3(1, 1, 1));
            }
            if (this._opponentSubtitleGapLabel) {
                this._opponentSubtitleGapLabel.string = '—';
                this._opponentSubtitleGapLabel.color = new Color(168, 174, 201);
            }
            if (this._duelBarLeadingPpLabel) this._duelBarLeadingPpLabel.string = '';
            // Kick off the 60Hz spring + redraw loop.
            this._startDuelBarLoop();
        } else {
            this._stopDuelBarLoop();
        }

        if (this._raceCountdownLabel)    this._raceCountdownLabel.string = '—:—';
        if (this._raceHeroDeltaLabel) {
            this._raceHeroDeltaLabel.string = '+0.00%';
            this._raceHeroDeltaLabel.color  = new Color(255, 255, 255);
        }
        if (this._raceHeroSubtitleLabel) this._raceHeroSubtitleLabel.string = 'Fetching entry prices…';
        this._racePanel.active = true;
        if (this._gameArea) this._gameArea.active = false;
        const symbols = holdings.slice(0, n).map((h) => h?.symbol || '?').join(',');
        console.log(`${TAG} _showRacePanel | SHOW tokens=${n} cards_available=${this._raceTokenCards.length} symbols=[${symbols}] duel_layout=${this._isDuelLayout}`);
    }

    /**
     * betting-duel live opponent delta — subscribe to the match's squad
     * board via backend WS. When opponent's mints arrive, snapshot their
     * entry prices so `_updateOpponentDeltaTick` can compute deltas on
     * each race tick.
     */
    private _subscribeOpponentSquad(): void {
        if (!this._activeRealMatchPda) {
            console.log(`${TAG} _subscribeOpponentSquad | NO_MATCH_PDA — skipping`);
            return;
        }
        const matchPda = this._activeRealMatchPda;
        const myPubkey = MWAManager.instance?.connectedPubkey ?? '';
        this._opponentMints = null;
        this._opponentEntryPrices = null;
        this._opponentDeltaPct = 0;
        if (this._opponentUnsubscribe) { try { this._opponentUnsubscribe(); } catch (_) {} this._opponentUnsubscribe = null; }

        void import('../../token-duel/scripts/SpectatorRpc').then(({ subscribeToMatch }) => {
            if (!this._activeRealMatchPda || this._activeRealMatchPda !== matchPda) {
                // Match changed while we were loading; bail.
                console.log(`${TAG} _subscribeOpponentSquad | STALE match=${matchPda.slice(0, 8)}... active=${this._activeRealMatchPda ?? 'null'}`);
                return;
            }
            const pickOpponent = (squads: Array<{ playerPubkey: string; mints: string[] }> | undefined): string[] | null => {
                if (!squads) return null;
                const opp = squads.find((s) => s.playerPubkey !== myPubkey);
                return opp ? opp.mints.slice() : null;
            };
            const onOpponentMints = (mints: string[]) => {
                if (this._opponentMints) return; // already captured
                this._opponentMints = mints;
                if (this._raceOpponentSymbols) this._raceOpponentSymbols.string = 'loading prices…';
                console.log(`${TAG} _subscribeOpponentSquad | OPPONENT_MINTS mints=[${mints.map((m) => m.slice(0, 8)).join(',')}]`);
                // One-shot: capture opponent entry prices at the moment we learn them.
                void this._priceFeed?.getSpotPrices(mints).then((prices) => {
                    this._opponentEntryPrices = prices;
                    const tags = mints.map((m) => (prices[m] ? m.slice(0, 4) : '?')).join(',');
                    console.log(`${TAG} _subscribeOpponentSquad | OPPONENT_ENTRY resolved=${Object.keys(prices).length}/${mints.length} [${tags}]`);
                    if (this._raceOpponentSymbols) this._raceOpponentSymbols.string = mints.map((m) => m.slice(0, 4)).join(' · ');
                    // Phase 22 — duel layout: populate opponent token card symbols (truncated mint).
                    if (this._isDuelLayout) {
                        for (let i = 0; i < this._opponentDuelTokenSyms.length; i++) {
                            const lbl = this._opponentDuelTokenSyms[i];
                            if (lbl) lbl.string = mints[i] ? mints[i].slice(0, 4).toUpperCase() : '—';
                        }
                    }
                });
            };
            this._opponentUnsubscribe = subscribeToMatch(this._tdRpc, matchPda, {
                onState: () => { /* unused for opponent delta */ },
                onReady: (ev) => {
                    const mints = pickOpponent(ev.squads);
                    if (mints) onOpponentMints(mints);
                    else console.log(`${TAG} _subscribeOpponentSquad | WS_READY no opponent squad yet (squads=${ev.squads?.length ?? 0})`);
                },
                onOpponentSquad: (ev) => {
                    if (ev.playerPubkey === myPubkey) return;
                    onOpponentMints(ev.mints.slice());
                },
            });
            console.log(`${TAG} _subscribeOpponentSquad | SUBSCRIBED match=${matchPda.slice(0, 8)}... my=${myPubkey.slice(0, 8)}...`);
        }).catch((e) => console.log(`${TAG} _subscribeOpponentSquad | IMPORT_ERR ${e}`));
    }

    /**
     * Called from `_onRaceTick`. If opponent mints + entry prices are
     * captured, fetch current prices and update the opponent card.
     */
    private _updateOpponentDeltaTick(playerDeltaPct: number): void {
        if (!this._opponentMints || !this._opponentEntryPrices || !this._priceFeed) return;
        const mints = this._opponentMints;
        const entry = this._opponentEntryPrices;
        // Fire-and-forget; multiple in-flight is fine — later ones overwrite.
        void this._priceFeed.getSpotPrices(mints).then((current) => {
            let sum = 0;
            let count = 0;
            const perToken: Record<string, number> = {};
            for (const m of mints) {
                const e = entry[m];
                const c = current[m];
                if (!Number.isFinite(e) || !Number.isFinite(c) || e <= 0) continue;
                const d = ((c - e) / e) * 100;
                perToken[m] = d;
                sum += d;
                count++;
            }
            if (count === 0) return;
            const oppDelta = sum / count;
            this._opponentDeltaPct = oppDelta;
            this._opponentPerTokenDeltas = perToken;
            const green = new Color(120, 220, 120, 255);
            const red   = new Color(240, 110, 110, 255);
            if (this._raceOpponentDelta) {
                const s = oppDelta >= 0 ? '+' : '';
                this._raceOpponentDelta.string = `${s}${oppDelta.toFixed(2)}%`;
                this._raceOpponentDelta.color = oppDelta >= 0 ? green : red;
            }
            if (this._raceOpponentGap) {
                const gap = playerDeltaPct - oppDelta;
                const absGap = Math.abs(gap).toFixed(2);
                if (gap > 0.01) {
                    this._raceOpponentGap.string = `you +${absGap} pp ahead`;
                    this._raceOpponentGap.color = green;
                } else if (gap < -0.01) {
                    this._raceOpponentGap.string = `${absGap} pp behind`;
                    this._raceOpponentGap.color = red;
                } else {
                    this._raceOpponentGap.string = 'neck and neck';
                    this._raceOpponentGap.color = new Color(180, 185, 200, 255);
                }
            }
        }).catch(() => { /* transient fetch errors OK; next tick retries */ });
    }

    private _hideRacePanel(): void {
        // 2026-04-27 — Stop the dedicated UI timer regardless of panel state
        // (race may have already finished naturally with panel hidden by Home).
        if (this._raceUiTimerActive) {
            this._raceUiTimerActive = false;
            this.unschedule(this._onRaceUiTimerTick);
        }
        if (!this._racePanel) {
            console.log(`${TAG} _hideRacePanel | NO_PANEL_REF — nothing to hide`);
            return;
        }
        if (!this._racePanel.active) {
            console.log(`${TAG} _hideRacePanel | ALREADY_HIDDEN`);
            return;
        }
        // Tear down opponent WS subscription if live.
        if (this._opponentUnsubscribe) { try { this._opponentUnsubscribe(); } catch (_) {} this._opponentUnsubscribe = null; }
        this._opponentMints = null;
        this._opponentEntryPrices = null;
        // Round 4: clear Paper N-bot state.
        this._liveSquadBot = null;
        this._liveSquadBots = [];
        if (this._raceOpponentStrip) this._raceOpponentStrip.active = false;
        for (const row of this._raceOpponentRows) row.active = false;
        // Stage 1 game-feel — stop loops + reset node transforms before hide.
        if (this._raceTimerPulseNode) {
            Tween.stopAllByTarget(this._raceTimerPulseNode);
            this._raceTimerPulseNode.active = false;
            this._raceTimerPulseNode.setScale(new Vec3(1, 1, 1));
        }
        if (this._raceHeroDeltaLabel) {
            Tween.stopAllByTarget(this._raceHeroDeltaLabel.node);
            this._raceHeroDeltaLabel.node.setScale(new Vec3(1, 1, 1));
        }
        if (this._raceTimerRing) this._raceTimerRing.clear();
        if (this._screenVignetteGraphics) this._screenVignetteGraphics.clear();
        // Phase 22 — stop the duel bar's 60Hz loop and clear its Graphics.
        this._stopDuelBarLoop();
        this._isDuelLayout = false;
        this._duelBarPos = 0;
        this._duelBarVel = 0;
        this._duelBarTargetPos = 0;
        this._duelBarLastSignSnap = 0;
        if (this._duelBarTrackGraphics)      this._duelBarTrackGraphics.clear();
        if (this._duelBarFillGraphics)       this._duelBarFillGraphics.clear();
        if (this._duelBarGlowGraphics)       this._duelBarGlowGraphics.clear();
        if (this._duelBarCenterTickGraphics) this._duelBarCenterTickGraphics.clear();
        if (this._opponentHeroDeltaLabel) {
            Tween.stopAllByTarget(this._opponentHeroDeltaLabel.node);
            this._opponentHeroDeltaLabel.node.setScale(new Vec3(1, 1, 1));
        }
        this._racePanel.active = false;
        console.log(`${TAG} _hideRacePanel | HIDDEN last_snapshot_portfolio=${this._raceLatestSnapshot?.portfolioDeltaPct?.toFixed(2) ?? 'null'}%`);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Phase F5/F6 — price-feed health callbacks bridged from PortfolioRace.
    //  Used by RacePanel to render "stale ⚠" badges + "Reconnecting…" banner.
    //  Phase G5 polish layer renders these visually; for F8 we just track
    //  state + log so plumbing is end-to-end before the visual pass.
    // ═══════════════════════════════════════════════════════════════

    /** Phase F6 — semi-transparent banner state on RacePanel. */
    private _raceConnectionState: 'ok' | 'degraded' | 'lost' = 'ok';
    /** Phase F6 — set of mints currently flagged stale. */
    private _staleRaceMints: Set<string> = new Set();

    private _onPriceFallback(mint: string, fallbackEntry: number): void {
        console.log(`${TAG} _onPriceFallback | mint=${mint.slice(0, 8)} fallback_entry=${fallbackEntry}`);
        // Surface via the existing toast mechanism so the user knows we're
        // racing with a cached price for this token. Once per race per mint.
        const key = `_priceFallbackToast_${mint}`;
        if (!(this as any)[key]) {
            (this as any)[key] = true;
            try { showToast(`Cached entry price used for ${mint.slice(0, 4)}…`); } catch (_) { /* ignore */ }
        }
    }

    private _onStalePrice(mint: string, missingTicks: number): void {
        this._staleRaceMints.add(mint);
        console.log(`${TAG} _onStalePrice | mint=${mint.slice(0, 8)} missing_ticks=${missingTicks} stale_count=${this._staleRaceMints.size}`);
        // Phase G5 will render a ⚠ badge on the per-token RaceTokenCard. For
        // F8 we just refresh the connection-state UI in case it should escalate.
        this._refreshRaceConnectionUi();
    }

    private _onPriceRecovered(mint: string): void {
        this._staleRaceMints.delete(mint);
        console.log(`${TAG} _onPriceRecovered | mint=${mint.slice(0, 8)} stale_count=${this._staleRaceMints.size}`);
        this._refreshRaceConnectionUi();
    }

    private _onConnectionState(state: 'ok' | 'degraded' | 'lost'): void {
        const prev = this._raceConnectionState;
        this._raceConnectionState = state;
        console.log(`${TAG} _onConnectionState | ${prev} → ${state}`);
        this._refreshRaceConnectionUi();
    }

    /**
     * Phase F8 — minimal UI surface for connection state. Reuses the
     * `_raceHeroSubtitleLabel` to display "Reconnecting…" / "Stale prices ⚠"
     * inline. Phase G5 swaps this for a dedicated overlay banner.
     */
    private _refreshRaceConnectionUi(): void {
        if (!this._raceHeroSubtitleLabel) return;
        if (this._raceConnectionState === 'lost') {
            this._raceHeroSubtitleLabel.string = 'Reconnecting to price feed…';
        } else if (this._raceConnectionState === 'degraded') {
            this._raceHeroSubtitleLabel.string = 'Price feed unstable — retrying';
        } else if (this._staleRaceMints.size > 0) {
            this._raceHeroSubtitleLabel.string = `${this._staleRaceMints.size} token price${this._staleRaceMints.size === 1 ? '' : 's'} stale`;
        } else if (this._raceConnectionState === 'ok' && this._raceHeroSubtitleLabel.string.startsWith('Reconnecting') || this._raceHeroSubtitleLabel.string.includes('unstable') || this._raceHeroSubtitleLabel.string.includes('stale')) {
            // Clear our previous status messages — let later code restore the
            // existing race subtitle. This is conservative: don't overwrite
            // arbitrary subtitles, only ones we set above.
            this._raceHeroSubtitleLabel.string = '';
        }
    }

    private _onRaceTick(snap: RaceSnapshot): void {
        this._raceLatestSnapshot = snap;
        if (!this._raceTickBindingGapLogged && (!this._raceCountdownLabel || !this._raceHeroDeltaLabel)) {
            this._raceTickBindingGapLogged = true;
            console.log(`${TAG} _onRaceTick | TICK_BINDING_GAP countdown=${!!this._raceCountdownLabel} hero=${!!this._raceHeroDeltaLabel} hero_sub=${!!this._raceHeroSubtitleLabel} cards=${this._raceTokenCards.length}`);
        }
        // One-shot notice: PortfolioRace dropped any mint whose entry price
        // couldn't be resolved at race start (after 3 retries). Equal-weight
        // delta silently ignores the dropped mint; tell the user once.
        if (!this._raceEntryNoticeShown && snap.resolvedCount > 0 && snap.resolvedCount < this._raceActiveHoldings.length) {
            const dropped = this._raceActiveHoldings.length - snap.resolvedCount;
            showToast(`${dropped} token${dropped > 1 ? 's' : ''} not indexed — racing with ${snap.resolvedCount}/${this._raceActiveHoldings.length}`);
            this._raceEntryNoticeShown = true;
            console.log(`${TAG} _onRaceTick | ENTRY_DROP_NOTICE dropped=${dropped} resolved=${snap.resolvedCount}/${this._raceActiveHoldings.length}`);
        }
        // 2026-04-27 — Radial ring + countdown label are now driven by the
        // dedicated 1s `_onRaceUiTimerTick` so they tick smoothly on long
        // (1h / 24h / 7d) matches whose price poll fires every 1–10 minutes.
        // Snapshot still advances elapsed/remaining for downstream logic.

        // Mirror live deltas (me + bots) into the local-match heights array
        // so MIP rows render the correct `YOU +X.XX%` / `OPP +X.XX%` line
        // from the same data the duel bar uses. encodeDeltaPct matches
        // what the on-chain settle uses.
        if (this._currentLocalMatchPda) {
            const local = this._localActiveMatches.find((m) => m.pda === this._currentLocalMatchPda);
            if (local) {
                const me = MWAManager.instance?.connectedPubkey ?? '';
                const myIdx = local.players.indexOf(me);
                const myHeight = encodeDeltaPct(snap.portfolioDeltaPct);
                if (myIdx >= 0) local.heights[myIdx] = myHeight;
                const botHeights: number[] = [];
                for (let i = 0; i < this._liveSquadBots.length; i++) {
                    const slot = i + 1; // bots occupy indices after me
                    const h = encodeDeltaPct(this._liveSquadBots[i].deltaAt(snap.elapsedMs).portfolioDeltaPct);
                    botHeights.push(h);
                    if (slot < local.heights.length) local.heights[slot] = h;
                }
                // Throttled backend PATCH (every ~10s) so the row stays fresh
                // for cross-device MIP queries without spamming the backend.
                const now = Date.now();
                if (this._shouldHitBackend() && now - this._lastPaperMatchHeightsPostMs > 10_000) {
                    this._lastPaperMatchHeightsPostMs = now;
                    void patchPaperMatchHeights(this._currentLocalMatchPda, myHeight, botHeights);
                }
            }
        }

        // Hero delta — Block B rolls the number when the change is > 0.3pp.
        const deltaPct = snap.portfolioDeltaPct;
        const green = new Color(51, 204, 85);
        const red = new Color(255, 85, 85);
        const neutral = new Color(255, 255, 255);
        const heroColor = snap.resolvedCount === 0 ? neutral : (deltaPct >= 0 ? green : red);
        this._tweenHeroDelta(deltaPct, heroColor);

        // Block C — ambient screen-edge vignette reacts to |delta|.
        this._updateVignette(snap);

        // Block F — enter last-5-seconds drama mode (one-shot).
        this._enterLastFiveMode(snap.remainingMs);
        if (this._raceHeroSubtitleLabel) {
            this._raceHeroSubtitleLabel.string = snap.resolvedCount === 0
                ? 'Waiting for price feed…'
                : `Portfolio change (${snap.resolvedCount} token${snap.resolvedCount === 1 ? '' : 's'})`;
        }

        // Per-token cards (legacy 5-stack — used in 4p/8p)
        for (let i = 0; i < this._raceActiveHoldings.length && i < this._raceTokenCards.length; i++) {
            const h = this._raceActiveHoldings[i];
            const key = h?.mint || h?.symbol || '';
            const info = snap.perToken[key];
            if (!info) continue;
            if (this._raceTokenEntryLabels[i])   this._raceTokenEntryLabels[i].string   = `entry ${this._fmtPrice(info.entryPrice)}`;
            if (this._raceTokenCurrentLabels[i]) this._raceTokenCurrentLabels[i].string = this._fmtPrice(info.currentPrice);
            if (this._raceTokenDeltaLabels[i]) {
                const s = info.deltaPct >= 0 ? '+' : '';
                this._raceTokenDeltaLabels[i].string = `${s}${info.deltaPct.toFixed(2)}%`;
                this._raceTokenDeltaLabels[i].color = info.deltaPct >= 0 ? green : red;
            }
        }

        // Phase 22 — duel-layout player token cards (3 horizontal). Battle-UI
        // polish: per-tick tint, swing-pulse, and contribution bar so each
        // card reads as a live unit.
        if (this._isDuelLayout) {
            // Compute squad-side max for contribution-bar normalization.
            let pMaxAbs = 0;
            for (let i = 0; i < this._raceActiveHoldings.length && i < this._playerDuelTokenCards.length; i++) {
                const h = this._raceActiveHoldings[i];
                const key = h?.mint || h?.symbol || '';
                const info = snap.perToken[key];
                if (info) pMaxAbs = Math.max(pMaxAbs, Math.abs(info.deltaPct));
            }
            for (let i = 0; i < this._raceActiveHoldings.length && i < this._playerDuelTokenCards.length; i++) {
                const h = this._raceActiveHoldings[i];
                const key = h?.mint || h?.symbol || '';
                const info = snap.perToken[key];
                const symLbl = this._playerDuelTokenSyms[i];
                const dtLbl = this._playerDuelTokenDeltas[i];
                if (symLbl) symLbl.string = h?.symbol || '—';
                if (dtLbl && info) {
                    const s = info.deltaPct >= 0 ? '+' : '';
                    dtLbl.string = `${s}${info.deltaPct.toFixed(2)}%`;
                    dtLbl.color = info.deltaPct >= 0 ? green : red;
                } else if (dtLbl) {
                    dtLbl.string = '—';
                    dtLbl.color = new Color(168, 174, 201);
                }
                if (info) {
                    this._applyDuelTokenCardFeedback(
                        this._playerDuelTokenCards[i],
                        this._playerDuelTokenSprites[i] ?? null,
                        this._playerDuelTokenBars[i] ?? null,
                        info.deltaPct,
                        pMaxAbs,
                        i,
                        true,
                    );
                }
            }
        }

        // Haptic + sound + Block D screen flash on zero-cross (ignore first tick to avoid false-trigger at t=0).
        const curSign: 1 | -1 | 0 = deltaPct > 0 ? 1 : (deltaPct < 0 ? -1 : 0);
        if (this._raceLastDeltaSign !== 0 && curSign !== 0 && curSign !== this._raceLastDeltaSign) {
            try { Haptics.fire(HapticType.MEDIUM); } catch (_) { /* editor no-op */ }
            try { playSound(curSign > 0 ? 'stack' : 'miss'); } catch (_) { /* asset may be missing */ }
            this._flashZeroCross(curSign);
        }
        if (curSign !== 0) this._raceLastDeltaSign = curSign;

        // Block 2: opponent card (Paper only — live bot delta).
        // Round 4: dispatch on big-card vs strip — big card for 1v1, strip
        // for 4p/8p with N-1 bots iterated.
        // Phase 22: also drives the 1v1 duel-format opponent surfaces.
        let oppDeltaForDuel: number | null = null;
        let oppPerTokenForDuel: Record<string, number> | null = null;
        let oppSymbolsForDuel: string[] | null = null;

        if (this._pickerSelectedTrack === 'paper' && this._liveSquadBot && (this._raceOpponentCard?.active || this._isDuelLayout)) {
            // 1v1 paper: live bot delta (legacy big card OR duel layout).
            const botSnap = this._liveSquadBot.deltaAt(snap.elapsedMs);
            oppDeltaForDuel = botSnap.portfolioDeltaPct;
            oppPerTokenForDuel = botSnap.perTokenDeltas;
            oppSymbolsForDuel = this._liveSquadBot.getSquad().map(s => s.symbol);
            if (this._raceOpponentCard?.active && this._raceOpponentDelta) {
                const s = botSnap.portfolioDeltaPct >= 0 ? '+' : '';
                this._raceOpponentDelta.string = `${s}${botSnap.portfolioDeltaPct.toFixed(2)}%`;
                this._raceOpponentDelta.color = botSnap.portfolioDeltaPct >= 0 ? green : red;
            }
            if (this._raceOpponentCard?.active && this._raceOpponentGap) {
                const gap = deltaPct - botSnap.portfolioDeltaPct;
                const absGap = Math.abs(gap).toFixed(2);
                if (gap > 0.05) {
                    this._raceOpponentGap.string = `you +${absGap} pp ahead`;
                    this._raceOpponentGap.color = green;
                } else if (gap < -0.05) {
                    this._raceOpponentGap.string = `${absGap} pp behind`;
                    this._raceOpponentGap.color = red;
                } else {
                    this._raceOpponentGap.string = 'neck and neck';
                    this._raceOpponentGap.color = new Color(200, 200, 210);
                }
            }
        } else if (this._pickerSelectedTrack === 'paper' && this._liveSquadBots.length > 1) {
            // 2026-04-27 — 4p / 8p multi-bot. Compute ranks once, then dispatch
            // on which surface is currently visible: collapsed grid → render
            // per-card data; expanded → pull tapped bot's snapshot into the
            // 1v1 duel-format vars (oppDeltaForDuel/oppPerTokenForDuel/
            // oppSymbolsForDuel) so the existing block at line ~5274 drives
            // the hero delta / token row / lead-state subtitle / duel bar.
            const neutral = new Color(140, 150, 170);
            const players: { idx: number; delta: number }[] = [];
            players.push({ idx: -1, delta: deltaPct });   // me
            for (let i = 0; i < this._liveSquadBots.length; i++) {
                players.push({ idx: i, delta: this._liveSquadBots[i].deltaAt(snap.elapsedMs).portfolioDeltaPct });
            }
            players.sort((a, b) => b.delta - a.delta);
            const rankOf = new Map<number, number>();
            for (let r = 0; r < players.length; r++) rankOf.set(players[r].idx, r + 1);
            const myRank = rankOf.get(-1) ?? 1;
            const ranksuffix = (n: number) => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;

            if (this._raceMultiGrid?.active) {
                // Collapsed grid: per-card data + RANK subtitle.
                for (let i = 0; i < this._liveSquadBots.length && i < this._raceMultiCardNodes.length; i++) {
                    const card = this._raceMultiCardNodes[i];
                    if (!card.active) continue;
                    const botSnap = this._liveSquadBots[i].deltaAt(snap.elapsedMs);
                    const r = rankOf.get(i) ?? 0;
                    if (this._raceMultiCardRankLabels[i]) this._raceMultiCardRankLabels[i].string = ranksuffix(r);
                    if (this._raceMultiCardNameLabels[i]) this._raceMultiCardNameLabels[i].string = `Bot ${i + 1}`;
                    const deltaLbl = this._raceMultiCardDeltaLabels[i];
                    if (deltaLbl) {
                        const s = botSnap.portfolioDeltaPct >= 0 ? '+' : '';
                        deltaLbl.string = `${s}${botSnap.portfolioDeltaPct.toFixed(2)}%`;
                        deltaLbl.color = botSnap.portfolioDeltaPct >= 0 ? green : red;
                    }
                    const bar = this._raceMultiCardPnlBars[i];
                    if (bar) {
                        // Color: green if I'm BEHIND this bot, rose if I'm AHEAD.
                        const gap = deltaPct - botSnap.portfolioDeltaPct;
                        bar.color = gap < -0.05 ? green : gap > 0.05 ? red : neutral;
                    }
                }
                // Subtitle "RANK X OF N · ±Y.YY pp behind/ahead" — adaptive bar shows
                // me vs leader (or vs runner-up if I'm 1st). Reuses opponentSubtitleGapLabel
                // since it's the central lead-state subtitle in 1v1 too.
                const N = players.length;
                const targetIdx = myRank === 1 ? 1 : 0;  // runner-up if I'm 1st, else leader
                const targetDelta = players[targetIdx].delta;
                const pp = deltaPct - targetDelta;
                if (this._opponentSubtitleGapLabel) {
                    const dir = pp >= 0 ? 'ahead' : 'behind';
                    this._opponentSubtitleGapLabel.string = `RANK ${myRank} OF ${N} · ${pp >= 0 ? '+' : ''}${pp.toFixed(2)} pp ${dir}`;
                    this._opponentSubtitleGapLabel.color = pp >= 0 ? green : red;
                }
            } else if (this._raceMultiExpandedIdx != null) {
                // Expanded view → surface tapped bot through the 1v1 duel-format pipe.
                // The block at ~line 5274 reads oppDeltaForDuel/oppPerTokenForDuel/
                // oppSymbolsForDuel and drives hero delta, token row, YOU LEAD
                // subtitle, and duel bar.
                const idx = this._raceMultiExpandedIdx;
                const bot = this._liveSquadBots[idx];
                if (bot) {
                    const botSnap = bot.deltaAt(snap.elapsedMs);
                    oppDeltaForDuel = botSnap.portfolioDeltaPct;
                    oppPerTokenForDuel = botSnap.perTokenDeltas;
                    oppSymbolsForDuel = bot.getSquad().map((s) => s.symbol);
                    if (this._opponentIdentityName)  this._opponentIdentityName.string  = `Bot ${idx + 1}`;
                    if (this._opponentIdentityLevel) this._opponentIdentityLevel.string = `${ranksuffix(rankOf.get(idx) ?? 0)} of ${players.length}`;
                }
            }
        }

        // betting-duel live opponent delta (Real track). Opponent mints + entry
        // prices are captured via WS once both players have published their
        // squads; this tick updates their current delta from the same Birdeye
        // spot-price feed that drives the player's own portfolio race.
        if (this._pickerSelectedTrack === 'real' && (this._raceOpponentCard?.active || this._isDuelLayout)) {
            this._updateOpponentDeltaTick(deltaPct);
            // Real track: aggregate opponent delta is set asynchronously by
            // _updateOpponentDeltaTick. Use the most recent value for the duel bar.
            oppDeltaForDuel = this._opponentDeltaPct;
            oppPerTokenForDuel = this._opponentPerTokenDeltas;
            oppSymbolsForDuel = (this._opponentMints ?? []).map((m) => m.slice(0, 4).toUpperCase());
        }

        // Phase 22 — drive the 1v1 duel-format surfaces (opp hero %, opp
        // token cards, gap subtitle, duel bar).
        if (this._isDuelLayout && oppDeltaForDuel != null) {
            const oppDelta = oppDeltaForDuel;
            const oppHeroColor = snap.resolvedCount === 0 ? neutral : (oppDelta >= 0 ? green : red);
            this._tweenOpponentDelta(oppDelta, oppHeroColor);

            // Opponent token cards — same live-feedback layers as player.
            if (oppPerTokenForDuel && oppSymbolsForDuel) {
                const keys = Object.keys(oppPerTokenForDuel);
                let oMaxAbs = 0;
                for (let i = 0; i < this._opponentDuelTokenCards.length; i++) {
                    const k = keys[i];
                    const v = k != null ? oppPerTokenForDuel[k] : undefined;
                    if (Number.isFinite(v as number)) oMaxAbs = Math.max(oMaxAbs, Math.abs(v as number));
                }
                for (let i = 0; i < this._opponentDuelTokenCards.length; i++) {
                    const sym = oppSymbolsForDuel[i] ?? '—';
                    const symLbl = this._opponentDuelTokenSyms[i];
                    const dtLbl = this._opponentDuelTokenDeltas[i];
                    if (symLbl) symLbl.string = sym;
                    const k = keys[i];
                    const v = k != null ? oppPerTokenForDuel[k] : undefined;
                    if (dtLbl && Number.isFinite(v as number)) {
                        const s = (v as number) >= 0 ? '+' : '';
                        dtLbl.string = `${s}${(v as number).toFixed(2)}%`;
                        dtLbl.color = (v as number) >= 0 ? green : red;
                    } else if (dtLbl) {
                        dtLbl.string = '—';
                        dtLbl.color = new Color(168, 174, 201);
                    }
                    if (Number.isFinite(v as number)) {
                        this._applyDuelTokenCardFeedback(
                            this._opponentDuelTokenCards[i],
                            this._opponentDuelTokenSprites[i] ?? null,
                            this._opponentDuelTokenBars[i] ?? null,
                            v as number,
                            oMaxAbs,
                            i,
                            false,
                        );
                    }
                }
            }

            // Lead-state line — promoted to a 2-line emphasis above the bar.
            if (this._opponentSubtitleGapLabel) {
                const gap = deltaPct - oppDelta;
                const absGap = Math.abs(gap).toFixed(2);
                if (gap > 0.05) {
                    this._opponentSubtitleGapLabel.string = `YOU LEAD\n+${absGap} pp`;
                    this._opponentSubtitleGapLabel.color = green;
                } else if (gap < -0.05) {
                    this._opponentSubtitleGapLabel.string = `YOU TRAIL\n−${absGap} pp`;
                    this._opponentSubtitleGapLabel.color = red;
                } else {
                    this._opponentSubtitleGapLabel.string = 'DEAD HEAT';
                    this._opponentSubtitleGapLabel.color = new Color(200, 200, 210);
                }
            }

            // Drive the duel bar.
            this._duelBarSetTarget(deltaPct, oppDelta);
            // Update leading pp label content (positioning happens per frame).
            // Battle-UI polish: 100ms UIOpacity fade-in on empty→text so the
            // label doesn't pop in jarringly when a lead emerges.
            if (this._duelBarLeadingPpLabel) {
                const lbl = this._duelBarLeadingPpLabel;
                const gap = deltaPct - oppDelta;
                const wasEmpty = lbl.string === '';
                if (Math.abs(gap) < 0.05) {
                    lbl.string = '';
                } else {
                    const absGap = Math.abs(gap).toFixed(2);
                    lbl.string = `${gap >= 0 ? '+' : '−'}${absGap} pp`;
                    lbl.color = gap >= 0 ? green : red;
                    if (wasEmpty) {
                        const op = this._ensureOpacity(lbl.node);
                        Tween.stopAllByTarget(op);
                        op.opacity = 0;
                        tween(op).to(0.10, { opacity: 255 }, { easing: 'cubicOut' }).start();
                    }
                }
            }
        }

        // Block E — detect player↔best-opponent overtake (Paper track only).
        this._detectOvertake(snap);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Battle-UI polish (2026-04-26): per-token tint + pulse + contribution
    // bar — make each card read as a live unit.
    // ═══════════════════════════════════════════════════════════════════

    /** Token card live-feedback: tint sprite, pulse on swing, draw contribution bar. */
    private _applyDuelTokenCardFeedback(
        card: Node | null,
        sprite: Sprite | null,
        bar: Graphics | null,
        deltaPct: number,
        squadMaxAbs: number,
        slot: number,
        isPlayer: boolean,
    ): void {
        if (!card) return;
        const cache = isPlayer ? this._playerLastTokenDelta : this._opponentLastTokenDelta;
        const prev = cache[slot] ?? 0;

        // 1) Sprite tint — subtle wash by sign.
        if (sprite) {
            const baseR = isPlayer ? 30 : 21;
            const baseG = isPlayer ? 36 : 25;
            const baseB = isPlayer ? 56 : 41;
            if (deltaPct > 0.5) {
                // Lerp toward win green.
                sprite.color = new Color(
                    Math.round(baseR + (20  - baseR) * 0.18),
                    Math.round(baseG + (241 - baseG) * 0.18),
                    Math.round(baseB + (149 - baseB) * 0.18),
                );
            } else if (deltaPct < -0.5) {
                // Lerp toward loss rose.
                sprite.color = new Color(
                    Math.round(baseR + (255 - baseR) * 0.18),
                    Math.round(baseG + (92  - baseG) * 0.18),
                    Math.round(baseB + (138 - baseB) * 0.18),
                );
            } else {
                sprite.color = new Color(baseR, baseG, baseB);
            }
        }

        // 2) Micro pulse on big swings (>0.10 pp tick-over-tick).
        if (Math.abs(deltaPct - prev) > 0.10) {
            Tween.stopAllByTarget(card);
            tween(card)
                .to(0.06, { scale: new Vec3(1.06, 1.06, 1) }, { easing: 'cubicOut' })
                .to(0.06, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicIn' })
                .start();
        }

        // 3) Sign flip — soft haptic.
        if ((prev > 0.05 && deltaPct < -0.05) || (prev < -0.05 && deltaPct > 0.05)) {
            try { Haptics.fire(HapticType.SOFT); } catch (_) { /* editor no-op */ }
        }

        // 4) Contribution bar — |delta| normalized vs squad max, colored by sign.
        if (bar) {
            const fullW = 180;
            const halfW = fullW / 2;
            const norm = squadMaxAbs > 0 ? Math.min(1, Math.abs(deltaPct) / squadMaxAbs) : 0;
            const w = Math.max(2, norm * fullW);
            const col = deltaPct >= 0
                ? { r: 20, g: 241, b: 149 }
                : { r: 255, g: 92, b: 138 };
            bar.clear();
            // Track (subtle background rail).
            bar.fillColor = new Color(255, 255, 255, 18);
            bar.roundRect(-halfW, -3, fullW, 6, 3);
            bar.fill();
            // Filled portion centered.
            bar.fillColor = new Color(col.r, col.g, col.b, 220);
            bar.roundRect(-halfW, -3, w, 6, 3);
            bar.fill();
        }

        cache[slot] = deltaPct;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Stage 1 game-feel helpers (radial timer, vignette, overtake, last-5s).
    // ═══════════════════════════════════════════════════════════════════

    /** Lerp color across the emerald → amber → coral timer-ring gradient. */
    private _timerRingColor(progress: number): Color {
        const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
        const emerald = { r: 48, g: 198, b: 155 };
        const amber   = { r: 232, g: 176, b: 70 };
        const coral   = { r: 236, g: 88, b: 122 };
        if (progress <= 0.5) {
            const t = progress / 0.5;
            return new Color(lerp(emerald.r, amber.r, t), lerp(emerald.g, amber.g, t), lerp(emerald.b, amber.b, t), 255);
        }
        if (progress <= 0.8) {
            const t = (progress - 0.5) / 0.3;
            return new Color(lerp(amber.r, coral.r, t), lerp(amber.g, coral.g, t), lerp(amber.b, coral.b, t), 255);
        }
        return new Color(coral.r, coral.g, coral.b, 255);
    }

    /** Block A — draw the radial timer ring draining as `progress` goes 0→1. */
    /**
     * 2026-04-27 — Dedicated 1s UI tick for the radial timer + countdown.
     * Decoupled from PortfolioRace's price-poll cadence (which throttles to
     * 10min on 24h/7d matches and would freeze the visible ring). Driven by
     * wall-clock elapsed since `_raceUiTimerStartedAtMs`.
     */
    private _onRaceUiTimerTick(): void {
        if (!this._raceUiTimerActive) return;
        const total = this._raceUiTimerDurationMs;
        if (total <= 0) return;
        const elapsed = Date.now() - this._raceUiTimerStartedAtMs;
        const remaining = Math.max(0, total - elapsed);
        const progress = Math.max(0, Math.min(1, elapsed / total));
        this._drawTimerRing(progress);
        if (this._raceCountdownLabel) {
            this._raceCountdownLabel.string = this._formatRemainingTime(remaining);
        }
        if (remaining <= 0) {
            this._raceUiTimerActive = false;
            this.unschedule(this._onRaceUiTimerTick);
        }
    }

    private _drawTimerRing(progress: number): void {
        const g = this._raceTimerRing;
        if (!g) return;
        const p = Math.max(0, Math.min(1, progress));
        const col = this._timerRingColor(p);
        g.clear();
        // Faint background track (full circle).
        g.lineWidth = 8;
        g.strokeColor = new Color(col.r, col.g, col.b, 40);
        g.circle(0, 0, 60);
        g.stroke();
        // Remaining portion of the ring (drains clockwise from top).
        const remain = 1 - p;
        if (remain > 0) {
            g.lineWidth = 8;
            g.strokeColor = col;
            const start = -Math.PI / 2;
            const end   = start + remain * Math.PI * 2;
            g.arc(0, 0, 60, start, end, false);
            g.stroke();
        }
    }

    /** Block C — ambient screen-edge vignette driven by |portfolioDeltaPct|. */
    private _updateVignette(snap: RaceSnapshot): void {
        const g = this._screenVignetteGraphics;
        if (!g) return;
        const delta = snap.portfolioDeltaPct;
        const mag = Math.min(0.35, Math.abs(delta) * 0.025);
        this._vignetteBaseAlpha = mag;
        let r = 255, gc = 255, b = 255;
        if (delta > 0.05)       { r = 48;  gc = 198; b = 155; }
        else if (delta < -0.05) { r = 236; gc = 88;  b = 122; }
        const a = Math.round(mag * 255);
        g.clear();
        g.lineWidth = 140;
        g.strokeColor = new Color(r, gc, b, a);
        // Stroke a large circle; the 140px band lies along the screen edges.
        g.circle(0, 0, 420);
        g.stroke();
    }

    /** Block D — brief full-screen flash when delta crosses 0. */
    private _flashZeroCross(direction: 1 | -1): void {
        const g = this._screenVignetteGraphics;
        if (!g) return;
        const base = direction > 0 ? { r: 48, g: 198, b: 155 } : { r: 236, g: 88, b: 122 };
        const carrier = { boost: 1 };
        Tween.stopAllByTarget(carrier);
        tween(carrier)
            .to(0.4, { boost: 0 }, {
                easing: 'quadOut',
                onUpdate: () => {
                    const delta = this._raceLatestSnapshot?.portfolioDeltaPct ?? 0;
                    const baseMag = Math.min(0.35, Math.abs(delta) * 0.025);
                    const mag = Math.max(baseMag, 0.45 * carrier.boost);
                    g.clear();
                    g.lineWidth = 140;
                    g.strokeColor = new Color(base.r, base.g, base.b, Math.round(mag * 255));
                    g.circle(0, 0, 420);
                    g.stroke();
                },
            })
            .call(() => { if (this._raceLatestSnapshot) this._updateVignette(this._raceLatestSnapshot); })
            .start();
    }

    /** Block B — roll hero-delta number when change > 0.3pp; scale bump on zero-cross. */
    private _tweenHeroDelta(newDelta: number, color: Color): void {
        const lbl = this._raceHeroDeltaLabel;
        if (!lbl) return;
        const prev = this._lastRenderedDeltaPct;
        const diff = Math.abs(newDelta - prev);
        const signOf = (v: number) => (v >= 0 ? '+' : '');
        if (diff <= 0.3) {
            lbl.string = `${signOf(newDelta)}${newDelta.toFixed(2)}%`;
            lbl.color = color;
            this._lastRenderedDeltaPct = newDelta;
            return;
        }
        const carrier = { v: prev };
        Tween.stopAllByTarget(carrier);
        tween(carrier)
            .to(0.4, { v: newDelta }, {
                easing: 'quartOut',
                onUpdate: () => {
                    lbl.string = `${signOf(carrier.v)}${carrier.v.toFixed(2)}%`;
                    lbl.color = color;
                },
            })
            .call(() => { this._lastRenderedDeltaPct = newDelta; })
            .start();
        // Zero-cross scale bump — multiplies against last-5s steady scale if active.
        if ((prev < 0 && newDelta > 0) || (prev > 0 && newDelta < 0)) {
            const node = lbl.node;
            Tween.stopAllByTarget(node);
            const baseScale = this._lastFiveActivated ? 1.15 : 1;
            const peak = baseScale * 1.12;
            tween(node)
                .to(0.06, { scale: new Vec3(peak, peak, 1) })
                .to(0.06, { scale: new Vec3(baseScale, baseScale, 1) })
                .start();
        }
    }

    /** Block E — detect player↔best-opponent overtake (Paper track). */
    private _detectOvertake(snap: RaceSnapshot): void {
        if (snap.elapsedMs < 1000 || snap.resolvedCount < 1) return;
        if (this._pickerSelectedTrack !== 'paper' || this._liveSquadBots.length === 0) return;
        let bestOpp = -Infinity;
        for (const bot of this._liveSquadBots) {
            const bs = bot.deltaAt(snap.elapsedMs);
            if (bs.portfolioDeltaPct > bestOpp) bestOpp = bs.portfolioDeltaPct;
        }
        if (!Number.isFinite(bestOpp)) return;
        const curSign = Math.sign(snap.portfolioDeltaPct - bestOpp);
        if (this._lastOvertakeSign === 0) {
            this._lastOvertakeSign = curSign;
            return;
        }
        if (curSign === 0 || curSign === this._lastOvertakeSign) return;
        this._lastOvertakeSign = curSign;
        try { Haptics.fire(HapticType.MEDIUM); } catch (_) { /* editor no-op */ }
        try { playSound('stack'); } catch (_) { /* asset may be missing */ }
        const oppNode: Node | null = this._raceOpponentCard?.active
            ? this._raceOpponentCard
            : (this._raceOpponentStrip?.active ? this._raceOpponentStrip : null);
        if (oppNode) {
            Tween.stopAllByTarget(oppNode);
            tween(oppNode)
                .to(0.125, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'cubicOut' })
                .to(0.125, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicIn' })
                .start();
        }
        if (this._raceHeroDeltaLabel) shake(this._raceHeroDeltaLabel.node, 8);
        // Phase 22 — slam the duel bar with a transient under-damped spring
        // (small overshoot) for 600ms, then revert to the active mode's tuning.
        if (this._isDuelLayout) {
            this._setDuelBarTuning(12.0, 0.7);
            this._duelBarOvertakeUntil = Date.now() + 600;
        }
        console.log(`${TAG} _onRaceTick | OVERTAKE sign=${curSign} player=${snap.portfolioDeltaPct.toFixed(2)}% bestOpp=${bestOpp.toFixed(2)}%`);
    }

    /** Block F — one-shot activation of last-5-seconds tension cues. */
    private _enterLastFiveMode(remainingMs: number): void {
        if (this._lastFiveActivated) return;
        if (remainingMs > 5000 || remainingMs <= 0) return;
        this._lastFiveActivated = true;
        // Scale hero delta up and leave it scaled until race end.
        if (this._raceHeroDeltaLabel) {
            const node = this._raceHeroDeltaLabel.node;
            Tween.stopAllByTarget(node);
            tween(node)
                .to(0.3, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'cubicOut' })
                .start();
        }
        // Activate + pulse the inner ring at 2Hz.
        if (this._raceTimerPulseNode && this._raceTimerPulseGraphics) {
            this._raceTimerPulseNode.active = true;
            this._raceTimerPulseNode.setScale(new Vec3(1, 1, 1));
            const pg = this._raceTimerPulseGraphics;
            pg.clear();
            pg.lineWidth = 4;
            pg.strokeColor = new Color(236, 88, 122, 180);
            pg.circle(0, 0, 55);
            pg.stroke();
            Tween.stopAllByTarget(this._raceTimerPulseNode);
            tween(this._raceTimerPulseNode)
                .to(0.25, { scale: new Vec3(1.08, 1.08, 1) })
                .to(0.25, { scale: new Vec3(1, 1, 1) })
                .union()
                .repeatForever()
                .start();
        }
        // Schedule countdown tick sounds 5..1 (gated on racePanel still active).
        const scheduleTick = (remaining: number) => {
            if (remaining <= 0) return;
            setTimeout(() => {
                if (!this._racePanel?.active) return;
                try { playSound('tap'); } catch (_) { /* asset may be missing */ }
                try { Haptics.fire(HapticType.SOFT); } catch (_) { /* editor no-op */ }
                scheduleTick(remaining - 1000);
            }, 1000);
        };
        scheduleTick(Math.floor(remainingMs));
        // Phase 22 — tighten the duel bar's spring in the closing seconds.
        if (this._isDuelLayout) this._setDuelBarTuning(9.0, 1.0);
        console.log(`${TAG} _onRaceTick | LAST_FIVE_ACTIVATED remaining=${Math.round(remainingMs)}ms`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Phase 22 — Duel bar (1v1 tug-of-war).
    //
    // Math:
    //   gap    = playerDelta - opponentDelta            (signed pp)
    //   target = tanh(gap / SCALE)                       (∈ [-1, +1])
    //   SCALE  = 2.0pp (where |bar| ≈ 0.76 of half-width)
    //
    // Animation: critically-damped spring integrated at 60Hz.
    //   accel = ω²·(target - x) − 2·ζ·ω·v
    // Default ω=6 ζ=1 (~370ms to 90%); last-5s ω=9; overtake ω=12 ζ=0.7
    // for 600ms (transient slam + small overshoot), then revert.
    //
    // Resists 1-tick price-jitter sign flips because the spring's effective
    // lowpass smooths them before the bar moves.
    // ═══════════════════════════════════════════════════════════════════

    private static readonly DUEL_BAR_SCALE = 2.0;       // pp at which |target| ≈ 0.76
    private static readonly DUEL_BAR_HALF_W = 320;      // half of 640px track

    /** Compute the bar's target position from the gap (player - opponent). */
    private _duelBarSetTarget(playerDeltaPct: number, opponentDeltaPct: number): void {
        const gap = playerDeltaPct - opponentDeltaPct;
        const t = Math.tanh(gap / AppUI.DUEL_BAR_SCALE);
        const newTarget = Math.max(-1, Math.min(1, t));
        // Battle-UI polish: when the lead flips (target crosses center vs
        // current position), apply a brief under-damped spring so the bar
        // overshoots a hair and settles — feels like a tug-of-war counter,
        // not a slider. 500ms transient; reuses _duelBarOvertakeUntil.
        const prevTarget = this._duelBarTargetPos;
        const prevSign = prevTarget > 0.04 ? 1 : (prevTarget < -0.04 ? -1 : 0);
        const newSign  = newTarget  > 0.04 ? 1 : (newTarget  < -0.04 ? -1 : 0);
        if (prevSign !== 0 && newSign !== 0 && prevSign !== newSign) {
            this._setDuelBarTuning(10.0, 0.65);
            this._duelBarOvertakeUntil = Date.now() + 500;
        }
        this._duelBarTargetPos = newTarget;
    }

    /** Set spring tuning. Used for default / last-5s / overtake regimes. */
    private _setDuelBarTuning(omega: number, zeta: number): void {
        this._duelBarOmega = omega;
        this._duelBarZeta = zeta;
    }

    /** Schedule the 60Hz spring + redraw loop. */
    private _startDuelBarLoop(): void {
        this._duelBarLastTickAt = Date.now();
        // Reuse Cocos schedule on this Component (interval 0 = every frame).
        this.unschedule(this._duelBarUpdate);
        this.schedule(this._duelBarUpdate, 0);
    }

    private _stopDuelBarLoop(): void {
        this.unschedule(this._duelBarUpdate);
    }

    /** Per-frame: spring integrate, then redraw fill + glow. Bound via .bind(this) on schedule. */
    private _duelBarUpdate = (_dt?: number): void => {
        if (!this._isDuelLayout) return;
        const now = Date.now();
        const dt = Math.max(0, Math.min(1 / 30, (now - this._duelBarLastTickAt) / 1000));
        this._duelBarLastTickAt = now;

        // Revert overtake transient when its window expires.
        if (this._duelBarOvertakeUntil && now > this._duelBarOvertakeUntil) {
            this._duelBarOvertakeUntil = 0;
            this._setDuelBarTuning(this._lastFiveActivated ? 9.0 : 6.0, 1.0);
        }

        const omega = this._duelBarOmega;
        const zeta = this._duelBarZeta;
        const accel = omega * omega * (this._duelBarTargetPos - this._duelBarPos)
                    - 2 * zeta * omega * this._duelBarVel;
        this._duelBarVel += accel * dt;
        this._duelBarPos += this._duelBarVel * dt;

        this._drawDuelBarTrack();
        this._drawDuelBarFill();
        this._drawDuelBarGlow(now);
        this._drawDuelBarCenterTick();
        this._positionDuelBarLeadingPp();
    };

    /** Draw the static track (rounded background channel). */
    private _drawDuelBarTrack(): void {
        const g = this._duelBarTrackGraphics;
        if (!g) return;
        // Track is static; only redraw if cleared. Cheap to redraw, so just do it.
        g.clear();
        g.fillColor = new Color(255, 255, 255, 20);
        g.roundRect(-AppUI.DUEL_BAR_HALF_W, -4, AppUI.DUEL_BAR_HALF_W * 2, 8, 4);
        g.fill();
    }

    /** Draw the fill bar from center toward winning side. */
    private _drawDuelBarFill(): void {
        const g = this._duelBarFillGraphics;
        if (!g) return;
        const pos = this._duelBarPos;
        const halfW = AppUI.DUEL_BAR_HALF_W;
        const px = pos * halfW;

        const isWin  = pos > 0.04;
        const isLoss = pos < -0.04;
        const col = isWin  ? { r: 20,  g: 241, b: 149 }
                  : isLoss ? { r: 255, g: 92,  b: 138 }
                           : { r: 168, g: 174, b: 201 };

        g.clear();
        if (Math.abs(px) < 2) {
            // Neck-and-neck: tiny pill at center.
            g.fillColor = new Color(col.r, col.g, col.b, 200);
            g.roundRect(-3, -6, 6, 12, 3);
            g.fill();
            return;
        }
        const x = pos > 0 ? 0 : px;
        const w = Math.abs(px);
        g.fillColor = new Color(col.r, col.g, col.b, 230);
        g.roundRect(x, -6, w, 12, 4);
        g.fill();

        // Pin-overflow chevron when target saturates the bar.
        if (Math.abs(this._duelBarTargetPos) > 0.95) {
            g.fillColor = new Color(col.r, col.g, col.b, 178);
            const tip = pos > 0 ? halfW + 6 : -halfW - 6;
            const sgn = pos > 0 ? 1 : -1;
            g.moveTo(tip, 0);
            g.lineTo(tip - sgn * 10, 8);
            g.lineTo(tip - sgn * 10, -8);
            g.close();
            g.fill();
        }

        // Detect zero-cross to drive haptic on bar (separate from hero zero-cross).
        const sign: 1 | -1 | 0 = pos > 0.04 ? 1 : (pos < -0.04 ? -1 : 0);
        if (this._duelBarLastSignSnap !== 0 && sign !== 0 && sign !== this._duelBarLastSignSnap) {
            // Bar zero-cross — haptic only (sound + flash already fire via hero zero-cross).
            try { Haptics.fire(HapticType.SOFT); } catch (_) { /* editor no-op */ }
        }
        if (sign !== 0) this._duelBarLastSignSnap = sign;
    }

    /** Draw the leading-tip glow — breathing radial alpha at 1.5Hz, plus a
     *  wider halo when commanding the lead, and a 4-dot fading trail
     *  receding from the leading tip toward center for "speed lines". */
    private _drawDuelBarGlow(now: number): void {
        const g = this._duelBarGlowGraphics;
        if (!g) return;
        const pos = this._duelBarPos;
        const halfW = AppUI.DUEL_BAR_HALF_W;
        const px = pos * halfW;

        if (Math.abs(pos) < 0.04) {
            g.clear();
            return;
        }
        const isWin = pos > 0;
        const col = isWin ? { r: 20, g: 241, b: 149 } : { r: 255, g: 92, b: 138 };
        const breathe = 0.5 + 0.5 * Math.sin((now / 1000) * 1.5 * Math.PI * 2);
        const alphaBase = 0.35 + 0.25 * Math.abs(pos);
        const alpha = Math.round(255 * Math.min(0.6, alphaBase * (0.7 + 0.3 * breathe)));
        const r = 20 + 8 * breathe;
        g.clear();
        // Battle-UI polish: wider, dimmer outer halo when commanding the
        // lead — the leading side reads as glowing/dominant, not just lit.
        if (Math.abs(pos) > 0.4) {
            const haloAlpha = Math.round(alpha * 0.45);
            g.fillColor = new Color(col.r, col.g, col.b, haloAlpha);
            g.circle(px, 0, r * 1.8);
            g.fill();
        }
        g.fillColor = new Color(col.r, col.g, col.b, alpha);
        g.circle(px, 0, r);
        g.fill();
        // Trailing dots — recede toward center, fading to zero. 4 dots,
        // 8px apart along the bar axis. Cheap; no particle system.
        const dir = isWin ? -1 : 1;
        for (let k = 1; k <= 4; k++) {
            const tx = px + dir * k * 9;
            // Stop the trail at the center tick.
            if ((isWin && tx < 0) || (!isWin && tx > 0)) break;
            const tAlpha = Math.round(alpha * (1 - k * 0.22));
            if (tAlpha <= 8) break;
            g.fillColor = new Color(col.r, col.g, col.b, tAlpha);
            g.circle(tx, 0, Math.max(2, r - k * 3));
            g.fill();
        }
    }

    /** Draw the center splitter — vertical 2px line. */
    private _drawDuelBarCenterTick(): void {
        const g = this._duelBarCenterTickGraphics;
        if (!g) return;
        g.clear();
        g.fillColor = new Color(168, 174, 201, 200);
        g.rect(-1, -16, 2, 32);
        g.fill();
    }

    /** Position the leading-pp label above the leading bar tip. */
    private _positionDuelBarLeadingPp(): void {
        const lbl = this._duelBarLeadingPpLabel;
        if (!lbl) return;
        const pos = this._duelBarPos;
        const px = pos * AppUI.DUEL_BAR_HALF_W;
        // Hide in neck-and-neck.
        if (Math.abs(pos) < 0.04) {
            lbl.string = '';
            return;
        }
        // Position at tip with ±50px nudge so the label doesn't fall off the bar.
        const x = pos > 0 ? Math.min(AppUI.DUEL_BAR_HALF_W - 50, px) : Math.max(-AppUI.DUEL_BAR_HALF_W + 50, px);
        lbl.node.setPosition(new Vec3(x, 24, 0));
    }

    /** Phase 22 — mirror of _tweenHeroDelta for opponent hero %. */
    private _tweenOpponentDelta(newDelta: number, color: Color): void {
        const lbl = this._opponentHeroDeltaLabel;
        if (!lbl) return;
        const prev = this._lastRenderedOpponentDeltaPct;
        const diff = Math.abs(newDelta - prev);
        const sign = (v: number) => (v >= 0 ? '+' : '');
        // Battle-UI polish: brighter coral pulse when player is losing the
        // duel — opponent's delta is the rival's stake; brief pulse keeps
        // the threat tactile without going over-the-top.
        const losing = this._duelBarPos < -0.04 && newDelta < -0.3;
        if (diff <= 0.3) {
            lbl.string = `${sign(newDelta)}${newDelta.toFixed(2)}%`;
            lbl.color = color;
            this._lastRenderedOpponentDeltaPct = newDelta;
            if (losing) this._pulseOpponentDeltaLosing();
            return;
        }
        const carrier = { v: prev };
        Tween.stopAllByTarget(carrier);
        tween(carrier)
            .to(0.4, { v: newDelta }, {
                easing: 'quartOut',
                onUpdate: () => {
                    lbl.string = `${sign(carrier.v)}${carrier.v.toFixed(2)}%`;
                    lbl.color = color;
                },
            })
            .call(() => { this._lastRenderedOpponentDeltaPct = newDelta; })
            .start();
        if (losing) this._pulseOpponentDeltaLosing();
    }

    /** 200ms scale pulse on opponent hero label when player is trailing. */
    private _pulseOpponentDeltaLosing(): void {
        const lbl = this._opponentHeroDeltaLabel;
        if (!lbl) return;
        const node = lbl.node;
        Tween.stopAllByTarget(node);
        tween(node)
            .to(0.10, { scale: new Vec3(1.06, 1.06, 1) }, { easing: 'cubicOut' })
            .to(0.10, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicIn' })
            .start();
    }

    /** Ensure a node has a UIOpacity component; return it. */
    private _ensureOpacity(node: Node): UIOpacity {
        return node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    }

    /**
     * Phase 16 — animation polish item 1: starfield twinkle.
     *
     * Picks every 4th of the 64 BackgroundFX stars (= 16 stars) and runs an
     * infinite UIOpacity oscillation on each. Per-star randomization (LCG
     * seed=137) gives independent durations (1.8-3.5s) and phase delays
     * (0-2s) so no two stars sync. The other 48 stars stay perfectly static —
     * the eye reads the moving 16 against the static field as parallax depth.
     */
    private _initStarfieldTwinkle(): void {
        const fxNode = this.node.getChildByName('BackgroundFX');
        const starfield = fxNode?.getChildByName('Starfield');
        if (!starfield) {
            console.log(`${TAG} _initStarfieldTwinkle | no Starfield node`);
            return;
        }
        // Deterministic LCG for per-star phase/duration variation.
        let lcg = 137;
        const rand = () => { lcg = (lcg * 1103515245 + 12345) & 0x7FFFFFFF; return lcg / 0x7FFFFFFF; };
        const stars = starfield.children;
        let twinkled = 0;
        for (let i = 0; i < stars.length; i += 4) { // every 4th star
            const star = stars[i];
            if (!star) continue;
            const op = this._ensureOpacity(star);
            const dur = 1.8 + rand() * 1.7;        // 1.8-3.5s per cycle half
            const delay = rand() * 2.0;            // 0-2s initial phase offset
            // Half-cycle dim → bright → dim, repeating forever. The initial
            // delay() lets each star start at a different point in the cycle.
            // v2 Landing: peak opacity dropped 255 → 180 so stars feel
            // atmospheric instead of competing with the CTA card.
            tween(op)
                .delay(delay)
                .to(dur / 2, { opacity: 90 },  { easing: 'sineInOut' })
                .to(dur / 2, { opacity: 180 }, { easing: 'sineInOut' })
                .union()
                .repeatForever()
                .start();
            twinkled++;
        }
        console.log(`${TAG} _initStarfieldTwinkle | ${twinkled} of ${stars.length} stars twinkling`);
    }

    /**
     * Phase 17 (item 2) — FeedRow tap-down glow.
     *
     * Each FeedRow has a per-row BtnGlow_FeedRow_<i> child sprite (initial
     * _active=false, alpha 0). On TOUCH_START we activate it and tween
     * UIOpacity 0 → 100 over 80ms (cubicOut); on TOUCH_END / TOUCH_CANCEL we
     * tween back to 0 over 200ms (cubicIn) and deactivate. Asymmetric
     * in/out timing reads as confirmation rather than highlight.
     */
    private _initFeedRowTactile(): void {
        let wired = 0;
        for (const rowNode of this._feedRowNodes) {
            if (!rowNode) continue;
            // Row names are 'FeedRow_<i>'. Glow child is 'BtnGlow_FeedRow_<i>'.
            const glow = rowNode.getChildByName(`BtnGlow_${rowNode.name}`);
            if (!glow) continue;
            const op = this._ensureOpacity(glow);
            rowNode.on(Node.EventType.TOUCH_START, () => {
                glow.active = true;
                Tween.stopAllByTarget(op);
                tween(op).to(0.08, { opacity: 100 }, { easing: 'cubicOut' }).start();
            }, this);
            const fadeOut = () => {
                Tween.stopAllByTarget(op);
                tween(op)
                    .to(0.20, { opacity: 0 }, { easing: 'cubicIn' })
                    .call(() => { glow.active = false; })
                    .start();
            };
            rowNode.on(Node.EventType.TOUCH_END,    fadeOut, this);
            rowNode.on(Node.EventType.TOUCH_CANCEL, fadeOut, this);
            wired++;
        }
        console.log(`${TAG} _initFeedRowTactile | wired ${wired} FeedRow tap-down glows`);
    }

    /**
     * Phase 17 (item 4) — generic count-up tween for hero numerics.
     *
     * Mirrors the established `_animatePayoutTicker` pattern (AppUI.ts:6936):
     * tween a proxy {v} from fromN → toN, run formatter() in onUpdate,
     * snap to formatter(toN) on completion.
     *
     * Use sparingly — count-up is for *milestone* changes (Day N+1, level
     * up, payout) where the satisfaction matters. Don't use on data-feed
     * numerics that update every tick.
     */
    private _animateCountUp(
        label: Label,
        fromN: number,
        toN: number,
        durationS: number,
        formatter: (n: number) => string,
    ): void {
        if (fromN === toN) { label.string = formatter(toN); return; }
        const proxy = { v: fromN };
        tween(proxy)
            .to(durationS, { v: toN }, {
                easing: 'cubicOut',
                onUpdate: () => { label.string = formatter(proxy.v); },
            })
            .call(() => { label.string = formatter(toN); })
            .start();
    }

    /**
     * Stage 4K — update the home-screen streak flame.
     * Hidden when streak = 0. ≥ 1 shows flame + count. ≥ 3 adds pulse.
     * ≥ 5 switches to rare-state gold tint.
     */
    /** Phase J1 — last-known on-chain streak, used to compute XP bonus
     *  display on PostMatchPanel without re-fetching mid-match. */
    private _lastKnownStreak: number = 0;

    /** Phase 17 — last value shown by StreakDayLabel; used to drive a
     *  count-up tween from oldVal → newVal when the streak increments.
     *  Sentinel -1 means "first render" (instant set, no tween). */
    private _lastShownStreakDay: number = -1;

    private _updateStreakFlame(streak: number): void {
        // Phase N4 — fire streak_milestone when crossing 3 / 6 / 10 boundaries.
        // Use rendered-value as previous; if we crossed a milestone tier upward,
        // emit a notification (toast + feed). Idempotent via dedupeKey on tier.
        const prev = this._streakRenderedValue;
        const TIERS = [3, 6, 10];
        for (const tier of TIERS) {
            if (streak >= tier && (prev < tier || prev === -1)) {
                this._emitNotification('streak_milestone', `${tier}-day streak!`,
                    `Keep playing daily for the XP bonus. Next tier at ${tier === 10 ? 'max' : `${TIERS.find((t) => t > tier) ?? '?'}`}.`,
                    { payload: { streak, tier }, dedupeKey: `streak:${tier}` });
            }
        }
        this._lastKnownStreak = streak;
        const container = this._streakFlameContainer;
        if (!container) return;
        if (streak === this._streakRenderedValue) return;
        this._streakRenderedValue = streak;
        if (streak <= 0) {
            Tween.stopAllByTarget(container);
            container.active = false;
            container.setScale(new Vec3(1, 1, 1));
            return;
        }
        container.active = true;
        if (this._streakCountLabel) this._streakCountLabel.string = `${streak}×`;
        // Color tier: gold for ≥5, warm orange for 1-4.
        const col = streak >= 5 ? new Color(255, 210, 74, 255) : new Color(255, 160, 70, 255);
        if (this._streakCountLabel) this._streakCountLabel.color = col;
        if (this._streakFlameIconNode) {
            const iconLbl = this._streakFlameIconNode.getComponent(Label);
            if (iconLbl) iconLbl.color = col;
        }
        // Pulse when streak ≥ 3 — subtle 0.9Hz scale breathe to cue the rare state.
        Tween.stopAllByTarget(container);
        container.setScale(new Vec3(1, 1, 1));
        if (streak >= 3) {
            tween(container)
                .to(0.55, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'sineInOut' })
                .to(0.55, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
                .union()
                .repeatForever()
                .start();
        }
        console.log(`${TAG} _updateStreakFlame | SHOW streak=${streak} tier=${streak >= 5 ? 'gold' : 'warm'} pulse=${streak >= 3}`);
    }

    /**
     * Stage 2G — race-start fly-in cinematic (~800ms).
     * Token cards rise from below with staggered stagger; opponent card/strip
     * drops from above; hero delta label pops from scale=0.3, opacity=0.
     * Called after the "GO!" countdown finishes; race.start() is deferred
     * so the tick doesn't fire during the reveal.
     */
    private _playRaceStartCinematic(): void {
        if (!this._racePanel) return;
        // Token cards (3 or 5): y_base - 80, opacity 0 → original, staggered 80ms.
        for (let i = 0; i < this._raceTokenCards.length; i++) {
            const card = this._raceTokenCards[i];
            if (!card || !card.active) continue;
            const op = this._ensureOpacity(card);
            const target = card.position.clone();
            Tween.stopAllByTarget(card);
            Tween.stopAllByTarget(op);
            op.opacity = 0;
            card.setPosition(new Vec3(target.x, target.y - 80, target.z));
            const delay = i * 0.08;
            tween(card)
                .delay(delay)
                .to(0.4, { position: target }, { easing: 'quartOut' })
                .start();
            tween(op)
                .delay(delay)
                .to(0.4, { opacity: 255 })
                .start();
        }
        // Opponent card / strip: y_base + 80, opacity 0 → original (300ms delay).
        const oppNodes: Node[] = [];
        if (this._raceOpponentCard?.active) oppNodes.push(this._raceOpponentCard);
        if (this._raceOpponentStrip?.active) oppNodes.push(this._raceOpponentStrip);
        for (const n of oppNodes) {
            const op = this._ensureOpacity(n);
            const target = n.position.clone();
            Tween.stopAllByTarget(n);
            Tween.stopAllByTarget(op);
            op.opacity = 0;
            n.setPosition(new Vec3(target.x, target.y + 80, target.z));
            tween(n)
                .delay(0.3)
                .to(0.3, { position: target }, { easing: 'quartOut' })
                .start();
            tween(op)
                .delay(0.3)
                .to(0.3, { opacity: 255 })
                .start();
        }
        // Hero delta: scale 0.3 + opacity 0 → 1 + 255 over 500ms (backOut).
        if (this._raceHeroDeltaLabel) {
            const node = this._raceHeroDeltaLabel.node;
            const op = this._ensureOpacity(node);
            Tween.stopAllByTarget(node);
            Tween.stopAllByTarget(op);
            node.setScale(new Vec3(0.3, 0.3, 1));
            op.opacity = 0;
            tween(node)
                .to(0.5, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                .start();
            tween(op)
                .to(0.5, { opacity: 255 })
                .start();
        }
        // Vignette fades in its baseline over 500ms (driven by next tick anyway).
        if (this._screenVignetteNode) {
            const op = this._ensureOpacity(this._screenVignetteNode);
            Tween.stopAllByTarget(op);
            op.opacity = 0;
            tween(op).to(0.5, { opacity: 255 }).start();
        }
        console.log(`${TAG} _playRaceStartCinematic | FLY_IN tokens=${this._raceTokenCards.filter((c) => c?.active).length} opp_nodes=${oppNodes.length}`);
    }

    private _fmtPrice(p: number): string {
        if (!Number.isFinite(p) || p <= 0) return '—';
        if (p >= 1)       return `$${p.toFixed(3)}`;
        if (p >= 0.001)   return `$${p.toFixed(5)}`;
        return `$${p.toPrecision(3)}`;
    }

    /**
     * Block 8: show the signing overlay. Safe to call repeatedly — replaces
     * status text. `hide()` is the companion. Spinner just rotates via a
     * looping tween.
     */
    private _showSigningOverlay(status: string): void {
        if (!this._signingOverlay) return;
        this._signingOverlay.active = true;
        if (this._signingStatusLabel) this._signingStatusLabel.string = status;
        // Phase G4 — surface the action hint set by the caller (joinMatch /
        // settle / cancel / etc). Falls back to the existing default copy
        // when no hint was set.
        if (this._signingHintLabel) {
            this._signingHintLabel.string = this._signingActionHint
                ? this._signingActionHint
                : 'Check your wallet app — sign to continue.';
        }
        if (this._signingSpinnerLabel) {
            const node = this._signingSpinnerLabel.node;
            Tween.stopAllByTarget(node);
            node.angle = 0;
            tween(node).by(1.0, { angle: -360 }).repeatForever().start();
        }
        console.log(`${TAG} _showSigningOverlay | SHOW status="${status}" hint="${this._signingActionHint}"`);
    }

    /** Phase G4 — caller sets an action context BEFORE calling MWA sign methods. Cleared on hide. */
    private _setSigningContext(hint: string): void {
        this._signingActionHint = hint;
        // If overlay is already visible, refresh it now.
        if (this._signingOverlay?.active && this._signingHintLabel) {
            this._signingHintLabel.string = hint;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Phase H4 — Level-up cinematic
    // ═══════════════════════════════════════════════════════════════

    /**
     * Compute the rake basis points for a level. Mirrors the on-chain
     * `rake_bps_for_level` function (state.rs): 500 bps at lvl 1, linearly
     * down to 300 bps at lvl 10+.
     */
    private _rakeBpsForLevel(level: number): number {
        const RAKE_BPS_MAX = 500;
        const RAKE_BPS_MIN = 300;
        const clamped = Math.max(1, Math.min(10, level | 0));
        const steps = clamped - 1;
        const range = RAKE_BPS_MAX - RAKE_BPS_MIN;
        return RAKE_BPS_MAX - Math.floor(steps * range / 9);
    }

    private _showLevelUpOverlay(previousLevel: number, newLevel: number): void {
        if (!this._levelUpOverlay) return;
        if (this._lastShownLevelUp >= newLevel) return; // already shown
        this._lastShownLevelUp = newLevel;
        console.log(`${TAG} _showLevelUpOverlay | prev=${previousLevel} new=${newLevel}`);
        // Phase N4 — feed entry only; cinematic IS the primary surface.
        const newRakeBps = this._rakeBpsForLevel(newLevel);
        this._emitNotification('level_up', `Level ${newLevel} reached`,
            `Your rake is now ${(newRakeBps / 100).toFixed(1)}%`,
            { payload: { previousLevel, newLevel }, quietToast: true, dedupeKey: `level:${newLevel}` });

        if (this._levelUpTitleLabel) this._levelUpTitleLabel.string = 'LEVEL UP';
        if (this._levelUpBigLevel) {
            // Count up from previousLevel → newLevel over 700ms via setTimeout chain.
            const start = Math.max(1, previousLevel | 0);
            const end = newLevel | 0;
            this._levelUpBigLevel.string = String(start);
            const steps = Math.max(1, end - start);
            const stepMs = Math.min(220, Math.floor(700 / steps));
            for (let i = 1; i <= steps; i++) {
                setTimeout(() => {
                    if (!this._levelUpBigLevel) return;
                    this._levelUpBigLevel.string = String(start + i);
                }, i * stepMs);
            }
        }
        if (this._levelUpCaptionLabel) this._levelUpCaptionLabel.string = `Level ${newLevel} reached`;
        if (this._levelUpRakeLabel) {
            const oldBps = this._rakeBpsForLevel(previousLevel);
            const newBps = this._rakeBpsForLevel(newLevel);
            if (newBps < oldBps) {
                this._levelUpRakeLabel.string = `Your rake: ${(newBps / 100).toFixed(1)}% (was ${(oldBps / 100).toFixed(1)}%)`;
                this._levelUpRakeLabel.color = new Color(48, 198, 155, 255);
            } else {
                this._levelUpRakeLabel.string = `Your rake: ${(newBps / 100).toFixed(1)}%`;
                this._levelUpRakeLabel.color = new Color(180, 190, 210, 255);
            }
        }
        this._levelUpOverlay.active = true;
        // Pulse-tween the big level number to draw the eye.
        if (this._levelUpBigLevel) {
            const node = this._levelUpBigLevel.node;
            Tween.stopAllByTarget(node);
            node.setScale(0.6, 0.6, 1);
            tween(node).to(0.35, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'backOut' }).start();
        }
        try { Haptics.fire(HapticType.HEAVY); } catch (_) { /* ignore */ }
        try { playSound('level_up'); } catch (_) { /* ignore */ }
        // Auto-dismiss after 2.8s.
        setTimeout(() => this._hideLevelUpOverlay(), 2800);
    }

    private _hideLevelUpOverlay(): void {
        if (!this._levelUpOverlay) return;
        if (!this._levelUpOverlay.active) return;
        this._levelUpOverlay.active = false;
        console.log(`${TAG} _hideLevelUpOverlay | DONE`);
    }

    private _hideSigningOverlay(): void {
        if (!this._signingOverlay) return;
        this._signingOverlay.active = false;
        this._signingActionHint = ''; // Phase G4 — reset for next signing flow

        if (this._signingSpinnerLabel) Tween.stopAllByTarget(this._signingSpinnerLabel.node);
        console.log(`${TAG} _hideSigningOverlay | HIDE`);
    }

    /**
     * Phase 19 — show LoadingOverlay during post-tap waits (reconnect,
     * post-connect home render). Mirrors SigningOverlay structure +
     * adds tip rotation (cycles 6 tips every 3s while shown).
     */
    private _showLoadingOverlay(status: string): void {
        if (!this._loadingOverlay) return;
        this._loadingOverlay.active = true;
        if (this._loadingStatusLabel) this._loadingStatusLabel.string = status;
        // Pick a random tip start-index; cycle every 3s while shown.
        this._loadingTipIndex = Math.floor(Math.random() * AppUI.LOADING_TIPS.length);
        if (this._loadingTipLabel) {
            this._loadingTipLabel.string = `Tip: ${AppUI.LOADING_TIPS[this._loadingTipIndex]}`;
        }
        if (this._loadingTipTimer != null) clearInterval(this._loadingTipTimer);
        this._loadingTipTimer = setInterval(() => {
            if (!this._loadingTipLabel) return;
            this._loadingTipIndex = (this._loadingTipIndex + 1) % AppUI.LOADING_TIPS.length;
            this._loadingTipLabel.string = `Tip: ${AppUI.LOADING_TIPS[this._loadingTipIndex]}`;
        }, 3000) as unknown as number;
        // Spinner rotation (mirror SigningOverlay pattern).
        if (this._loadingSpinnerLabel) {
            const node = this._loadingSpinnerLabel.node;
            Tween.stopAllByTarget(node);
            node.angle = 0;
            tween(node).by(1.0, { angle: -360 }).repeatForever().start();
        }
        console.log(`${TAG} _showLoadingOverlay | SHOW status="${status}"`);
    }

    /** Phase 19 — dismiss LoadingOverlay + clean up tip timer + spinner. */
    private _hideLoadingOverlay(): void {
        if (!this._loadingOverlay) return;
        this._loadingOverlay.active = false;
        if (this._loadingTipTimer != null) {
            clearInterval(this._loadingTipTimer);
            this._loadingTipTimer = null;
        }
        if (this._loadingSpinnerLabel) {
            Tween.stopAllByTarget(this._loadingSpinnerLabel.node);
        }
        console.log(`${TAG} _hideLoadingOverlay | HIDE`);
    }

    /**
     * Phase 20 — cold-start asset gate. Shows LoadingOverlay immediately,
     * waits for Phase 3 art OR 3s timeout (whichever first), enforces a
     * 600ms minimum display so the mascot/tip greeting registers, then
     * hides. The user sees a polished mascot + spinner + tip instead of
     * a Landing → procedural-to-PNG pop transition.
     *
     * Called fire-and-forget at the end of start(). The promise resolves
     * silently after the gate completes; no caller awaits it.
     */
    private async _gateColdStartLoad(): Promise<void> {
        if (!this._loadingOverlay) {
            console.log(`${TAG} _gateColdStartLoad | SKIP — no LoadingOverlay node`);
            return;
        }
        const startMs = Date.now();
        const MIN_DISPLAY_MS = 600;
        const MAX_TIMEOUT_MS = 3000;

        this._showLoadingOverlay('Preparing your dashboard…');

        // Race: phase3 done OR 3s timeout. .catch() prevents promise
        // rejection from short-circuiting the race.
        const phase3Wait = (this._phase3LoadPromise ?? Promise.resolve()).catch((e: any) => {
            console.log(`${TAG} _gateColdStartLoad | phase3 rejected (continuing) err=${e?.message ?? e}`);
        });
        const timeoutWait = new Promise<void>((resolve) => setTimeout(resolve, MAX_TIMEOUT_MS));
        await Promise.race([phase3Wait, timeoutWait]);

        // Enforce minimum display so the overlay doesn't blink off if Phase
        // 3 happened to finish in 50ms.
        const elapsed = Date.now() - startMs;
        if (elapsed < MIN_DISPLAY_MS) {
            await new Promise<void>((resolve) => setTimeout(resolve, MIN_DISPLAY_MS - elapsed));
        }

        this._hideLoadingOverlay();
        console.log(`${TAG} _gateColdStartLoad | DONE elapsed=${Date.now() - startMs}ms`);
    }

    /**
     * Block 3: 3-2-1-GO pre-race countdown. Shows for ~2.4s with scale tween
     * and haptic pulse per digit. Invokes `onDone` after GO! disappears.
     */
    private _showCountdown(squadSymbols: string[], onDone: () => void): void {
        if (!this._countdownOverlay || !this._countdownBigLabel) {
            console.log(`${TAG} _showCountdown | NO_OVERLAY — skipping to race start`);
            onDone();
            return;
        }
        this._countdownOverlay.active = true;
        if (this._countdownSquadLabel) {
            this._countdownSquadLabel.string = squadSymbols.length > 0 ? squadSymbols.join(' · ') : 'Your squad';
        }
        // Stage 2H — color ramp coral → amber → lime → emerald, with a 100ms
        // white flash on each transition so each digit "pops" before settling.
        const steps: Array<{ text: string; color: Color; haptic: HapticType }> = [
            { text: '3',   color: new Color(236, 88, 122),  haptic: HapticType.SOFT   },
            { text: '2',   color: new Color(232, 176, 70),  haptic: HapticType.SOFT   },
            { text: '1',   color: new Color(166, 232, 70),  haptic: HapticType.MEDIUM },
            { text: 'GO!', color: new Color(48, 198, 155),  haptic: HapticType.HEAVY  },
        ];
        let i = 0;
        const tick = () => {
            if (i >= steps.length) {
                if (this._countdownOverlay) this._countdownOverlay.active = false;
                console.log(`${TAG} _showCountdown | DONE`);
                onDone();
                return;
            }
            const step = steps[i++];
            if (this._countdownBigLabel) {
                const lbl = this._countdownBigLabel;
                lbl.string = step.text;
                lbl.color = new Color(255, 255, 255);
                const node = lbl.node;
                node.scale = new Vec3(0.6, 0.6, 1);
                tween(node).to(0.35, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'backOut' })
                    .to(0.15, { scale: new Vec3(1, 1, 1) })
                    .start();
                // 100ms white flash, then lerp to target color over 150ms.
                const colorCarrier = { r: 255, g: 255, b: 255 };
                Tween.stopAllByTarget(colorCarrier);
                tween(colorCarrier)
                    .delay(0.1)
                    .to(0.15, { r: step.color.r, g: step.color.g, b: step.color.b }, {
                        onUpdate: () => {
                            lbl.color = new Color(
                                Math.round(colorCarrier.r),
                                Math.round(colorCarrier.g),
                                Math.round(colorCarrier.b),
                            );
                        },
                    })
                    .start();
            }
            try { Haptics.fire(step.haptic); } catch (_) { /* editor no-op */ }
            try { playSound(step.text === 'GO!' ? 'stack' : 'tap'); } catch (_) { /* missing asset */ }
            setTimeout(tick, step.text === 'GO!' ? 450 : 550);
        };
        tick();
    }

    private _onRaceCancel(): void {
        const lastDelta = this._raceLatestSnapshot?.portfolioDeltaPct;
        const lastResolved = this._raceLatestSnapshot?.resolvedCount;
        const lastRemaining = this._raceLatestSnapshot?.remainingMs;
        console.log(`${TAG} _onRaceCancel | FORFEIT last_delta=${lastDelta?.toFixed(2) ?? 'null'}% resolved=${lastResolved ?? 'null'} remaining=${lastRemaining ?? 'null'}ms last_sign=${this._raceLastDeltaSign} — submitting score=0 (encoded 0% delta)`);
        this._game?.destroy();
        this._game = null;
        this._hideRacePanel();
        this._onGameOver(0, {});
    }

    /**
     * 2026-04-27 — Non-destructive escape from RacePanel. Activates HomePanel
     * but does NOT stop PortfolioRace. The match keeps ticking in the
     * background; user can resume via MatchesInProgressPanel or a future
     * background-match toast. Only behavior change vs Forfeit: no settle.
     */
    private _onRaceHomeTap(): void {
        const lastDelta = this._raceLatestSnapshot?.portfolioDeltaPct;
        const lastRemaining = this._raceLatestSnapshot?.remainingMs;
        console.log(`${TAG} _onRaceHomeTap | LEAVE_TO_HOME (race continues in background) last_delta=${lastDelta?.toFixed(2) ?? 'null'}% remaining=${lastRemaining ?? 'null'}ms`);
        this._raceRunningInBackground = true;
        if (this._racePanel) this._racePanel.active = false;
        this._setActivePanel('home');
    }

    /**
     * 2026-04-27 — Tap a condensed multi-opponent card → expand into the
     * 1v1-style opponent view (their hero delta + identity + 3 tokens).
     * Reuses existing 1v1 opponent nodes; just toggles visibility.
     */
    private _onMultiOppCardTap(idx: number): void {
        if (!this._raceMultiGrid) return;
        console.log(`${TAG} _onMultiOppCardTap | EXPAND idx=${idx}`);
        this._raceMultiExpandedIdx = idx;
        this._raceMultiGrid.active = false;
        if (this._raceMultiBackBtn) this._raceMultiBackBtn.node.active = true;
        // Show 1v1 opponent nodes; tick handler will populate them with the
        // tapped opp's data on the next snapshot.
        if (this._opponentHeroDeltaLabel?.node) this._opponentHeroDeltaLabel.node.active = true;
        if (this._opponentIdentityCard) this._opponentIdentityCard.active = true;
        if (this._opponentTokenRow) this._opponentTokenRow.active = true;
    }

    /** 2026-04-27 — Return from expanded opponent view to the condensed grid. */
    private _onMultiOppBackTap(): void {
        if (!this._raceMultiGrid) return;
        console.log(`${TAG} _onMultiOppBackTap | COLLAPSE`);
        this._raceMultiExpandedIdx = null;
        this._raceMultiGrid.active = true;
        if (this._raceMultiBackBtn) this._raceMultiBackBtn.node.active = false;
        if (this._opponentHeroDeltaLabel?.node) this._opponentHeroDeltaLabel.node.active = false;
        if (this._opponentIdentityCard) this._opponentIdentityCard.active = false;
        if (this._opponentTokenRow) this._opponentTokenRow.active = false;
    }

    /**
     * 2026-04-27 — Switch RacePanel layout between 1v1 (existing) and
     * multi-player (condensed-card grid). Called once when a race starts.
     */
    private _setRaceLayoutForRequiredPlayers(n: number): void {
        const isMulti = n > 2;
        console.log(`${TAG} _setRaceLayoutForRequiredPlayers | n=${n} isMulti=${isMulti}`);
        const oppDelta    = this._opponentHeroDeltaLabel?.node ?? null;
        const oppIdentity = this._opponentIdentityCard ?? null;
        const oppTokenRow = this._opponentTokenRow ?? null;
        if (!isMulti) {
            // 1v1: 1v1 opp nodes ON, multi grid OFF.
            if (oppDelta) oppDelta.active = true;
            if (oppIdentity) oppIdentity.active = true;
            if (oppTokenRow) oppTokenRow.active = true;
            if (this._raceMultiGrid) this._raceMultiGrid.active = false;
            if (this._raceMultiBackBtn) this._raceMultiBackBtn.node.active = false;
            this._raceMultiExpandedIdx = null;
            return;
        }
        // Multi: collapsed by default — 1v1 opp nodes OFF, multi grid ON.
        if (oppDelta) oppDelta.active = false;
        if (oppIdentity) oppIdentity.active = false;
        if (oppTokenRow) oppTokenRow.active = false;
        if (this._raceMultiGrid) this._raceMultiGrid.active = true;
        if (this._raceMultiBackBtn) this._raceMultiBackBtn.node.active = false;
        this._raceMultiExpandedIdx = null;
        this._layoutMultiOppCards(n);
    }

    /** 2026-04-27 — Position the visible subset of the 7-card pool per mode. */
    private _layoutMultiOppCards(n: number): void {
        const oppCount = n - 1;
        const layouts: Record<number, { x: number; row: 1 | 2 }[]> = {
            2: [{ x: -86, row: 1 }, { x: 86, row: 1 }],
            3: [{ x: -172, row: 1 }, { x: 0, row: 1 }, { x: 172, row: 1 }],
            7: [
                { x: -258, row: 1 }, { x: -86, row: 1 }, { x: 86, row: 1 }, { x: 258, row: 1 },
                { x: -172, row: 2 }, { x: 0, row: 2 }, { x: 172, row: 2 },
            ],
        };
        const cfg = layouts[oppCount] ?? layouts[7];
        for (let i = 0; i < this._raceMultiCardNodes.length; i++) {
            const card = this._raceMultiCardNodes[i];
            if (i < oppCount && i < cfg.length) {
                const { x, row } = cfg[i];
                const y = row === 1 ? 60 : -60;
                card.setPosition(x, y, 0);
                card.active = true;
            } else {
                card.active = false;
            }
        }
    }

    private async _onClaim(): Promise<void> {
        console.log(`${TAG} onClaim | START height=${this._lastGameHeight}`);
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.isConnected) {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Not connected';
            return;
        }
        if (this._claimButton) this._claimButton.interactable = false;
        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Fetching blockhash…';

        const bh = await this._rpc.getLatestBlockhash();
        if (!bh) {
            console.log(`${TAG} onClaim | FAIL blockhash=null`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Failed to get blockhash';
            if (this._claimButton) this._claimButton.interactable = true;
            return;
        }

        // Phase 6: settle is now a real Anchor program call, not a memo tx.
        if (!this._sessionSeed) {
            // Trap state (audit T7): no session seed means the round can't be
            // settled — hide the Claim button instead of re-enabling it so the
            // user doesn't keep hitting an impossible state. Back is the exit.
            console.log(`${TAG} onClaim | FAIL no session_seed — stake was likely orphaned`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Session lost — tap Back to return to menu';
            if (this._claimButton) this._claimButton.node.active = false;
            showToast('No session to settle — return to menu', true);
            return;
        }

        // Hero bonus stays cosmetic in v1 (no longer lives in a memo since settle
        // is now a structured program call). Computed for status-text display only.
        let heroBonus = 0;
        if (this._pickedHeroSymbol && this._sessionDeltas) {
            const picked = this._sessionDeltas[this._pickedHeroSymbol] ?? 0;
            const max = Math.max(...Object.values(this._sessionDeltas));
            heroBonus = picked === max ? 25 : 0;
        }

        const tx = AnchorBackend.buildSettleTx(mwa.connectedPubkey, this._sessionSeed, this._lastGameHeight, bh.blockhash);
        if (tx.length === 0) {
            console.log(`${TAG} onClaim | FAIL tx_build`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Failed to build settle tx';
            if (this._claimButton) this._claimButton.interactable = true;
            return;
        }

        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Sign settle tx in your wallet…';
        const sig = await mwa.signAndSendTransaction(tx);
        console.log(`${TAG} onClaim | sig=${sig || '(empty)'} lastError=${mwa.lastError?.code ?? '(none)'}`);

        if (sig) {
            // CI5: hero bonus is computed off-chain in v1 (the settle tx doesn't
            // carry it). Make the status explicit so a reviewer clicking the
            // explorer link isn't surprised that the bonus isn't in the memo.
            const heroSuffix = this._pickedHeroSymbol
                ? ` (Hero: ${this._pickedHeroSymbol}${heroBonus > 0 ? ` +${heroBonus}% off-chain v1` : ''})`
                : '';
            if (this._tokenDuelStatus) {
                this._tokenDuelStatus.string =
                    `Settled on-chain!${heroSuffix}\nSig: ${sig.substring(0, 24)}…\nhttps://explorer.solana.com/tx/${sig}?cluster=devnet`;
            }
            showToast('Settled via Token Duel program', true);
            // Flow complete — button stays disabled.
            return;
        }

        // Error fallbacks — mirror HomeUI._onSignAndSend.
        if (mwa.lastError?.code === 'WALLET_AUTH_MISMATCH') {
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet mismatch';
        } else if (mwa.lastError?.code === 'WALLET_HUNG') {
            showToast("Wallet didn't respond — try reconnecting", true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet timeout';
        } else if (mwa.lastError?.code === 'WALLET_CRASHED') {
            showToast('Wallet crashed — try Backpack, Phantom, or Jupiter', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet crashed';
        } else if (mwa.lastError?.code === 'INSUFFICIENT_FUNDS_FOR_RENT') {
            showToast('Fee-payer underfunded — send ≥0.001 SOL and retry', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Underfunded';
        } else if (mwa.lastError?.code === 'RPC_BROADCAST_FAILED') {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Broadcast failed — tap again';
        } else {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Settle rejected — tap again to retry';
        }
        if (this._claimButton) this._claimButton.interactable = true;
    }

    /**
     * Session 2: replaces the former Sign → Broadcast two-tap flow with a
     * single commit that delegates to `mwa.signAndSendTransaction`. Matches
     * the pattern `_onClaim` already uses (AppUI.ts settle flow) and what
     * HomeUI uses for the generic Sign+Send demo. The MWAManager picks the
     * right route per wallet: native MWA 2.0 sign_and_send for Phantom /
     * Jupiter, sign+RPC fallback for Backpack (KNOWN_ISSUES #9) and the
     * universal-safe default for Solflare / Seed Vault / unknown. The wallet
     * catches pre-flight errors (insufficient funds) and shows its own
     * native prompt instead of leaking raw `-32002 / AccountNotFound` to us.
     */
    private async _onCommitStake(): Promise<void> {
        console.log(`${TAG} onCommitStake | START`);
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.isConnected) {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Not connected';
            console.log(`${TAG} onCommitStake | FAIL not_connected`);
            return;
        }
        const btn = this._stakeCommitButton ?? this._signStakeButton;
        if (btn) btn.interactable = false;
        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Fetching blockhash…';

        const bh = await this._rpc.getLatestBlockhash();
        if (!bh) {
            console.log(`${TAG} onCommitStake | FAIL blockhash=null`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Failed to get blockhash';
            if (btn) btn.interactable = true;
            return;
        }

        // Phase 6: Anchor `commit` program call. Fresh session seed per round
        // — random up to 2^40, ample space for demo PDAs.
        this._sessionSeed = BigInt(Math.floor(Math.random() * 1_000_000_000_000));
        const stakeLamports = this._currentStakeLamports();
        const tx = AnchorBackend.buildCommitTx(mwa.connectedPubkey, stakeLamports, this._sessionSeed, bh.blockhash);
        if (tx.length === 0) {
            console.log(`${TAG} onCommitStake | FAIL tx_build stake_lamports=${stakeLamports}`);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Failed to build commit tx';
            if (btn) btn.interactable = true;
            return;
        }

        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Confirm stake in your wallet…';
        console.log(`${TAG} onCommitStake | SENDING tx_bytes=${tx.length} stake_lamports=${stakeLamports} seed=${this._sessionSeed}`);
        const sig = await mwa.signAndSendTransaction(tx);
        console.log(`${TAG} onCommitStake | result sig=${sig || '(empty)'} lastError=${mwa.lastError?.code ?? '(none)'}`);

        if (sig) {
            this._stakeCommitSig = sig;
            if (btn) btn.node.active = false;
            if (this._startGameButton) {
                this._startGameButton.node.active = true;
                this._startGameButton.interactable = true;
            }
            const cluster = getAppIdentity().cluster;
            if (this._tokenDuelStatus) {
                this._tokenDuelStatus.string =
                    `Stake escrowed on-chain!\nSig: ${sig.substring(0, 24)}…\nhttps://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
            }
            showToast('Stake escrowed via Token Duel program', true);
            return;
        }

        // Error fallbacks — mirror _onClaim's branches plus Token-Duel-specific
        // AccountNotFound (0-SOL wallet on devnet). MWAManager normalizes errors
        // into codes (WALLET_*, INSUFFICIENT_FUNDS_FOR_RENT, RPC_BROADCAST_FAILED).
        const code = mwa.lastError?.code;
        const msg = (mwa.lastError?.message ?? '').toLowerCase();
        const isSimulationFail = code === 'RPC_BROADCAST_FAILED'
            && (msg.includes('accountnotfound') || msg.includes('no record of a prior credit'));

        if (isSimulationFail) {
            showToast('Wallet has 0 SOL — fund at faucet.solana.com and retry', true);
            if (this._tokenDuelStatus) {
                this._tokenDuelStatus.string = 'Wallet needs devnet SOL\nhttps://faucet.solana.com';
            }
        } else if (code === 'WALLET_AUTH_MISMATCH') {
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet mismatch';
        } else if (code === 'WALLET_HUNG') {
            showToast("Wallet didn't respond — try reconnecting", true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet timeout';
        } else if (code === 'WALLET_CRASHED') {
            showToast('Wallet crashed — try Backpack, Phantom, or Jupiter', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Wallet crashed';
        } else if (code === 'INSUFFICIENT_FUNDS_FOR_RENT') {
            showToast('Fee-payer underfunded — send ≥0.001 SOL and retry', true);
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Underfunded';
        } else if (code === 'RPC_BROADCAST_FAILED') {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = `Broadcast failed — tap Stake to retry\n${mwa.lastError?.message ?? ''}`;
        } else {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Commit rejected — tap Stake to retry';
        }
        if (btn) btn.interactable = true;
    }

    /** Current stake amount — driven by the active chip, or the v1 default. */
    private _currentStakeLamports(): bigint {
        console.log(`${TAG} _currentStakeLamports | DONE lamports=${this._selectedStakeLamports} default=${STAKE_LAMPORTS} is_default=${this._selectedStakeLamports === STAKE_LAMPORTS}`);
        return this._selectedStakeLamports;
    }

    // ═══════════════════════════════════════════════════════════════
    //  PHASE III — Birdeye feed + squad picker + stake chips
    // ═══════════════════════════════════════════════════════════════

    /** Lazy-init the shared BirdeyeClient (also available through PriceFeed). */
    private _getBirdeye(): BirdeyeClient {
        if (!this._birdeye) {
            this._birdeye = new BirdeyeClient();
            console.log(`${TAG} _getBirdeye | LAZY_INIT`);
        }
        return this._birdeye;
    }

    /** Toggle the dropdown popover open/closed. Session 11. */
    private _onFeedTabDropdownClick(): void {
        if (!this._feedTabDropdownPopover) return;
        const willOpen = !this._feedTabDropdownPopover.active;
        this._feedTabDropdownPopover.active = willOpen;
        // Close sibling popovers for mutual exclusivity.
        if (willOpen) {
            if (this._minLiqPopoverNode) this._minLiqPopoverNode.active = false;
            if (this._columnsPopoverNode) { this._columnsPopoverNode.active = false; this._columnsPopoverOpen = false; }
        }
        this._syncBackdrop();
        console.log(`${TAG} _onFeedTabDropdownClick | popover_open=${willOpen} current_tab=${this._currentFeedTab}`);
    }

    /** Dropdown option picked — close popover + switch tab. Session 11+13. */
    private _onFeedTabOptionClick(tab: FeedTabOrVirtual): void {
        console.log(`${TAG} _onFeedTabOptionClick | tab=${tab} prev=${this._currentFeedTab}`);
        if (this._feedTabDropdownPopover) this._feedTabDropdownPopover.active = false;
        this._syncBackdrop();
        this._currentFeedTab = tab;
        if (this._searchMode) {
            this._searchMode = false;
            if (this._searchEditBox) this._searchEditBox.string = '';
            if (this._searchClearButton) this._searchClearButton.node.active = false;
            if (this._searchPopoverNode) this._searchPopoverNode.active = false;
        }
        // Session 13: tab switch resets column visibility to this tab's defaults
        // and clears any pending row selection / watchlist mode.
        this._applyFeedColumnDefaults();
        this._selectedRowMint = null;
        if (this._watchlistMode) this._exitWatchlistMode();
        this._updateFeedTabDropdownLabel(tab);
        this._highlightActiveFeedTabOption(tab);
        this._restartFeedPoll();
        this._refreshFeed();
    }

    private _updateFeedTabDropdownLabel(tab: FeedTabOrVirtual): void {
        if (!this._feedTabDropdownLabel) return;
        // UX Phase 2b: emoji-free labels + IconBadge re-attach per tab.
        const map: Record<FeedTabOrVirtual, string> = {
            'new':         'New Pairs  ▾',
            'trending':    'Trending  ▾',
            'gainers':     'Top Gainers  ▾',
            'smart_money': 'Smart Money  ▾',
            'watchlist':   'Watchlist  ▾',
            'top10':       'Top 10  ▾',
        };
        const iconMap: Record<FeedTabOrVirtual, IconName> = {
            'new':         'bolt',
            'trending':    'flame',
            'gainers':     'chart',
            'smart_money': 'brain',
            'watchlist':   'star',
            'top10':       'trophy',
        };
        this._feedTabDropdownLabel.string = map[tab] ?? '▾';
        const btn = this._tokenDuelPanel?.getChildByName('FeedTabDropdownButton');
        if (btn) this._ensureIconBadge(btn, iconMap[tab] ?? 'bolt', { size: 16, offsetX: -90 });
    }

    private _highlightActiveFeedTabOption(active: FeedTabOrVirtual): void {
        // Session 12: teal-tinted chrome on active, flat chrome idle.
        for (const [tab, btn] of this._feedTabOptionButtons) {
            const spr = btn.node.getComponent(Sprite);
            if (!spr) continue;
            spr.color = tab === active
                ? new Color(28, 92, 78, 255)
                : new Color(28, 34, 48, 255);
        }
    }

    /** Filter chip tapped — re-sort/filter cached rows without re-fetching. */
    private _onFilterChipClick(key: FilterChipKey): void {
        // 'liq' chip is a dropdown trigger — defer to the popover handler so
        // the user picks High → Low or Low → High explicitly.
        if (key === 'liq') {
            this._onLiqSortDropdownClick();
            return;
        }
        console.log(`${TAG} _onFilterChipClick | key=${key} prev sort=${this._sortCol}/${this._sortDir} min_liq=${this._minLiq}`);
        switch (key) {
            case 'newest':   this._sortCol = 'age'; this._sortDir = 'desc'; break;
            case 'liq_desc': this._sortCol = 'liq'; this._sortDir = 'desc'; break;
            case 'liq_asc':  this._sortCol = 'liq'; this._sortDir = 'asc';  break;
            case 'all':      this._minLiq = 0;     break;
            case 'liq1k':    this._minLiq = 1000;  break;
            case 'liq5k':    this._minLiq = 5000;  break;
            case 'liq10k':   this._minLiq = 10000; break;
        }
        this._highlightActiveFilterChip(key);
        const filtered = this._applySortAndFilter(this._lastFetchedRows);
        this._currentFeedRows = filtered;
        if (filtered.length === 0) {
            this._renderEmptyStateRow(`No results (min liq $${this._minLiq})`, 'EMPTY_FILTER');
        } else {
            this._renderFeedRows(filtered);
        }
        console.log(`${TAG} _onFilterChipClick | DONE raw=${this._lastFetchedRows.length} filtered=${filtered.length} sort=${this._sortCol}/${this._sortDir} min_liq=${this._minLiq}`);
    }

    /** Liquidity-sort dropdown opened/closed (mirrors _onMinLiqDropdownClick). */
    private _onLiqSortDropdownClick(): void {
        if (!this._liqSortPopoverNode) return;
        const willOpen = !this._liqSortPopoverNode.active;
        this._liqSortPopoverNode.active = willOpen;
        if (willOpen) {
            if (this._minLiqPopoverNode) this._minLiqPopoverNode.active = false;
            if (this._columnsPopoverNode) { this._columnsPopoverNode.active = false; this._columnsPopoverOpen = false; }
            if (this._searchPopoverNode) this._searchPopoverNode.active = false;
            if (this._feedTabDropdownPopover) this._feedTabDropdownPopover.active = false;
        }
        this._syncBackdrop();
        console.log(`${TAG} _onLiqSortDropdownClick | popover_open=${willOpen} sort=${this._sortCol}/${this._sortDir}`);
    }

    /** Liquidity-sort option chosen (popover row tap). Routes to existing sort. */
    private _onLiqSortOptionClick(dir: 'desc' | 'asc'): void {
        this._sortCol = 'liq';
        this._sortDir = dir;
        if (this._liqSortPopoverNode) this._liqSortPopoverNode.active = false;
        this._syncBackdrop();
        // Update the FilterChip_liq label to reflect the chosen direction.
        const liqChip = this._filterChipButtons.get('liq');
        const liqChipLbl = liqChip?.node.getChildByName('Label')?.getComponent(Label) ?? null;
        if (liqChipLbl) liqChipLbl.string = dir === 'desc' ? 'Liq ↓ ▾' : 'Liq ↑ ▾';
        this._highlightActiveFilterChip('liq');
        const filtered = this._applySortAndFilter(this._lastFetchedRows);
        this._currentFeedRows = filtered;
        if (filtered.length === 0) {
            this._renderEmptyStateRow(`No results (min liq $${this._minLiq})`, 'EMPTY_FILTER');
        } else {
            this._renderFeedRows(filtered);
        }
        console.log(`${TAG} _onLiqSortOptionClick | dir=${dir} filtered=${filtered.length}`);
    }

    private _highlightActiveFilterChip(active: FilterChipKey): void {
        // Session 12: emerald-teal accent on active, chrome-bg idle.
        for (const [key, btn] of this._filterChipButtons) {
            const spr = btn.node.getComponent(Sprite);
            if (!spr) continue;
            spr.color = key === active
                ? new Color(48, 198, 155, 255)
                : new Color(28, 34, 48, 255);
        }
    }

    /** Apply current sort + liq filter to a row set (pure — returns new array). */
    private _applySortAndFilter(rows: TokenRow[]): TokenRow[] {
        const filtered = this._minLiq > 0 ? rows.filter((r) => r.liquidity >= this._minLiq) : rows.slice();
        const dir = this._sortDir === 'asc' ? 1 : -1;
        if (this._sortCol === 'liq') {
            filtered.sort((a, b) => (a.liquidity - b.liquidity) * dir);
        } else if (this._sortCol === 'vol') {
            filtered.sort((a, b) => (a.volume24hUsd - b.volume24hUsd) * dir);
        } else {
            // 'age' → newest first when desc: higher blockUnixTime = newer.
            filtered.sort((a, b) => (a.blockUnixTime - b.blockUnixTime) * dir);
        }
        return filtered;
    }

    /**
     * Session 13 A6: watchlist star enters multi-select mode (matches solpulse).
     * First click → enter mode (checkboxes appear on rows, button label changes
     * to "+ N to Watchlist"). Second click while in mode → confirm (add all
     * checked). Separate ✕ Cancel button exits without saving.
     */
    private _onWatchlistStarClick(): void {
        if (!this._watchlistMode) {
            // Enter mode.
            this._watchlistMode = true;
            this._watchlistChecked.clear();
            if (this._watchlistCancelButton) this._watchlistCancelButton.node.active = true;
            this._refreshWatchlistStarTint();
            this._renderFeedRows(this._currentFeedRows); // re-render to show checkboxes
            console.log(`${TAG} _onWatchlistStarClick | ENTER_MODE rows=${this._currentFeedRows.length}`);
            return;
        }
        // Confirm: add all checked to watchlist.
        if (this._watchlistChecked.size === 0) {
            console.log(`${TAG} _onWatchlistStarClick | CONFIRM_NOOP no_checked`);
            return;
        }
        let added = 0;
        for (const mint of this._watchlistChecked) {
            const row = this._currentFeedRows.find((r) => r.address === mint);
            if (!row) continue;
            if (Watchlist.add(row)) added++;
        }
        console.log(`${TAG} _onWatchlistStarClick | CONFIRM added=${added} checked=${this._watchlistChecked.size} total=${Watchlist.size()}`);
        showToast(`Added ${added} to Watchlist`);
        this._exitWatchlistMode();
        if (this._currentFeedTab === 'watchlist') this._refreshFeed();
    }

    /** Cancel watchlist mode without saving. */
    private _onWatchlistCancelClick(): void {
        console.log(`${TAG} _onWatchlistCancelClick | EXIT_MODE checked_was=${this._watchlistChecked.size}`);
        this._exitWatchlistMode();
    }

    private _exitWatchlistMode(): void {
        this._watchlistMode = false;
        this._watchlistChecked.clear();
        if (this._watchlistCancelButton) this._watchlistCancelButton.node.active = false;
        this._refreshWatchlistStarTint();
        this._renderFeedRows(this._currentFeedRows);
    }

    /** Gold when any squad token in watchlist, muted otherwise. */
    /**
     * Session 13: button styles reflect 3 states:
     *   idle         → "☆ Watchlist" on chrome bg
     *   idle+saved   → "★ Watchlist" on gold-tinted chrome
     *   mode+0       → "+ 0 to Watchlist" (dimmed emerald) + ✕ cancel visible
     *   mode+N       → "+ N to Watchlist" (full emerald)
     */
    private _refreshWatchlistStarTint(): void {
        if (!this._watchlistStarButton) return;
        const spr = this._watchlistStarButton.node.getComponent(Sprite);
        // 2026-04-26 — Watchlist is now an icon-only 44×44 button. Label is
        // empty; state is conveyed entirely by the icon + bg tint.
        if (this._watchlistStarLabel) this._watchlistStarLabel.string = '';
        if (this._watchlistMode) {
            const n = this._watchlistChecked.size;
            if (spr) spr.color = n > 0 ? new Color(48, 198, 155, 255) : new Color(36, 76, 68, 255);
            const btn = this._tokenDuelPanel?.getChildByName('WatchlistStarButton');
            if (btn) this._ensureIconBadge(btn, 'star', { size: 32, offsetX: 0 });
            return;
        }
        const anyIn = Watchlist.size() > 0;
        if (spr) spr.color = anyIn ? new Color(70, 52, 14, 255) : new Color(28, 34, 48, 255);
        const btn = this._tokenDuelPanel?.getChildByName('WatchlistStarButton');
        if (btn) this._ensureIconBadge(btn, anyIn ? 'star' : 'starOutline', { size: 32, offsetX: 0 });
    }

    /** Search-suggest row tapped — add to squad (same semantics as feed row tap). */
    private _onSearchSuggestTap(i: number): void {
        const row = this._currentFeedRows[i];
        if (!row) {
            console.log(`${TAG} _onSearchSuggestTap | NO_ROW index=${i}`);
            return;
        }
        const added = this._squad.add(row);
        console.log(`${TAG} _onSearchSuggestTap | index=${i} symbol="${row.symbol}" squad_index=${added}`);
        if (added >= 0) showToast(`+ ${row.symbol} → slot ${added + 1}`);
        // Close the popover after tap (like a native autocomplete).
        if (this._searchPopoverNode) this._searchPopoverNode.active = false;
        if (this._searchEditBox) this._searchEditBox.string = '';
        this._searchMode = false;
        this._refreshFeed().catch(() => {});
    }

    /** Cadence per tab. Session 11: smart_money 30s, watchlist no poll. */
    private _currentTabPollMs(): number {
        switch (this._currentFeedTab) {
            case 'trending':
            case 'gainers':
                return 15_000;
            case 'new':
            case 'top10':
            case 'smart_money':
                return 30_000;
            case 'watchlist':
                return 60_000; // watchlist reads from localStorage; only need periodic price enrich
            default:
                return 20_000;
        }
    }

    private _restartFeedPoll(): void {
        if (this._feedPollTimer !== null) {
            clearInterval(this._feedPollTimer as unknown as number);
            this._feedPollTimer = null;
            console.log(`${TAG} _restartFeedPoll | cleared_previous`);
        }
        const ms = this._currentTabPollMs();
        this._feedPollTimer = setInterval(() => {
            // Session 9: surface poll-tick errors under [AppUI] instead of
            // swallowing them silently — the previous `.catch(() => {})` hid
            // every Birdeye transport failure that happened after the first
            // fetch, making it impossible to tell a cold start from a
            // sustained 4xx.
            this._refreshFeed().catch((e) => console.log(`${TAG} _refreshFeed | POLL_ERROR tab=${this._currentFeedTab} error=${e}`));
            const owner = MWAManager.instance?.connectedPubkey;
            if (owner) this._refreshBalanceChip(owner).catch(() => {});
        }, ms) as unknown as number;
        console.log(`${TAG} _restartFeedPoll | tab=${this._currentFeedTab} interval_ms=${ms} timer=${this._feedPollTimer}`);
    }

    /** Call Birdeye (or leaderboard RPC) for the current tab and render rows. */
    private async _refreshFeed(): Promise<void> {
        if (this._searchMode) {
            console.log(`${TAG} _refreshFeed | SKIP_SEARCH_ACTIVE tab=${this._currentFeedTab}`);
            return;
        }
        const tabForUrl = this._currentFeedTab;
        const limit = Math.max(1, this._feedRowNodes.length || 20);
        const previewUrl = tabForUrl === 'trending'    ? trendingUrl(limit)
                         : tabForUrl === 'gainers'     ? gainersUrl(limit)
                         : tabForUrl === 'new'         ? newListingsUrl(limit)
                         : tabForUrl === 'smart_money' ? smartMoneyUrl(limit)
                         : ''; // top10 = RPC, watchlist = localStorage
        console.log(`${TAG} _refreshFeed | START tab=${this._currentFeedTab}${previewUrl ? ` path=${pathOf(previewUrl)}` : ''}`);

        // Short-circuit the two non-Birdeye tabs.
        if (this._currentFeedTab === 'top10') {
            await this._renderLeaderboardRows();
            return;
        }
        if (this._currentFeedTab === 'watchlist') {
            await this._refreshWatchlistTab();
            return;
        }

        if (this._currentFeedRows.length === 0) {
            this._renderEmptyStateRow(`Loading ${this._currentFeedTab}…`, 'LOADING');
        }

        const client = this._getBirdeye();
        let rows: TokenRow[] = [];
        try {
            rows = await client.getTrending(this._currentFeedTab as FeedTab, limit);
        } catch (e) {
            console.log(`${TAG} _refreshFeed | CLIENT_ERROR tab=${this._currentFeedTab} error=${e}`);
        }

        // Session 11: enrich rows with missing prices (new + trending tabs
        // commonly return incomplete data for fresh listings).
        if ((this._currentFeedTab === 'new' || this._currentFeedTab === 'trending') && rows.length > 0) {
            rows = await this._enrichViaPriceMulti(rows);
        }

        const usable = rows.filter((r) => r.address && r.symbol);
        this._lastFetchedRows = usable; // cache for filter chips to re-derive without re-fetch
        if (usable.length === 0) {
            console.log(`${TAG} _refreshFeed | EMPTY tab=${this._currentFeedTab} rows_received=${rows.length}`);
            this._renderEmptyStateRow(`No results for ${this._currentFeedTab}`, 'EMPTY_TAB');
            this._currentFeedRows = [];
            return;
        }
        const sorted = this._applySortAndFilter(usable);
        this._currentFeedRows = sorted;
        this._renderFeedRows(sorted);
        // Aggregate log so we can see enrichment took effect even in compressed logs.
        let liqSum = 0, mcapSum = 0, holdersSum = 0, scoreSum = 0;
        for (const r of sorted) { liqSum += r.liquidity; mcapSum += r.marketCap; holdersSum += r.holders; scoreSum += computeScore(r); }
        const avgScore = sorted.length ? Math.round(scoreSum / sorted.length) : 0;
        console.log(`${TAG} _refreshFeed | DONE tab=${this._currentFeedTab} rendered=${sorted.length}/${this._feedRowNodes.length} raw=${usable.length} avg_score=${avgScore} liq_sum=${Math.round(liqSum)} mcap_sum=${Math.round(mcapSum)} holders_sum=${holdersSum}`);
    }

    /**
     * Session 11: backfill missing price/change/volume via /defi/price_volume/multi.
     * Calls BirdeyeClient directly so we don't need to instantiate a full PriceFeed
     * (which has its own polling state).
     */
    private async _enrichViaPriceMulti(rows: TokenRow[]): Promise<TokenRow[]> {
        const needPrice = rows.filter((r) => r.address && (r.priceUsd === 0 || r.change24hPct === 0));
        if (needPrice.length === 0) {
            console.log(`${TAG} _enrichViaPriceMulti | ENRICH_SKIP reason=all_have_price tab=${this._currentFeedTab} rows=${rows.length}`);
            return rows;
        }
        console.log(`${TAG} _enrichViaPriceMulti | ENRICH_START tab=${this._currentFeedTab} candidates=${needPrice.length} total=${rows.length}`);
        let live;
        try {
            live = await this._getBirdeye().priceMulti(needPrice.map((r) => r.address));
        } catch (e) {
            console.log(`${TAG} _enrichViaPriceMulti | ENRICH_ERROR error=${e} — rows returned as-is`);
            return rows;
        }
        let applied = 0;
        const out = rows.map((r) => {
            const upd = live[r.address];
            if (!upd) return r;
            applied++;
            return {
                ...r,
                priceUsd: r.priceUsd || upd.priceUsd,
                change24hPct: r.change24hPct || upd.change24hPct,
                volume24hUsd: r.volume24hUsd || upd.volume24hUsd,
            };
        });
        console.log(`${TAG} _enrichViaPriceMulti | ENRICH_DONE applied=${applied} skipped=${needPrice.length - applied}`);
        return out;
    }

    /**
     * Watchlist tab render: pulls rows from localStorage, then enriches via
     * Birdeye's priceMulti so the 24h % is fresh. No getTrending call.
     */
    private async _refreshWatchlistTab(): Promise<void> {
        console.log(`${TAG} _refreshWatchlistTab | START count=${Watchlist.size()}`);
        const base = Watchlist.asRows();
        if (base.length === 0) {
            this._renderEmptyStateRow('Watchlist empty — tap ★ above after picking tokens', 'EMPTY_WATCHLIST');
            this._currentFeedRows = [];
            this._lastFetchedRows = [];
            console.log(`${TAG} _refreshWatchlistTab | EMPTY`);
            return;
        }
        const enriched = await this._enrichViaPriceMulti(base);
        this._lastFetchedRows = enriched;
        const sorted = this._applySortAndFilter(enriched);
        this._currentFeedRows = sorted;
        this._renderFeedRows(sorted);
        console.log(`${TAG} _refreshWatchlistTab | DONE rendered=${sorted.length}/${base.length}`);
    }

    /**
     * B2 helper — fills row 0 with a message and hides the rest. Used for
     * Loading / Empty / Not-initialized states. Transition-log pattern:
     *   console.log via the `state` label so future state machines can be grepped.
     */
    private _renderEmptyStateRow(message: string, state: string): void {
        for (let i = 0; i < this._feedRowNodes.length; i++) {
            const node = this._feedRowNodes[i];
            if (!node) continue;
            if (i === 0) {
                node.active = true;
                const logo = this._feedRowLogoSprites[0];
                if (logo?.node) logo.node.active = false;
                const symL = this._feedRowSymbolLabels[0];
                const dltL = this._feedRowDeltaLabels[0];
                const spr = this._feedRowSprites[0];
                if (symL) symL.string = message;
                if (dltL) dltL.string = '';
                if (spr) spr.color = new Color(35, 35, 50, 255);
            } else {
                node.active = false;
            }
        }
        console.log(`${TAG} _renderEmptyStateRow | state=${state} message="${message}"`);
    }

    /**
     * Leaderboard rendering (Phase B B8): re-use the same row pool, but each
     * row shows "rank. player (short) — height — elapsed" with a trophy-esque
     * backdrop tint by rank. Uses a distinct address scheme (rank-prefixed
     * sentinel strings) so _onFeedRowTap ignores taps.
     */
    private async _renderLeaderboardRows(): Promise<void> {
        console.log(`${TAG} _renderLeaderboardRows | START mode=${this._lbFilterMode}`);
        let entries: { player: string; height: number; settled_at: number }[] = [];
        let rpcErr: any = null;
        try {
            // Session D Part 7: fetch mode-specific leaderboard PDA. Mirrors
            // the dedicated LeaderboardPanel; feed-tab view uses the same filter.
            const modeEntries = await fetchLeaderboard(this._tdRpc, this._lbFilterMode);
            entries = modeEntries.map((e) => ({
                player: e.player,
                height: e.height,
                settled_at: Number(e.settledAt),
            }));
        } catch (e) {
            rpcErr = e;
            console.log(`${TAG} _renderLeaderboardRows | CLIENT_ERROR error=${e}`);
        }
        // Distinguish "not initialized" (empty result + no error) from "no finishers yet"
        // (PDA exists, all entries zero). TokenDuelRpc.getLeaderboard logs NOT_INITIALIZED
        // when getAccountInfo returns null — we can't see the distinction here, but the
        // message below is broad enough to cover both without lying to the user.
        if (entries.length === 0) {
            const msg = rpcErr
                ? 'Leaderboard fetch failed — tap another tab and retry'
                : 'No finishers yet — be the first';
            const state = rpcErr ? 'EMPTY_LEADERBOARD_ERR' : 'EMPTY_LEADERBOARD';
            this._renderEmptyStateRow(msg, state);
            this._currentFeedRows = [];
            return;
        }
        this._currentFeedRows = []; // taps are no-ops on leaderboard rows
        const nowSec = Math.floor(Date.now() / 1000);
        for (let i = 0; i < this._feedRowNodes.length; i++) {
            const entry = entries[i];
            const node = this._feedRowNodes[i];
            if (!entry || entry.height === 0) {
                node.active = false;
                continue;
            }
            node.active = true;
            const symL = this._feedRowSymbolLabels[i];
            const dltL = this._feedRowDeltaLabels[i];
            const spr = this._feedRowSprites[i];
            const logo = this._feedRowLogoSprites[i];
            // Hide the logo sprite on leaderboard rows (no token to show).
            if (logo?.node) logo.node.active = false;
            if (symL) {
                const short = entry.player.length > 8
                    ? `${entry.player.substring(0, 4)}…${entry.player.substring(entry.player.length - 4)}`
                    : entry.player;
                symL.string = `${i + 1}.  ${short}`;
            }
            if (dltL) {
                const elapsedSec = Math.max(0, nowSec - entry.settled_at);
                const elapsedStr = elapsedSec < 60
                    ? `${elapsedSec}s ago`
                    : elapsedSec < 3600
                        ? `${Math.floor(elapsedSec / 60)}m ago`
                        : `${Math.floor(elapsedSec / 3600)}h ago`;
                // Block 5: decode encoded score → portfolio delta %.
                const pct = decodeScore(entry.height);
                const sign = pct >= 0 ? '+' : '';
                dltL.string = `${sign}${pct.toFixed(2)}% · ${elapsedStr}`;
                dltL.color = pct >= 0 ? new Color(48, 198, 155, 255) : new Color(236, 88, 122, 255);
            }
            if (spr) {
                // Rank tint: gold → silver → bronze → flat.
                if (i === 0) spr.color = new Color(90, 70, 10, 255);
                else if (i === 1) spr.color = new Color(70, 70, 70, 255);
                else if (i === 2) spr.color = new Color(70, 50, 30, 255);
                else spr.color = new Color(40, 40, 60, 255);
            }
        }
        console.log(`${TAG} _renderLeaderboardRows | DONE entries=${entries.length}`);
    }

    /**
     * Session 11: solpulse-parity row renderer. Populates 9 columns per row
     * plus logo + live dot. Score computed client-side via TokenScore.compute.
     * DEX pill color-muted, age color-shifts green when fresh, change color
     * green/red by sign.
     */
    private _renderFeedRows(rows: TokenRow[]): void {
        const isNewTab = this._currentFeedTab === 'new';
        const showCols = this._visibleCols;
        for (let i = 0; i < this._feedRowNodes.length; i++) {
            const node = this._feedRowNodes[i];
            const row = rows[i];
            if (!row) { node.active = false; continue; }
            node.active = true;

            // Session 13 A5: selection edge — emerald strip on left when this
            // mint matches _selectedRowMint.
            const selEdge = this._feedRowSelectedEdges[i];
            if (selEdge) selEdge.active = row.address === this._selectedRowMint;

            // 2026-04-26 — checkbox is ALWAYS visible (no longer gated on
            // pick/watchlist mode). Its checked state mirrors squad membership
            // for the row's mint, except in watchlist mode where it mirrors
            // the pending-add set instead.
            const chkSpr = this._feedRowCheckboxes[i];
            const isInSquad = this._squad.slots.some((s) => !!s && s.address === row.address);
            if (chkSpr?.node) {
                chkSpr.node.active = true;
                const checked = this._watchlistMode
                    ? this._watchlistChecked.has(row.address)
                    : isInSquad;
                chkSpr.color = checked ? new Color(48, 198, 155, 255) : new Color(45, 52, 70, 255);
                const iconN = chkSpr.node.getChildByName('CheckmarkIcon');
                if (iconN) iconN.active = checked;
            }
            // Logo position is sourced entirely from the layout spec
            // (FR.logo.x). The runtime override that shifted the logo right
            // in check mode is gone — checkboxes are always visible and the
            // spec already places the logo to clear them.

            // Logo.
            const logo = this._feedRowLogoSprites[i];
            if (logo?.node) {
                logo.node.active = true;
                // Defensive: re-assert 2.5x hero size in case scene cache lags.
                // Mirrors LayoutSpec.cjs feedRow.logo.{w,h}.
                const logoUT = logo.node.getComponent(UITransform);
                if (logoUT) logoUT.setContentSize(220, 220);
            }
            this._loadLogoInto(logo, row.logoUri);

            // Top line: ticker bold.
            const symL = this._feedRowSymbolLabels[i];
            if (symL) {
                const sym = row.symbol && row.symbol.length > 0 ? `$${row.symbol}` : '—';
                symL.string = sym.length > 12 ? sym.substring(0, 12) + '…' : sym;
                symL.color = new Color(255, 255, 255, 255);
            }

            // Bottom line: name · shortened mint.
            const nameL = this._feedRowNameLabels[i];
            if (nameL) {
                const short = this._fmtMintShort(row.address);
                const name = row.name ? (row.name.length > 16 ? row.name.substring(0, 16) : row.name) : '';
                nameL.string = name ? `${name} · ${short}` : short;
            }

            // Score column.
            const scoreL = this._feedRowScoreLabels[i];
            if (scoreL) {
                const s = computeScore(row);
                scoreL.string = formatScore(s);
                // Color by band: 0-39 muted, 40-59 amber, 60-79 white, 80-100 green.
                scoreL.color = s >= 80 ? new Color(120, 220, 140, 255)
                             : s >= 60 ? new Color(230, 230, 240, 255)
                             : s >= 40 ? new Color(220, 180, 100, 255)
                             :           new Color(150, 150, 160, 255);
            }

            // Liq / Vol — compact USD format.
            const liqL = this._feedRowLiqLabels[i];
            if (liqL) {
                liqL.string = this._fmtUsdCompact(row.liquidity);
                liqL.node.active = showCols.has('liq');
            }
            const volL = this._feedRowVolLabels[i];
            if (volL) {
                volL.string = this._fmtUsdCompact(row.volume24hUsd);
                volL.node.active = showCols.has('vol');
            }

            // 24h Change — green/red/grey.
            const changeL = this._feedRowChangeLabels[i];
            const deltaL = this._feedRowDeltaLabels[i]; // alias — update both
            const changeStr = this._fmtPercent(row.change24hPct);
            const changeColor = row.change24hPct > 0 ? new Color(120, 220, 140, 255)
                              : row.change24hPct < 0 ? new Color(240, 110, 110, 255)
                              :                       new Color(200, 200, 200, 255);
            if (changeL) {
                changeL.string = changeStr;
                changeL.color = changeColor;
                changeL.node.active = showCols.has('change');
            }
            if (deltaL && deltaL !== changeL) { deltaL.string = changeStr; deltaL.color = changeColor; }

            // Price — accent gold.
            const priceL = this._feedRowPriceLabels[i];
            if (priceL) {
                priceL.string = this._fmtPrice(row.priceUsd);
                priceL.node.active = showCols.has('price');
            }

            // DEX — bottom line, muted.
            const dexL = this._feedRowDexLabels[i];
            if (dexL) {
                dexL.string = row.source ? row.source.replace(/_/g, ' ') : '';
                dexL.node.active = showCols.has('source');
            }

            // Age — fresh = green, stale = grey.
            const ageL = this._feedRowAgeLabels[i];
            if (ageL) {
                ageL.string = this._fmtAge(row.blockUnixTime);
                const ageSec = row.blockUnixTime > 0 ? Math.floor(Date.now() / 1000) - row.blockUnixTime : -1;
                ageL.color = ageSec < 0 ? new Color(100, 100, 110, 255)
                           : ageSec < 60 ? new Color(120, 220, 140, 255)
                           : ageSec < 300 ? new Color(218, 200, 80, 255)
                           :                new Color(140, 170, 150, 255);
                ageL.node.active = showCols.has('age');
            }

            // Toggle score visibility per _visibleCols.
            if (scoreL) scoreL.node.active = showCols.has('score');

            // LiveDot — only show on new-pair tab.
            const liveDot = this._feedRowLiveDots[i];
            if (liveDot) liveDot.active = isNewTab;

            // Session 13: flat list + selection highlight.
            const spr = this._feedRowSprites[i];
            if (spr) {
                if (row.address === this._selectedRowMint) {
                    spr.color = new Color(28, 70, 58, 255); // emerald-tinted selected
                } else {
                    const base = i % 2 === 0 ? [14, 18, 28] : [18, 22, 32];
                    spr.color = new Color(base[0], base[1], base[2], 255);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 11 — formatting helpers (solpulse-parity output)
    // ═══════════════════════════════════════════════════════════════

    /** $11.5K / $5.3M / $1.2B / "$8.4" — compact USD with SI suffix. */
    private _fmtUsdCompact(n: number): string {
        if (!Number.isFinite(n) || n <= 0) return '—';
        const abs = Math.abs(n);
        if (abs >= 1e9) return `$${(n / 1e9).toFixed(abs < 10e9 ? 2 : 1)}B`;
        if (abs >= 1e6) return `$${(n / 1e6).toFixed(abs < 10e6 ? 2 : 1)}M`;
        if (abs >= 1e3) return `$${(n / 1e3).toFixed(abs < 10e3 ? 1 : 0)}K`;
        if (abs >= 1)   return `$${n.toFixed(abs < 10 ? 2 : 0)}`;
        return `$${n.toFixed(2)}`;
    }

    /** $0.000304 / $7.5e-6 / $1.25 — precision scales with magnitude. */
    private _fmtPrice(n: number): string {
        if (!Number.isFinite(n) || n <= 0) return '—';
        if (n >= 1) return `$${n.toFixed(2)}`;
        if (n >= 0.01) return `$${n.toFixed(4)}`;
        if (n >= 1e-6) return `$${n.toFixed(6)}`;
        // Very small — scientific notation like $7.5e-6.
        return `$${n.toExponential(1)}`;
    }

    /** +3.1% / -11.6% / "—" */
    private _fmtPercent(n: number): string {
        if (!Number.isFinite(n) || n === 0) return '—';
        const sign = n > 0 ? '+' : '';
        return `${sign}${n.toFixed(1)}%`;
    }

    /** 45s / 12m / 3h / 2d / "—" when unknown. */
    private _fmtAge(unixSec: number): string {
        if (!unixSec || unixSec <= 0) return '—';
        const diff = Math.floor(Date.now() / 1000) - unixSec;
        if (diff < 0) return '—';
        if (diff < 60) return `${diff}s`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
        return `${Math.floor(diff / 86400)}d`;
    }

    /** 3Q41R4…ad5z — first4…last4 of a mint. */
    private _fmtMintShort(addr: string): string {
        if (!addr || addr.length <= 8) return addr ?? '';
        return `${addr.substring(0, 4)}…${addr.substring(addr.length - 4)}`;
    }

    /**
     * Session 14: row-tap behavior branches on mode.
     *   squadPickMode  → toggle pick check (honors 3-max rule).
     *   watchlistMode  → toggle watchlist check.
     *   else           → highlight + open detail view.
     */
    private _onFeedRowTap(i: number): void {
        const row = this._currentFeedRows[i];
        if (!row) {
            console.log(`${TAG} _onFeedRowTap | NO_ROW index=${i}`);
            return;
        }
        if (this._squadPickMode) {
            if (this._squadPickChecked.has(row.address)) {
                this._squadPickChecked.delete(row.address);
                console.log(`${TAG} _onFeedRowTap | PICK_UNCHECK index=${i} symbol="${row.symbol}" checked=${this._squadPickChecked.size}`);
            } else {
                const filled = this._squad.filled;
                if (this._squadPickChecked.size + filled >= 3) {
                    showToast(`Squad limit 3 (have ${filled}, picking ${this._squadPickChecked.size})`);
                    console.log(`${TAG} _onFeedRowTap | PICK_BLOCKED_MAX filled=${filled} checked=${this._squadPickChecked.size}`);
                    return;
                }
                if (filled > 0 && this._squad.slots.some((s) => s?.address === row.address)) {
                    showToast(`${row.symbol} already in squad`);
                    return;
                }
                this._squadPickChecked.add(row.address);
                console.log(`${TAG} _onFeedRowTap | PICK_CHECK index=${i} symbol="${row.symbol}" checked=${this._squadPickChecked.size}`);
            }
            this._refreshSquadActionButtons();
            this._renderFeedRows(this._currentFeedRows);
            return;
        }
        if (this._watchlistMode) {
            if (this._watchlistChecked.has(row.address)) {
                this._watchlistChecked.delete(row.address);
                console.log(`${TAG} _onFeedRowTap | UNCHECK index=${i} symbol="${row.symbol}" checked=${this._watchlistChecked.size}`);
            } else {
                this._watchlistChecked.add(row.address);
                console.log(`${TAG} _onFeedRowTap | CHECK index=${i} symbol="${row.symbol}" checked=${this._watchlistChecked.size}`);
            }
            this._refreshWatchlistStarTint();
            this._renderFeedRows(this._currentFeedRows);
            return;
        }
        // 2026-04-27 — default tap behavior:
        //   • If row already in squad → just unpick (no popover).
        //   • If user pre-selected an empty squad slot via "Pick +" → drop
        //     directly into that slot, skip the popover.
        //   • Otherwise → open the [+ Pick] / [View Chart] popover anchored
        //     to the right of the tapped row's checkbox.
        const existingIdx = this._squad.slots.findIndex((s) => !!s && s.address === row.address);
        if (existingIdx >= 0) {
            console.log(`${TAG} _onFeedRowTap | UNPICK symbol="${row.symbol}" slot=${existingIdx}`);
            this._squad.clearAt(existingIdx);
            this._renderFeedRows(this._currentFeedRows);
            return;
        }
        if (this._pickTargetSlot != null && !this._squad.slots[this._pickTargetSlot]) {
            const targetSlot = this._pickTargetSlot;
            this._squad.setAt(targetSlot, row);
            this._pickTargetSlot = null;
            console.log(`${TAG} _onFeedRowTap | PICK_TARGET_DROP symbol="${row.symbol}" slot=${targetSlot}`);
            this._renderFeedRows(this._currentFeedRows);
            return;
        }
        this._rowActionPendingRow = row;
        if (this._rowActionPopover) {
            // Reposition popover next to the tapped row's checkbox. Row world-y
            // → TokenDuelPanel-local-y; x = checkbox right edge + half-popover-w + gap.
            const rowNode = this._feedRowNodes[i];
            const tdUT = this._tokenDuelPanel?.getComponent(UITransform);
            if (rowNode && tdUT) {
                const wp = rowNode.worldPosition;
                const local = new Vec3();
                tdUT.convertToNodeSpaceAR(wp, local);
                // Checkbox sits at row local x=-320, w=22 (half=11). Popover
                // w=260 (half=130). Anchor popover so its left edge sits 10 px
                // right of the checkbox's right edge:
                //   popLeft = checkboxRight + 10
                //   popCenter = popLeft + popHalfW = checkboxX + checkboxHalfW + 10 + popHalfW
                const popX = local.x + (-320) + 11 + 10 + 130;
                const popY = local.y;
                this._rowActionPopover.setPosition(new Vec3(popX, popY, 0));
            }
            this._rowActionPopover.active = true;
            this._syncBackdrop();
            console.log(`${TAG} _onFeedRowTap | ROW_ACTION_POPOVER symbol="${row.symbol}" idx=${i}`);
        }
    }

    /** Pick + on the row-action popover — toggle squad membership for the cached row. */
    private _onRowActionPick(): void {
        const row = this._rowActionPendingRow;
        if (this._rowActionPopover) this._rowActionPopover.active = false;
        this._syncBackdrop();
        this._rowActionPendingRow = null;
        if (!row) return;
        const existingIdx = this._squad.slots.findIndex((s) => !!s && s.address === row.address);
        if (existingIdx >= 0) {
            console.log(`${TAG} _onRowActionPick | TOGGLE_OFF symbol="${row.symbol}" slot=${existingIdx}`);
            this._squad.clearAt(existingIdx);
        } else {
            let placedAt = -1;
            if (this._pickTargetSlot != null && !this._squad.slots[this._pickTargetSlot]) {
                this._squad.setAt(this._pickTargetSlot, row);
                placedAt = this._pickTargetSlot;
                this._pickTargetSlot = null;
            } else {
                placedAt = this._squad.add(row);
            }
            console.log(`${TAG} _onRowActionPick | TOGGLE_ON symbol="${row.symbol}" slot=${placedAt}`);
            if (placedAt < 0) {
                showToast('Squad full — tap × to remove first');
            }
        }
        this._renderFeedRows(this._currentFeedRows);
    }

    /** View Chart on the row-action popover — open the existing TokenDetail panel. */
    private _onRowActionChart(): void {
        const row = this._rowActionPendingRow;
        if (this._rowActionPopover) this._rowActionPopover.active = false;
        this._syncBackdrop();
        this._rowActionPendingRow = null;
        if (!row) return;
        console.log(`${TAG} _onRowActionChart | symbol="${row.symbol}"`);
        this._showTokenDetail(row);
    }

    private _onSquadSlotTap(i: number): void {
        // Empty slot tap → toggle the per-slot pick target. The next feed-row
        // tap will land into this slot specifically. Tapping the same target
        // again clears the target. Tapping a different empty slot moves it.
        if (!this._squad.slots[i]) {
            this._pickTargetSlot = (this._pickTargetSlot === i) ? null : i;
            console.log(`${TAG} _onSquadSlotTap | TARGET_SET slot=${i} target=${this._pickTargetSlot}`);
            this._renderSquad();
            return;
        }
        // Filled slot tap → clear (back-compat fallback; the per-slot × is
        // the primary removal affordance).
        console.log(`${TAG} _onSquadSlotTap | CLEAR slot=${i} symbol=${this._squad.slots[i]?.symbol}`);
        this._squad.clearAt(i);
    }

    private _onSquadSlotRemove(i: number): void {
        if (!this._squad.slots[i]) return;
        console.log(`${TAG} _onSquadSlotRemove | index=${i} symbol=${this._squad.slots[i]?.symbol}`);
        const slotNode = this._squadSlotButtons[i]?.node ?? null;
        if (slotNode) {
            try { addPressPop(slotNode); } catch (_) { /* ignore */ }
        }
        this._squad.clearAt(i);
    }

    private _renderSquad(): void {
        const slots = this._squad.slots;
        for (let i = 0; i < this._squadSlotSymbolLabels.length; i++) {
            const symLbl = this._squadSlotSymbolLabels[i];
            const dltLbl = this._squadSlotDeltaLabels[i];
            const logo = this._squadSlotLogoSprites[i];
            const btn = this._squadSlotButtons[i];
            const slot = slots[i];
            const slotNode = btn?.node ?? null;
            const wasFilled = this._squadSlotPrevFilled[i] ?? false;
            const isFilled = !!slot;
            // Slot card stays visible always — empty slots show "+" drop zone.
            if (slotNode && !slotNode.active) slotNode.active = true;
            const removeBtn = slotNode?.getChildByName('RemoveButton') ?? null;
            if (!slot) {
                // EMPTY: 'Pick +' affordance — tap to target this slot for
                // the next pick (see _onSquadSlotTap → _pickTargetSlot).
                const targeted = this._pickTargetSlot === i;
                symLbl.string = 'Pick +';
                symLbl.color = targeted
                    ? new Color(48, 198, 155, 255)   // bright emerald when targeted
                    : new Color(168, 230, 200, 255); // mint when idle
                symLbl.fontSize = 18;
                if (dltLbl) { dltLbl.string = ''; dltLbl.node.active = false; }
                if (logo) { logo.spriteFrame = null; logo.node.active = false; }
                if (removeBtn) removeBtn.active = false;
                // Brighten the slot bg when this slot is the active target.
                const slotSpr = slotNode?.getComponent(Sprite) ?? null;
                if (slotSpr) {
                    slotSpr.color = targeted
                        ? new Color(36, 76, 68, 255)
                        : new Color(26, 32, 48, 255);
                }
            } else {
                const d = slot.change24hPct;
                const sign = d > 0 ? '+' : '';
                const pctStr = Number.isFinite(d) && d !== 0 ? `${sign}${d.toFixed(1)}%` : '—';
                symLbl.string = slot.symbol ?? '?';
                symLbl.color = new Color(240, 242, 250, 255);
                symLbl.fontSize = 18;
                if (dltLbl) {
                    dltLbl.string = pctStr;
                    dltLbl.color = d > 0
                        ? new Color(120, 220, 120, 255)
                        : d < 0
                            ? new Color(240, 110, 110, 255)
                            : new Color(180, 185, 200, 255);
                    dltLbl.node.active = true;
                }
                if (logo) {
                    logo.node.active = true;
                    if (slot.logoUri) this._loadLogoInto(logo, slot.logoUri);
                    else { logo.spriteFrame = null; logo.color = new Color(60, 72, 96, 255); }
                }
                if (removeBtn) removeBtn.active = true;
                // Reset slot bg to neutral once filled (clears any leftover
                // targeted highlight from when it was empty).
                const slotSpr = slotNode?.getComponent(Sprite) ?? null;
                if (slotSpr) slotSpr.color = new Color(26, 32, 48, 255);
                // Slot pop on empty → filled transition.
                if (!wasFilled && slotNode) {
                    try {
                        slotNode.setScale(1, 1, 1);
                        tween(slotNode)
                            .to(0.12, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'cubicOut' as any })
                            .to(0.10, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicIn' as any })
                            .start();
                    } catch (_) { /* ignore */ }
                }
            }
            this._squadSlotPrevFilled[i] = isFilled;
        }
        console.log(`${TAG} _renderSquad | DONE filled=${this._squad.filled}/${slots.length} slots_rendered=${this._squadSlotSymbolLabels.length}`);
        // Pulse any slots whose 24h % has drifted since the last render (A6).
        this._maybePulseSquadOnDeltas();
        // Session 4 B1: if the squad just crossed empty → populated (or vice versa)
        // re-offer the hero pick so tiles track the new source.
        if (this._tokenDuelPanel?.active && !this._stakeCommitSig && !this._pickedHeroSymbol) {
            this._offerHeroPickIfSupported();
        }
    }

    private _onStakeChipTap(kind: '001' | '010' | '100', sol: number): void {
        this._selectedStakeLamports = BigInt(Math.floor(sol * 1_000_000_000));
        console.log(`${TAG} _onStakeChipTap | kind=${kind} sol=${sol} lamports=${this._selectedStakeLamports}`);
        this._highlightActiveStakeChip(kind);
        // Update commit button label so the user sees the selected amount.
        if (this._stakeCommitButton) {
            const lbl = this._stakeCommitButton.node.getChildByName('Label')?.getComponent(Label);
            if (lbl) lbl.string = `Stake ${sol} SOL + Commit`;
        }
    }

    private _highlightActiveStakeChip(active: '001' | '010' | '100'): void {
        // Session 12: emerald accent when active, chrome-bg when idle.
        const colorActive = new Color(48, 198, 155, 255);
        const colorInactive = new Color(28, 34, 48, 255);
        for (const [kind, btn] of this._stakeChipButtons) {
            const spr = btn.node.getComponent(Sprite);
            if (spr) spr.color = kind === active ? colorActive : colorInactive;
        }
    }

    private async _refreshBalanceChip(owner: string): Promise<void> {
        if (!this._balanceChipLabel) return;
        try {
            const bal = await this._rpc.getBalance(owner);
            const sol = bal / 1_000_000_000;
            this._balanceChipLabel.string = `◼ ${sol.toFixed(2)} SOL`;
            console.log(`${TAG} _refreshBalanceChip | DONE owner="${owner.substring(0, 8)}..." lamports=${bal} sol=${sol.toFixed(2)}`);
        } catch (e) {
            console.log(`${TAG} _refreshBalanceChip | ERROR owner="${owner.substring(0, 8)}..." error=${e}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 4 A1 — dual-name event binding helper
    // ═══════════════════════════════════════════════════════════════
    //
    // Tracks which event-name variant actually fired so we can log
    // `dual_name_event_fired=<variant>` the first time each kicks in. If
    // neither fires after the panel's been open a while, the NO_EVENTS sweep
    // in _refreshBalanceChip surfaces that for debugging.
    private _firedEventVariants: Set<string> = new Set();

    private _bindEvent<T>(
        node: Node,
        eventNames: string[],
        handler: (arg: T) => void,
        label: string,
    ): void {
        const self = this;
        for (const name of eventNames) {
            node.on(name, function (arg: T) {
                const key = `${label}:${name}`;
                if (!self._firedEventVariants.has(key)) {
                    self._firedEventVariants.add(key);
                    console.log(`${TAG} _bindEvent | FIRST_FIRE label=${label} event="${name}" total_fired=${self._firedEventVariants.size}`);
                }
                handler.call(self, arg);
            }, this);
        }
        console.log(`${TAG} _bindEvent | REGISTERED label=${label} events=[${eventNames.join(',')}]`);
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 3 — search + slider + remote logos + squad pulse
    // ═══════════════════════════════════════════════════════════════

    /**
     * EditBox text-changed handler (fires on every keystroke). Debounces
     * 500ms so Birdeye isn't hammered per character.
     */
    private _onSearchTextChanged(editBox: EditBox): void {
        const raw = editBox?.string ?? '';
        const query = raw.trim();
        console.log(`${TAG} _onSearchTextChanged | raw="${raw}" query_len=${query.length}`);
        // B3: show/hide the × clear button based on input length.
        if (this._searchClearButton) this._searchClearButton.node.active = raw.length > 0;
        if (this._searchDebounceHandle !== null) {
            clearTimeout(this._searchDebounceHandle as unknown as number);
            this._searchDebounceHandle = null;
        }
        if (query.length === 0) {
            // Empty query — hide popover, restore tab mode.
            if (this._searchPopoverNode) this._searchPopoverNode.active = false;
            if (this._searchMode) {
                this._searchMode = false;
                console.log(`${TAG} _onSearchTextChanged | EMPTY — restoring tab mode tab=${this._currentFeedTab}`);
                this._refreshFeed().catch(() => {});
            }
            return;
        }
        // Skip noise queries (single char, punctuation).
        if (query.length < 2) {
            console.log(`${TAG} _onSearchTextChanged | SKIP_SHORT query="${query}"`);
            return;
        }
        this._searchDebounceHandle = setTimeout(() => {
            this._searchDebounceHandle = null;
            this._runSearch(query).catch((e) => console.log(`${TAG} _runSearch | ERROR query="${query}" error=${e}`));
        }, 500) as unknown as number;
        console.log(`${TAG} _onSearchTextChanged | DEBOUNCE_SCHEDULED query="${query}" delay_ms=500`);
    }

    /**
     * Session 11: search now populates the autocomplete popover overlay (5 rows)
     * on top of the feed — it doesn't replace the feed. Matches solpulse's
     * NewPairsFeed.jsx UX. Tap a suggestion to add to squad + close popover.
     */
    private async _runSearch(query: string): Promise<void> {
        const limit = 5; // popover has 5 slots
        console.log(`${TAG} _runSearch | START query="${query}" path=${pathOf(searchUrl(query, limit))}`);
        this._searchMode = true;
        const client = this._getBirdeye();
        let rows: TokenRow[] = [];
        try {
            rows = await client.search(query, limit);
        } catch (e) {
            console.log(`${TAG} _runSearch | CLIENT_ERROR query="${query}" error=${e}`);
        }
        const usable = rows.filter((r) => r.address && r.symbol);
        this._renderSearchSuggestions(usable, query);
        // Cache so _onSearchSuggestTap can resolve index → TokenRow.
        this._currentFeedRows = usable;
        console.log(`${TAG} _runSearch | DONE query="${query}" suggestions=${usable.length}/${limit} raw=${rows.length}`);
    }

    /** Populate the 5-row suggestion popover. Hides popover if no results. */
    private _renderSearchSuggestions(rows: TokenRow[], query: string): void {
        if (!this._searchPopoverNode) return;
        if (rows.length === 0) {
            this._searchPopoverNode.active = false;
            console.log(`${TAG} _renderSearchSuggestions | HIDE query="${query}" no_results`);
            return;
        }
        this._searchPopoverNode.active = true;
        for (let i = 0; i < this._searchSuggestNodes.length; i++) {
            const sNode = this._searchSuggestNodes[i];
            const row = rows[i];
            if (!row) { sNode.active = false; continue; }
            sNode.active = true;
            const logo = this._searchSuggestLogos[i];
            if (logo) this._loadLogoInto(logo, row.logoUri);
            const sym = this._searchSuggestSymbols[i];
            if (sym) sym.string = row.symbol ? `$${row.symbol}` : '—';
            const mint = this._searchSuggestMints[i];
            if (mint) mint.string = this._fmtMintShort(row.address);
            const prc = this._searchSuggestPrices[i];
            if (prc) prc.string = this._fmtPrice(row.priceUsd);
            const vol = this._searchSuggestVols[i];
            if (vol) vol.string = this._fmtUsdCompact(row.volume24hUsd);
            const chg = this._searchSuggestChanges[i];
            if (chg) {
                chg.string = this._fmtPercent(row.change24hPct);
                chg.color = row.change24hPct > 0 ? new Color(120, 220, 140, 255)
                          : row.change24hPct < 0 ? new Color(240, 110, 110, 255)
                          :                       new Color(200, 200, 200, 255);
            }
        }
        console.log(`${TAG} _renderSearchSuggestions | DONE query="${query}" shown=${Math.min(rows.length, this._searchSuggestNodes.length)}`);
    }

    /** Session 4 B3 / Session 11 — Clear search input + hide suggestion popover. */
    private _onSearchClear(): void {
        console.log(`${TAG} _onSearchClear | was_search_mode=${this._searchMode}`);
        if (this._searchEditBox) this._searchEditBox.string = '';
        if (this._searchClearButton) this._searchClearButton.node.active = false;
        if (this._searchPopoverNode) this._searchPopoverNode.active = false;
        if (this._searchDebounceHandle !== null) {
            clearTimeout(this._searchDebounceHandle as unknown as number);
            this._searchDebounceHandle = null;
        }
        const wasSearching = this._searchMode;
        this._searchMode = false;
        if (wasSearching) {
            this._refreshFeed().catch((e) => console.log(`${TAG} _onSearchClear | refresh_error=${e}`));
        }
    }

    /** cc.Slider's 'slide' event carries the Slider instance; read `.progress`. */
    private _onStakeSliderSlide(slider: Slider): void {
        const raw = slider?.progress ?? 0;
        const clamped = Math.min(1, Math.max(0, raw));
        if (clamped !== raw) {
            console.log(`${TAG} _onStakeSliderSlide | CLAMPED raw=${raw} clamped=${clamped}`);
        }
        const sol = STAKE_MIN_SOL + clamped * (STAKE_MAX_SOL - STAKE_MIN_SOL);
        this._selectedStakeLamports = BigInt(Math.floor(sol * 1_000_000_000));
        this._syncStakeValueLabel(sol);
        console.log(`${TAG} _onStakeSliderSlide | progress=${clamped.toFixed(3)} sol=${sol.toFixed(4)} lamports=${this._selectedStakeLamports}`);
    }

    private _syncStakeValueLabel(sol: number): void {
        if (this._stakeValueLabel) {
            const str = sol < 0.01
                ? `${sol.toFixed(4)} SOL`
                : sol < 0.1
                    ? `${sol.toFixed(3)} SOL`
                    : `${sol.toFixed(2)} SOL`;
            this._stakeValueLabel.string = str;
        }
        if (this._stakeCommitButton) {
            const lbl = this._stakeCommitButton.node.getChildByName('Label')?.getComponent(Label);
            if (lbl) lbl.string = `Stake ${sol.toFixed(3)} SOL + Commit`;
        }
    }

    /**
     * Remote logo fetch → SpriteFrame → apply. Cancel-safe (pending map),
     * cache by URL. Session 4 A2: adds a fetch+blob+Image fallback when
     * `assetManager.loadRemote` refuses the response (Birdeye occasionally
     * returns `image/webp` or a redirect chain that Cocos's native loader
     * doesn't grok).
     */
    private _loadLogoInto(sprite: Sprite, url: string): void {
        if (!sprite) {
            console.log(`${TAG} _loadLogoInto | NO_SPRITE url="${url?.substring(0, 32) ?? ''}..."`);
            return;
        }
        if (!url) {
            sprite.spriteFrame = null;
            sprite.color = new Color(180, 180, 180, 140);
            console.log(`${TAG} _loadLogoInto | EMPTY_URL resetting sprite`);
            return;
        }
        // betting-duel polish: known-failed URL cache. Without this, every
        // 15s poll + every squad render re-hits _loadLogoInto for the same
        // .svg / 403-Forbidden URLs and floods logcat with 80+ lines per
        // poll. Once a URL fails, never retry.
        if (this._logoFailedUrls.has(url)) {
            sprite.spriteFrame = null;
            sprite.color = new Color(60, 72, 96, 255);
            return;
        }
        // Cocos 3.8 `loadRemote({ext:'.png'})` can't decode SVG. Blacklist
        // up-front so we never even try.
        if (url.toLowerCase().endsWith('.svg')) {
            this._logoFailedUrls.add(url);
            sprite.spriteFrame = null;
            sprite.color = new Color(60, 72, 96, 255);
            console.log(`${TAG} _loadLogoInto | SKIP_SVG url_suffix="${url.substring(url.length - 24)}" failed_count=${this._logoFailedUrls.size}`);
            return;
        }
        const cached = this._logoCache.get(url);
        if (cached) {
            sprite.spriteFrame = cached;
            sprite.color = new Color(255, 255, 255, 255);
            return;
        }
        this._logoPending.set(sprite, url);
        console.log(`${TAG} _loadLogoInto | FETCH url_suffix="${url.substring(url.length - 24)}" cache_size=${this._logoCache.size}`);
        assetManager.loadRemote<ImageAsset>(url, { ext: '.png' }, (err, asset) => {
            if (err || !asset) {
                // Primary path failed — try the fetch+Image fallback before giving up.
                const reason = err ? (err as any)?.message ?? String(err) : 'null_asset';
                console.log(`${TAG} _loadLogoInto | PRIMARY_ERR url_suffix="${url.substring(url.length - 24)}" reason="${reason}" — FALLBACK_START`);
                this._loadLogoFallback(sprite, url);
                return;
            }
            this._applyLogoAsset(sprite, url, asset, 'PRIMARY_OK');
        });
    }

    /**
     * A2 fallback: fetch the URL, convert blob → Image → Texture2D → SpriteFrame.
     * Used when `assetManager.loadRemote` rejects the response (webp, redirect).
     */
    private _loadLogoFallback(sprite: Sprite, url: string): void {
        // Android WebView + Cocos JSB sometimes return a non-standard Response
        // shape without .blob(). Bail cleanly in that case rather than noisy-
        // logging every logo fetch — the primary loadRemote path already got
        // its crack; fallback simply can't run.
        if (typeof (globalThis as any).fetch !== 'function') {
            this._logoFailedUrls.add(url);
            return;
        }
        fetch(url).then(async (resp) => {
            if (!resp || typeof (resp as any).blob !== 'function') {
                this._logoFailedUrls.add(url);
                console.log(`${TAG} _loadLogoInto | FALLBACK_UNSUPPORTED url_suffix="${url.substring(url.length - 24)}" failed_count=${this._logoFailedUrls.size}`);
                return;
            }
            if (!resp.ok) {
                this._logoFailedUrls.add(url);
                console.log(`${TAG} _loadLogoInto | FALLBACK_FETCH_ERR url_suffix="${url.substring(url.length - 24)}" status=${resp.status} failed_count=${this._logoFailedUrls.size}`);
                return;
            }
            let blob: Blob;
            try {
                blob = await resp.blob();
            } catch (e) {
                this._logoFailedUrls.add(url);
                console.log(`${TAG} _loadLogoInto | FALLBACK_BLOB_ERR url_suffix="${url.substring(url.length - 24)}" error=${e}`);
                return;
            }
            const objectUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                try {
                    const tex = new Texture2D();
                    // initWithElement is the Cocos 3.x path to load from a DOM/Image source.
                    // Width/height are read from the element; format defaults to RGBA8888.
                    (tex as any).initWithElement(img);
                    const frame = new SpriteFrame();
                    frame.texture = tex;
                    this._logoCache.set(url, frame);
                    if (!sprite.isValid) {
                        console.log(`${TAG} _loadLogoInto | FALLBACK_SPRITE_DESTROYED url_suffix="${url.substring(url.length - 24)}" cached_for_future=true`);
                        URL.revokeObjectURL(objectUrl);
                        return;
                    }
                    const expected = this._logoPending.get(sprite);
                    if (expected !== url) {
                        console.log(`${TAG} _loadLogoInto | FALLBACK_STALE url_suffix="${url.substring(url.length - 24)}"`);
                        URL.revokeObjectURL(objectUrl);
                        return;
                    }
                    sprite.spriteFrame = frame;
                    sprite.color = new Color(255, 255, 255, 255);
                    URL.revokeObjectURL(objectUrl);
                    console.log(`${TAG} _loadLogoInto | FALLBACK_OK url_suffix="${url.substring(url.length - 24)}" cache_size=${this._logoCache.size}`);
                } catch (e) {
                    console.log(`${TAG} _loadLogoInto | FALLBACK_DECODE_ERR url_suffix="${url.substring(url.length - 24)}" error=${e}`);
                    URL.revokeObjectURL(objectUrl);
                }
            };
            img.onerror = (e) => {
                console.log(`${TAG} _loadLogoInto | FALLBACK_IMG_ERR url_suffix="${url.substring(url.length - 24)}" error=${e}`);
                URL.revokeObjectURL(objectUrl);
            };
            img.src = objectUrl;
        }).catch((e) => {
            console.log(`${TAG} _loadLogoInto | FALLBACK_NET_ERR url_suffix="${url.substring(url.length - 24)}" error=${e}`);
        });
    }

    /** Shared path: convert an ImageAsset into a SpriteFrame and apply (respecting cancellation). */
    private _applyLogoAsset(sprite: Sprite, url: string, asset: ImageAsset, phase: string): void {
        let frame: SpriteFrame;
        try {
            const tex = new Texture2D();
            tex.image = asset;
            frame = new SpriteFrame();
            frame.texture = tex;
        } catch (e) {
            console.log(`${TAG} _loadLogoInto | SPRITEFRAME_ERROR url_suffix="${url.substring(url.length - 24)}" error=${e}`);
            return;
        }
        this._logoCache.set(url, frame);
        if (!sprite.isValid) {
            console.log(`${TAG} _loadLogoInto | SPRITE_DESTROYED url_suffix="${url.substring(url.length - 24)}" cached_for_future=true`);
            return;
        }
        const expected = this._logoPending.get(sprite);
        if (expected !== url) {
            console.log(`${TAG} _loadLogoInto | STALE_CALLBACK url_suffix="${url.substring(url.length - 24)}" expected_suffix="${expected?.substring((expected?.length ?? 0) - 24) ?? '(none)'}"`);
            return;
        }
        sprite.spriteFrame = frame;
        sprite.color = new Color(255, 255, 255, 255);
        console.log(`${TAG} _loadLogoInto | APPLIED url_suffix="${url.substring(url.length - 24)}" cache_size=${this._logoCache.size} phase=${phase}`);
    }

    /** Squad delta pulse (A6). Compares new price deltas to last snapshot. */
    private _maybePulseSquadOnDeltas(): void {
        const slots = this._squad.slots;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            const prev = this._lastSquadDeltas[i] ?? 0;
            const next = slot?.change24hPct ?? 0;
            if (next === prev) continue;
            const btn = this._squadSlotButtons[i];
            if (!btn) continue;
            const node = btn.node;
            Tween.stopAllByTarget(node);
            node.setScale(1, 1, 1);
            tween(node)
                .to(0.15, { scale: new Vec3(1.12, 1.12, 1) })
                .to(0.15, { scale: new Vec3(1, 1, 1) })
                .start();
            console.log(`${TAG} _maybePulseSquadOnDeltas | PULSE slot=${i} prev=${prev} next=${next}`);
            this._lastSquadDeltas[i] = next;
        }
    }

    private async _onHeroTileClick(index: number): Promise<void> {
        console.log(`${TAG} onHeroTileClick | index=${index} squad_filled=${this._squad.filled}`);
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.isConnected) return;

        // Session 4 B1: hero source matches what _offerHeroPickIfSupported rendered —
        // squad first, wallet holdings as fallback. The index→symbol mapping MUST
        // mirror that function or the user taps "WIF" and we sign a BONK message.
        let symbol = '';
        let source: 'squad' | 'wallet' = 'wallet';
        if (this._squad.filled > 0) {
            source = 'squad';
            symbol = this._squad.slots[index]?.symbol ?? '';
        } else {
            const h = this._cachedHoldings?.[index];
            symbol = h?.symbol ?? '';
        }
        if (!symbol || symbol === '---') {
            console.log(`${TAG} onHeroTileClick | SKIP index=${index} source=${source} — no symbol at slot`);
            return;
        }
        console.log(`${TAG} onHeroTileClick | resolved index=${index} source=${source} symbol="${symbol}"`);

        for (const b of this._heroTileButtons) b.interactable = false;
        if (this._tokenDuelStatus) this._tokenDuelStatus.string = `Sign hero commit (${symbol})…`;

        // Pulse the tapped tile so the user sees the selection land.
        const tapped = this._heroTileButtons[index]?.node;
        if (tapped) {
            Tween.stopAllByTarget(tapped);
            tapped.setScale(1, 1, 1);
            tween(tapped)
                .to(0.12, { scale: new Vec3(1.15, 1.15, 1) })
                .to(0.12, { scale: new Vec3(1, 1, 1) })
                .start();
        }

        const message = `tdl:hero:${symbol}:ts=${Date.now()}`;
        const sig = await mwa.signMessage(message);

        if (sig && sig.length > 0) {
            this._pickedHeroSymbol = symbol;
            this._pickedHeroSig = sig;
            for (const b of this._heroTileButtons) b.node.active = false;
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = `Hero locked: ${symbol} — now Sign Stake`;
            showToast(`Hero: ${symbol}`);
            return;
        }

        // Error fallbacks — mirror HomeUI._onSignMessage's code-based messaging.
        // C1: `WALLET_AUTH_MISMATCH` on sign_messages is actually Jupiter (and
        // similar wallets) rejecting the method — the Java side misclassifies
        // "unsupported" as "auth mismatch" because both surface as
        // AuthorizationNotValidException (code=-1). Treat the same as
        // UNSUPPORTED on THIS panel (hero is optional, UX should just degrade).
        // The Home panel still treats WALLET_AUTH_MISMATCH as "wrong wallet"
        // for its signMessage button, which is the correct interpretation
        // THERE (KNOWN_ISSUES #17 wallet-switch case).
        if (
            mwa.lastError?.code === 'UNSUPPORTED' ||
            mwa.lastError?.code === 'WALLET_HUNG' ||
            mwa.lastError?.code === 'WALLET_CRASHED' ||
            mwa.lastError?.code === 'WALLET_AUTH_MISMATCH'
        ) {
            // Wallet doesn't support sign_messages (Phantom, Solflare, Jupiter,
            // ...). Hide tiles and continue without hero bonus.
            for (const b of this._heroTileButtons) b.node.active = false;
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Hero pick unsupported on this wallet — continuing without bonus';
        } else {
            if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Hero sign rejected — pick another or skip';
            for (const b of this._heroTileButtons) b.interactable = true;
        }
    }

    private async _onSignMessage(): Promise<void> {
        console.log(`${TAG} onSignMessage | START`);
        this._setHomeEnabled(false);
        const mwa = MWAManager.instance!;
        const sig = await mwa.signMessage('Hello from Cocos MWA SDK!');
        console.log(`${TAG} onSignMessage | RESULT sig_len=${sig?.length ?? 0} lastError=${mwa.lastError?.code ?? '(none)'}`);
        if (this._homeStatus) this._homeStatus.string = sig ? `Signed: ${sig.substring(0, 20)}...` : 'Sign failed';
        if (sig) {
            showToast('Message Signed!');
        } else if (mwa.lastError?.code === 'UNSUPPORTED') {
            // Wallet declared no sign_messages support, or static map flagged it. See KNOWN_ISSUES.md #11.
            showToast("This wallet doesn't support sign_messages — try Backpack or Jupiter", true);
        } else if (mwa.lastError?.code === 'WALLET_HUNG') {
            // Wallet didn't respond — usually means it silently doesn't implement the method. See KNOWN_ISSUES.md #11.
            showToast("Wallet didn't respond — may not support this operation. Try Backpack or Jupiter", true);
        } else if (mwa.lastError?.code === 'WALLET_CRASHED') {
            // Wallet closed WebSocket without reply — Solflare-class crash or unsupported method. See KNOWN_ISSUES.md #6/#11.
            showToast('Wallet crashed — try Backpack, Phantom, or Jupiter', true);
        } else if (mwa.lastError?.code === 'WALLET_AUTH_MISMATCH') {
            // Pass 13: user picked a different wallet in the OS picker than the
            // one that issued the cached authToken. See KNOWN_ISSUES.md #17.
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
        } else {
            showToast('Sign message failed');
        }
        this._setHomeEnabled(true);
    }

    private async _onSignTransaction(): Promise<void> {
        console.log(`${TAG} onSignTransaction | START`);
        this._setHomeEnabled(false);
        if (this._homeStatus) this._homeStatus.string = 'Fetching blockhash...';
        const bh = await this._rpc.getLatestBlockhash();
        if (!bh) {
            console.log(`${TAG} onSignTransaction | FAIL blockhash=null`);
            if (this._homeStatus) this._homeStatus.string = 'Failed to get blockhash';
            this._setHomeEnabled(true);
            return;
        }
        const tx = buildMemoTransaction(MWAManager.instance!.connectedPubkey, 'Hello from Cocos Creator MWA SDK!', bh.blockhash);
        console.log(`${TAG} onSignTransaction | built_tx_bytes=${tx.length}`);
        if (this._homeStatus) this._homeStatus.string = 'Approve in wallet...';
        const mwa = MWAManager.instance!;
        const signed = await mwa.signTransaction(tx);
        console.log(`${TAG} onSignTransaction | RESULT signed_bytes=${signed.length} lastError=${mwa.lastError?.code ?? '(none)'}`);
        if (this._homeStatus) this._homeStatus.string = signed.length > 0
            ? 'Transaction signed successfully!'
            : 'Sign transaction failed';
        if (signed.length > 0) {
            showToast('Transaction Signed!');
        } else if (mwa.lastError?.code === 'WALLET_AUTH_MISMATCH') {
            // Pass 13 — KNOWN_ISSUES.md #17.
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
        } else {
            showToast('Sign transaction failed');
        }
        this._setHomeEnabled(true);
    }

    private async _onSignAndSend(): Promise<void> {
        console.log(`${TAG} onSignAndSend | START`);
        this._setHomeEnabled(false);
        if (this._homeStatus) this._homeStatus.string = 'Fetching blockhash...';
        const bh = await this._rpc.getLatestBlockhash();
        if (!bh) {
            console.log(`${TAG} onSignAndSend | FAIL blockhash=null`);
            if (this._homeStatus) this._homeStatus.string = 'Failed to get blockhash';
            this._setHomeEnabled(true);
            return;
        }
        const mwa = MWAManager.instance!;
        const tx = buildMemoTransaction(mwa.connectedPubkey, 'Hello from Cocos Creator MWA SDK!', bh.blockhash);
        console.log(`${TAG} onSignAndSend | built_tx_bytes=${tx.length}`);
        if (this._homeStatus) this._homeStatus.string = 'Signing & sending...';
        const sig = await mwa.signAndSendTransaction(tx);
        console.log(`${TAG} onSignAndSend | RESULT sig=${sig || '(empty)'} lastError=${mwa.lastError?.code ?? '(none)'}`);
        if (this._homeStatus) this._homeStatus.string = sig ? `Sent! ${sig.substring(0, 24)}...` : 'Send failed';
        if (sig) {
            showToast('Transaction Sent!', true);
        } else if (mwa.lastError?.code === 'INSUFFICIENT_FUNDS_FOR_RENT') {
            // Fee-payer is below rent-exempt minimum + fee + priority-fee buffer.
            // Seed Vault's wrapper injects priority-fee instructions which raises
            // the required balance. See KNOWN_ISSUES.md #13.
            showToast('Fee-payer account underfunded — send ≥0.001 SOL and retry', true);
        } else if (mwa.lastError?.code === 'WALLET_HUNG') {
            showToast("Wallet didn't respond — try reconnecting or a different wallet", true);
        } else if (mwa.lastError?.code === 'WALLET_CRASHED') {
            // Wallet crashed during signing (Solflare-class bug). See KNOWN_ISSUES.md #6.
            showToast('Wallet crashed — try Backpack, Phantom, or Jupiter', true);
        } else if (mwa.lastError?.code === 'RPC_BROADCAST_FAILED') {
            showToast('Sign succeeded but RPC broadcast was rejected', true);
        } else if (mwa.lastError?.code === 'WALLET_AUTH_MISMATCH') {
            // Pass 13 — KNOWN_ISSUES.md #17.
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
        } else {
            showToast('Sign & send failed');
        }
        this._setHomeEnabled(true);
    }

    private async _onCapabilities(): Promise<void> {
        console.log(`${TAG} onCapabilities | START`);
        this._setHomeEnabled(false);
        const caps = await MWAManager.instance!.getCapabilities();
        console.log(`${TAG} onCapabilities | RESULT success=${caps != null}`);
        if (this._homeStatus) this._homeStatus.string = caps
            ? `max_txs: ${caps.maxTransactionsPerRequest}\nmax_msgs: ${caps.maxMessagesPerRequest}`
            : 'Failed';
        if (caps) showToast(`Capabilities: max_txs=${caps.maxTransactionsPerRequest}`);
        else showToast('Get capabilities failed');
        this._setHomeEnabled(true);
    }

    private async _onDisconnect(): Promise<void> {
        console.log(`${TAG} onDisconnect | START`);
        // DB Stage 9 — detach cross-device sync so any further local edits
        // don't leak to a wallet we just walked away from.
        this._bindUserCollectionsSync(null);
        await MWAManager.instance!.deauthorize();
        console.log(`${TAG} onDisconnect | DONE`);
        showToast('Disconnected');
    }

    private async _onDelete(): Promise<void> {
        const mwa = MWAManager.instance!;
        console.log(`${TAG} onDelete | START pubkey=${mwa.connectedPubkey}`);
        this._setHomeEnabled(false);
        await mwa.deleteAccount();
        console.log(`${TAG} onDelete | DONE isConnected=${mwa.isConnected} lastError=${mwa.lastError?.code ?? '(none)'}`);
        if (!mwa.isConnected) {
            showToast('Account deleted');
        } else if (mwa.lastError?.code === 'WALLET_HUNG') {
            showToast("Wallet didn't respond — try reconnecting or a different wallet", true);
            this._setHomeEnabled(true);
        } else if (mwa.lastError?.code === 'WALLET_CRASHED') {
            // Wallet crashed during sign confirmation — see KNOWN_ISSUES.md #6/#11.
            showToast('Wallet crashed — try Backpack, Phantom, or Jupiter', true);
            this._setHomeEnabled(true);
        } else if (mwa.lastError?.code === 'RPC_BLOCKHASH_FAILED') {
            showToast('Delete failed — could not reach Solana RPC', true);
            this._setHomeEnabled(true);
        } else if (mwa.lastError?.code === 'WALLET_AUTH_MISMATCH') {
            // Pass 13 — user picked a different wallet in the OS picker than
            // the one that issued the cached authToken. KNOWN_ISSUES.md #17.
            showToast('Wrong wallet — use the wallet you connected with, or Disconnect and Connect again', true);
            this._setHomeEnabled(true);
        } else {
            this._setHomeEnabled(true);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STATUS + HELPERS
    // ═══════════════════════════════════════════════════════════════════

    private _onStatus(message: string): void {
        // Landing's connection-state UI is driven by explicit _setConnectionPill
        // from _onConnect/_onReconnect; granular MWA status messages are too
        // noisy for the footer pill. Home keeps the verbose readout.
        if (this._homePanel.active && this._homeStatus) this._homeStatus.string = message;
        // Block 8 — show signing overlay on any MWA sign-path status. Auto-hides
        // when we see a done-ish signal.
        const lower = message.toLowerCase();
        if (lower.startsWith('signing') || lower.startsWith('signing and sending')) {
            this._showSigningOverlay(message);
        } else if (lower.startsWith('sent!') || lower.startsWith('transaction signed') || lower.includes('sign failed') || lower.includes('disconnect')) {
            this._hideSigningOverlay();
        }
    }

    private _setLandingEnabled(enabled: boolean): void {
        if (this._connectButton) this._connectButton.interactable = enabled;
        if (this._reconnectButton) this._reconnectButton.interactable = enabled;
        console.log(`${TAG} _setLandingEnabled | DONE enabled=${enabled} connect_wired=${!!this._connectButton} reconnect_wired=${!!this._reconnectButton}`);
    }

    private _setHomeEnabled(enabled: boolean): void {
        for (const btn of this._allHomeButtons) btn.interactable = enabled;
        console.log(`${TAG} _setHomeEnabled | DONE enabled=${enabled} button_count=${this._allHomeButtons.length}`);
    }

    /**
     * Toggle Home + Settings UI based on guest vs real-wallet mode.
     *
     * Guest mode (real wallet NOT connected, _guestId set):
     *   • Hide Start Match, Find Match, Disconnect, Delete, NotificationBell, RakeChip
     *   • Show Sign Out (in same slot as Disconnect)
     *
     * Real-wallet mode: opposite (Sign Out hidden, all wallet-only nodes shown).
     *
     * Idempotent — safe to call from _showHome on every entry. Settings panel
     * sections (username editbox, wallet card, delete-account) are toggled
     * separately in _onOpenSettingsClick since the panel might not exist yet.
     */
    private _applyGuestModeUiHiding(): void {
        const guest = this._isGuest();
        if (!this._homePanel) return;
        const setActive = (name: string, active: boolean) => {
            const n = this._homePanel.getChildByName(name);
            if (n) n.active = active;
        };
        // 2026-04-26 lobby restructure: Disconnect / Delete / SignOutGuest /
        // HomeRakeChip removed from Home — those concerns live in
        // SettingsPanel now (which has its own guest-mode toggling). Subtitles
        // are children of buttons → implicitly hidden when button.active=false.
        setActive('StartMatchButton',           !guest);
        setActive('FindMatchButton',            !guest);
        if (guest) setActive('FindMatchButtonCountBadge', false);
        setActive('NotificationBellButton',     !guest);
        setActive('NotificationBellBadge',      !guest);
        console.log(`${TAG} _applyGuestModeUiHiding | guest=${guest}`);
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 13 A1 — MinLiq dropdown
    // ═══════════════════════════════════════════════════════════════

    private _onMinLiqDropdownClick(): void {
        if (!this._minLiqPopoverNode) return;
        const willOpen = !this._minLiqPopoverNode.active;
        this._minLiqPopoverNode.active = willOpen;
        if (willOpen) {
            if (this._columnsPopoverNode) { this._columnsPopoverNode.active = false; this._columnsPopoverOpen = false; }
            if (this._feedTabDropdownPopover) this._feedTabDropdownPopover.active = false;
            if (this._liqSortPopoverNode) this._liqSortPopoverNode.active = false;
        }
        this._syncBackdrop();
        console.log(`${TAG} _onMinLiqDropdownClick | popover_open=${willOpen} min_liq=${this._minLiq}`);
    }

    private _onMinLiqOptionClick(key: string, val: number): void {
        this._minLiq = val;
        if (this._minLiqPopoverNode) this._minLiqPopoverNode.active = false;
        this._syncBackdrop();
        if (this._minLiqDropdownLabel) {
            this._minLiqDropdownLabel.string = key === 'all' ? 'All  ▾' : `$${key.toUpperCase()}+  ▾`;
        }
        console.log(`${TAG} _onMinLiqOptionClick | key=${key} min_liq=${val}`);
        const filtered = this._applySortAndFilter(this._lastFetchedRows);
        this._currentFeedRows = filtered;
        if (filtered.length === 0) {
            this._renderEmptyStateRow(`No results (min liq $${this._minLiq})`, 'EMPTY_FILTER');
        } else {
            this._renderFeedRows(filtered);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 13 A3 — Columns popover
    // ═══════════════════════════════════════════════════════════════

    private _onColumnsButtonClick(): void {
        if (!this._columnsPopoverNode) return;
        this._columnsPopoverOpen = !this._columnsPopoverNode.active;
        this._columnsPopoverNode.active = this._columnsPopoverOpen;
        if (this._columnsPopoverOpen) {
            if (this._minLiqPopoverNode) this._minLiqPopoverNode.active = false;
            if (this._feedTabDropdownPopover) this._feedTabDropdownPopover.active = false;
        }
        this._syncBackdrop();
        this._refreshColumnToggleLabels();
        console.log(`${TAG} _onColumnsButtonClick | open=${this._columnsPopoverOpen} visible_cols=${Array.from(this._visibleCols).join(',')}`);
    }

    private _onColumnToggleClick(key: string): void {
        if (this._visibleCols.has(key)) {
            this._visibleCols.delete(key);
            console.log(`${TAG} _onColumnToggleClick | HIDE key=${key} visible=${this._visibleCols.size}`);
        } else {
            if (this._visibleCols.size >= this._colMax) {
                console.log(`${TAG} _onColumnToggleClick | SKIP_MAX key=${key} max=${this._colMax}`);
                showToast(`Max ${this._colMax} columns`);
                return;
            }
            this._visibleCols.add(key);
            console.log(`${TAG} _onColumnToggleClick | SHOW key=${key} visible=${this._visibleCols.size}`);
        }
        this._refreshColumnToggleLabels();
        this._renderFeedRows(this._currentFeedRows);
    }

    private _refreshColumnToggleLabels(): void {
        const hidden = new Set(this._hiddenByFeed[this._currentFeedTab] || []);
        for (const [key, btn] of this._colToggleButtons) {
            const disabledByFeed = hidden.has(key);
            const active = this._visibleCols.has(key) && !disabledByFeed;
            const lbl = this._colToggleLabels.get(key);
            const niceLabel = { score: 'Score', liq: 'Liq', vol: 'Vol', change: '24h', age: 'Age', mc: 'MC', fdv: 'FDV', price: 'Price', holders: 'Holders', source: 'DEX' }[key] ?? key;
            if (lbl) {
                lbl.string = `${active ? '✓' : '○'}  ${niceLabel}`;
                lbl.color = disabledByFeed
                    ? new Color(70, 80, 100, 255)
                    : active
                        ? new Color(48, 198, 155, 255)
                        : new Color(180, 190, 210, 255);
            }
            const spr = btn.node.getComponent(Sprite);
            if (spr) spr.color = disabledByFeed ? new Color(22, 26, 36, 255) : new Color(28, 34, 48, 255);
            btn.interactable = !disabledByFeed;
        }
    }

    private _applyFeedColumnDefaults(): void {
        // Per-feed default visibility (matches solpulse's hiddenByFeed + sane defaults).
        const defaultsByFeed: Record<string, string[]> = {
            new: ['score', 'liq', 'vol', 'change', 'age'],
            trending: ['score', 'liq', 'vol', 'change', 'price', 'mc'],
            gainers: ['score', 'liq', 'vol', 'change', 'price'],
            smart_money: ['score', 'liq', 'vol', 'change', 'price'],
            watchlist: ['score', 'liq', 'vol', 'change', 'price'],
            top10: [],
        };
        const cols = defaultsByFeed[this._currentFeedTab] ?? defaultsByFeed.new;
        this._visibleCols = new Set(cols);
        this._refreshColumnToggleLabels();
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 13 Phase B — Token detail / chart view
    // ═══════════════════════════════════════════════════════════════

    private _showTokenDetail(row: TokenRow): void {
        if (!this._tokenDetailPanel) {
            console.log(`${TAG} _showTokenDetail | NO_PANEL falling back to squad add`);
            const idx = this._squad.add(row);
            if (idx >= 0) showToast(`+ ${row.symbol} → slot ${idx + 1}`);
            return;
        }
        this._detailCurrentRow = row;
        console.log(`${TAG} _showTokenDetail | START symbol="${row.symbol}" mint=${row.address}`);

        // Panel flip.
        if (this._tokenDuelPanel) this._tokenDuelPanel.active = false;
        if (this._landingPanel) this._landingPanel.active = false;
        if (this._homePanel) this._homePanel.active = false;
        this._tokenDetailPanel.active = true;

        // Hydrate header + stats + pick/unpick state.
        if (this._detailSymbolLabel) this._detailSymbolLabel.string = row.symbol ? `$${row.symbol}` : '$—';
        if (this._detailNameLabel) this._detailNameLabel.string = row.name ?? '';
        // UX Phase 2b: clipboard emoji stripped; the chip button itself cues copy.
        if (this._detailMintChipLabel) this._detailMintChipLabel.string = this._fmtMintShort(row.address);
        this._refreshDetailPickUnpickButton();
        this._refreshDetailStats(row);
        this._refreshSafetyChips();
        this._highlightActiveTimeframe(this._detailActiveTimeframe);
        this._highlightActiveDenom();

        // Kick off chart load.
        this._loadChart(row.address, this._detailActiveTimeframe);
        console.log(`${TAG} _showTokenDetail | DONE panel_visible=true`);
    }

    private _hideTokenDetail(): void {
        if (!this._tokenDetailPanel) return;
        this._tokenDetailPanel.active = false;
        if (this._tokenDuelPanel) this._tokenDuelPanel.active = true;
        this._detailCurrentRow = null;
        if (this._detailChartGraphics) this._detailChartGraphics.clear();
        console.log(`${TAG} _hideTokenDetail | DONE`);
    }

    private _onDetailBackClick(): void {
        console.log(`${TAG} _onDetailBackClick | returning to TokenDuelPanel`);
        this._hideTokenDetail();
    }

    private _onDetailMintChipClick(): void {
        const mint = this._detailCurrentRow?.address ?? '';
        console.log(`${TAG} _onDetailMintChipClick | mint=${mint} (clipboard copy TBD — JSB bridge)`);
        // Copy-to-clipboard isn't wired via a JSB bridge yet; toast the mint so
        // the user can screenshot it until we add a native-side copy function.
        showToast(`Mint: ${mint}`);
    }

    private _onDetailPickUnpickClick(): void {
        const row = this._detailCurrentRow;
        if (!row) return;
        const idx = this._squad.slots.findIndex((s) => !!s && s.address === row.address);
        if (idx >= 0) {
            this._squad.clearAt(idx);
            console.log(`${TAG} _onDetailPickUnpickClick | UNPICK symbol="${row.symbol}" slot_was=${idx}`);
            showToast(`Unpicked ${row.symbol}`);
        } else {
            const added = this._squad.add(row);
            console.log(`${TAG} _onDetailPickUnpickClick | PICK symbol="${row.symbol}" added_at=${added}`);
            if (added >= 0) showToast(`Picked ${row.symbol}`);
            else showToast('Squad full — tap a slot to clear first');
        }
        this._refreshDetailPickUnpickButton();
    }

    private _refreshDetailPickUnpickButton(): void {
        if (!this._detailPickUnpickButton || !this._detailPickUnpickLabel || !this._detailCurrentRow) return;
        const isPicked = this._squad.slots.findIndex((s) => !!s && s.address === this._detailCurrentRow!.address) >= 0;
        this._detailPickUnpickLabel.string = isPicked ? '− Unpick' : '+ Pick';
        const spr = this._detailPickUnpickButton.node.getComponent(Sprite);
        if (spr) spr.color = isPicked ? new Color(70, 52, 14, 255) : new Color(48, 198, 155, 255);
        this._detailPickUnpickLabel.color = isPicked ? new Color(218, 165, 32, 255) : new Color(12, 18, 26, 255);
    }

    private _onDetailTimeframeClick(tf: OhlcvType): void {
        if (this._detailActiveTimeframe === tf) return;
        this._detailActiveTimeframe = tf;
        this._highlightActiveTimeframe(tf);
        console.log(`${TAG} _onDetailTimeframeClick | tf=${tf}`);
        if (this._detailChartDebounceHandle !== null) {
            clearTimeout(this._detailChartDebounceHandle as unknown as number);
            this._detailChartDebounceHandle = null;
        }
        // 500ms debounce — prevents rapid Birdeye spam on quick toggles.
        this._detailChartDebounceHandle = setTimeout(() => {
            this._detailChartDebounceHandle = null;
            const mint = this._detailCurrentRow?.address ?? '';
            if (mint) this._loadChart(mint, tf);
        }, 500) as unknown as number;
    }

    private _highlightActiveTimeframe(active: OhlcvType): void {
        for (const [tf, btn] of this._detailTimeframeButtons) {
            const spr = btn.node.getComponent(Sprite);
            if (spr) spr.color = tf === active ? new Color(48, 198, 155, 255) : new Color(28, 34, 48, 255);
            const lbl = btn.node.getChildByName('Label')?.getComponent(Label);
            if (lbl) lbl.color = tf === active ? new Color(12, 18, 26, 255) : new Color(200, 210, 230, 255);
        }
    }

    private _onDetailDenomClick(key: 'price' | 'mcap' | 'usd' | 'sol'): void {
        if (key === 'price' || key === 'mcap') this._detailPriceMode = key;
        else this._detailDenom = key === 'usd' ? 'USD' : 'SOL';
        this._highlightActiveDenom();
        console.log(`${TAG} _onDetailDenomClick | key=${key} mode=${this._detailPriceMode} denom=${this._detailDenom}`);
        // Redraw without re-fetching (same candle data, different projection).
        this._redrawChart();
    }

    private _highlightActiveDenom(): void {
        const active = new Set([this._detailPriceMode, this._detailDenom.toLowerCase()]);
        for (const [key, btn] of this._detailDenomButtons) {
            const on = active.has(key);
            const spr = btn.node.getComponent(Sprite);
            if (spr) spr.color = on ? new Color(48, 198, 155, 255) : new Color(28, 34, 48, 255);
            const lbl = btn.node.getChildByName('Label')?.getComponent(Label);
            if (lbl) lbl.color = on ? new Color(12, 18, 26, 255) : new Color(200, 210, 230, 255);
        }
    }

    private _detailLastCandles: Candle[] = [];

    private async _loadChart(mint: string, tf: OhlcvType): Promise<void> {
        if (!this._detailChartGraphics) return;
        this._detailChartLoading = true;
        if (this._detailChartStatusLabel) {
            this._detailChartStatusLabel.string = `Loading ${tf} candles…`;
            this._detailChartStatusLabel.node.active = true;
        }
        console.log(`${TAG} _loadChart | START mint=${mint.substring(0, 6)}…${mint.substring(mint.length - 4)} tf=${tf}`);
        const now = Math.floor(Date.now() / 1000);
        const lookback = lookbackFor(tf);
        const fromSec = now - lookback;
        let candles: Candle[] = [];
        try {
            candles = await this._getBirdeye().getOhlcv(mint, tf, fromSec, now);
        } catch (e) {
            console.log(`${TAG} _loadChart | ERROR mint=${mint} error=${e}`);
        }
        // Guard: user may have navigated away while fetching.
        if (this._detailCurrentRow?.address !== mint) {
            console.log(`${TAG} _loadChart | STALE mint=${mint} current=${this._detailCurrentRow?.address ?? 'null'}`);
            return;
        }
        this._detailLastCandles = candles;
        this._detailChartLoading = false;
        if (this._detailChartStatusLabel) {
            this._detailChartStatusLabel.node.active = candles.length === 0;
            if (candles.length === 0) this._detailChartStatusLabel.string = `No ${tf} data`;
        }
        this._redrawChart();
        console.log(`${TAG} _loadChart | DONE mint=${mint} candles=${candles.length}`);
    }

    private _redrawChart(): void {
        if (!this._detailChartGraphics) return;
        renderCandles(this._detailChartGraphics, this._detailLastCandles, {
            width: 680,
            height: 640,
            paddingTop: 12,
            paddingBottom: 90,
            paddingX: 8,
        }, {
            timeframe: this._detailActiveTimeframe,
            denom: this._detailDenom,
            mode: this._detailPriceMode,
            // We don't have a live SOL/USD price wired yet — leave undefined so
            // renderer falls back to raw USD values when denom=SOL is chosen.
        });
    }

    private _refreshDetailStats(row: TokenRow): void {
        const map = [
            { key: 'price',   value: this._fmtPrice(row.priceUsd) },
            { key: 'liq',     value: this._fmtUsdCompact(row.liquidity) },
            { key: 'mcap',    value: this._fmtUsdCompact(row.marketCap) },
            { key: 'vol24h',  value: this._fmtUsdCompact(row.volume24hUsd) },
            { key: 'change',  value: this._fmtPercent(row.change24hPct) },
            { key: 'holders', value: row.holders > 0 ? this._fmtCompactInt(row.holders) : '—' },
        ];
        for (const d of map) {
            const lbl = this._detailStatValueLabels.get(d.key);
            if (!lbl) continue;
            lbl.string = d.value;
            if (d.key === 'change') {
                const c = row.change24hPct;
                lbl.color = c > 0 ? new Color(48, 198, 155, 255) : c < 0 ? new Color(236, 88, 122, 255) : new Color(200, 210, 230, 255);
            } else if (d.key === 'price') {
                lbl.color = new Color(218, 165, 32, 255);
            } else {
                lbl.color = new Color(255, 255, 255, 255);
            }
        }
        console.log(`${TAG} _refreshDetailStats | DONE symbol="${row.symbol}" liq=${row.liquidity} mcap=${row.marketCap} vol=${row.volume24hUsd} change=${row.change24hPct} holders=${row.holders}`);
    }

    private _refreshSafetyChips(): void {
        // v1 placeholder — no safety backend yet. Session 13 plan: deferred.
        for (const [key, lbl] of this._detailSafetyChipLabels) {
            lbl.string = `◎ ${key.charAt(0).toUpperCase() + key.slice(1)}`;
            lbl.color = new Color(140, 150, 170, 255);
        }
    }

    /** 1.2K / 5.8M / 123 — compact integer (holders count). */
    private _fmtCompactInt(n: number): string {
        if (!Number.isFinite(n) || n <= 0) return '—';
        if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
        if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
        return String(Math.round(n));
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION D PART 3 — Waiting + PostMatch panel handlers
    // ═══════════════════════════════════════════════════════════════

    private _showWaitingPanel(opts: { mode: string; wagerSol: number; track: 'paper' | 'real'; status?: string; requiredPlayers?: number }): void {
        if (!this._waitingPanel) return;
        this._tokenDuelPanel.active = false;
        this._waitingPanel.active = true;
        const n = opts.requiredPlayers ?? 2;
        if (this._waitingTitleLabel) this._waitingTitleLabel.string = opts.track === 'real' ? 'Finding opponents…' : 'Matching vs Bots…';
        if (this._waitingModeLabel) this._waitingModeLabel.string = `${opts.mode} · ${opts.wagerSol.toFixed(3)} SOL · ${opts.track === 'real' ? 'Real' : 'Paper'}`;
        if (this._waitingProgressLabel) this._waitingProgressLabel.string = opts.track === 'real' ? `0/${n} players · 0:00 / 2:00` : 'Sampling opponents…';
        if (this._waitingStatusLabel) this._waitingStatusLabel.string = opts.status ?? '';
        if (this._waitingPlayBotButton) this._waitingPlayBotButton.node.active = opts.track === 'real';
        // Part 13: rake preview line — "Rake: X.X% · pot: Y.Y SOL".
        if (this._waitingRakeLabel) {
            const bps = rakeBpsForLevel(this._cachedLevel);
            const pct = (bps / 100).toFixed(1);
            const pot = opts.wagerSol * n;
            this._waitingRakeLabel.string = `Rake: ${pct}% (lvl ${this._cachedLevel}) · pot: ${pot.toFixed(3)} SOL`;
        }
        // Part 11 D3: hide banner immediately; _hydrateStreakBanner reveals it
        // async if the player's on-chain streak ≥ 3.
        const banner = this._waitingPanel.getChildByName('WaitingStreakBanner');
        if (banner) banner.active = false;
        this._hydrateStreakBanner();
        console.log(`${TAG} _showWaitingPanel | track=${opts.track} mode=${opts.mode} wager_sol=${opts.wagerSol} required=${n}`);
    }

    /**
     * Part 11 D3: show a streak banner on WaitingPanel when the player has
     * a 3+ day streak on-chain. Display-only (no payout multiplier yet).
     */
    private async _hydrateStreakBanner(): Promise<void> {
        if (!this._waitingPanel) return;
        const banner = this._waitingPanel.getChildByName('WaitingStreakBanner');
        if (!banner) return;
        const label = banner.getComponent(Label);
        if (!label) return;
        const mwa = MWAManager.instance;
        const pubkey = mwa?.connectedPubkey;
        if (!pubkey) { banner.active = false; return; }
        try {
            const stats = await getUserStats(this._tdRpc, pubkey);
            if (stats && stats.currentStreak >= 3) {
                // UX overhaul Phase 1: emoji moved to IconBadge sibling on
                // DailyStreakStrip (see _attachHomeIconBadges).
                label.string = `Day ${stats.currentStreak} streak — keep the fire going`;
                banner.active = true;
                console.log(`${TAG} _hydrateStreakBanner | SHOW streak=${stats.currentStreak}`);
            } else {
                banner.active = false;
            }
            // Stage 4K — refresh the home flame whenever we re-fetch streak here.
            this._updateStreakFlame(stats?.currentStreak ?? 0);
        } catch (e) {
            console.log(`${TAG} _hydrateStreakBanner | ERROR ${e}`);
            banner.active = false;
        }
    }

    private _hideWaitingPanel(): void {
        if (this._waitingPanel) this._waitingPanel.active = false;
        this._tokenDuelPanel.active = true;
        this._stopForceSettleWatch();
        // ReceiptSession cleanup removed — no session to close on betting-duel.
        console.log(`${TAG} _hideWaitingPanel | DONE`);
    }

    /**
     * Part 9: watch match-active time and reveal the Force-Settle button once
     * the FORCE_SETTLE_TIMEOUT_SECS window has elapsed without all players
     * settling. Fires every 5 seconds; self-hides once button is visible.
     */
    private _startForceSettleWatch(startedAtMs: number): void {
        this._stopForceSettleWatch();
        this._realMatchStartedAt = startedAtMs;
        const threshold = 300_000; // 5 minutes
        const fn = () => {
            if (!this._activeRealMatchPda) { this._stopForceSettleWatch(); return; }
            const elapsed = Date.now() - this._realMatchStartedAt;
            const state = this._latestRealMatchState;
            const readyPlayers = state ? state.settledCount : 0;
            const needed = state ? state.requiredPlayers : 0;
            const active = !!state && state.status === 1 && readyPlayers < needed;
            const should = active && elapsed >= threshold;
            if (this._waitingForceSettleButton) this._waitingForceSettleButton.node.active = should;
            if (should) {
                console.log(`${TAG} _startForceSettleWatch | SHOW match=${this._activeRealMatchPda} elapsed=${elapsed}ms settled=${readyPlayers}/${needed}`);
            }
        };
        fn();
        this._forceSettleWatchTimer = setInterval(fn, 5000) as unknown as number;
        console.log(`${TAG} _startForceSettleWatch | STARTED started_at=${startedAtMs}`);
    }

    private _stopForceSettleWatch(): void {
        if (this._forceSettleWatchTimer !== null) {
            clearInterval(this._forceSettleWatchTimer as unknown as number);
            this._forceSettleWatchTimer = null;
        }
        if (this._waitingForceSettleButton) this._waitingForceSettleButton.node.active = false;
        this._realMatchStartedAt = 0;
    }

    /**
     * Handle "⚡ Force Settle" tap — builds a force_settle tx and signs via MWA.
     * Any signer can call this on-chain once the 5-min timeout has elapsed;
     * AFK players forfeit to 0 and the rest get paid via compute_mode_payout.
     */
    private _onWaitingForceSettle(): void {
        if (!this._activeRealMatchPda) return;
        const mwa = MWAManager.instance;
        const pubkey = mwa?.connectedPubkey;
        if (!mwa || !pubkey) return;
        const matchPda = this._activeRealMatchPda;
        const state = this._latestRealMatchState;
        if (!state) {
            if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'No match state — retry in a sec';
            return;
        }
        console.log(`${TAG} _onWaitingForceSettle | START match=${matchPda} started_at=${this._realMatchStartedAt}`);
        this._realPollAbortFlag = true;
        (async () => {
            if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Forcing settle — sign tx';
            const bh = await this._rpc.getLatestBlockhash('confirmed');
            if (!bh) { if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Blockhash fetch failed'; return; }
            const txBytes = buildForceSettleTxFor({
                matchState: state,
                callerPubkey: pubkey,
                blockhash: bh.blockhash,
            });
            const sig = await mwa.signAndSendTransaction(txBytes);
            if (!sig) {
                if (this._waitingStatusLabel) this._waitingStatusLabel.string = `Force settle failed: ${mwa.lastError?.code ?? 'user cancelled'}`;
                return;
            }
            console.log(`${TAG} _onWaitingForceSettle | SIGNED sig=${sig}`);
            if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Force settle submitted — waiting for chain';
            const result = await waitForSettlement(this._tdRpc, matchPda);
            if (result.outcome === 'settled') {
                this._activeRealMatchPda = null;
                this._hideWaitingPanel();
                showToast('Force-settled — AFK reclaimed');
            } else {
                if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Force settle timed out — check explorer';
            }
        })().catch((e) => {
            console.log(`${TAG} _onWaitingForceSettle | ERROR error=${e}`);
            if (this._waitingStatusLabel) this._waitingStatusLabel.string = `Force settle error: ${e?.message ?? e}`;
        });
    }

    private _onWaitingCancel(): void {
        console.log(`${TAG} _onWaitingCancel | active_real=${this._activeRealMatchPda ?? 'none'}`);
        // Always route home immediately so this isn't a dead-end. The lobby
        // remains on-chain (visible in Open Lobbies as "Your Lobby") if the
        // refund tx can't run synchronously; the lone-creator self-cancel
        // path runs in the background and toasts the outcome.
        const matchPda = this._activeRealMatchPda;
        this._realPollAbortFlag = true;
        this._stopForceSettleWatch();
        if (this._waitingPanel) this._waitingPanel.active = false;
        this._activeRealMatchPda = null;
        this._showHome();
        if (matchPda) {
            void this._submitCancelMatch(matchPda)
                .then((ok) => showToast(ok ? 'Refund signed — match cancelled' : 'Lobby still open — cancel from Open Lobbies later'))
                .catch((e) => console.log(`${TAG} _onWaitingCancel | bg_cancel_err ${e?.message ?? e}`));
        }
    }

    private _onWaitingPlayBot(): void {
        console.log(`${TAG} _onWaitingPlayBot | switching to bot fallback active_real=${this._activeRealMatchPda ?? 'none'}`);
        // If a real match is live + timed-out, try best-effort refund before falling back.
        if (this._activeRealMatchPda) {
            const matchPda = this._activeRealMatchPda;
            this._realPollAbortFlag = true;
            this._submitCancelMatch(matchPda).catch(() => { /* best-effort */ });
            this._activeRealMatchPda = null;
        }
        (this as any)._pendingPaperBotMatch = true;
        this._hideWaitingPanel();
        this._setStakeClusterVisible(true);
        this._refreshSquadActionButtons();
        showToast('Bot match — tap Commit to start');
    }

    private _showPostMatchPanel(outcome: {
        won: boolean;
        tie?: boolean;          // betting-duel: equal portfolio deltas → think mascot
        playerHeight: number;
        opponentHeight: number;
        xpGained: number;
        newLevel: number;
        payoutLamports: number;
        track: 'paper' | 'real';
        previousLevel?: number; // Session D Part 5: for level-up flash
        totalXp?: number;       // Session D Part 5: for progress-bar text
        placement?: number;     // Session D Part 6: 0-indexed placement (0=1st)
        totalPlayers?: number;  // Session D Part 6: mode N
        modeLabel?: string;     // Session D Part 6: "4p Pot" etc.
    }): void {
        if (!this._postMatchPanel) return;
        this._tokenDuelPanel.active = false;
        this._postMatchPanel.active = true;
        // UX Phase 2b: route celebrate/lose/think to the PostMatchMascot. The
        // results screen must NEVER show 'idle' — pick exactly one of the
        // outcome states. `force=true` replays the animation when the previous
        // match settled to the same outcome (without it, setState early-returns
        // and a second loss freezes on the last lose frame).
        const mascotState: MascotState =
            outcome.tie ? 'think'
          : outcome.won ? 'celebrate'
          :               'lose';
        console.assert(mascotState !== 'idle', 'PostMatch mascot must never be idle');
        this._postMatchMascot?.setState(mascotState, true);
        const previousLevel = outcome.previousLevel ?? outcome.newLevel; // if not supplied, assume no level change
        const leveledUp = outcome.newLevel > previousLevel;

        // 2026-04-27 — three distinct shades per outcome so bg / glow / text
        // each read as separate layers instead of blending. Pattern:
        //   bg     = lightest wash (soft tint behind everything)
        //   glow   = darker mid-tone halo around mascot
        //   accent = darkest, used for title + payout (max contrast vs bg)
        const winBg     = new Color(48,  198, 155, 255);  // mint teal — light wash
        const winGlow   = new Color(15,  100,  72, 255);  // deep forest — dark halo
        const winAccent = new Color(6,   72,  50, 255);  // emerald — darkest text
        const loseBg    = new Color(180, 80,  200, 255);  // violet wash
        const loseGlow  = new Color(180, 50,  85, 255);  // dark rose halo
        const loseAccent = new Color(236, 88,  122, 255); // rose accent (kept)
        const accent = outcome.won ? winAccent : loseAccent;
        if (this._postMatchOutcomeBgGfx && this._postMatchOutcomeBgOpacity) {
            const bg = this._postMatchOutcomeBgGfx;
            bg.clear();
            bg.fillColor = outcome.won ? winBg : loseBg;
            bg.rect(-360, -640, 720, 1280);
            bg.fill();
            const op = this._postMatchOutcomeBgOpacity;
            Tween.stopAllByTarget(op);
            op.opacity = 0;
            tween(op).to(0.6, { opacity: 60 }).start();
        }
        if (this._postMatchMascotGlowGfx && this._postMatchMascotGlowOpacity) {
            const g = this._postMatchMascotGlowGfx;
            g.clear();
            g.fillColor = outcome.won ? winGlow : loseGlow;
            g.circle(0, 0, 140);  // radius matches new MASCOT_GLOW_WH=320 (h/2 - small inset)
            g.fill();
            const op = this._postMatchMascotGlowOpacity;
            Tween.stopAllByTarget(op);
            op.opacity = 0;
            tween(op).to(0.4, { opacity: 200 }).start();  // bumped 140→200 for higher contrast
        }

        // Phase H4 — fire cinematic BEFORE rendering the rest of the panel.
        // The overlay sits above PostMatchPanel; auto-dismisses after 2.8s
        // and the user can tap-through immediately.
        if (leveledUp) {
            this._showLevelUpOverlay(previousLevel, outcome.newLevel);
        }

        if (this._postMatchTitleLabel) {
            // Drifting-gadget redesign: outcome-driven uppercase header.
            // Multi-player modes still surface placement ("1st of 4") for clarity.
            let title: string;
            const nth = (n: number): string => {
                const r = n + 1;
                if (r === 1) return '1st';
                if (r === 2) return '2nd';
                if (r === 3) return '3rd';
                return `${r}th`;
            };
            const myPubkey = MWAManager.instance?.connectedPubkey ?? '';
            const myName = myPubkey ? this._getDisplayName(myPubkey) : '';
            const isUsername = myName && !myName.includes('…');
            if (outcome.placement != null && outcome.totalPlayers != null && outcome.totalPlayers > 2) {
                title = `${nth(outcome.placement)} OF ${outcome.totalPlayers}`;
            } else if (outcome.won) {
                title = isUsername ? `YOU WON, ${myName.toUpperCase()}!` : 'YOU WON!';
            } else {
                title = 'SO CLOSE…';
            }
            this._postMatchTitleLabel.string = title;
            // 2026-04-27 — title uses the dark accent so it reads against the
            // light wash bg. Win=deep emerald, loss=rose (kept).
            this._postMatchTitleLabel.color = accent;
        }
        if (this._postMatchTrackLabel) {
            const modeLbl = outcome.modeLabel ?? '1v1 Duel';
            this._postMatchTrackLabel.string = `${outcome.track === 'real' ? 'Real' : 'Paper'} · ${modeLbl}`;
        }
        if (this._postMatchPayoutLabel) {
            const sol = outcome.payoutLamports / 1e9;
            const wagerSol = outcome.track === 'real'
                ? this._realMatchWagerLamports / 1e9
                : Number(this._selectedStakeLamports ?? 0n) / 1e9;
            // Drifting-gadget: signed payout — `+0.05 SOL` on win, `−0.02 SOL`
            // on loss (loss amount = stake forfeited). U+2212 minus sign for a
            // proper typographic dash; mono digits for stable width.
            // 2026-04-27 — payout matches title accent (dark emerald on win,
            // rose on loss) so it stands out against the light wash bg.
            this._postMatchPayoutLabel.color = accent;
            this._postMatchPayoutLabel.string = outcome.won
                ? '+0.000 SOL'
                : `−${wagerSol >= 0.01 ? wagerSol.toFixed(2) : wagerSol.toFixed(4)} SOL`;
            // Scale-in prelude: opacity 0 + scale 0.6 → 1.0 over 250ms.
            const payoutNode = this._postMatchPayoutLabel.node;
            const op = this._ensureOpacity(payoutNode);
            Tween.stopAllByTarget(payoutNode);
            Tween.stopAllByTarget(op);
            payoutNode.setScale(0.6, 0.6, 1);
            op.opacity = 0;
            tween(op).to(0.25, { opacity: 255 }).start();
            tween(payoutNode)
                .to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                .call(() => {
                    if (outcome.won && sol > 0 && this._postMatchPayoutLabel) {
                        this._animatePayoutTicker(this._postMatchPayoutLabel, sol, 1.0);
                    }
                })
                .start();
        }

        // betting-duel: decode encoded u32 scores back into portfolio delta % for display.
        const playerDeltaPct   = decodeScore(outcome.playerHeight);
        const opponentDeltaPct = decodeScore(outcome.opponentHeight);
        const deltaDiff        = Math.abs(playerDeltaPct - opponentDeltaPct);
        console.log(`${TAG} _showPostMatchPanel | DECODED player_score=${outcome.playerHeight} player=${playerDeltaPct.toFixed(2)}% opp_score=${outcome.opponentHeight} opp=${opponentDeltaPct.toFixed(2)}% diff_pp=${deltaDiff.toFixed(2)} won=${outcome.won} track=${outcome.track}`);

        // Phase G2 — per-slot breakdown. Build a "BONK +4.2% · WIF -1.1% ·
        // JUP +0.8%" line from the latest race snapshot so the user can see
        // which tokens carried (or sank) their portfolio.
        const buildSlotBreakdown = (): string => {
            const snap = this._raceLatestSnapshot;
            if (!snap) return '';
            const parts: string[] = [];
            for (const h of this._raceActiveHoldings) {
                const key = h?.mint || h?.symbol || '';
                const info = snap.perToken[key];
                if (!info) continue;
                const sym = h?.symbol || (key ? `${key.slice(0, 4)}…` : '?');
                const sign = info.deltaPct >= 0 ? '+' : '';
                parts.push(`${sym} ${sign}${info.deltaPct.toFixed(2)}%`);
            }
            return parts.length > 0 ? parts.join(' · ') : '';
        };

        // Subtitle: default = portfolio-delta diff; level-up message overrides;
        // unverified-real-match badge takes priority over both.
        if (this._postMatchSubtitleLabel) {
            if (outcome.track === 'real' && this._lastMatchUnverifiedReason) {
                this._postMatchSubtitleLabel.string = `⚠ Unverified — ${this._lastMatchUnverifiedReason}`;
                this._postMatchSubtitleLabel.color = new Color(220, 180, 70, 255);
            } else if (leveledUp) {
                this._postMatchSubtitleLabel.string = `LEVEL UP! ${previousLevel} → ${outcome.newLevel}`;
                this._postMatchSubtitleLabel.color = new Color(218, 165, 32, 255);
            } else {
                const breakdown = buildSlotBreakdown();
                // Drifting-gadget: tighter copy. "You won by X pp" / "They beat you by X pp".
                const headline = outcome.won
                    ? `You won by ${deltaDiff.toFixed(2)} pp`
                    : `They beat you by ${deltaDiff.toFixed(2)} pp`;
                this._postMatchSubtitleLabel.string = breakdown
                    ? `${headline}\n${breakdown}`
                    : headline;
                this._postMatchSubtitleLabel.color = new Color(220, 226, 240, 255);
            }
        }

        // Part 13: rake paid line. Reads last-known level + wager from the
        // in-flight real match (falls back to paper stake for paper matches).
        if (this._postMatchRakeLabel) {
            const bps = rakeBpsForLevel(outcome.previousLevel ?? this._cachedLevel);
            const wagerLamports = outcome.track === 'real'
                ? this._realMatchWagerLamports
                : Number(this._selectedStakeLamports ?? 0n);
            if (wagerLamports > 0) {
                const rakeLamports = Math.floor((wagerLamports * bps) / 10_000);
                const rakeSol = rakeLamports / 1e9;
                const discount = 500 - bps;
                const discountStr = discount > 0 ? ` · lvl ${outcome.previousLevel ?? this._cachedLevel} saved ${(discount / 100).toFixed(1)}%` : '';
                this._postMatchRakeLabel.string = `Rake paid: ${rakeSol.toFixed(4)} SOL (${bps} bps)${discountStr}`;
            } else {
                this._postMatchRakeLabel.string = '';
            }
        }

        // XP card: show `+gained · total · pct_to_next` when available.
        // Phase J1 — surface streak bonus when applicable. xpGained reflects
        // base XP today; the multiplier is shown in the cell so the user
        // sees what their streak earned them. (Onchain enforcement comes in
        // Phase K — for now this is display-only.)
        const streakMul = streakBonusFor(this._lastKnownStreak ?? 0);
        const bonusXp = streakMul > 1.0
            ? Math.max(0, Math.round(outcome.xpGained * streakMul) - outcome.xpGained)
            : 0;
        // 2026-04-27 — split "+N" main / breakdown sub for the XP card so the
        // multiplier line renders at smaller font (Value 32pt, ValueSub 13pt).
        let xpMain: string;
        let xpSub: string;
        if (outcome.totalXp && outcome.totalXp > 0) {
            const prog = levelProgress(outcome.totalXp);
            xpMain = bonusXp > 0
                ? `+${outcome.xpGained} (×${streakMul.toFixed(2)})`
                : `+${outcome.xpGained}`;
            xpSub  = `${outcome.totalXp} · ${Math.round(prog.progress * 100)}%→L${prog.level + 1}`;
        } else if (bonusXp > 0) {
            xpMain = `+${outcome.xpGained}`;
            xpSub  = `× ${streakMul.toFixed(2)} streak`;
        } else {
            xpMain = `+${outcome.xpGained}`;
            xpSub  = '';
        }
        const fmtPct = (p: number): string => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
        const values = new Map([
            ['you', fmtPct(playerDeltaPct)],
            ['opp', fmtPct(opponentDeltaPct)],
            ['xp',  xpMain],
            ['lvl', String(outcome.newLevel)],
        ]);
        for (const [k, v] of values) {
            const lbl = this._postMatchCardValues.get(k);
            if (lbl) lbl.string = v;
        }
        // Sub-line text: only XP card uses it for now; others stay blank.
        const subs = new Map([
            ['you', ''],
            ['opp', ''],
            ['xp',  xpSub],
            ['lvl', ''],
        ]);
        for (const [k, v] of subs) {
            const lbl = this._postMatchCardSubs.get(k);
            if (lbl) lbl.string = v;
        }

        // Color-code the delta cards by sign.
        const youLbl = this._postMatchCardValues.get('you');
        const oppLbl = this._postMatchCardValues.get('opp');
        const green = new Color(48, 198, 155, 255);
        const red = new Color(236, 88, 122, 255);
        const neutral = new Color(255, 255, 255, 255);
        if (youLbl) youLbl.color = playerDeltaPct > 0 ? green : (playerDeltaPct < 0 ? red : neutral);
        if (oppLbl) oppLbl.color = opponentDeltaPct > 0 ? green : (opponentDeltaPct < 0 ? red : neutral);

        // Tint LEVEL card when leveled up — Stage 5O: rare-state gold instead of teal.
        const lvlLabel = this._postMatchCardValues.get('lvl');
        if (lvlLabel) {
            lvlLabel.color = leveledUp ? new Color(255, 210, 74, 255) : new Color(255, 255, 255, 255);
        }

        // Drifting-gadget: per-outcome card edge accents (green on win, rose on loss).
        const edgeColor = outcome.won
            ? new Color(48, 198, 155, 255)
            : new Color(236, 88, 122, 255);
        for (const [, edge] of this._postMatchCardEdges) {
            edge.color = edgeColor;
        }

        console.log(`${TAG} _showPostMatchPanel | won=${outcome.won} player=${outcome.playerHeight} opp=${outcome.opponentHeight} xp=${outcome.xpGained} total_xp=${outcome.totalXp ?? '?'} level_was=${previousLevel} level_now=${outcome.newLevel} level_up=${leveledUp} payout_sol=${(outcome.payoutLamports / 1e9).toFixed(4)} track=${outcome.track}`);

        // Part 11 C: PostMatch audio — victory fanfare on 1st, level-up chime
        // layered on top if the XP gain pushed into a new level.
        // Stage 4L audit: silence on loss is intentional — no fanfare plays when
        // !won. The natural thud of victory absence is the punishment.
        if (outcome.won && outcome.placement === 0) {
            playSound('victory');
        }
        if (leveledUp) {
            // Stage 3J: delay level-up chime so it lands AFTER the payout ticker
            // finishes (1.2s), making it a second reward beat rather than a
            // collision during the payout animation.
            setTimeout(() => playSound('level_up'), 1400);
        }

        // Part 11 A: stash share-summary + toggle share button visibility.
        // Only Real matches are shareable — paper matches have no on-chain PDA
        // and so no verifiable story to publish.
        const shareBtnNode = this._postMatchPanel.getChildByName('PostMatchShareButton');
        if (outcome.track === 'real' && this._activeRealMatchPda) {
            const wagerLamports = BigInt(this._realMatchWagerLamports);
            const squadSyms = this._squad.slots.map((s) => s?.symbol ?? 'SOL');
            const squadDeltas = this._squad.slots.map((s) =>
                s?.address ? (this._sessionDeltas?.[s.address] ?? 0) : 0);
            const q = new URLSearchParams({
                placement: String(outcome.placement ?? 0),
                requiredPlayers: String(outcome.totalPlayers ?? 2),
                height: String(outcome.playerHeight),
                payoutLamports: String(BigInt(outcome.payoutLamports)),
                wagerLamports: String(wagerLamports),
                modeLabel: outcome.modeLabel ?? '1v1 Duel',
                timeWindowLabel: TIME_WINDOWS[this._pickerSelectedWindow]?.label ?? '24h',
                track: 'real',
                squadSymbols: squadSyms.join(','),
                squadDeltas: squadDeltas.join(','),
                playerPubkey: MWAManager.instance?.connectedPubkey ?? '',
                verified: this._useVerifiedPath ? '1' : '0',
            });
            this._lastShareMatchPda = this._activeRealMatchPda;
            this._lastShareQuery = q.toString();
            if (shareBtnNode) shareBtnNode.active = true;
        } else {
            this._lastShareMatchPda = null;
            this._lastShareQuery = null;
            if (shareBtnNode) shareBtnNode.active = false;
        }

        // Tween: XP card scale pulse when any XP was gained.
        if (outcome.xpGained > 0) {
            const xpCard = this._postMatchPanel.getChildByName('PMCard_xp');
            if (xpCard) {
                Tween.stopAllByTarget(xpCard);
                xpCard.setScale(1, 1, 1);
                tween(xpCard)
                    .to(0.25, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'cubicOut' })
                    .to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicIn' })
                    .start();
                console.log(`${TAG} _showPostMatchPanel | TWEEN_XP scale 1.0→1.2→1.0 500ms`);
            }
        }

        // Tween: LEVEL card flash + subtitle emphasis on level-up.
        if (leveledUp) {
            const lvlCard = this._postMatchPanel.getChildByName('PMCard_lvl');
            if (lvlCard) {
                Tween.stopAllByTarget(lvlCard);
                lvlCard.setScale(1, 1, 1);
                tween(lvlCard)
                    .to(0.3, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'backOut' })
                    .to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backIn' })
                    .to(0.3, { scale: new Vec3(1.1, 1.1, 1) }, { easing: 'cubicOut' })
                    .to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicIn' })
                    .start();
                console.log(`${TAG} _showPostMatchPanel | TWEEN_LEVEL_UP subtitle_flash 1200ms`);
            }
        }

        // Session D Part 7: trophy/medal emoji for top-3 placements.
        //   placement=0 → 🏆 (bounce + 360° rotate)
        //   placement=1 → 🥈 (static fade-in)
        //   placement=2 → 🥉 (static fade-in)
        //   placement≥3 → hidden
        this._animatePostMatchTrophy(outcome.placement ?? (outcome.won ? 0 : 99));

        // Stage 3I — staggered reveal cascade. Values are already set (above);
        // hide the 4 stat cards immediately, then fade+pop them back in over
        // ~800ms in a deliberate order: opp → you → xp → lvl. Pure overlay on
        // top of existing logic — no value reshuffling.
        this._revealPostMatchStaggered(outcome.won);

        // Drifting-gadget: XP progress bar. Rolls from previous-level progress
        // to new-level progress over 700ms; on level-up, rolls to 100% first,
        // flashes gold, then resets and rolls to the new bucket.
        if (outcome.totalXp != null && outcome.xpGained > 0) {
            // Onchain XP gain is base-only (streakBonusFor is display-only per
            // the Phase J1 audit above). prevTotal = totalXp − xpGained.
            const prevTotal = Math.max(0, outcome.totalXp - outcome.xpGained);
            this._animateXPBar(prevTotal, outcome.totalXp, leveledUp, outcome.xpGained, outcome.won);
        } else if (this._postMatchXPBarLabelLeft && this._postMatchXPBarLabelRight && this._postMatchXPBarFillGfx) {
            // No XP this match — clear the bar entirely.
            this._postMatchXPBarLabelLeft.string = '';
            this._postMatchXPBarLabelRight.string = '';
            this._postMatchXPBarFillGfx.clear();
        }
    }

    /**
     * Drifting-gadget — XP progress bar fill animation.
     * Track is 480×16, rounded; dark fill behind, accent fill on top.
     * On level-up: roll prev → 100%, flash gold, reset to 0, roll → new.
     * Otherwise: roll prev → new in 700ms.
     */
    private _animateXPBar(prevTotalXp: number, newTotalXp: number, leveledUp: boolean, xpGained: number, won: boolean): void {
        const left = this._postMatchXPBarLabelLeft;
        const right = this._postMatchXPBarLabelRight;
        const g = this._postMatchXPBarFillGfx;
        if (!left || !right || !g) return;

        const prog0 = levelProgress(prevTotalXp);
        const prog1 = levelProgress(newTotalXp);
        const trackW = 480;
        const trackH = 16;
        const halfW = trackW / 2;

        const drawBar = (pct: number, fill: Color) => {
            g.clear();
            // Dark track behind.
            g.fillColor = new Color(28, 32, 48, 200);
            g.roundRect(-halfW, -trackH / 2, trackW, trackH, trackH / 2);
            g.fill();
            // Accent fill on top, clamped 0..1.
            const w = Math.max(0, Math.min(1, pct)) * trackW;
            if (w > 1) {
                g.fillColor = fill;
                g.roundRect(-halfW, -trackH / 2, w, trackH, trackH / 2);
                g.fill();
            }
        };

        const accent = won ? new Color(48, 198, 155, 255) : new Color(236, 88, 122, 255);
        const gold   = new Color(255, 210, 74, 255);

        // Labels — left always shows the "next-level" target post-animation,
        // right shows the gained XP delta in accent color.
        left.string = `Lv ${prog1.level} → Lv ${prog1.level + 1}`;
        left.color = new Color(150, 160, 185, 255);
        right.string = `+${xpGained} XP`;
        right.color = accent;

        // Initial frame at prog0 fill.
        drawBar(prog0.progress, accent);

        const proxy = { p: prog0.progress };
        if (leveledUp) {
            // Stage 1: roll to 100% (treat prev-level remainder as the run).
            tween(proxy)
                .to(0.5, { p: 1 }, {
                    easing: 'cubicOut',
                    onUpdate: () => drawBar(proxy.p, gold),
                })
                .call(() => {
                    proxy.p = 0;
                    drawBar(0, accent);
                })
                .delay(0.15)
                .to(0.55, { p: prog1.progress }, {
                    easing: 'cubicOut',
                    onUpdate: () => drawBar(proxy.p, accent),
                })
                .start();
        } else {
            tween(proxy)
                .to(0.7, { p: prog1.progress }, {
                    easing: 'cubicOut',
                    onUpdate: () => drawBar(proxy.p, accent),
                })
                .start();
        }
    }

    /**
     * Stage 3I — stagger the 4 PostMatch stat cards in after the panel shows.
     * Each card fades in from opacity=0 + scale=0.7 with a backOut pop,
     * 180ms stagger. Order: opp (suspense first), you (reveal), xp, lvl.
     */
    private _revealPostMatchStaggered(won: boolean): void {
        if (!this._postMatchPanel) return;
        const order: string[] = ['opp', 'you', 'xp', 'lvl'];
        const stagger = 0.18;
        const baseDelay = 0.1;
        for (let i = 0; i < order.length; i++) {
            const key = order[i];
            const card = this._postMatchPanel.getChildByName(`PMCard_${key}`);
            if (!card) continue;
            const op = this._ensureOpacity(card);
            Tween.stopAllByTarget(card);
            Tween.stopAllByTarget(op);
            op.opacity = 0;
            card.setScale(new Vec3(0.7, 0.7, 1));
            const delay = baseDelay + i * stagger;
            tween(card)
                .delay(delay)
                .to(0.28, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                .start();
            tween(op)
                .delay(delay)
                .to(0.28, { opacity: 255 })
                .start();
        }
        // Player card gets a flourish bump after its reveal — scale 1 → 1.25 → 1
        // with color flash on win. Lands ~(0.1 + 1 * 0.18 + 0.28) = 560ms in.
        const youCard = this._postMatchPanel.getChildByName('PMCard_you');
        if (youCard) {
            setTimeout(() => {
                Tween.stopAllByTarget(youCard);
                tween(youCard)
                    .to(0.15, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'cubicOut' })
                    .to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicIn' })
                    .start();
            }, Math.round((baseDelay + 1 * stagger + 0.28) * 1000));
        }
        console.log(`${TAG} _revealPostMatchStaggered | CASCADE order=[${order.join(',')}] won=${won}`);
    }

    /**
     * Show/hide + tween the TrophyLabel on PostMatchPanel based on placement.
     * Placement is 0-indexed (0 = 1st place). Idempotent per panel show.
     *
     * UX Phase 2b: trophy is now an IconLibrary-rendered Graphics icon (trophy
     * for 1st, medalSilver / medalBronze for 2nd / 3rd) rather than an emoji.
     */
    private _animatePostMatchTrophy(placement: number): void {
        if (!this._postMatchPanel) return;
        const trophyN = this._postMatchPanel.getChildByName('TrophyLabel');
        if (!trophyN) return;

        Tween.stopAllByTarget(trophyN);
        trophyN.active = placement <= 2;
        if (!trophyN.active) {
            console.log(`${TAG} _animatePostMatchTrophy | HIDE placement=${placement}`);
            return;
        }

        // Re-attach a procedural trophy/medal on the node (replaces any prior draw).
        // Drifting-gadget: trophy is now a small corner badge in the title
        // row (64×64) — the centered celebrate mascot is the primary
        // celebration. Icon size dropped 120 → 56 to fit the badge box.
        const iconName = placement === 0 ? 'trophy' : placement === 1 ? 'medalSilver' : 'medalBronze';
        IconLibrary.attach(trophyN, iconName, { size: 56 });
        trophyN.setScale(0.01, 0.01, 1);
        trophyN.angle = 0;

        if (placement === 0) {
            // 1st place: scale-from-0 + bounce + 360° spin in its corner box.
            tween(trophyN)
                .to(0.3, { scale: new Vec3(1.35, 1.35, 1) }, { easing: 'backOut' })
                .to(0.2, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'cubicIn' })
                .to(0.1, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'cubicOut' })
                .to(0.1, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'cubicIn' })
                .start();
            tween(trophyN)
                .by(0.6, { angle: 360 }, { easing: 'cubicOut' })
                .start();
            // Session D Part 8: confetti particles fan out from the trophy.
            this._animateConfetti(trophyN);
            console.log(`${TAG} _animatePostMatchTrophy | FIRST_PLACE bounce+spin 700ms + confetti=12`);
        } else {
            // 2nd/3rd: subtle fade-in scale. Hide confetti.
            tween(trophyN)
                .to(0.25, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'cubicOut' })
                .start();
            this._hideConfetti(trophyN);
            console.log(`${TAG} _animatePostMatchTrophy | RUNNER_UP placement=${placement} icon=${iconName}`);
        }
    }

    /**
     * Pre-allocate the 12 confetti Graphics components once — called from
     * `start()` after the PostMatchPanel bindings. Before this existed,
     * `_animateConfetti` added 12 cc.Graphics components in a single JS tick
     * on every match-end, which SIGSEGV'd Cocos 3.8's Android native renderer
     * when the XP/LEVEL card tweens + trophy spin + payout ticker were also
     * firing in the same frame (Seeker, observed 2026-04-23).
     *
     * The shape/tint per slot is picked here once and cached on
     * `_confettiShapes` / `_confettiTints` so `_animateConfetti` can restart
     * the burst without re-attaching anything.
     */
    private _bindPostMatchConfetti(): void {
        if (this._confettiBound || !this._postMatchPanel) return;
        const trophyN = this._postMatchPanel.getChildByName('TrophyLabel');
        if (!trophyN) {
            console.log(`${TAG} _bindPostMatchConfetti | ABORT_NO_TROPHY`);
            return;
        }
        const shapes: IconName[] = ['sparkle', 'star', 'starBurst', 'circle', 'triangle'];
        const tints = [Palette.accent.violet, Palette.accent.teal, Palette.accent.amber, Palette.accent.rose, Palette.rank.gold];
        this._confettiShapes = [];
        this._confettiTints = [];
        let attached = 0;
        for (let i = 0; i < 12; i++) {
            const confN = trophyN.getChildByName(`Confetti_${i}`);
            if (!confN) continue;
            const shape = shapes[i % shapes.length];
            const tint = tints[i % tints.length];
            this._confettiShapes.push(shape);
            this._confettiTints.push(tint);
            try {
                IconLibrary.attach(confN, shape, { size: 40, tintHex: tint });
                confN.active = false;
                attached++;
            } catch (e) {
                console.log(`${TAG} _bindPostMatchConfetti | ATTACH_FAIL slot=${i} err=${e}`);
            }
        }
        this._confettiBound = true;
        console.log(`${TAG} _bindPostMatchConfetti | DONE attached=${attached}/12`);
    }

    /**
     * Session D Part 8 / UX Phase 2b: spawn 12 confetti particles from the
     * trophy center and fan them outward. Confetti nodes are pre-built in
     * the scene as children of TrophyLabel (`Confetti_0..11`); their
     * Graphics components are pre-bound in `_bindPostMatchConfetti` so this
     * hot path only resets transform state + starts tweens.
     */
    private _animateConfetti(trophyN: Node): void {
        // Drifting-gadget: rebase burst origin to the celebrate-mascot center so
        // particles fan out from the visual centerpiece (the small corner trophy
        // is no longer the dramatic anchor). Confetti remain parented to
        // TrophyLabel — the silly-gathering-ember.md SIGSEGV fix forbids
        // re-parenting in the hot path. Both trophy + mascot are siblings under
        // PostMatchPanel, so the offset is just mascot.pos − trophy.pos.
        let ox = 0, oy = 0;
        const mascotN = this._postMatchPanel?.getChildByName('PostMatchMascotContainer');
        if (mascotN) {
            ox = mascotN.position.x - trophyN.position.x;
            oy = mascotN.position.y - trophyN.position.y;
        }
        let started = 0;
        for (let i = 0; i < 12; i++) {
            const confN = trophyN.getChildByName(`Confetti_${i}`);
            if (!confN) continue;
            try {
                Tween.stopAllByTarget(confN);
                confN.active = true;
                confN.setPosition(ox, oy, 0);
                confN.setScale(0.01, 0.01, 1);
                confN.angle = 0;
                // Radial layout: 12 slots around a circle, ±20° jitter, radius 180-260.
                const baseAngle = (i / 12) * Math.PI * 2;
                const jitter = (Math.random() - 0.5) * (Math.PI / 9);
                const theta = baseAngle + jitter;
                const radius = 180 + Math.random() * 80;
                const tx = Math.cos(theta) * radius;
                const ty = Math.sin(theta) * radius;
                const spin = (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 180);
                tween(confN)
                    .to(0.9, {
                        position: new Vec3(ox + tx, oy + ty, 0),
                        scale: new Vec3(1.0, 1.0, 1),
                    }, { easing: 'cubicOut' })
                    .call(() => { confN.active = false; })
                    .start();
                tween(confN)
                    .by(0.9, { angle: spin }, { easing: 'cubicOut' })
                    .start();
                started++;
            } catch (e) {
                console.log(`${TAG} _animateConfetti | PARTICLE_FAIL slot=${i} err=${e}`);
            }
        }
        console.log(`${TAG} _animateConfetti | CONFETTI_DONE started=${started}/12 bound=${this._confettiBound}`);
    }

    /** Hide all confetti emoji children (2nd/3rd-place or non-trophy placements). */
    private _hideConfetti(trophyN: Node): void {
        for (let i = 0; i < 12; i++) {
            const confN = trophyN.getChildByName(`Confetti_${i}`);
            if (!confN) continue;
            Tween.stopAllByTarget(confN);
            confN.active = false;
        }
    }

    /**
     * betting-duel Phase 4 — payout count-up.
     * Tweens the PostMatchPayoutLabel from 0.000 to `toSol` over `durationS`
     * using a proxy object (Label has no numeric value property). Quadratic
     * ease-out feels satisfying; a periodic 'stack' tick keeps the ticker
     * audible without getting noisy.
     */
    private _animatePayoutTicker(label: Label, toSol: number, durationS: number): void {
        console.log(`${TAG} _animatePayoutTicker | TICKER_START to=${toSol.toFixed(6)} SOL dur=${durationS}s`);
        const proxy = { v: 0 };
        const stopAt = Date.now() + Math.ceil(durationS * 1000) + 50;
        let lastTickMs = 0;
        const tickEvery = 300;
        // Drifting-gadget: 2dp for amounts ≥0.01 SOL, 4dp for paper micro-stakes.
        const dp = toSol >= 0.01 ? 2 : 4;
        tween(proxy)
            .to(durationS, { v: toSol }, {
                easing: 'quadOut',
                onUpdate: () => {
                    label.string = `+${proxy.v.toFixed(dp)} SOL`;
                    const now = Date.now();
                    if (now < stopAt && now - lastTickMs >= tickEvery) {
                        lastTickMs = now;
                        try { playSound('stack'); } catch (e) { console.log(`${TAG} _animatePayoutTicker | SOUND_ERROR error=${e}`); }
                    }
                },
            })
            .call(() => {
                label.string = `+${toSol.toFixed(dp)} SOL`;
                console.log(`${TAG} _animatePayoutTicker | TICKER_END final=${toSol.toFixed(6)} SOL`);
            })
            .start();
    }

    private _onPostMatchBack(): void {
        if (this._postMatchPanel) this._postMatchPanel.active = false;
        this._tokenDuelPanel.active = true;
        console.log(`${TAG} _onPostMatchBack | BACK_TO_TOKEN_DUEL`);
    }

    private _onPostMatchAgain(): void {
        if (this._postMatchPanel) this._postMatchPanel.active = false;
        this._tokenDuelPanel.active = true;
        // Re-open picker so user can pick mode/wager again. Squad still intact.
        if (this._modePickerOverlay) {
            this._modePickerOverlay.active = true;
            this._refreshModePickerUi();
        }
        console.log(`${TAG} _onPostMatchAgain | RE_OPEN_PICKER`);
    }

    /**
     * betting-duel Block 6: Play Again with the same squad + same picker
     * settings. Bypasses ModePicker → goes straight to countdown → race.
     */
    private _onPostMatchSameSquad(): void {
        if (this._postMatchPanel) this._postMatchPanel.active = false;
        this._tokenDuelPanel.active = true;
        // Reuse existing picker state — wager, mode, window, track are all
        // still set from the last run. Just kick onStartGame directly.
        console.log(`${TAG} _onPostMatchSameSquad | SKIP_PICKER mode=${this._pickerSelectedMode} wager_idx=${this._pickerSelectedWagerIndex} window=${this._pickerSelectedWindow} track=${this._pickerSelectedTrack}`);
        // Defer by one frame so the panel-hide tween completes cleanly.
        setTimeout(() => this._onStartGame(), 50);
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION D PART 2 — Mode picker handlers
    // ═══════════════════════════════════════════════════════════════

    private _onPickerModeClick(key: string): void {
        // Stage 3 mode rebalance: scene keys ARE the ModeId now (oneVone, trio,
        // fourPlayer, eightPlayer). Map any legacy '4p'/'8p'/'br10' to new ids.
        const legacyToModeId: Record<string, string> = {
            oneVone:     'oneVone',
            trio:        'trio',
            fourPlayer:  'fourPlayer',
            eightPlayer: 'eightPlayer',
            // Pre-Stage-3 legacy keys (kept for safety):
            '4p':         'fourPlayer',
            '8p':         'eightPlayer',
            br10:         'eightPlayer',
            battleRoyale: 'eightPlayer',
        };
        const modeId = legacyToModeId[key] ?? 'oneVone';
        this._pickerSelectedMode = modeId;
        console.log(`${TAG} _onPickerModeClick | mode=${modeId} scene_key=${key}`);
        this._refreshModePickerUi();
    }

    private _onPickerWagerClick(idx: number): void {
        if (idx < 0 || idx >= WAGER_TIERS_LAMPORTS.length) return;
        this._pickerSelectedWagerIndex = idx;
        console.log(`${TAG} _onPickerWagerClick | idx=${idx} wager_lamports=${WAGER_TIERS_LAMPORTS[idx]}`);
        this._refreshModePickerUi();
    }

    private _onPickerTrackClick(track: 'paper' | 'real'): void {
        this._pickerSelectedTrack = track;
        console.log(`${TAG} _onPickerTrackClick | track=${track}`);
        this._refreshModePickerUi();
    }

    private _onPickerWindowClick(window: TimeWindowId): void {
        if (!TIME_WINDOWS[window]) return;
        this._pickerSelectedWindow = window;
        console.log(`${TAG} _onPickerWindowClick | window=${window} u8=${TIME_WINDOWS[window].windowU8}`);
        this._refreshModePickerUi();
    }

    /** Phase E — bot difficulty toggle. Persisted; takes effect at next paper match. */
    private _onPickerDifficultyClick(d: BotDifficulty): void {
        this._pickerSelectedDifficulty = d;
        // sys.localStorage shim for native compat (matches Stats.ts/Watchlist.ts pattern).
        try { this._readLocalStorage()?.setItem('tokenduel:botDifficulty', d); } catch (_) { /* ignore */ }
        this._syncPreference({ botDifficulty: d });
        const mul = BOT_DIFFICULTY_MULTIPLIERS[d] ?? 1.0;
        console.log(`${TAG} _onPickerDifficultyClick | difficulty=${d} mul=${mul.toFixed(2)}`);
        this._refreshModePickerUi();
    }

    /** Phase E — refresh Birdeye gainers snapshot for Hard bot picks.
     *  Best-effort: empty array on any failure; SquadBot then falls back. */
    private async _refreshHardGainersSnapshot(): Promise<void> {
        if (this._pickerSelectedDifficulty !== 'hard') {
            this._hardGainersSnapshot = [];
            return;
        }
        try {
            const rows = await this._birdeye?.getTrending('gainers', 20);
            if (!Array.isArray(rows)) { this._hardGainersSnapshot = []; return; }
            this._hardGainersSnapshot = rows
                .map((r: any) => ({
                    mint: r.address ?? r.mint ?? '',
                    symbol: r.symbol ?? '?',
                    decimals: typeof r.decimals === 'number' ? r.decimals : 6,
                    logoUri: r.logoUri ?? r.logoURI,
                }))
                .filter((m: VettedMint) => typeof m.mint === 'string' && m.mint.length >= 32);
            console.log(`${TAG} _refreshHardGainersSnapshot | DONE rows=${this._hardGainersSnapshot.length}`);
        } catch (e) {
            console.log(`${TAG} _refreshHardGainersSnapshot | FAIL ${e}`);
            this._hardGainersSnapshot = [];
        }
    }

    private _onPickerCancel(): void {
        console.log(`${TAG} _onPickerCancel | CLOSE`);
        if (this._modePickerOverlay) this._modePickerOverlay.active = false;
    }

    private _onPickerStart(): void {
        const join = this._isJoinMode();
        const joinTarget = this._pickerJoinTarget;
        // In join-mode, mode + wager + window are dictated by the lobby, not
        // the local picker selections (which haven't been touched on this
        // path). Override them so all downstream copy + on-chain calls match.
        if (join && joinTarget) {
            // Stage 3 modeU8: 0=1v1, 1=Trio, 2=4p, 3=8p.
            const modeIdMap: Record<number, string> = { 0: 'oneVone', 1: 'trio', 2: 'fourPlayer', 3: 'eightPlayer' };
            this._pickerSelectedMode = modeIdMap[joinTarget.mode] ?? 'oneVone';
            this._pickerSelectedWagerIndex = joinTarget.wagerTier;
            const winIdMap: Record<number, TimeWindowId> = { 0: '30s', 1: '1m', 2: '5m', 3: '1h', 4: '24h', 5: '7d' };
            this._pickerSelectedWindow = winIdMap[joinTarget.timeWindow] ?? '30s';
            this._pickerSelectedTrack = 'real';
        }
        const wager = WAGER_TIERS_LAMPORTS[this._pickerSelectedWagerIndex];
        const track = this._pickerSelectedTrack;
        const hosting = this._pickerHostMode && !join;
        console.log(`${TAG} _onPickerStart | mode=${this._pickerSelectedMode} wager_lamports=${wager} track=${track} hosting=${hosting} join=${join} target=${joinTarget?.pda ?? 'none'}`);

        // Phase E — kick off Hard gainers refresh in parallel (no-op for easy/medium).
        if (track === 'paper') void this._refreshHardGainersSnapshot();

        // Session D Part 4: real-mode on-chain flow — init stats + join match + poll.
        if (track === 'real') {
            if (this._modePickerOverlay) this._modePickerOverlay.active = false;
            const modeDef = MODES[this._pickerSelectedMode as keyof typeof MODES] ?? MODES.oneVone;
            this._showWaitingPanel({
                mode: modeDef.label,
                wagerSol: wager / 1e9,
                track: 'real',
                status: join ? 'Joining lobby — sign tx…' : (hosting ? 'Hosting · waiting for opponents…' : 'Checking wallet…'),
                requiredPlayers: modeDef.requiredPlayers,
            });
            // Cache selections so settle flow knows what to do. Stage 3 modeU8 mapping.
            const modeMap: Record<string, number> = { oneVone: 0, trio: 1, fourPlayer: 2, eightPlayer: 3 };
            this._realMatchMode = modeMap[this._pickerSelectedMode] ?? 0;
            this._realMatchWagerTier = this._pickerSelectedWagerIndex;
            this._realMatchWagerLamports = wager;
            this._selectedStakeLamports = BigInt(wager);
            this._syncStakeValueLabel(wager / 1e9);

            // Fire off the async join flow; WaitingPanel stays visible and updates as it progresses.
            (async () => {
                const initResult = await this._ensureUserStatsInitialized();
                if (initResult !== 'ok') {
                    if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Could not init stats — tap Play Bot or Cancel';
                    return;
                }
                const joinOpts = join && joinTarget
                    ? { explicitMatchPda: joinTarget.pda }
                    : { forceCreate: hosting };
                const joinResult = await this._submitRealJoinMatch(this._realMatchMode, this._realMatchWagerTier, joinOpts);
                // Clear the join target now — submission is in flight; if a
                // retry/back-out happens, the user starts fresh from Home.
                if (join) this._pickerJoinTarget = null;
                // Reset host flag after the request is in flight; a subsequent
                // tap (back/cancel/replay) should default to auto-match again.
                this._pickerHostMode = false;
                if (!joinResult) {
                    if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Join tx failed — tap Play Bot or Cancel';
                    return;
                }
                this._activeRealMatchPda = joinResult.matchPda;
                // betting-duel live opponent delta: publish this player's
                // 3 squad mints to the backend so the other client can
                // subscribe + compute our live delta during the race.
                // Fire-and-forget — a missing backend shouldn't block join.
                const squadMints = this._squad.slots
                    .map((s) => s?.address ?? '')
                    .filter((m) => m.length >= 32);
                if (squadMints.length === 3 && MWAManager.instance?.connectedPubkey) {
                    const { publishSquadToBackend } = await import('../../token-duel/scripts/SpectatorRpc');
                    void publishSquadToBackend(joinResult.matchPda, MWAManager.instance.connectedPubkey, squadMints);
                }
                const required = (MODES[this._pickerSelectedMode as keyof typeof MODES] ?? MODES.oneVone).requiredPlayers;
                if (this._waitingStatusLabel) this._waitingStatusLabel.string = `Match ${joinResult.matchPda.substring(0, 8)}… · waiting for opponents`;
                if (this._waitingProgressLabel) this._waitingProgressLabel.string = `1/${required} players · 0:00 / 2:00`;

                const outcome = await this._runRealPollLoop(joinResult.matchPda);
                if (outcome === 'active') {
                    this._pendingRealMatch = true;
                    this._hideWaitingPanel();
                    this._setStakeClusterVisible(true);
                    this._refreshSquadActionButtons();
                    showToast('Opponent found — tap Commit to start');
                } else if (outcome === 'timeout') {
                    // Keep panel open; Play Bot + Cancel buttons are visible.
                    if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'No opponent in 2 min — Play Bot or Cancel+Refund';
                    this._emitNotification('match_expired', 'Lobby timed out',
                        'No opponent joined — tap Cancel to refund or Play vs Bot.',
                        { payload: { matchPda: joinResult.matchPda }, dedupeKey: joinResult.matchPda });
                } else if (outcome === 'settled' || outcome === 'cancelled') {
                    this._activeRealMatchPda = null;
                    this._hideWaitingPanel();
                    showToast(outcome === 'settled' ? 'Match already settled' : 'Match cancelled');
                    if (outcome === 'cancelled') {
                        this._emitNotification('lobby_cancelled', 'Lobby cancelled',
                            'Refund landed in your wallet.',
                            { payload: { matchPda: joinResult.matchPda }, dedupeKey: joinResult.matchPda });
                    }
                }
            })().catch((e) => {
                console.log(`${TAG} _onPickerStart | REAL_FLOW_ERROR error=${e}`);
                if (this._waitingStatusLabel) this._waitingStatusLabel.string = `Error: ${e?.message ?? e}`;
            });
            return;
        }

        // Paper: close picker → flash WaitingPanel briefly → launch race directly.
        // betting-duel: no more legacy stake-cluster commit UI. The match is
        // fully determined by squad + wager + mode + window + track and starts
        // as soon as the picker closes. `_onStartGame` handles countdown →
        // PortfolioRace → settlement.
        if (this._modePickerOverlay) this._modePickerOverlay.active = false;
        this._selectedStakeLamports = BigInt(wager);
        const solVal = wager / 1_000_000_000;
        this._syncStakeValueLabel(solVal);
        (this as any)._pendingPaperBotMatch = true;
        const modePaperDef = MODES[this._pickerSelectedMode as keyof typeof MODES] ?? MODES.oneVone;
        // 2026-04-27 — log selected config so multi-bot dispatch can be verified at runtime.
        console.log(`${TAG} _onPickerStart | paper_bot mode=${this._pickerSelectedMode} requiredPlayers=${modePaperDef.requiredPlayers} window=${this._pickerSelectedWindow} difficulty=${this._pickerSelectedDifficulty}`);
        this._showWaitingPanel({
            mode: modePaperDef.label,
            wagerSol: solVal,
            track: 'paper',
            status: `Paper match · ${modePaperDef.requiredPlayers - 1} bot opponent${modePaperDef.requiredPlayers > 2 ? 's' : ''}`,
            requiredPlayers: modePaperDef.requiredPlayers,
        });
        setTimeout(() => {
            this._hideWaitingPanel();
            console.log(`${TAG} _onPickerStart | PAPER_LAUNCH squad_filled=${this._squad.filled} wager=${solVal}`);
            this._onStartGame();
        }, 600);
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION D PART 4 — Real-mode on-chain wiring
    //  Mirror `_onClaim` sign-and-send pattern for init/join/settle/cancel.
    // ═══════════════════════════════════════════════════════════════

    /**
     * Check if the connected wallet has a UserStats PDA; if not, prompt the
     * wallet to sign an `initialize_user_stats` tx. Returns 'ok' when the PDA
     * exists (or was just created), 'error' on any failure.
     */
    private async _ensureUserStatsInitialized(): Promise<'ok' | 'error'> {
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.connectedPubkey) {
            console.log(`${TAG} _ensureUserStatsInitialized | NO_WALLET`);
            return 'error';
        }
        const pubkey = mwa.connectedPubkey;
        console.log(`${TAG} _ensureUserStatsInitialized | START player=${pubkey}`);

        // Part 10 Bundle 3: raw account lookup to decide init / migrate / skip.
        const userStatsPda = AnchorBackend.deriveUserStatsPda(pubkey);
        const info = await this._tdRpc.getAccountInfo(userStatsPda);

        if (!info || !info.dataBase64) {
            // Brand-new player — init the full v2 account.
            if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Initializing stats account — sign tx';
            const bh = await this._rpc.getLatestBlockhash('confirmed');
            if (!bh) { console.log(`${TAG} _ensureUserStatsInitialized | NO_BLOCKHASH`); return 'error'; }
            const tx = AnchorBackend.buildInitUserStatsTx(pubkey, bh.blockhash);
            const sig = await mwa.signAndSendTransaction(tx);
            if (!sig) {
                console.log(`${TAG} _ensureUserStatsInitialized | SIGN_FAIL lastError=${mwa.lastError?.code ?? '(none)'}`);
                return 'error';
            }
            console.log(`${TAG} _ensureUserStatsInitialized | INIT_V2 OK sig=${sig}`);
            return 'ok';
        }

        // Existing account — check if it needs migration from v1 (80 bytes) to v2 (120 bytes).
        const bytes = this._b64ToBytesLen(info.dataBase64);
        if (bytes < 8 + 112) {
            console.log(`${TAG} _ensureUserStatsInitialized | MIGRATE_NEEDED current_size=${bytes} → 120`);
            if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Upgrading stats account — sign tx';
            const bh = await this._rpc.getLatestBlockhash('confirmed');
            if (!bh) { console.log(`${TAG} _ensureUserStatsInitialized | NO_BLOCKHASH`); return 'error'; }
            const tx = AnchorBackend.buildMigrateUserStatsTx(pubkey, bh.blockhash);
            const sig = await mwa.signAndSendTransaction(tx);
            if (!sig) {
                console.log(`${TAG} _ensureUserStatsInitialized | MIGRATE_SIGN_FAIL lastError=${mwa.lastError?.code ?? '(none)'}`);
                return 'error';
            }
            console.log(`${TAG} _ensureUserStatsInitialized | MIGRATE OK sig=${sig}`);
        } else {
            console.log(`${TAG} _ensureUserStatsInitialized | EXISTS_V2 size=${bytes} player=${pubkey}`);
        }
        return 'ok';
    }

    /** Decode base64 account data length without materializing the full bytes. */
    private _b64ToBytesLen(b64: string): number {
        // Each 4-char base64 group maps to 3 bytes. Trailing `=`s reduce by 1 each.
        const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
        return Math.floor((b64.length * 3) / 4) - pad;
    }

    /**
     * Submit a join_match tx (create or join) based on open-match discovery.
     * Returns the match PDA on success, null on failure.
     */
    private async _submitRealJoinMatch(
        mode: number,
        wagerTierIndex: number,
        opts?: { forceCreate?: boolean; explicitMatchPda?: string },
    ): Promise<{ matchPda: string; action: 'create' | 'join' } | null> {
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.connectedPubkey) return null;
        const pubkey = mwa.connectedPubkey;
        console.log(`${TAG} _submitRealJoinMatch | START mode_u8=${mode} tier=${wagerTierIndex} forceCreate=${opts?.forceCreate ? 'yes' : 'no'} explicit=${opts?.explicitMatchPda ?? 'none'}`);
        // Phase G4 — wager-aware signing copy.
        const wagerSol = (WAGER_TIERS_LAMPORTS[wagerTierIndex] ?? 0) / 1e9;
        const action = opts?.explicitMatchPda ? 'Joining lobby' : (opts?.forceCreate ? 'Creating lobby' : 'Joining match');
        this._setSigningContext(`${action} — committing ${wagerSol.toFixed(3)} SOL wager`);

        // XP bucket from on-chain UserStats (default 0 if not initialized).
        const stats = await loadRealStats(this._tdRpc, pubkey);
        const xpBucket = stats.loaded ? stats.xpBucket : 0;

        // Stage 3 modeU8: 0=1v1, 1=Trio, 2=4p, 3=8p.
        const modeIdMap: Record<number, 'oneVone' | 'trio' | 'fourPlayer' | 'eightPlayer'> = {
            0: 'oneVone', 1: 'trio', 2: 'fourPlayer', 3: 'eightPlayer',
        };
        const modeId = modeIdMap[mode] ?? 'oneVone';

        // Session D Part 8: wrap with counter-race retries. signAndSend + getBlockhash
        // callbacks are passed in so the retry loop can re-build + re-sign on each
        // attempt with a fresh blockhash.
        // Part 9: thread the picker's TimeWindow so matchmaking isolates per-window.
        if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Preparing match — sign tx';
        const windowU8 = TIME_WINDOWS[this._pickerSelectedWindow]?.windowU8 ?? TIME_WINDOWS[DEFAULT_TIME_WINDOW].windowU8;
        try {
            const result = await joinOrCreateWithRetry({
                rpc: this._tdRpc,
                playerPubkey: pubkey,
                mode: modeId,
                wagerTierIndex,
                xpBucket,
                timeWindow: windowU8,
                forceCreate: opts?.forceCreate,
                explicitMatchPda: opts?.explicitMatchPda,
                getBlockhash: async () => {
                    const bh = await this._rpc.getLatestBlockhash('confirmed');
                    if (!bh) throw new Error('failed to fetch blockhash');
                    return bh.blockhash;
                },
                signAndSend: async (txBytes) => {
                    const sig = await mwa.signAndSendTransaction(txBytes);
                    if (!sig) {
                        throw new Error(`sign failed: ${mwa.lastError?.code ?? 'user cancelled'}`);
                    }
                    return sig;
                },
                onRetry: (attempt, max) => {
                    if (this._waitingStatusLabel) this._waitingStatusLabel.string = `Retry ${attempt}/${max} — counter race, re-signing`;
                },
            });
            console.log(`${TAG} _submitRealJoinMatch | OK match=${result.matchPda} action=${result.action} sig=${result.signature} attempts=${result.attempts}`);
            if (result.action === 'create') {
                // Confirm to the user that hosting succeeded — without this
                // the host has no signal the lobby is live + on-chain.
                showToast('Match created — waiting for opponents');
                const requiredPlayers = (MODES[modeId] ?? MODES.oneVone).requiredPlayers;
                const wagerLamports = WAGER_TIERS_LAMPORTS[wagerTierIndex] ?? 0;
                void (async () => {
                    try {
                        const { postLobbyCreated } = await import('../../token-duel/scripts/MatchLobbyDbRpc');
                        await postLobbyCreated({
                            matchPda: result.matchPda,
                            creatorPubkey: pubkey,
                            modeU8: mode,
                            wagerTier: wagerTierIndex,
                            wagerLamports,
                            timeWindow: windowU8,
                            requiredPlayers,
                            createdAt: new Date().toISOString(),
                        });
                    } catch (e) {
                        console.log(`${TAG} _submitRealJoinMatch | postLobbyCreated_err ${e}`);
                    }
                })();
            }
            return { matchPda: result.matchPda, action: result.action };
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            console.log(`${TAG} _submitRealJoinMatch | FAIL ${msg}`);
            // Phase G7 — friendly mapping of underlying MWA error.
            const friendly = this._friendlyMwaError(mwa.lastError?.code, mwa.lastError?.message ?? msg);
            if (this._waitingStatusLabel) this._waitingStatusLabel.string = `Join failed — ${friendly}`;
            return null;
        }
    }

    /**
     * Drive the WaitingPanel's progress label while `waitForOpponent` polls.
     * Returns the loop's outcome; caller decides what to do next.
     */
    private async _runRealPollLoop(matchPda: string): Promise<'active' | 'timeout' | 'cancelled' | 'settled'> {
        console.log(`${TAG} _runRealPollLoop | START match=${matchPda}`);
        this._realPollAbortFlag = false;
        const timeoutMs = 120_000;
        // Live wall-clock tick every 1s for the elapsed display.
        const startWall = Date.now();
        const clockTimer = setInterval(() => {
            if (this._realPollAbortFlag) return;
            const elapsed = Date.now() - startWall;
            const mm = Math.floor(elapsed / 60_000).toString().padStart(1, '0');
            const ss = Math.floor((elapsed / 1000) % 60).toString().padStart(2, '0');
            if (this._waitingProgressLabel) {
                // Keep the player_count portion; only update the clock segment.
                const current = this._waitingProgressLabel.string || '0/2 players';
                const parts = current.split('·');
                const countPart = (parts[0] ?? '0/2 players').trim();
                this._waitingProgressLabel.string = `${countPart} · ${mm}:${ss} / 2:00`;
            }
        }, 1000);

        const result = await waitForOpponent(this._tdRpc, matchPda, timeoutMs, (u) => {
            if (this._realPollAbortFlag) return;
            if (this._waitingProgressLabel) {
                const mm = Math.floor(u.elapsedMs / 60_000).toString().padStart(1, '0');
                const ss = Math.floor((u.elapsedMs / 1000) % 60).toString().padStart(2, '0');
                this._waitingProgressLabel.string = `${u.playerCount}/${u.requiredPlayers} players · ${mm}:${ss} / 2:00`;
            }
            // Part 9: seed force-settle watcher off the first Active poll.
            if (u.state) this._latestRealMatchState = u.state;
            if (u.status === 1 && this._realMatchStartedAt === 0) {
                // `state.startedAt` is on-chain unix sec; convert to JS ms wall clock.
                const chainStartedSec = u.state?.startedAt ?? 0n;
                const nowSec = Math.floor(Date.now() / 1000);
                const chainSec = Number(chainStartedSec);
                const clockSkewSec = chainSec > 0 ? nowSec - chainSec : 0;
                const startedAtMs = chainSec > 0 ? chainSec * 1000 : Date.now();
                console.log(`${TAG} _runRealPollLoop | ACTIVE match=${matchPda} chain_started_at=${chainSec} skew=${clockSkewSec}s`);
                this._startForceSettleWatch(startedAtMs);
                // Phase N4 — match transitioned to Active. Notify the player.
                const wagerSol = u.state ? Number(u.state.wagerLamports) / 1e9 : 0;
                this._emitNotification('match_started', 'Match starting!',
                    `Race begins now · ${u.requiredPlayers}-player · ${wagerSol.toFixed(3)} SOL`,
                    { payload: { matchPda }, dedupeKey: matchPda });
            }
        });
        clearInterval(clockTimer);
        console.log(`${TAG} _runRealPollLoop | OUTCOME ${result.outcome}`);
        return result.outcome as 'active' | 'timeout' | 'cancelled' | 'settled';
    }

    /**
     * Submit a settle_match tx for the player's height. Builds the correct
     * winner/loser accounts based on partial-vs-final settler state.
     */
    private async _submitSettleMatch(matchPda: string, height: number): Promise<boolean> {
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.connectedPubkey) return false;
        console.log(`${TAG} _submitSettleMatch | START match=${matchPda} height=${height}`);
        this._setSigningContext('Settling match — submit your final score');
        // Fresh read so winner derivation uses latest heights + settled_count.
        const matchState = await getMatch(this._tdRpc, matchPda);
        if (!matchState) {
            console.log(`${TAG} _submitSettleMatch | NO_MATCH match=${matchPda}`);
            return false;
        }

        // Phase F2 — real-track ALWAYS goes through the verified path. After
        // the program redeploy, settle_match (unverified) rejects any match
        // with wager_lamports>0 with VerifiedSettleRequired. Backend MUST be
        // reachable; on failure we surface a toast + return false.
        const isRealTrack = matchState.wagerLamports > 0n;
        if (isRealTrack) {
            const { requestReceiptSign } = await import('../../token-duel/scripts/ReceiptSigner');
            const receipt = await requestReceiptSign({
                matchPda,
                playerPubkey: mwa.connectedPubkey,
                height,
            });
            if (!receipt) {
                console.log(`${TAG} _submitSettleMatch | RECEIPT_UNAVAILABLE — backend unreachable`);
                if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Backend unavailable — wait or try again. Force-settle in 5min if stuck.';
                return false;
            }
            return await this._submitSettleMatchVerified(matchState, height, receipt, mwa);
        }

        // Paper-track or unwagered (no real-track wager): legacy unverified path.
        // Note: paper matches never hit onchain in current code, so this is dead
        // for now — kept for future-flexibility in case of free-test matches.
        const bh = await this._rpc.getLatestBlockhash('confirmed');
        if (!bh) { console.log(`${TAG} _submitSettleMatch | NO_BLOCKHASH`); return false; }
        const tx = buildSettleMatchTxFor({
            matchState,
            playerPubkey: mwa.connectedPubkey,
            height,
            blockhash: bh.blockhash,
        });
        const sig = await mwa.signAndSendTransaction(tx);
        if (!sig) {
            console.log(`${TAG} _submitSettleMatch | SIGN_FAIL lastError=${mwa.lastError?.code ?? '(none)'}`);
            return false;
        }
        console.log(`${TAG} _submitSettleMatch | SIGNED (legacy) OK sig=${sig}`);
        return true;
    }

    /**
     * Part 10 Bundle 1: build + sign the 2-ix verified settle transaction.
     * Returns true on successful wallet signature (not on-chain confirmation —
     * the caller polls the match account for Settled status).
     */
    private async _submitSettleMatchVerified(
        matchState: MatchState,
        height: number,
        receipt: { ed25519IxDataB64: string; signedAt: number; height: number },
        mwa: MWAManager,
    ): Promise<boolean> {
        const bh = await this._rpc.getLatestBlockhash('confirmed');
        if (!bh) { console.log(`${TAG} _submitSettleMatchVerified | NO_BLOCKHASH`); return false; }
        const required = matchState.requiredPlayers;
        const allPlayers = matchState.players.slice(0, required);
        const modeDef = modeFromU8(matchState.mode);

        // Decide partial vs final settler, mirroring buildSettleMatchTxFor logic.
        const isFinal = matchState.settledCount + 1 >= required;
        let payoutRecipients: string[] = [];
        if (isFinal) {
            const mySlot = allPlayers.indexOf(mwa.connectedPubkey!);
            const heights = matchState.heights.slice(0, required);
            if (mySlot >= 0) heights[mySlot] = height;
            const pot = Number(matchState.wagerLamports) * required;
            const breakdown = computeModePayout(modeDef.id, pot, heights);
            payoutRecipients = breakdown.winnerSlots.map((slot: number) => allPlayers[slot]);
        }
        const tx = AnchorBackend.buildSettleMatchVerifiedTx(
            mwa.connectedPubkey!,
            matchState.pda,
            matchState.mode,
            allPlayers,
            payoutRecipients,
            height,
            receipt.signedAt,
            receipt.ed25519IxDataB64,
            bh.blockhash,
        );
        if (tx.length === 0) {
            console.log(`${TAG} _submitSettleMatchVerified | TX_BUILD_FAIL`);
            return false;
        }
        const sig = await mwa.signAndSendTransaction(tx);
        if (!sig) {
            console.log(`${TAG} _submitSettleMatchVerified | SIGN_FAIL lastError=${mwa.lastError?.code ?? '(none)'}`);
            return false;
        }
        console.log(`${TAG} _submitSettleMatchVerified | SIGNED OK sig=${sig} final=${isFinal} recipients=${payoutRecipients.length}`);
        return true;
    }

    /** Submit cancel_match. Only succeeds if ≥ 120s elapsed OR creator self-cancel (Phase D Branch B). */
    private async _submitCancelMatch(matchPda: string): Promise<boolean> {
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.connectedPubkey) return false;
        console.log(`${TAG} _submitCancelMatch | START match=${matchPda}`);
        this._setSigningContext('Cancelling lobby — refund will land in your wallet');
        // Phase N4 — emit lobby_cancelled on the success path below; defer
        // emission until after the wallet-signature confirms.
        const bh = await this._rpc.getLatestBlockhash('confirmed');
        if (!bh) return false;
        const tx = AnchorBackend.buildCancelMatchTx(
            mwa.connectedPubkey,
            matchPda,
            mwa.connectedPubkey, // refund recipient = player 0 (solo waiter)
            bh.blockhash,
        );
        const sig = await mwa.signAndSendTransaction(tx);
        if (!sig) {
            console.log(`${TAG} _submitCancelMatch | SIGN_FAIL lastError=${mwa.lastError?.code ?? '(none)'}`);
            return false;
        }
        console.log(`${TAG} _submitCancelMatch | REFUNDED sig=${sig}`);
        // Phase N4 — surface the cancel + refund.
        this._emitNotification('lobby_cancelled', 'Lobby cancelled',
            'Refund landed in your wallet.',
            { payload: { matchPda }, dedupeKey: matchPda });
        return true;
    }

    /**
     * Read on-chain result for a settled match: did we win + payout + XP + level.
     * Returns null if the match isn't actually settled yet or pubkey missing.
     */
    private async _readRealMatchResult(matchPda: string, previousLevel?: number, previousXp?: number): Promise<{
        won: boolean;
        playerHeight: number;
        opponentHeight: number;
        payoutLamports: number;
        xpGained: number;
        newLevel: number;
        previousLevel: number;
        totalXp: number;
        placement: number;
        totalPlayers: number;
        modeLabel: string;
    } | null> {
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.connectedPubkey) return null;
        // Poll Match until settled (or timeout — other player may still be playing).
        const settled = await waitForSettlement(this._tdRpc, matchPda, 30_000);
        if (settled.outcome !== 'settled' || !settled.state) {
            console.log(`${TAG} _readRealMatchResult | NOT_SETTLED_YET match=${matchPda}`);
            return null;
        }
        const m = settled.state;
        const pubkey = mwa.connectedPubkey;
        const n = m.requiredPlayers;
        let mySlot = -1;
        for (let i = 0; i < n; i++) {
            if (m.players[i] === pubkey) { mySlot = i; break; }
        }
        // Session D Part 6: compute placement from all N heights.
        const heights = m.heights.slice(0, n);
        const indexed = heights.map((h, i) => ({ slot: i, h })).sort((a, b) => b.h - a.h);
        const placement = indexed.findIndex((x) => x.slot === mySlot);
        const modeDef = modeFromU8(m.mode);
        const won = placement < modeDef.payoutBps.length;
        const pot = Number(m.wagerLamports) * n;
        const breakdown = computeModePayout(modeDef.id, pot, heights);
        const payout = placement < breakdown.winnerLamports.length ? breakdown.winnerLamports[placement] : 0;
        // Best opponent height (excluding self).
        let bestOpp = 0;
        for (let i = 0; i < n; i++) { if (i !== mySlot && heights[i] > bestOpp) bestOpp = heights[i]; }
        // Read post-settle UserStats to pick up XP + new level exactly as on-chain computed.
        await new Promise((r) => setTimeout(r, 500));
        const stats = await loadRealStats(this._tdRpc, pubkey);
        const xpGained = xpForPlacement(modeDef.id, placement);
        console.log(`${TAG} _readRealMatchResult | SETTLED mode=${modeDef.id} placement=${placement + 1}/${n} won=${won} player_h=${heights[mySlot] ?? '?'} best_opp=${bestOpp} payout=${payout} xp=${stats.xp} level=${stats.level} prev_level=${previousLevel ?? '?'}`);
        return {
            won,
            playerHeight: heights[mySlot] ?? 0,
            opponentHeight: bestOpp,
            payoutLamports: payout,
            xpGained,
            newLevel: stats.level,
            previousLevel: previousLevel ?? stats.level,
            totalXp: stats.xp,
            placement,
            totalPlayers: n,
            modeLabel: modeDef.label,
        };
    }

    /** Sync picker UI tint + enable states to current selection. */
    // ═══════════════════════════════════════════════════════════════
    //  Phase N — Notification system (panel + bell + render + dispatch)
    // ═══════════════════════════════════════════════════════════════

    private _showNotificationPanel(): void {
        if (!this._notifPanel) return;
        console.log(`${TAG} _showNotificationPanel | SHOW`);
        this._notifPanel.active = true;
        // Slide-in animation: card starts off-right and slides to resting x.
        if (this._notifPanelCard) {
            const restingX = 120;
            const offX = 600;
            Tween.stopAllByTarget(this._notifPanelCard);
            this._notifPanelCard.setPosition(restingX + offX, 0, 0);
            tween(this._notifPanelCard)
                .to(0.22, { position: new Vec3(restingX, 0, 0) }, { easing: 'cubicOut' })
                .start();
        }
        this._renderNotificationList();
    }

    private _hideNotificationPanel(): void {
        if (!this._notifPanel) return;
        console.log(`${TAG} _hideNotificationPanel | HIDE`);
        if (this._notifPanelCard) {
            const restingX = 120;
            const offX = 600;
            Tween.stopAllByTarget(this._notifPanelCard);
            tween(this._notifPanelCard)
                .to(0.18, { position: new Vec3(restingX + offX, 0, 0) }, { easing: 'cubicIn' })
                .call(() => { if (this._notifPanel) this._notifPanel.active = false; })
                .start();
        } else {
            this._notifPanel.active = false;
        }
    }

    private _onNotifMarkAllReadTap(): void {
        const n = NotificationStore.instance.markAllRead();
        console.log(`${TAG} _onNotifMarkAllReadTap | marked=${n}`);
    }

    private _onNotifRowTap(rowIdx: number): void {
        const id = this._notifRowIds[rowIdx];
        if (!id) return;
        const list = NotificationStore.instance.getRecent(50);
        const n = list.find((x) => x.id === id);
        if (!n) return;
        // Mark read first.
        NotificationStore.instance.markRead(id);
        // Dispatch deep-link.
        const handler = this._resolveNotifTapHandler(n);
        try { handler?.(n); } catch (e) { console.log(`${TAG} _onNotifRowTap | dispatch error ${e}`); }
        this._hideNotificationPanel();
    }

    /** Returns a tap handler for the given notification (used by both panel rows and toast taps). */
    private _resolveNotifTapHandler(n: Notification): ((n: Notification) => void) | undefined {
        switch (n.kind) {
            case 'match_started':
            case 'match_filled': {
                const matchPda = (n.payload?.matchPda as string) ?? null;
                if (!matchPda) return undefined;
                return () => this._onOpenSpectator(matchPda);
            }
            case 'tournament_starting':
            case 'tournament_full': {
                const matchPda = (n.payload?.matchPda as string) ?? '';
                if (!matchPda) return undefined;
                return () => this._onOpenTournament(matchPda);
            }
            case 'challenge_done': {
                return () => this._onOpenDailyChallenges();
            }
            case 'match_settled':
            case 'payout':
            case 'lobby_cancelled':
            case 'match_expired':
            case 'level_up':
            case 'streak_milestone':
            default:
                return undefined; // mark-read only
        }
    }

    private _renderNotificationList(): void {
        const items = NotificationStore.instance.getRecent(8);
        if (this._notifEmptyLabel) {
            this._notifEmptyLabel.node.active = items.length === 0;
        }
        // Per-kind color map (RGB triplets matching the toast queue).
        const KIND_RGB: Record<NotificationKind, [number, number, number]> = {
            match_filled:        [153, 69, 255],
            match_started:       [153, 69, 255],
            match_settled:       [48, 198, 155],
            payout:              [255, 210, 74],
            match_expired:       [255, 180, 84],
            lobby_cancelled:     [255, 180, 84],
            level_up:            [255, 210, 74],
            streak_milestone:    [255, 180, 84],
            tournament_starting: [255, 210, 74],
            tournament_full:     [255, 210, 74],
            challenge_done:      [48, 198, 155],
        };
        const KIND_ICON: Record<NotificationKind, IconName> = {
            match_filled: 'sword',
            match_started: 'bolt',
            match_settled: 'check',
            payout: 'coin',
            match_expired: 'clock',
            lobby_cancelled: 'clock',
            level_up: 'star',
            streak_milestone: 'flame',
            tournament_starting: 'trophy',
            tournament_full: 'crown',
            challenge_done: 'check',
        };
        for (let i = 0; i < this._notifRows.length; i++) {
            const row = this._notifRows[i];
            if (!row) continue;
            const n = items[i];
            if (!n) {
                row.active = false;
                this._notifRowIds[i] = null;
                continue;
            }
            row.active = true;
            this._notifRowIds[i] = n.id;
            // Title + body.
            const titleL = row.getChildByName(`NotifRowTitleLabel_${i}`)?.getComponent(Label);
            if (titleL) titleL.string = n.title;
            const bodyL = row.getChildByName(`NotifRowBodyLabel_${i}`)?.getComponent(Label);
            if (bodyL) bodyL.string = n.body;
            // Time ago.
            const timeL = row.getChildByName(`NotifRowTimeLabel_${i}`)?.getComponent(Label);
            if (timeL) timeL.string = this._relativeTimeAgo(n.createdAt);
            // Stripe color (dimmed if read).
            const stripe = row.getChildByName(`NotifRowStripe_${i}`)?.getComponent(Sprite);
            if (stripe) {
                const [r, g, b] = KIND_RGB[n.kind] ?? [153, 69, 255];
                const alpha = n.readAt === null ? 255 : 110;
                stripe.color = new Color(r, g, b, alpha);
            }
            // Icon.
            const iconN = row.getChildByName(`NotifRowIcon_${i}`);
            if (iconN) {
                try { IconLibrary.attach(iconN, KIND_ICON[n.kind] ?? 'bell', { size: 32 }); }
                catch (_) { /* ignore */ }
            }
            // Unread dot.
            const dot = row.getChildByName(`NotifRowUnreadDot_${i}`);
            if (dot) dot.active = n.readAt === null;
        }
    }

    private _refreshNotificationBadge(): void {
        const unread = NotificationStore.instance.getUnreadCount();
        if (this._notifBellBadge) {
            this._notifBellBadge.active = unread > 0;
        }
        if (this._notifBadgeLabel) {
            this._notifBadgeLabel.string = unread >= 10 ? '9+' : String(unread);
        }
        // Pulse on increment to draw the eye.
        if (unread > this._notifLastUnread && this._notifBellBadge) {
            const node = this._notifBellBadge;
            Tween.stopAllByTarget(node);
            node.setScale(0.6, 0.6, 1);
            tween(node)
                .to(0.20, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backOut' })
                .to(0.12, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'cubicOut' })
                .start();
        }
        this._notifLastUnread = unread;
    }

    private _relativeTimeAgo(createdAtMs: number): string {
        const elapsedMs = Math.max(0, Date.now() - createdAtMs);
        const sec = Math.floor(elapsedMs / 1000);
        if (sec < 60) return `${sec}s ago`;
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min}m ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr}h ago`;
        const day = Math.floor(hr / 24);
        return day === 1 ? '1d ago' : `${day}d ago`;
    }

    /** Phase N6 — wallet connected: subscribe to backend notification feed. */
    private _onMwaAuthorized(): void {
        const pubkey = MWAManager.instance?.connectedPubkey ?? null;
        if (!pubkey) return;
        if (this._notifFeedPubkey === pubkey && this._notifFeedUnsub) return; // already subscribed
        // Tear down previous subscription.
        this._onMwaDisconnected();
        this._notifFeedPubkey = pubkey;
        // Last-seen timestamp for catchup — pull from store, fall back to 0.
        const lastSeenTs = NotificationStore.instance.getLastSeenTs();
        console.log(`${TAG} _onMwaAuthorized | subscribe pubkey=${pubkey.slice(0, 8)} lastSeenTs=${lastSeenTs}`);
        // Dynamic import keeps module weight off the cold-launch path.
        void import('../../token-duel/scripts/NotificationFeedRpc').then(({ subscribeToNotifications }) => {
            // The wallet may have disconnected before the import resolved.
            if (this._notifFeedPubkey !== pubkey) return;
            this._notifFeedUnsub = subscribeToNotifications(pubkey, {
                onCatchupBatch: (events) => {
                    for (const ev of events) this._ingestBackendEvent(ev);
                    console.log(`${TAG} notif_feed | catchup count=${events.length}`);
                },
                onEvent: (ev) => {
                    this._ingestBackendEvent(ev);
                },
                onWsConnected: () => console.log(`${TAG} notif_feed | ws connected`),
                onWsClosed: (r) => console.log(`${TAG} notif_feed | ws closed reason="${r}"`),
                onWsReconnected: (a) => console.log(`${TAG} notif_feed | ws reconnected attempt=${a}`),
                onWsGiveUp: () => console.log(`${TAG} notif_feed | ws give up`),
            }, lastSeenTs);
        }).catch((e) => console.log(`${TAG} _onMwaAuthorized | IMPORT_ERR ${e}`));
    }

    /** Phase N6 — wallet disconnect: unsubscribe from feed. */
    private _onMwaDisconnected(): void {
        if (this._notifFeedUnsub) {
            try { this._notifFeedUnsub(); } catch (_) { /* ignore */ }
            this._notifFeedUnsub = null;
        }
        this._notifFeedPubkey = null;
    }

    /** Phase N6 — translate a backend event into a local NotificationStore add. */
    private _ingestBackendEvent(ev: { id: string; kind: string; player: string; title: string; body: string; payload?: Record<string, unknown>; createdAt: number }): void {
        try {
            // DB Stage 10 — flag this id as server-origin so add() doesn't
            // echo it back to the server (would create a feedback loop).
            NotificationStore.instance.markServerOrigin(ev.id);
            NotificationStore.instance.add({
                id: ev.id,
                kind: ev.kind as any,
                title: ev.title,
                body: ev.body,
                payload: ev.payload,
                createdAt: ev.createdAt,
            });
        } catch (e) {
            console.log(`${TAG} _ingestBackendEvent | ERROR ${e}`);
        }
    }

    /** Phase N4 — emit a notification (writes to store; toast queue picks up via subscription). */
    private _emitNotification(
        kind: NotificationKind,
        title: string,
        body: string,
        opts?: { payload?: Record<string, unknown>; quietToast?: boolean; dedupeKey?: string; id?: string },
    ): Notification | null {
        return NotificationStore.instance.add({
            kind, title, body,
            payload: opts?.payload,
            quietToast: opts?.quietToast,
            dedupeKey: opts?.dedupeKey,
            id: opts?.id,
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Phase A — FindMatchPanel (top-level lobby browser)
    // ═══════════════════════════════════════════════════════════════

    private _showFindMatchPanel(): void {
        if (!this._findMatchPanel || !this._matchBrowser) {
            console.log(`${TAG} _showFindMatchPanel | NO_PANEL panel=${!!this._findMatchPanel} browser=${!!this._matchBrowser}`);
            return;
        }
        console.log(`${TAG} _showFindMatchPanel | SHOW`);
        this._findMatchPanel.active = true;
        if (this._homePanel) this._homePanel.active = false;
        this._refreshFindMatchFilterChips();
        // Phase A2 — refresh Lv/XP chip and reset empty-mascot to think state.
        void this._refreshFindMatchHeaderXp();
        this._findMatchEmptyMascot?.setState('think');
        // Bump the browser to 5s so the lobby feels live; restored to 15s
        // when the user backs out (see _hideFindMatchPanel).
        this._matchBrowser.setIntervalMs(AppUI.LOBBY_BROWSER_INTERVAL_MS);
        // Render any cached rows immediately, then kick off auto-refresh.
        this._renderMatchList();
        this._matchBrowser.start();
    }

    private _hideFindMatchPanel(): void {
        if (!this._findMatchPanel) return;
        console.log(`${TAG} _hideFindMatchPanel | HIDE`);
        this._findMatchPanel.active = false;
        if (this._homePanel) this._homePanel.active = true;
        // Throttle back down to home-screen cadence so the count badge
        // keeps refreshing in the background without the lobby's full 5s pace.
        this._matchBrowser?.setIntervalMs(AppUI.HOME_BROWSER_INTERVAL_MS);
    }

    private _onFilterModeClick(key: string): void {
        // Stage 3 mode rebalance: 0=1v1, 1=Trio, 2=4p, 3=8p.
        const map: Record<string, number | null> = {
            all: null, oneVone: 0, trio: 1, '4p': 2, '8p': 3,
        };
        const v = key in map ? map[key] : null;
        this._matchBrowser?.setFilter({ mode: v ?? null });
        console.log(`${TAG} _onFilterModeClick | key=${key} mode=${v ?? 'null'}`);
        this._refreshFindMatchFilterChips();
    }

    private _onFilterWindowClick(key: string): void {
        const map: Record<string, number | null> = {
            all: null, '30s': 0, '1m': 1, '5m': 2, '1h': 3, '24h': 4, '7d': 5,
        };
        const v = key in map ? map[key] : null;
        this._matchBrowser?.setFilter({ window: v ?? null });
        console.log(`${TAG} _onFilterWindowClick | key=${key} window=${v ?? 'null'}`);
        this._refreshFindMatchFilterChips();
    }

    /**
     * Bucket → set of accepted on-chain wagerTier indices.
     *   low   = 0.001 (5) + 0.01 (0)
     *   mid   = 0.05 (1) + 0.1 (2)
     *   high  = 0.25 (3) + 0.5 (4)
     *   whale = 1 (6) + 5 (7)
     */
    private _wagerBucketSet(key: string): Set<number> | null {
        switch (key) {
            case 'low':   return new Set([5, 0]);
            case 'mid':   return new Set([1, 2]);
            case 'high':  return new Set([3, 4]);
            case 'whale': return new Set([6, 7]);
            default:      return null; // 'all'
        }
    }

    /** Active wager bucket key — synthesized from the matched-set in browser filter. */
    private _activeWagerBucketKey: string = 'all';

    private _onFilterWagerClick(key: string): void {
        this._activeWagerBucketKey = key;
        // The browser stores a single tier index, but we want bucket
        // semantics — so we keep `wagerTier=null` in the browser and apply
        // the bucket filter client-side in _renderMatchList.
        this._matchBrowser?.setFilter({ wagerTier: null });
        console.log(`${TAG} _onFilterWagerClick | bucket=${key}`);
        this._refreshFindMatchFilterChips();
    }

    private _onToggleHideFull(): void {
        const cur = this._matchBrowser?.getFilters().hideFull ?? true;
        this._matchBrowser?.setFilter({ hideFull: !cur });
        console.log(`${TAG} _onToggleHideFull | hideFull=${!cur}`);
        this._refreshFindMatchFilterChips();
    }

    /** Phase H2 — toggle browser between Open Lobbies and Live Now feeds. */
    private _onFindMatchTabClick(mode: 'open' | 'live'): void {
        if (!this._matchBrowser) return;
        this._matchBrowser.setMode(mode);
        // HideFull doesn't apply to live matches (they're full by definition);
        // disable it visually but don't change the underlying filter.
        this._refreshFindMatchFilterChips();
    }

    /**
     * Phase 2b — segmented-control polish for FindMatch filter chips.
     *
     * Each chip can be in one of two visual states:
     *   • Active   — solid teal sprite, bold white label, glow sibling visible,
     *                addIdlePulse breathing.
     *   • Inactive — dim cardHover sprite (alpha 220), mid text, no glow,
     *                no pulse.
     *
     * On selection change, the OLD active chip and NEW active chip both
     * tween color + scale via popScale + glow fade so the change is fluid.
     *
     * `_filterActiveChip` tracks the previous-active key per row so we know
     * which chip needs the deactivation animation.
     */
    private _refreshFindMatchFilterChips(): void {
        const filters = this._matchBrowser?.getFilters();
        if (!filters) return;
        // Stage 3 mode rebalance: 0=1v1, 1=Trio, 2=4p, 3=8p.
        const sceneToMode: Record<string, number | null> = {
            all: null, oneVone: 0, trio: 1, '4p': 2, '8p': 3,
        };
        const sceneToWindow: Record<string, number | null> = {
            all: null, '30s': 0, '1m': 1, '5m': 2, '1h': 3, '24h': 4, '7d': 5,
        };
        // Resolve "which key is active per row".
        const modeActiveKey = (() => {
            for (const k of this._filterModeButtons.keys()) {
                if (sceneToMode[k] === filters.mode) return k;
            }
            return 'all';
        })();
        const windowActiveKey = (() => {
            for (const k of this._filterWindowButtons.keys()) {
                if (sceneToWindow[k] === filters.window) return k;
            }
            return 'all';
        })();
        const wagerActiveKey = this._activeWagerBucketKey ?? 'all';
        const browserMode = this._matchBrowser?.getMode() ?? 'open';
        const tabActiveKey = browserMode === 'live' ? 'Live' : 'Open';

        // Apply per-row polish. `prefix` matches the ChipGlow_<prefix>_<key> naming.
        const fmPanel = this._findMatchPanel;
        const applyRow = (
            buttons: Map<string, Button>,
            activeKey: string,
            rowKey: 'mode' | 'window' | 'wager' | 'tab',
            namePrefix: string,
        ) => {
            const previousActive = this._filterActiveChip.get(rowKey);
            for (const [k, b] of buttons) {
                const active = k === activeKey;
                const node = b.node;
                const spr = node.getComponent(Sprite);
                if (spr) {
                    spr.color = active
                        ? new Color(48, 198, 155, 255)        // teal — active
                        : new Color(28, 34, 48, 220);          // cardHover dim — inactive
                }
                // Bold + bright label when active.
                const lbl = node.getChildByName('Label')?.getComponent(Label);
                if (lbl) {
                    lbl.color = active
                        ? new Color(255, 255, 255, 255)
                        : new Color(168, 174, 201, 255);
                    (lbl as any)._isBold = active;
                }
                // Glow sibling toggle.
                if (fmPanel) {
                    const glow = fmPanel.getChildByName(`ChipGlow_${namePrefix}_${k}`);
                    if (glow) glow.active = active;
                }
                // Idle pulse: only the active chip breathes. Stop pulses on
                // any chip that just became inactive.
                if (active) {
                    try { addIdlePulse(node, 1.04, 1.5); } catch (_) { /* ignore */ }
                    // popScale on the chip that just GAINED active status (not the
                    // first render) so the change feels tactile.
                    if (previousActive !== undefined && previousActive !== k) {
                        try { popScale(node, 1.08); } catch (_) { /* ignore */ }
                    }
                } else {
                    Tween.stopAllByTarget(node);
                    node.scale = new Vec3(1, 1, 1);
                }
            }
            this._filterActiveChip.set(rowKey, activeKey);
        };

        applyRow(this._filterModeButtons,   modeActiveKey,   'mode',   'FilterMode');
        applyRow(this._filterWindowButtons, windowActiveKey, 'window', 'FilterWindow');
        applyRow(this._filterWagerButtons,  wagerActiveKey,  'wager',  'FilterWager');
        // Tabs use a different button-map (open/live).
        const tabMap = new Map<string, Button>();
        if (this._findMatchTabOpenBtn) tabMap.set('Open', this._findMatchTabOpenBtn);
        if (this._findMatchTabLiveBtn) tabMap.set('Live', this._findMatchTabLiveBtn);
        applyRow(tabMap, tabActiveKey, 'tab', 'FindMatchTab');

        // HideFull toggle label.
        const hf = this._findMatchHideFullToggle?.node.getChildByName('Label')?.getComponent(Label);
        if (hf) hf.string = filters.hideFull ? 'Hide full ✓' : 'Hide full';
    }

    /**
     * Update the home-screen FindMatchButton count badge. Called via a 2nd
     * MatchBrowser.subscribe() listener registered at start(). Pops with a
     * subtle scale tween whenever the count INCREASES (dopamine ding when
     * a new lobby appears while the user is on Home). Hides at zero.
     */
    private _renderFindMatchCount(count: number): void {
        const badge = this._findMatchCountBadge;
        const lbl = this._findMatchCountBadgeLabel;
        if (!badge || !lbl) return;
        const visible = count > 0;
        const wasVisible = this._findMatchCountLastValue > 0;
        badge.active = visible;
        if (visible) {
            lbl.string = String(count);
            // Pop only on increase to avoid pulsing on every refresh tick.
            if (count > this._findMatchCountLastValue) {
                try { popScale(badge, 1.18); } catch (_) { /* tween module not loaded */ }
            }
            // V2: start a soft idle pulse on the badge when it first becomes
            // visible. Calls are idempotent — addIdlePulse no-ops if already
            // pulsing — so this is safe across repeat ticks.
            if (!wasVisible) {
                try { addIdlePulse(badge, 1.06, 1.2); } catch (_) { /* tween not loaded */ }
            }
        }
        this._findMatchCountLastValue = count;
    }

    /** Mode index → row edge stripe / mode-badge tint (Phase A2). */
    private static readonly MODE_EDGE_TINT: Record<number, [number, number, number]> = {
        0: [153, 69, 255],   // 1v1     — violet
        1: [20, 241, 149],   // 4p Pot  — teal
        2: [255, 180, 84],   // 8p Pot  — amber
        3: [255, 92, 138],   // BR10    — rose
    };

    private _renderMatchList(): void {
        if (!this._matchBrowser) return;
        const mode = this._matchBrowser.getMode();
        let rows = this._matchBrowser.getRows();
        // Apply the wager bucket filter (orthogonal to MatchBrowser.filters).
        const bucket = this._wagerBucketSet(this._activeWagerBucketKey);
        if (bucket) rows = rows.filter((m) => bucket.has(m.wagerTier));

        const myPubkey = MWAManager.instance?.connectedPubkey ?? '';
        // We used to filter out lobbies we already created — but that hides
        // your own hosted match from the queue you'd check to verify it
        // landed on-chain. Keep them visible; the row binding marks them as
        // "Your Lobby" and swaps Join → Resume for the host.

        const visible = rows.slice(0, this._matchCardRows.length);
        if (this._findMatchCountLabel) {
            const total = this._matchBrowser.getAllRowCount();
            const totalLbl = mode === 'live' ? 'LIVE NOW' : 'OPEN LOBBIES';
            this._findMatchCountLabel.string = `● ${rows.length} ${totalLbl}  ·  ${total} TOTAL`;
        }
        // Phase A2 — gamified empty-state cluster (mascot + dual CTAs) replaces
        // the bare "no lobbies" label.
        const isEmpty = visible.length === 0;
        if (this._findMatchEmptyMascotNode) this._findMatchEmptyMascotNode.active = isEmpty;
        if (this._findMatchEmptyTitle)      this._findMatchEmptyTitle.node.active = isEmpty;
        if (this._findMatchEmptySubtitle)   this._findMatchEmptySubtitle.node.active = isEmpty;
        if (this._findMatchEmptyHostBtn)    this._findMatchEmptyHostBtn.node.active = isEmpty && mode === 'open';
        if (this._findMatchEmptyBotBtn)     this._findMatchEmptyBotBtn.node.active = isEmpty && mode === 'open';
        if (isEmpty && this._findMatchEmptyTitle) {
            this._findMatchEmptyTitle.string = mode === 'live' ? 'No live matches' : 'No matches yet';
        }
        if (isEmpty && this._findMatchEmptySubtitle) {
            this._findMatchEmptySubtitle.string = mode === 'live'
                ? 'Check back in a moment — race start any second.'
                : 'Be the first to host — others will join in seconds.';
        }
        if (isEmpty) this._findMatchEmptyMascot?.setState('think');
        // Hide the legacy bare empty label — replaced by the cluster above.
        if (this._findMatchEmptyLabel) this._findMatchEmptyLabel.node.active = false;

        const now = Date.now() / 1000;
        for (let i = 0; i < this._matchCardRows.length; i++) {
            const node = this._matchCardRows[i];
            if (!node) continue;
            const m = visible[i];
            if (!m) {
                node.active = false;
                this._matchCardRowMatchPdas[i] = null;
                this._matchCardRowMine[i] = false;
                continue;
            }
            node.active = true;
            this._matchCardRowMatchPdas[i] = m.pda;
            const isMine = !!myPubkey && m.players.includes(myPubkey);
            this._matchCardRowMine[i] = isMine;
            const modeMap: Record<number, string> = { 0: '1v1', 1: '4p Pot', 2: '8p Pot', 3: 'BR10' };
            const modeL = node.getChildByName(`MatchCardModeLabel_${i}`)?.getComponent(Label);
            if (modeL) modeL.string = modeMap[m.mode] ?? `mode ${m.mode}`;
            const wagerL = node.getChildByName(`MatchCardWagerLabel_${i}`)?.getComponent(Label);
            if (wagerL) wagerL.string = WAGER_TIERS_LABELS[m.wagerTier] ?? `tier ${m.wagerTier}`;
            const winLbl = ['30s', '1m', '5m', '1h', '24h', '7d'][m.timeWindow] ?? '?';
            const winL = node.getChildByName(`MatchCardWindowLabel_${i}`)?.getComponent(Label);
            if (winL) winL.string = `⏱  ${winLbl} race`;
            const subL = node.getChildByName(`MatchCardSubLabel_${i}`)?.getComponent(Label);
            const hostName = this._getDisplayName(m.players[0]);
            const hostPrefix = isMine ? '★ Your lobby' : hostName;
            if (mode === 'live') {
                const startedAt = Number(m.startedAt);
                const windowSec = [30, 60, 300, 3600][m.timeWindow] ?? 60;
                const elapsedSec = Math.max(0, now - startedAt);
                const pct = Math.max(0, Math.min(100, (elapsedSec / windowSec) * 100));
                if (subL) subL.string = `${hostPrefix} · ${m.playerCount}/${m.requiredPlayers} racing · ${pct.toFixed(0)}% elapsed`;
            } else {
                const ageSec = Math.max(0, now - Number(m.createdAt));
                const ageStr = ageSec < 60 ? `${Math.floor(ageSec)}s` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ${Math.floor(ageSec) % 60}s` : `${Math.floor(ageSec / 3600)}h ${Math.floor((ageSec % 3600) / 60)}m`;
                if (subL) subL.string = `${hostPrefix} · ${m.playerCount}/${m.requiredPlayers} players · ${ageStr} ago`;
            }
            // Phase A2 — edge stripe (mode-color) + capacity bar (tweened) + track chip per row.
            const tint = AppUI.MODE_EDGE_TINT[m.mode] ?? [153, 69, 255];
            const edgeNode = this._matchCardEdgeStripes[i];
            if (edgeNode) {
                const spr = edgeNode.getComponent(Sprite);
                if (spr) spr.color = new Color(tint[0], tint[1], tint[2], 255);
            }
            const capFill = this._matchCardCapBarFills[i];
            if (capFill) {
                const fillPct = m.requiredPlayers > 0 ? Math.min(1, m.playerCount / m.requiredPlayers) : 0;
                Tween.stopAllByTarget(capFill);
                tween(capFill).to(0.35, { scale: new Vec3(fillPct, 1, 1) }, { easing: 'cubicOut' }).start();
            }
            const trackChip = this._matchCardTrackChips[i];
            if (trackChip) trackChip.active = mode === 'open';
            const actionBtn = node.getChildByName(`MatchCardJoinButton_${i}`)?.getComponent(Button);
            const lbl = actionBtn?.node.getChildByName('Label')?.getComponent(Label);
            if (mode === 'live') {
                if (actionBtn) actionBtn.interactable = true;
                if (lbl) lbl.string = 'Spectate';
            } else if (isMine) {
                // Host's own lobby — re-enter the WaitingPanel for it.
                if (actionBtn) actionBtn.interactable = true;
                if (lbl) lbl.string = 'Resume';
            } else {
                // Phase A2 — squad-not-full no longer gates Join. Picker opens
                // after Confirm overlay so picking happens THEN.
                if (actionBtn) actionBtn.interactable = true;
                if (lbl) lbl.string = 'Join';
            }
        }
    }

    /**
     * Hydrate the FindMatchPanel header Lv/XP chip from on-chain UserStats.
     * Stage 2 — superseded by _refreshLevelChip(). Kept thin for back-compat;
     * just delegates to the unified helper.
     */
    private async _refreshFindMatchHeaderXp(): Promise<void> {
        return this._refreshLevelChip();
    }

    // ═══════════════════════════════════════════════════════════════
    //  Stage 2 — Top-right Level Chip
    //  Combines on-chain UserStats.xp (Real matches) + Stats.load('paper').xp
    //  (Paper/Bot training XP, per-device localStorage) into a single
    //  displayed level + progress. Stats system already records paper XP via
    //  Matchmaker.runPaperBotMatch; we just read it here.
    // ═══════════════════════════════════════════════════════════════

    /**
     * Refresh the top-right Lv/XP chip across Home / FindMatch / TokenDuel.
     * Single source of truth — keeps all 3 panels in sync. Hidden when wallet
     * not connected. Pulses chip if level changed (mini level-up celebration
     * without the full LevelUpOverlay cinematic).
     */
    private async _refreshLevelChip(): Promise<void> {
        const homeChip = this._homeLevelChip;
        const findChip = this._findMatchLvXpChip;
        const tdChip = this._tokenDuelLevelChip;
        const homeLbl = this._homeLevelChipLabel;
        const findLbl = this._findMatchLvXpChipLabel;
        const tdLbl = this._tokenDuelLevelChipLabel;

        const pubkey = MWAManager.instance?.connectedPubkey;
        const guest = this._isGuest();

        // No identity at all — hide chips.
        if (!pubkey && !guest) {
            if (homeChip) homeChip.active = false;
            if (findChip) findChip.active = false;
            if (tdChip) tdChip.active = false;
            return;
        }

        // Guest mode — local Stats only, no chain or DB read.
        let onchainXp = 0;
        let localXp = 0;
        if (guest) {
            localXp = Stats.load('paper').xp ?? 0;
        } else if (pubkey) {
            try {
                const stats = await getUserStats(this._tdRpc, pubkey);
                if (stats) onchainXp = Number((stats as any).xp ?? 0);
            } catch (e) {
                console.log(`${TAG} _refreshLevelChip | onchain_read_err ${e}`);
            }
            // DB Stage 3 — paper/bot XP from backend table; falls back to local
            // Stats when backend unreachable (offline play, network blip).
            // Local Stats is the per-device source of truth (see PaperXpRpc.ts
            // header comment). The backend mirror lags by one fire-and-forget
            // POST, so we must never let a stale remote value pull the
            // displayed total backwards on a freshly-completed match.
            const localStatsXp = Stats.load('paper').xp ?? 0;
            try {
                const { fetchPaperXp } = await import('../../token-duel/scripts/PaperXpRpc');
                const remote = await fetchPaperXp(pubkey);
                localXp = remote
                    ? Math.max(localStatsXp, Number(remote.totalXp) || 0)
                    : localStatsXp;
            } catch (e) {
                localXp = localStatsXp;
                console.log(`${TAG} _refreshLevelChip | paper_xp_read_err ${e} — using local fallback`);
            }
        }
        const totalXp = onchainXp + localXp;
        const { level } = levelProgress(totalXp);
        const xpAtLevel = xpForLevel(level);
        const xpForNext = xpForLevel(level + 1);
        const into = totalXp - xpAtLevel;
        const need = xpForNext - xpAtLevel;
        const text = `Lv ${level} · ${into}/${need}`;

        if (homeChip) homeChip.active = true;
        if (findChip) findChip.active = true;
        if (tdChip)   tdChip.active = true;
        // 2026-04-26 lobby restructure: Home chip splits the combined label.
        // "Lv N" goes to HomeLevelChipLabel; "X/Y XP" + progress bar are
        // driven by _setLevelProgress. FindMatch + TokenDuel chips keep the
        // legacy combined "Lv N · X/Y" form.
        if (homeLbl)  homeLbl.string = `Lv ${level}`;
        this._setLevelProgress(into, need);
        if (findLbl)  findLbl.string = text;
        if (tdLbl)    tdLbl.string = text;
        console.log(`${TAG} _refreshLevelChip | onchain=${onchainXp} local=${localXp} total=${totalXp} lvl=${level} progress=${into}/${need}`);

        // Pulse on level-up. Skip on first ever display (lastDisplayedLevel=0).
        if (this._lastDisplayedLevel > 0 && level > this._lastDisplayedLevel) {
            for (const c of [homeChip, findChip, tdChip]) {
                if (c?.active) {
                    try { popScale(c, 1.18); } catch (_) { /* tween not loaded */ }
                }
            }
        }
        this._lastDisplayedLevel = level;
    }

    /**
     * User tapped a match card's Join (or Spectate, in Live Now mode) button.
     *
     *  • LIVE Now mode → route to SpectatorPanel (unchanged).
     *  • OPEN lobby mode → open JoinMatchConfirmOverlay (Phase A) populated
     *    with the lobby summary. On Confirm, _onJoinConfirmGoTap routes to
     *    TokenDuelPanel in join-mode so the user can pick 3 tokens then tap
     *    "Join Match" to commit the on-chain join.
     */
    private _onMatchCardJoinClick(rowIdx: number): void {
        const matchPda = this._matchCardRowMatchPdas[rowIdx];
        if (!matchPda) {
            console.log(`${TAG} _onMatchCardJoinClick | row=${rowIdx} no_match_bound`);
            return;
        }
        if (this._matchBrowser?.getMode() === 'live') {
            console.log(`${TAG} _onMatchCardJoinClick | LIVE_SPECTATE row=${rowIdx} match=${matchPda}`);
            this._hideFindMatchPanel();
            this._onOpenSpectator(matchPda);
            return;
        }
        const allRows = this._matchBrowser?.getRows() ?? [];
        const target = allRows.find((m) => m.pda === matchPda);
        if (!target) {
            console.log(`${TAG} _onMatchCardJoinClick | row=${rowIdx} match_not_in_browser_rows`);
            return;
        }
        if (this._matchCardRowMine[rowIdx]) {
            console.log(`${TAG} _onMatchCardJoinClick | row=${rowIdx} RESUME_OWN match=${matchPda}`);
            this._resumeOwnLobby(target);
            return;
        }
        console.log(`${TAG} _onMatchCardJoinClick | row=${rowIdx} → confirm_overlay match=${matchPda} mode=${target.mode} tier=${target.wagerTier}`);
        this._showJoinConfirmOverlay(target);
    }

    /**
     * Re-enter the WaitingPanel for a lobby we already created. Called from
     * the Open Lobbies "Resume" action; restarts the poll loop so a status
     * flip to Active still pops the host into the game.
     */
    private _resumeOwnLobby(m: MatchState): void {
        console.log(`${TAG} _resumeOwnLobby | match=${m.pda} mode=${m.mode} tier=${m.wagerTier}`);
        const modeIdMap: Record<number, 'oneVone' | 'trio' | 'fourPlayer' | 'eightPlayer'> = {
            0: 'oneVone', 1: 'trio', 2: 'fourPlayer', 3: 'eightPlayer',
        };
        const winIdMap: Record<number, TimeWindowId> = { 0: '30s', 1: '1m', 2: '5m', 3: '1h', 4: '24h', 5: '7d' };
        const modeKey = modeIdMap[m.mode] ?? 'oneVone';
        this._pickerSelectedMode = modeKey;
        this._pickerSelectedWagerIndex = m.wagerTier;
        this._pickerSelectedWindow = winIdMap[m.timeWindow] ?? '1h';
        this._pickerSelectedTrack = 'real';
        this._realMatchMode = m.mode;
        this._realMatchWagerTier = m.wagerTier;
        this._realMatchWagerLamports = Number(m.wagerLamports);
        this._activeRealMatchPda = m.pda;
        this._hideFindMatchPanel();
        const modeDef = MODES[modeKey] ?? MODES.oneVone;
        this._showWaitingPanel({
            mode: modeDef.label,
            wagerSol: Number(m.wagerLamports) / 1e9,
            track: 'real',
            status: `Hosting · waiting for opponents…`,
            requiredPlayers: modeDef.requiredPlayers,
        });
        if (this._waitingProgressLabel) {
            this._waitingProgressLabel.string = `${m.playerCount}/${modeDef.requiredPlayers} players · 0:00 / 2:00`;
        }
        (async () => {
            const outcome = await this._runRealPollLoop(m.pda);
            if (outcome === 'active') {
                this._pendingRealMatch = true;
                this._hideWaitingPanel();
                this._setStakeClusterVisible(true);
                this._refreshSquadActionButtons();
                showToast('Opponent found — tap Commit to start');
            } else if (outcome === 'timeout') {
                if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'No opponent in 2 min — Play Bot or Cancel+Refund';
            } else if (outcome === 'settled' || outcome === 'cancelled') {
                this._activeRealMatchPda = null;
                this._hideWaitingPanel();
                showToast(outcome === 'settled' ? 'Match already settled' : 'Match cancelled');
            }
        })().catch((e) => {
            console.log(`${TAG} _resumeOwnLobby | POLL_ERROR ${e?.message ?? e}`);
            if (this._waitingStatusLabel) this._waitingStatusLabel.string = `Error: ${e?.message ?? e}`;
        });
    }

    /**
     * Populate + reveal the JoinMatchConfirmOverlay for the chosen lobby.
     * Card content is fully driven from the MatchState so a stale overlay
     * can never show wrong data.
     */
    private _showJoinConfirmOverlay(target: import('../../token-duel/scripts/MatchRpc').MatchState): void {
        if (!this._joinConfirmOverlay) {
            console.log(`${TAG} _showJoinConfirmOverlay | NO_OVERLAY — falling back to direct join`);
            // Defensive fallback: if scene is missing the overlay, treat the
            // card tap as Confirm so the user isn't blocked.
            this._pickerJoinTarget = target;
            this._hideFindMatchPanel();
            this._showTokenDuel();
            return;
        }
        this._joinConfirmTarget = target;
        const modeNames: Record<number, string> = { 0: '1v1', 1: '4P FFA', 2: '8P Royale', 3: 'BR 10' };
        const modeColors: Record<number, [number, number, number]> = {
            0: [153, 69, 255],   // violet
            1: [20, 241, 149],   // teal
            2: [255, 180, 84],   // amber
            3: [255, 92, 138],   // rose
        };
        if (this._joinConfirmModeLabel) this._joinConfirmModeLabel.string = modeNames[target.mode] ?? `mode ${target.mode}`;
        if (this._joinConfirmModeBadge) {
            const tint = modeColors[target.mode] ?? [153, 69, 255];
            const spr = this._joinConfirmModeBadge.getComponent(Sprite);
            if (spr) spr.color = new Color(tint[0], tint[1], tint[2], 220);
        }
        // Track chip — only Real lobbies appear in the on-chain feed today,
        // but keep this future-proof for paper-track pots when added.
        if (this._joinConfirmTrackLabel) this._joinConfirmTrackLabel.string = 'REAL';
        const wagerLabel = WAGER_TIERS_LABELS[target.wagerTier] ?? `tier ${target.wagerTier}`;
        if (this._joinConfirmWagerHero) this._joinConfirmWagerHero.string = wagerLabel;
        const winLabel = ['30s race', '1m race', '5m race', '1h race', '24h race', '7d race'][target.timeWindow] ?? '? race';
        if (this._joinConfirmWindowLabel) this._joinConfirmWindowLabel.string = `⏱  ${winLabel}`;
        if (this._joinConfirmCapacityLabel) this._joinConfirmCapacityLabel.string = `${target.playerCount}/${target.requiredPlayers} players`;
        const hostName = this._getDisplayName(target.players[0]);
        if (this._joinConfirmHostLabel) this._joinConfirmHostLabel.string = `Host  ${hostName}`;
        const ageSec = Math.max(0, Date.now() / 1000 - Number(target.createdAt));
        const ageStr = ageSec < 60
            ? `${Math.floor(ageSec)}s ago`
            : ageSec < 3600
                ? `${Math.floor(ageSec / 60)}m ${Math.floor(ageSec) % 60}s ago`
                : `${Math.floor(ageSec / 3600)}h ago`;
        if (this._joinConfirmAgeLabel) this._joinConfirmAgeLabel.string = ageStr;
        // Capacity bar — tween scaleX from 0 to (count/required) for the
        // dopamine "fill" effect.
        if (this._joinConfirmCapacityBarFill) {
            const fillPct = target.requiredPlayers > 0
                ? Math.min(1, (target.playerCount + 1) / target.requiredPlayers) // +1 to preview "after I join"
                : 0;
            const fillNode = this._joinConfirmCapacityBarFill;
            fillNode.scale = new Vec3(0, 1, 1);
            tween(fillNode).to(0.45, { scale: new Vec3(fillPct, 1, 1) }, { easing: 'cubicOut' }).start();
        }
        // Show + fade-in.
        this._joinConfirmOverlay.active = true;
        try { popScale(this._joinConfirmCard ?? this._joinConfirmOverlay, 1.04); } catch (_) { /* tween module not loaded */ }
        console.log(`${TAG} _showJoinConfirmOverlay | match=${target.pda} mode=${target.mode} tier=${target.wagerTier}`);
    }

    private _hideJoinConfirmOverlay(): void {
        if (!this._joinConfirmOverlay) return;
        this._joinConfirmOverlay.active = false;
        this._joinConfirmTarget = null;
        console.log(`${TAG} _hideJoinConfirmOverlay`);
    }

    /**
     * User confirmed the join — lock the target, leave the lobby, and route
     * to TokenDuelPanel in join-mode where they pick 3 tokens then commit
     * via the relabeled Join Match button.
     */
    private _onJoinConfirmGoTap(): void {
        const target = this._joinConfirmTarget;
        if (!target) {
            console.log(`${TAG} _onJoinConfirmGoTap | NO_TARGET`);
            this._hideJoinConfirmOverlay();
            return;
        }
        console.log(`${TAG} _onJoinConfirmGoTap | match=${target.pda} mode=${target.mode} tier=${target.wagerTier}`);
        this._pickerJoinTarget = target;
        // Pre-cache the lobby's mode/wager/window onto _picker* fields so
        // _refreshWagerControlRow + _showTokenDuel paint the join-mode state
        // immediately on arrival (before _onPickerStart runs).
        // Stage 3 mode rebalance: 0=1v1, 1=Trio, 2=4p, 3=8p.
        const modeIdMap: Record<number, string> = { 0: 'oneVone', 1: 'trio', 2: 'fourPlayer', 3: 'eightPlayer' };
        this._pickerSelectedMode = modeIdMap[target.mode] ?? 'oneVone';
        this._pickerSelectedWagerIndex = target.wagerTier;
        const winIdMap: Record<number, TimeWindowId> = { 0: '30s', 1: '1m', 2: '5m', 3: '1h', 4: '24h', 5: '7d' };
        this._pickerSelectedWindow = winIdMap[target.timeWindow] ?? '30s';
        this._pickerSelectedTrack = 'real';
        this._hideJoinConfirmOverlay();
        this._hideFindMatchPanel();
        this._showTokenDuel();
        this._refreshWagerControlRow();
    }

    /** "Host New Match" CTA on FindMatchPanel — opens picker in host mode. */
    private _onFindMatchHostTap(): void {
        if (this._squad?.filled !== 3) {
            if (this._findMatchStatusLabel) this._findMatchStatusLabel.string = 'Pick 3 tokens on the Token Duel screen first.';
            return;
        }
        console.log(`${TAG} _onFindMatchHostTap | HOST_FLOW`);
        this._pickerHostMode = true;
        // Default host lobbies to Real-track since hosting paper is meaningless
        // (paper is instant). User can flip back to Paper if they want.
        this._pickerSelectedTrack = 'real';
        this._hideFindMatchPanel();
        // Open the picker. AppUI._refreshModePickerUi tints chips per state.
        if (this._modePickerOverlay) {
            this._modePickerOverlay.active = true;
            this._refreshModePickerUi();
        }
    }

    private _refreshModePickerUi(): void {
        // 2026-04-27 — Guest OR bot mode hides Paper/Real toggle (always paper).
        // Bot mode keeps the Wager readout visible (shows "FREE · Bot Match"
        // via _refreshWagerControlRow); guest hides it entirely.
        const hideTrack = this._isGuest() || this._pickerBotMode;
        if (hideTrack) {
            this._pickerSelectedTrack = 'paper';
            if (this._pickerPaperToggle) this._pickerPaperToggle.node.active = false;
            if (this._pickerRealToggle)  this._pickerRealToggle.node.active = false;
            // Track section header label — find by name (emitted by scene-gen
            // as 'PickerSectionLabel_Track' top-level child of ModePickerOverlay).
            const trackHdr = this._modePickerOverlay?.getChildByName('PickerSectionLabel_Track');
            if (trackHdr) trackHdr.active = false;
            if (this._isGuest()) {
                if (this._pickerWagerReadout) this._pickerWagerReadout.node.active = false;
                for (const btn of this._pickerWagerButtons.values()) btn.node.active = false;
            } else {
                // Bot mode — keep wager readout visible (shows "FREE · Bot Match")
                if (this._pickerWagerReadout) this._pickerWagerReadout.node.active = true;
                for (const btn of this._pickerWagerButtons.values()) btn.node.active = false;
            }
        } else {
            if (this._pickerPaperToggle) this._pickerPaperToggle.node.active = true;
            if (this._pickerRealToggle)  this._pickerRealToggle.node.active = true;
            const trackHdr = this._modePickerOverlay?.getChildByName('PickerSectionLabel_Track');
            if (trackHdr) trackHdr.active = true;
            if (this._pickerWagerReadout) this._pickerWagerReadout.node.active = true;
            for (const btn of this._pickerWagerButtons.values()) btn.node.active = true;
        }
        // 2026-04-27 — Shift Difficulty / Wager / Start / Status nodes UP by
        // 150 px when Track is hidden, so we don't leave a gap. Idempotent —
        // each call sets absolute position from a known base.
        const SHIFT = hideTrack ? 150 : 0;
        const setY = (n: Node | null | undefined, baseY: number) => {
            if (!n) return;
            const p = n.position;
            n.setPosition(p.x, baseY + SHIFT, p.z);
        };
        setY(this._modePickerOverlay?.getChildByName('PickerSectionLabel_Difficulty'), -110);
        for (const btn of this._pickerDifficultyButtons.values()) setY(btn.node, -170);
        setY(this._pickerWagerReadout?.node, -280);
        setY(this._modePickerOverlay?.getChildByName('PickerStartButton'), -380);
        setY(this._modePickerOverlay?.getChildByName('PickerStatusLabel'), -460);
        // Stage 3 mode rebalance: scene keys ARE ModeIds now.
        const sceneToModeId: Record<string, string> = {
            oneVone:     'oneVone',
            trio:        'trio',
            fourPlayer:  'fourPlayer',
            eightPlayer: 'eightPlayer',
        };
        for (const [key, btn] of this._pickerModeButtons) {
            const modeId = sceneToModeId[key] ?? 'oneVone';
            const spr = btn.node.getComponent(Sprite);
            if (spr) {
                spr.color = modeId === this._pickerSelectedMode
                    ? new Color(48, 198, 155, 255)
                    : new Color(28, 34, 48, 255);
            }
        }
        // Wager tint. betting-duel: 8 chips. wagerKeys[i] → tier sceneToTierIdx[i].
        const wagerKeys = ['0001', '001', '005', '01', '025', '05', '1', '5'];
        const sceneToTierIdx = [5, 0, 1, 2, 3, 4, 6, 7];
        for (let w = 0; w < wagerKeys.length; w++) {
            const btn = this._pickerWagerButtons.get(wagerKeys[w]);
            if (!btn) continue;
            const spr = btn.node.getComponent(Sprite);
            if (spr) spr.color = sceneToTierIdx[w] === this._pickerSelectedWagerIndex
                ? new Color(48, 198, 155, 255)
                : new Color(28, 34, 48, 255);
        }
        // Part 9: TimeWindow chip tint
        for (const [wk, btn] of this._pickerWindowButtons) {
            const spr = btn.node.getComponent(Sprite);
            if (spr) spr.color = wk === this._pickerSelectedWindow ? new Color(48, 198, 155, 255) : new Color(28, 34, 48, 255);
        }
        // Track tint
        const paperSpr = this._pickerPaperToggle?.node.getComponent(Sprite);
        const realSpr = this._pickerRealToggle?.node.getComponent(Sprite);
        if (paperSpr) paperSpr.color = this._pickerSelectedTrack === 'paper' ? new Color(48, 198, 155, 255) : new Color(28, 34, 48, 255);
        if (realSpr)  realSpr.color  = this._pickerSelectedTrack === 'real'  ? new Color(48, 198, 155, 255) : new Color(28, 34, 48, 255);
        // Phase E — difficulty tint. Greyed when track=Real (host always
        // picks human opponents; difficulty only kicks in on the bot fallback).
        const difficultyVisible = this._pickerSelectedTrack === 'paper';
        for (const [d, btn] of this._pickerDifficultyButtons) {
            const spr = btn.node.getComponent(Sprite);
            if (!spr) continue;
            if (!difficultyVisible) {
                spr.color = new Color(50, 56, 72, 180);
            } else {
                spr.color = d === this._pickerSelectedDifficulty
                    ? new Color(48, 198, 155, 255)
                    : new Color(28, 34, 48, 255);
            }
        }
        // Status line
        if (this._pickerStatusLabel) {
            const modeLabel = MODES[this._pickerSelectedMode as keyof typeof MODES]?.label ?? '—';
            const windowLabel = TIME_WINDOWS[this._pickerSelectedWindow]?.label ?? '—';
            const trackLabel = this._pickerSelectedTrack === 'paper' ? `Paper · ${this._pickerSelectedDifficulty}` : 'Real';
            const label = `${modeLabel} · ${WAGER_TIERS_LABELS[this._pickerSelectedWagerIndex]} · ${windowLabel} · ${trackLabel}`;
            this._pickerStatusLabel.string = label;
        }
        if (this._pickerWagerReadout) {
            this._pickerWagerReadout.string = `Wager: ${WAGER_TIERS_LABELS[this._pickerSelectedWagerIndex]} · tap Start to confirm`;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  betting-duel polish — Wager control row (TokenDuelPanel bottom)
    // ═══════════════════════════════════════════════════════════════

    /** True when picker is in "join an existing match" mode (came from FindMatchPanel). */
    private _isJoinMode(): boolean {
        return this._pickerJoinTarget !== null;
    }

    /** True when picker is in "Bot Match" mode (came from Home Bot Match button). */
    private _isBotMode(): boolean {
        return this._pickerBotMode === true;
    }

    private _refreshWagerControlRow(): void {
        const filled = this._squad.filled;
        const ready = filled === 3;
        const join = this._isJoinMode();
        const bot = this._isBotMode();

        if (join && this._pickerJoinTarget) {
            // ── JOIN MODE — wager + mode pinned to the host's match. ──
            const target = this._pickerJoinTarget;
            const wagerLabel = WAGER_TIERS_LABELS[target.wagerTier] ?? '0.05 SOL';
            const hostShort = target.players[0]
                ? `${target.players[0].slice(0, 4)}…${target.players[0].slice(-4)}`
                : 'host';
            if (this._wagerValueButton) this._wagerValueButton.node.active = false;
            if (this._wagerDropdown) this._wagerDropdown.active = false;
            if (this._wagerBotChip) this._wagerBotChip.active = false;
            if (this._wagerLockChip) {
                this._wagerLockChip.active = true;
                if (this._wagerLockChipLabel) this._wagerLockChipLabel.string = `🔒 ${wagerLabel}`;
            }
            if (this._wagerStartButton) {
                this._wagerStartButton.interactable = ready;
                if (this._wagerStartLabel) {
                    this._wagerStartLabel.string = ready ? 'Join Match' : (filled === 0 ? 'Pick 3 tokens' : `Pick ${3 - filled} more`);
                }
            }
            if (this._wagerHintLabel) {
                this._wagerHintLabel.string = ready
                    ? `Joining ${hostShort}'s match · ${wagerLabel} · tap Join to commit`
                    : `Pick ${3 - filled} more token${3 - filled === 1 ? '' : 's'} to join`;
            }
            this._syncWagerStartPulse(ready);
            return;
        }

        if (bot) {
            // ── BOT MODE — paper · vs bots · free practice. No wager dropdown. ──
            if (this._wagerValueButton) this._wagerValueButton.node.active = false;
            if (this._wagerDropdown) this._wagerDropdown.active = false;
            if (this._wagerLockChip) this._wagerLockChip.active = false;
            if (this._wagerBotChip) {
                this._wagerBotChip.active = true;
                if (this._wagerBotChipLabel) this._wagerBotChipLabel.string = 'Free: Bot Match';
            }
            if (this._matchSetupStakeLabel) this._matchSetupStakeLabel.string = 'Free: Bot Match';
            if (this._wagerStartButton) {
                this._wagerStartButton.interactable = ready;
                if (this._wagerStartLabel) {
                    this._wagerStartLabel.string = ready ? 'Start Bot Match' : (filled === 0 ? 'Pick 3 tokens' : `Pick ${3 - filled} more`);
                }
            }
            if (this._wagerHintLabel) {
                this._wagerHintLabel.string = ready
                    ? 'Paper · vs Bots · free practice · tap to start'
                    : `Pick ${3 - filled} more token${3 - filled === 1 ? '' : 's'} to play bots`;
            }
            this._syncWagerStartPulse(ready);
            return;
        }

        // ── CREATE MODE — original Start Match (real / paper-real) flow. ──
        const label = WAGER_TIERS_LABELS[this._pickerSelectedWagerIndex] ?? '0.05 SOL';
        if (this._wagerValueButton) this._wagerValueButton.node.active = true;
        if (this._wagerLockChip) this._wagerLockChip.active = false;
        if (this._wagerBotChip) this._wagerBotChip.active = false;
        if (this._wagerValueLabel) this._wagerValueLabel.string = `${label}  ▾`;
        if (this._matchSetupStakeLabel) this._matchSetupStakeLabel.string = `Stake: ${label}`;
        if (this._wagerStartButton) {
            this._wagerStartButton.interactable = ready;
            if (this._wagerStartLabel) {
                this._wagerStartLabel.string = ready ? 'Start Match' : (filled === 0 ? 'Pick 3 tokens' : `Pick ${3 - filled} more`);
            }
        }
        if (this._wagerHintLabel) {
            this._wagerHintLabel.string = ready
                ? `Ready · ${label} · tap Start to launch`
                : `Pick ${3 - filled} more token${3 - filled === 1 ? '' : 's'} to start`;
        }
        this._syncWagerStartPulse(ready);
    }

    /**
     * Attach/detach the idle-pulse breathing tween on the primary CTA based on
     * whether the squad is full. Pulses while ready, stops when not. Tracks
     * state so we don't stack tweens across re-renders.
     */
    private _syncWagerStartPulse(ready: boolean): void {
        const node = this._wagerStartButton?.node;
        if (!node) return;
        if (ready && !this._wagerStartPulsing) {
            try { addIdlePulse(node); } catch (_) { /* ignore */ }
            this._wagerStartPulsing = true;
        } else if (!ready && this._wagerStartPulsing) {
            try { Tween.stopAllByTarget(node); } catch (_) { /* ignore */ }
            try { node.setScale(1, 1, 1); } catch (_) { /* ignore */ }
            this._wagerStartPulsing = false;
        }
    }

    /** Open/close the upward wager tier dropdown. */
    private _onWagerValueTap(): void {
        if (!this._wagerDropdown) return;
        const open = !this._wagerDropdown.active;
        this._wagerDropdown.active = open;
        console.log(`${TAG} _onWagerValueTap | open=${open} selected_idx=${this._pickerSelectedWagerIndex}`);
        this._syncBackdrop();
    }

    /** User picked a tier from the dropdown. */
    private _onWagerRowTap(dropdownIdx: number): void {
        // Dropdown row order is UX-driven (ascending $$ then INTRO last);
        // on-chain tier index is separate. Map via WAGER_DISPLAY_TO_TIER.
        const idx = WAGER_DISPLAY_TO_TIER[dropdownIdx] ?? dropdownIdx;
        if (idx < 0 || idx >= WAGER_TIERS_LAMPORTS.length) return;
        this._pickerSelectedWagerIndex = idx;
        console.log(`${TAG} _onWagerRowTap | row=${dropdownIdx} tier_idx=${idx} lamports=${WAGER_TIERS_LAMPORTS[idx]} label=${WAGER_TIERS_LABELS[idx]}`);
        if (this._wagerDropdown) this._wagerDropdown.active = false;
        this._refreshWagerControlRow();
        this._refreshModePickerUi();
        this._syncBackdrop();
    }

    /**
     * User tapped the Start Match / Join Match / Start Bot Match button.
     *
     *  • CREATE mode → opens ModePicker so the user picks mode/window/track.
     *  • JOIN mode (came from FindMatchPanel → confirm overlay) → skips
     *    ModePicker (host's lobby already decided those) → _onPickerStart
     *    fires _submitRealJoinMatch with explicitMatchPda.
     *  • BOT mode (came from Home Bot Match button) → skips ModePicker
     *    (track is already paper) → _onPickerStart fires the paper bot path.
     */
    private _onWagerStartTap(): void {
        const filled = this._squad.filled;
        if (filled !== 3) {
            // 2026-04-27 — when the label says "Pick X more"/"Pick 3 tokens",
            // route the tap into the existing squad-pick checkbox flow instead
            // of just toasting. _onSquadPickClick enters pick mode on the
            // first call and confirms (adds checked rows) on the second.
            console.log(`${TAG} _onWagerStartTap | NOT_READY filled=${filled}/3 → squadPickClick`);
            this._onSquadPickClick();
            return;
        }
        if (this._wagerDropdown) this._wagerDropdown.active = false;
        this._syncBackdrop();
        if (this._isJoinMode()) {
            console.log(`${TAG} _onWagerStartTap | JOIN_MODE skip_modepicker target=${this._pickerJoinTarget?.pda}`);
            this._onPickerStart();
            return;
        }
        // 2026-04-27 — Bot mode no longer skips the picker. User picks 3 tokens
        // in TokenDuelPanel, taps Start Duel → ModePicker opens (Track row hidden
        // per _refreshModePickerUi bot branch) → user picks mode/duration/difficulty
        // → tap Start Matching → match runs.
        console.log(`${TAG} _onWagerStartTap | OPEN_PICKER bot_mode=${this._isBotMode()} wager_idx=${this._pickerSelectedWagerIndex}`);
        if (this._modePickerOverlay) {
            this._modePickerOverlay.active = true;
            this._refreshModePickerUi();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 14 A4 — Popover tap-outside-close via Backdrop
    // ═══════════════════════════════════════════════════════════════

    /** Any popover open? Used to gate Backdrop visibility. */
    private _anyPopoverOpen(): boolean {
        return !!(
            (this._feedTabDropdownPopover && this._feedTabDropdownPopover.active) ||
            (this._minLiqPopoverNode && this._minLiqPopoverNode.active) ||
            (this._liqSortPopoverNode && this._liqSortPopoverNode.active) ||
            (this._columnsPopoverNode && this._columnsPopoverNode.active) ||
            (this._searchPopoverNode && this._searchPopoverNode.active) ||
            (this._wagerDropdown && this._wagerDropdown.active) ||
            (this._rowActionPopover && this._rowActionPopover.active)
        );
    }

    /** Show/hide the invisible backdrop based on popover state. */
    private _syncBackdrop(): void {
        if (!this._backdropNode) return;
        this._backdropNode.active = this._anyPopoverOpen();
    }

    /** User tapped outside any popover — close all popovers + hide backdrop. */
    private _onBackdropTap(): void {
        console.log(`${TAG} _onBackdropTap | closing all popovers`);
        if (this._feedTabDropdownPopover) this._feedTabDropdownPopover.active = false;
        if (this._minLiqPopoverNode) this._minLiqPopoverNode.active = false;
        if (this._liqSortPopoverNode) this._liqSortPopoverNode.active = false;
        if (this._columnsPopoverNode) { this._columnsPopoverNode.active = false; this._columnsPopoverOpen = false; }
        if (this._searchPopoverNode) this._searchPopoverNode.active = false;
        if (this._wagerDropdown) this._wagerDropdown.active = false;
        if (this._rowActionPopover) this._rowActionPopover.active = false;
        this._rowActionPendingRow = null;
        this._syncBackdrop();
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 14 B — Squad action buttons (Pick / Drop / Run)
    // ═══════════════════════════════════════════════════════════════

    /** Stake slider + chips + commit button toggled together. */
    private _setStakeClusterVisible(visible: boolean): void {
        const ids = ['StakeHeaderLabel', 'StakeValueLabel', 'StakeSlider',
                     'StakeChip_001', 'StakeChip_010', 'StakeChip_100',
                     'StakeCommitButton'];
        // betting-duel: legacy solo-commit flow is dead code on this branch.
        // The Run Squad → ModePicker → Start path is the only way to start a
        // match. Force hidden regardless of caller intent so stale call sites
        // (e.g. commit-then-start-game) can't resurrect the wrong UI.
        const force = false;
        for (const name of ids) {
            const n = this._tokenDuelPanel?.getChildByName(name);
            if (n) n.active = force;
        }
        this._squadLocked = visible;
        console.log(`${TAG} _setStakeClusterVisible | requested=${visible} applied=${force} (betting-duel force-hidden) squad_locked=${visible}`);
    }

    /**
     * betting-duel bug bash: hide every stack-jump-era scene node whose only
     * purpose is the solo `commit → startGame → claimPayout` flow. These
     * remain in the scene (to minimize diff + preserve node-name bindings)
     * but must never be visible on this branch. Called from _showTokenDuel,
     * _resetStakeFlow, and once during start() for belt-and-suspenders.
     */
    private _hideLegacyBettingDuelNodes(): void {
        if (!this._tokenDuelPanel) return;
        const ids = [
            'StakeHeaderLabel', 'StakeValueLabel', 'StakeSlider',
            'StakeChip_001', 'StakeChip_010', 'StakeChip_100',
            'StakeCommitButton',
            'StartGameButton',
            'ClaimPayoutButton',
            'GameOverLabel',
            // betting-duel polish: Holding1/2/3Label live at x=0 y=-400 on top
            // of the center squad slot. Legacy `_renderHoldings` repopulates
            // strings ("SOL,---,---") and flips them visible, bleeding
            // through the squad UI. Force-hide + stop the renderer (below).
            'Holding1Label', 'Holding2Label', 'Holding3Label',
        ];
        let hidden = 0;
        for (const name of ids) {
            const n = this._tokenDuelPanel.getChildByName(name);
            if (n && n.active) { n.active = false; hidden++; }
        }
        // Empty the binding array so `_renderHoldings` becomes a no-op on
        // this branch without losing back-compat with stack-jump master.
        this._holdingLabels = [];
        console.log(`${TAG} _hideLegacyBettingDuelNodes | DONE hidden=${hidden}/${ids.length} holding_labels_cleared=true`);
    }

    /**
     * Update labels + enable state for the 3 squad action buttons based on
     * the current squad + pick-mode state.
     */
    private _refreshSquadActionButtons(): void {
        const filled = this._squad.filled;
        const checking = this._squadPickChecked.size;
        // 2026-04-26 redesign — keep MatchSetupCard squad/hint labels in sync.
        if (this._matchSetupSquadLabel) {
            this._matchSetupSquadLabel.string = `Squad: ${filled}/3`;
        }
        if (this._matchSetupHintLabel) {
            const remaining = 3 - filled;
            this._matchSetupHintLabel.string = filled >= 3
                ? '✓ Squad full — tap Start Duel'
                : remaining === 1
                    ? 'Pick 1 more token to start'
                    : `Pick ${remaining} tokens to start`;
        }
        // Pick button
        if (this._squadPickLabel) {
            if (this._squadPickMode) {
                this._squadPickLabel.string = checking > 0 ? `+ ${checking} Confirm` : `Pick tokens…`;
            } else {
                this._squadPickLabel.string = filled >= 3 ? 'Squad full' : `+ Pick${filled ? ` (${filled}/3)` : ''}`;
            }
        }
        if (this._squadPickButton) {
            const spr = this._squadPickButton.node.getComponent(Sprite);
            if (spr) {
                const active = this._squadPickMode && checking > 0;
                spr.color = active ? new Color(48, 198, 155, 255)
                          : this._squadPickMode ? new Color(36, 76, 68, 255)
                          : filled >= 3 ? new Color(38, 44, 60, 255)
                          : new Color(48, 198, 155, 255);
            }
            this._squadPickButton.interactable = !this._squadLocked && (filled < 3 || this._squadPickMode);
        }
        // Drop button — hide entirely when squad is empty so the lone CTA below
        // (Start Match) is the unambiguous primary action. Show when ≥1 picked.
        if (this._squadDropButton) {
            this._squadDropButton.node.active = filled > 0;
            this._squadDropButton.interactable = filled > 0 && !this._squadLocked;
            const spr = this._squadDropButton.node.getComponent(Sprite);
            if (spr) spr.color = filled > 0 && !this._squadLocked ? new Color(40, 50, 68, 255) : new Color(26, 30, 42, 255);
        }
        if (this._squadDropLabel) this._squadDropLabel.string = filled > 0 ? `Manage Squad (${filled})` : 'Manage Squad';
        // Run button removed — wagerStartButton handles the same flow.
    }

    private _onSquadPickClick(): void {
        if (this._squadLocked) return;
        if (!this._squadPickMode) {
            this._squadPickMode = true;
            this._squadPickChecked.clear();
            console.log(`${TAG} _onSquadPickClick | ENTER_MODE allowance=${3 - this._squad.filled}`);
            this._refreshSquadActionButtons();
            this._renderFeedRows(this._currentFeedRows);
            return;
        }
        // Confirm.
        if (this._squadPickChecked.size === 0) {
            console.log(`${TAG} _onSquadPickClick | CONFIRM_NOOP`);
            return;
        }
        let added = 0;
        for (const mint of this._squadPickChecked) {
            const row = this._currentFeedRows.find((r) => r.address === mint);
            if (!row) continue;
            if (this._squad.add(row) >= 0) added++;
        }
        console.log(`${TAG} _onSquadPickClick | CONFIRM added=${added} filled=${this._squad.filled}`);
        if (added > 0) showToast(`Picked ${added}`);
        this._exitSquadPickMode();
    }

    private _exitSquadPickMode(): void {
        this._squadPickMode = false;
        this._squadPickChecked.clear();
        this._refreshSquadActionButtons();
        this._renderFeedRows(this._currentFeedRows);
    }

    private _onSquadDropClick(): void {
        if (this._squad.filled === 0 || this._squadLocked) return;
        console.log(`${TAG} _onSquadDropClick | OPEN_OVERLAY filled=${this._squad.filled}`);
        this._renderDropPills();
        if (this._squadDropOverlay) this._squadDropOverlay.active = true;
    }

    private _onSquadDropOverlayDismiss(): void {
        console.log(`${TAG} _onSquadDropOverlayDismiss | CLOSE`);
        if (this._squadDropOverlay) this._squadDropOverlay.active = false;
    }

    private _onSquadDropPillClick(i: number): void {
        const slot = this._squad.slots[i];
        if (!slot) return;
        console.log(`${TAG} _onSquadDropPillClick | DROP slot=${i} symbol="${slot.symbol}"`);
        this._squad.clearAt(i);
        this._renderDropPills();
        // If empty, auto-close overlay.
        if (this._squad.filled === 0) {
            if (this._squadDropOverlay) this._squadDropOverlay.active = false;
        }
        this._refreshSquadActionButtons();
    }

    private _renderDropPills(): void {
        for (let i = 0; i < 3; i++) {
            const pillLbl = this._squadDropPillLabels[i];
            const pillBtn = this._squadDropPills[i];
            const slot = this._squad.slots[i];
            if (!pillLbl || !pillBtn) continue;
            if (!slot) {
                pillBtn.node.active = false;
                continue;
            }
            pillBtn.node.active = true;
            const d = slot.change24hPct;
            const sign = d > 0 ? '+' : '';
            const pct = Number.isFinite(d) && d !== 0 ? `  ${sign}${d.toFixed(1)}%` : '';
            pillLbl.string = `✕  $${slot.symbol}${pct}`;
        }
    }

    // _onSquadRunClick removed 2026-04-26 — same flow as _onWagerStartTap.

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 14 C — Leaderboard + Portfolio entry points
    //  Phase N4 (2026-04-26): merged into a single hub. Trophy on Home
    //  routes through _onOpenHub which defaults to the Portfolio tab; the
    //  in-hub tab strip toggles between this panel and the Portfolio panel.
    // ═══════════════════════════════════════════════════════════════

    /** Phase N4: trophy on Home opens the merged hub (default = Portfolio). */
    private _onOpenHub(): void {
        this._hubActiveTab = 'portfolio';
        this._openPortfolioInternal();
        this._refreshHubTabTints();
    }

    /** Phase N4: in-hub tab strip — swap between Portfolio and Leaderboard
     *  panels without leaving the hub. Sub-tab state on each panel persists. */
    private _onHubTabClick(tab: 'portfolio' | 'leaderboard'): void {
        if (this._hubActiveTab === tab) return;
        this._hubActiveTab = tab;
        console.log(`${TAG} _onHubTabClick | tab=${tab}`);
        if (tab === 'portfolio') {
            if (this._leaderboardPanel) this._leaderboardPanel.active = false;
            this._openPortfolioInternal();
        } else {
            if (this._portfolioPanel) this._portfolioPanel.active = false;
            void this._openLeaderboardInternal();
        }
        // Slide the pill highlight (and glow shadow) to the active slot on
        // both panels in parallel so swaps land with the indicator already
        // in place.
        const targetX = tab === 'portfolio' ? -90 : +90;
        for (const n of [this._lbHubHighlight, this._pfHubHighlight,
                         this._lbHubGlow,      this._pfHubGlow]) {
            if (!n) continue;
            Tween.stopAllByTarget(n);
            tween(n).to(0.18, { position: new Vec3(targetX, 0, 0) },
                                { easing: 'cubicOut' }).start();
        }
        this._refreshHubTabTints();
    }

    /** Tint the 4 hub-tab labels (mirrors on both panels) based on
     *  _hubActiveTab. The pill background and animated highlight are drawn by
     *  Graphics in `_buildHubTabs`; the buttons themselves are invisible
     *  hit-areas, so only label colors flip here. */
    private _refreshHubTabTints(): void {
        const activeLbl   = new Color(12, 18, 26, 255);
        const inactiveLbl = new Color(255, 255, 255, 255);
        const tabs: Array<[Button | null, 'portfolio' | 'leaderboard']> = [
            [this._lbHubPortfolioTab,   'portfolio'],
            [this._lbHubLeaderboardTab, 'leaderboard'],
            [this._pfHubPortfolioTab,   'portfolio'],
            [this._pfHubLeaderboardTab, 'leaderboard'],
        ];
        for (const [btn, tabKey] of tabs) {
            if (!btn) continue;
            const lbl = btn.node.getChildByName('Label')?.getComponent(Label);
            if (lbl) lbl.color = this._hubActiveTab === tabKey ? activeLbl : inactiveLbl;
        }
    }

    /** Phase N4: build the hub-tab strip (Portfolio | Leaderboard) on a panel.
     *  Pill container at y=740 (above title at y=680). A Graphics-drawn
     *  background + animated highlight sit behind invisible button hit-areas.
     *  The selection highlight slides between slots in `_onHubTabClick`. */
    private _buildHubTabs(parent: Node): { portfolio: Button; leaderboard: Button } {
        const STRIP_W = 360, STRIP_H = 56;
        const TAB_W = 170, TAB_H = 44;
        const STRIP_Y = 740;
        const initialX = this._hubActiveTab === 'portfolio' ? -90 : +90;

        // Container — owns Bg / Glow / Highlight / Divider / two button hit-areas.
        const strip = new Node('HubTabStrip');
        parent.addChild(strip);
        strip.addComponent(UITransform).setContentSize(STRIP_W, STRIP_H);
        strip.setPosition(new Vec3(0, STRIP_Y, 0));

        // Pill background.
        const bg = new Node('HubBg');
        strip.addChild(bg);
        bg.addComponent(UITransform).setContentSize(STRIP_W, STRIP_H);
        const bgG = bg.addComponent(Graphics);
        bgG.fillColor = new Color(22, 28, 40, 255);
        bgG.roundRect(-STRIP_W / 2, -STRIP_H / 2, STRIP_W, STRIP_H, 28);
        bgG.fill();

        // Elevation glow — slightly larger than the highlight, low alpha.
        const glow = new Node('HubGlow');
        strip.addChild(glow);
        glow.addComponent(UITransform).setContentSize(180, 52);
        glow.setPosition(new Vec3(initialX, 0, 0));
        const glowG = glow.addComponent(Graphics);
        glowG.fillColor = new Color(48, 198, 155, 90);
        glowG.roundRect(-90, -26, 180, 52, 26);
        glowG.fill();

        // Active-tab highlight — the visible "filled" indicator.
        const highlight = new Node('HubHighlight');
        strip.addChild(highlight);
        highlight.addComponent(UITransform).setContentSize(TAB_W, TAB_H);
        highlight.setPosition(new Vec3(initialX, 0, 0));
        const hlG = highlight.addComponent(Graphics);
        hlG.fillColor = new Color(48, 198, 155, 255);
        hlG.roundRect(-TAB_W / 2, -TAB_H / 2, TAB_W, TAB_H, 22);
        hlG.fill();

        // Subtle vertical divider between the two slots.
        const divider = new Node('HubDivider');
        strip.addChild(divider);
        divider.addComponent(UITransform).setContentSize(1, 28);
        const divG = divider.addComponent(Graphics);
        divG.strokeColor = new Color(255, 255, 255, 30);
        divG.lineWidth = 1;
        divG.moveTo(0, -14);
        divG.lineTo(0, 14);
        divG.stroke();

        // Stash refs so the click handler can slide-tween highlight + glow.
        if (parent === this._leaderboardPanel) {
            this._lbHubHighlight = highlight;
            this._lbHubGlow = glow;
        } else {
            this._pfHubHighlight = highlight;
            this._pfHubGlow = glow;
        }

        // Invisible-hitbox button factory (visual is the Graphics layers
        // above). No Sprite on the button: SCALE transition uses UITransform
        // for hit detection, and an unframed Sprite on a runtime node can be
        // skipped by the renderer (project memory: "Sprites need _spriteFrame
        // references or colors won't render"), which would hide the label
        // child along with the node.
        const make = (name: string, label: string, x: number): Button => {
            const n = new Node(name);
            strip.addChild(n);
            n.addComponent(UITransform).setContentSize(TAB_W, TAB_H);
            const btn = n.addComponent(Button);
            btn.transition = Button.Transition.SCALE;
            btn.zoomScale = 0.96;
            n.setPosition(new Vec3(x, 0, 0));

            const lblN = new Node('Label');
            n.addChild(lblN);
            lblN.addComponent(UITransform).setContentSize(TAB_W - 10, TAB_H - 4);
            const lbl = lblN.addComponent(Label);
            lbl.string = label;
            lbl.fontSize = 20;
            lbl.lineHeight = 24;
            lbl.horizontalAlign = Label.HorizontalAlign.CENTER;
            lbl.verticalAlign = Label.VerticalAlign.CENTER;
            lbl.color = new Color(255, 255, 255, 255);
            return btn;
        };
        const portfolio   = make('HubTab_Portfolio',   'Portfolio',   -90);
        const leaderboard = make('HubTab_Leaderboard', 'Leaderboard', +90);
        portfolio.node.on(Button.EventType.CLICK,   () => this._onHubTabClick('portfolio'),   this);
        leaderboard.node.on(Button.EventType.CLICK, () => this._onHubTabClick('leaderboard'), this);
        // Sync button refs before tint so first paint hits the freshly-built
        // tabs (call sites also set these on the returned object, but doing
        // it here keeps `_refreshHubTabTints` idempotent across rebuilds).
        if (parent === this._leaderboardPanel) {
            this._lbHubPortfolioTab = portfolio;
            this._lbHubLeaderboardTab = leaderboard;
        } else {
            this._pfHubPortfolioTab = portfolio;
            this._pfHubLeaderboardTab = leaderboard;
        }
        // First paint: active dark on teal, inactive white on dark.
        this._refreshHubTabTints();
        return { portfolio, leaderboard };
    }

    /** Phase N4: Disconnect entry on Home — wallet path emits MWA_DISCONNECTED
     *  (already wired to _showLanding); guest path needs an explicit route. */
    private async _onDisconnectFromHome(): Promise<void> {
        console.log(`${TAG} _onDisconnectFromHome | START guest=${this._isGuest()}`);
        const wasGuest = this._isGuest();
        await this._onDisconnect();
        if (wasGuest) {
            this._guestId = null;
            try {
                const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
                ls?.removeItem?.('tokenduel:guest_id');
            } catch (_) { /* ignore */ }
            this._showLanding();
        }
    }

    private async _openLeaderboardInternal(): Promise<void> {
        if (!this._leaderboardPanel) return;
        console.log(`${TAG} _openLeaderboardInternal | OPEN mode=${this._lbFilterMode}`);
        // betting-duel polish: force-hide every other top-level panel so no
        // stale text (e.g. "Token Duel" title) bleeds behind the leaderboard
        // rows on device. `_setActivePanel` only knows about landing/home/
        // tokenDuel; this covers the full set.
        this._hideAllTopLevelPanelsExcept('leaderboard');
        this._leaderboardPanel.active = true;
        // Belt-and-suspenders: ensure the runtime hub-tab strip is visible.
        const lbStrip = this._leaderboardPanel.getChildByName('HubTabStrip');
        if (lbStrip) lbStrip.active = true;
        this._refreshLeaderboardTabTints();
        if (this._lbFilterMode === 4) {
            await this._refreshSeasonTab();
        } else {
            await this._refreshLeaderboardPanelRows();
        }
        // Session D Part 8: personal rank card below the rows.
        await this._refreshPersonalRankCard();
    }

    /**
     * Session D Part 7: user picked a mode tab on the LeaderboardPanel.
     * Part 10 pt2: sentinel modeU8=4 routes to season (This Week) render path.
     */
    private async _onLeaderboardTabClick(modeU8: number, tabKey: string): Promise<void> {
        if (this._lbFilterMode === modeU8) return;
        console.log(`${TAG} _onLeaderboardTabClick | mode=${modeU8} key=${tabKey}`);
        this._lbFilterMode = modeU8;
        this._refreshLeaderboardTabTints();
        if (modeU8 === 4) {
            await this._refreshSeasonTab();
        } else {
            await this._refreshLeaderboardPanelRows();
        }
        await this._refreshPersonalRankCard();
    }

    /**
     * Populate the PersonalRankCard below the leaderboard rows. Shows the user's
     * rank on the current mode (if in top-10) or "Not yet ranked · win to climb"
     * + their W–L / Level / P/L from on-chain UserStats. The "Play your first
     * match" CTA is shown only when the user is NOT in top-10.
     */
    private async _refreshPersonalRankCard(): Promise<void> {
        const card = this._leaderboardPanel?.getChildByName('PersonalRankCard');
        if (!card) return;
        const mwa = MWAManager.instance;
        const pubkey = mwa?.connectedPubkey ?? null;
        if (!pubkey) {
            card.active = false;
            console.log(`${TAG} _refreshPersonalRankCard | HIDE no_pubkey`);
            return;
        }
        card.active = true;

        const rankL = card.getChildByName('RankLabel')?.getComponent(Label);
        const statsL = card.getChildByName('StatsLabel')?.getComponent(Label);
        const ctaN = card.getChildByName('PlayCTAButton');

        let inTop10 = false;
        let rankStr = 'Not yet ranked · win to climb';
        try {
            const entries = await fetchLeaderboard(this._tdRpc, this._lbFilterMode);
            const mine = entries.findIndex((e) => e.player === pubkey);
            if (mine >= 0) {
                const mode = modeFromU8(this._lbFilterMode);
                rankStr = `Rank #${mine + 1} on ${mode.label}`;
                inTop10 = true;
            }
        } catch (e) {
            console.log(`${TAG} _refreshPersonalRankCard | LEADERBOARD_ERR ${e}`);
        }

        let statsStr = 'W–L —  ·  Level —  ·  P/L —';
        try {
            const stats = await loadRealStats(this._tdRpc, pubkey);
            if (stats.loaded) {
                const pnlSol = Number(stats.profitLamports) / 1e9;
                const pnlSign = pnlSol >= 0 ? '+' : '−';
                statsStr = `W–L ${stats.wins}-${stats.losses}  ·  Level ${stats.level}  ·  P/L ${pnlSign}${Math.abs(pnlSol).toFixed(3)} SOL`;
            }
        } catch (e) {
            console.log(`${TAG} _refreshPersonalRankCard | STATS_ERR ${e}`);
        }

        if (rankL) rankL.string = rankStr;
        if (statsL) statsL.string = statsStr;
        if (ctaN) ctaN.active = !inTop10;
        console.log(`${TAG} _refreshPersonalRankCard | mode=${this._lbFilterMode} pubkey=${pubkey.substring(0, 8)}… rank="${rankStr}" cta=${!inTop10}`);
    }

    /** Highlight the active mode tab (teal) and dim the others. The standalone
     *  ThisWeekChip (LBTab_season, modeU8=4) is styled separately so the
     *  segmented control can dim entirely while the chip lights up. */
    private _refreshLeaderboardTabTints(): void {
        const map: Record<number, string> = { 0: '1v1', 1: 'trio', 2: '4p', 3: '8p', 4: 'season' };
        const activeKey = map[this._lbFilterMode];
        const seasonActive = this._lbFilterMode === 4;
        for (const [key, btn] of this._lbTabButtons) {
            const spr = btn.node.getComponent(Sprite);
            if (!spr) continue;
            const isThisWeek = key === 'season';
            const isActive = key === activeKey;
            if (isThisWeek) {
                spr.color = isActive
                    ? new Color(48, 198, 155, 255)
                    : new Color(28, 34, 52, 255);
            } else {
                // When season is active, every mode tab dims to container surface.
                spr.color = (!seasonActive && isActive)
                    ? new Color(48, 198, 155, 255)
                    : new Color(28, 34, 52, 255);
            }
            // Re-tint the inner Label too (3rd child of an mkBtnXY button).
            const labelChild = btn.node.children[2];
            const labelComp = labelChild?.getComponent(Label);
            if (labelComp) {
                const showActive = isThisWeek ? isActive : (!seasonActive && isActive);
                labelComp.color = showActive
                    ? new Color(255, 255, 255, 255)
                    : new Color(168, 174, 201, 255);
            }
        }
    }

    /** Fetch the active-mode Leaderboard PDA and render rows + TopPlayerCard. */
    private async _refreshLeaderboardPanelRows(): Promise<void> {
        const subtitleL = this._leaderboardPanel?.getChildByName('LeaderboardSubtitleLabel')?.getComponent(Label);
        if (subtitleL) {
            const label = modeFromU8(this._lbFilterMode).label;
            subtitleL.string = `${label} · This Week`;
        }
        let entries: ModeLeaderboardEntry[] = [];
        try {
            entries = await fetchLeaderboard(this._tdRpc, this._lbFilterMode);
        } catch (e) {
            console.log(`${TAG} _refreshLeaderboardPanelRows | ERROR mode=${this._lbFilterMode} error=${e}`);
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const populated = entries.filter((e) => e && e.height > 0);
        this._renderLeaderboardChrome(
            populated.length > 0,
            populated[0]
                ? {
                    player: populated[0].player,
                    score: `+${populated[0].height}`,
                    elapsedSec: Math.max(0, nowSec - Number(populated[0].settledAt)),
                }
                : null,
        );
        for (let i = 0; i < this._lbRowNodes.length; i++) {
            const n = this._lbRowNodes[i];
            const entry = populated[i + 1];
            if (!entry) { n.active = false; continue; }
            this._renderLeaderboardRow(n, i + 1, {
                player: entry.player,
                score: `+${entry.height}`,
                elapsedSec: Math.max(0, nowSec - Number(entry.settledAt)),
            });
        }
        console.log(`${TAG} _refreshLeaderboardPanelRows | DONE mode=${this._lbFilterMode} entries=${entries.length} populated=${populated.length}`);
    }

    private _onLeaderboardBackClick(): void {
        if (!this._leaderboardPanel) return;
        console.log(`${TAG} _onLeaderboardBackClick | CLOSE`);
        this._leaderboardPanel.active = false;
        // Phase N4: a fresh hub re-entry should always land on Portfolio.
        this._hubActiveTab = 'portfolio';
        this._setActivePanel('home');
    }

    /** Empty-state CTA + PersonalRankCard "Play" CTA — close leaderboard,
     *  open the FindMatch lobby browser. Mirrors the back-out path used on
     *  PersonalRankCard, then enters FindMatch. */
    private _onLeaderboardCTAToFindMatch(): void {
        if (!this._leaderboardPanel) return;
        console.log(`${TAG} _onLeaderboardCTAToFindMatch | OPEN_FINDMATCH`);
        this._leaderboardPanel.active = false;
        this._showFindMatchPanel();
    }

    /** Toggle TopPlayerCard + EmptyStateGroup based on whether any entries exist
     *  for the active mode/season. Called by both the mode and season refresh
     *  paths so the empty-state predicate stays in one place. */
    private _renderLeaderboardChrome(
        hasAny: boolean,
        leader: { player: string; score: string; elapsedSec: number } | null,
    ): void {
        const top = this._leaderboardPanel?.getChildByName('TopPlayerCard');
        const empty = this._leaderboardPanel?.getChildByName('EmptyStateGroup');
        if (top) top.active = hasAny && !!leader;
        if (empty) empty.active = !hasAny;
        if (top && leader) {
            const playerL = top.getChildByName('PlayerLabel')?.getComponent(Label);
            const scoreL = top.getChildByName('ScoreLabel')?.getComponent(Label);
            const elapsedL = top.getChildByName('ElapsedLabel')?.getComponent(Label);
            if (playerL) playerL.string = this._fmtMintShort(leader.player);
            if (scoreL) scoreL.string = leader.score;
            if (elapsedL) elapsedL.string = this._fmtElapsed(leader.elapsedSec);
        }
    }

    private _renderLeaderboardRow(
        n: Node,
        rankNum: number,
        entry: { player: string; score: string; elapsedSec: number },
    ): void {
        n.active = true;
        const rankL = n.getChildByName('RankLabel')?.getComponent(Label);
        const playerL = n.getChildByName('PlayerLabel')?.getComponent(Label);
        const scoreL = n.getChildByName('ScoreLabel')?.getComponent(Label);
        const elapsedL = n.getChildByName('ElapsedLabel')?.getComponent(Label);
        if (rankL) {
            rankL.string = `#${rankNum + 1}`;
            // Top-3 ranks (silver / bronze for #2 / #3) get rank-color tint;
            // others stay text.mid. Rank-1 lives in TopPlayerCard.
            rankL.color = rankNum === 1 ? new Color(216, 221, 240, 255)
                        : rankNum === 2 ? new Color(224, 138, 74, 255)
                        :                 new Color(168, 174, 201, 255);
        }
        if (playerL) playerL.string = this._fmtMintShort(entry.player);
        if (scoreL) scoreL.string = entry.score;
        if (elapsedL) elapsedL.string = this._fmtElapsed(entry.elapsedSec);
    }

    private _fmtElapsed(diffSec: number): string {
        return diffSec < 60 ? `${diffSec}s ago`
             : diffSec < 3600 ? `${Math.floor(diffSec / 60)}m ago`
             : diffSec < 86400 ? `${Math.floor(diffSec / 3600)}h ago`
             : `${Math.floor(diffSec / 86400)}d ago`;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 10 pt2 — Season tab (🏆 This Week) render path
    // ═══════════════════════════════════════════════════════════════

    /**
     * Fetch the current Season PDA and render entries into the same TopPlayerCard
     * + LBRow_* pool the mode tabs use, but with a `wins` column instead of
     * `height`. Updates the subtitle to "All modes · This Week".
     */
    private async _refreshSeasonTab(): Promise<void> {
        const subtitleL = this._leaderboardPanel?.getChildByName('LeaderboardSubtitleLabel')?.getComponent(Label);
        if (subtitleL) subtitleL.string = 'All modes · This Week';
        let season: SeasonState | null = null;
        try {
            season = await getCurrentSeason(this._tdRpc);
        } catch (e) {
            console.log(`${TAG} _refreshSeasonTab | ERROR ${e}`);
        }
        const entries: SeasonEntry[] = season?.entries ?? [];
        const nowSec = Math.floor(Date.now() / 1000);
        const populated = entries.filter((e) => e && e.wins > 0);
        this._renderLeaderboardChrome(
            populated.length > 0,
            populated[0]
                ? {
                    player: populated[0].player,
                    score: `${populated[0].wins}w`,
                    elapsedSec: Math.max(0, nowSec - Number(populated[0].at)),
                }
                : null,
        );
        for (let i = 0; i < this._lbRowNodes.length; i++) {
            const n = this._lbRowNodes[i];
            const e = populated[i + 1];
            if (!e) { n.active = false; continue; }
            this._renderLeaderboardRow(n, i + 1, {
                player: e.player,
                score: `${e.wins}w`,
                elapsedSec: Math.max(0, nowSec - Number(e.at)),
            });
        }
        console.log(`${TAG} _refreshSeasonTab | DONE season_id=${season?.seasonId ?? 'null'} entries=${entries.length} populated=${populated.length}`);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 10 pt2 — DailyChallengePanel hydration + render
    // ═══════════════════════════════════════════════════════════════

    /**
     * Short status for the Home DailyStreakStrip — one fetch, fail-soft on
     * missing PDAs (pre-bootstrap) or missing UserStats (v1 not migrated yet).
     */
    private async _hydrateDailyChallengeWidget(): Promise<void> {
        // 2026-04-26 lobby restructure: DailyStreakStrip now hosts 5 chip
        // groups (DAY / CHALLENGES / SEASON / POOL / RAKE). Write each chip
        // value via _setChallengeChips. Rake chip is hydrated by
        // _refreshRakeChip async; pass the cached value here.
        const pubkey = MWAManager.instance?.connectedPubkey ?? null;
        if (!pubkey) {
            this._setChallengeChips({ day: '—', challenges: '—', season: '—', pool: '—', rake: this._cachedRakeText });
            return;
        }
        try {
            const [stats, dc, seasonRank, season] = await Promise.all([
                getUserStats(this._tdRpc, pubkey),
                getCurrentDailyChallenge(this._tdRpc),
                getUserSeasonRank(this._tdRpc, pubkey),
                getCurrentSeason(this._tdRpc),
            ]);
            const streak = stats?.currentStreak ?? 0;
            const bitsDone = stats ? countCompleted(stats.dailyChallengesBitmask) : 0;
            const total = dc?.challenges.length ?? 3;
            const rank = seasonRank ? `#${seasonRank.rank}` : '—';
            // Phase N4 — emit challenge_done for each newly-completed bit.
            const newMask = stats?.dailyChallengesBitmask ?? 0;
            const oldMask = this._lastDailyChallengeMask;
            if (oldMask !== -1 && newMask > oldMask && dc?.challenges) {
                for (let i = 0; i < dc.challenges.length; i++) {
                    const wasDone = (oldMask & (1 << i)) !== 0;
                    const nowDone = (newMask & (1 << i)) !== 0;
                    if (!wasDone && nowDone) {
                        const challenge = dc.challenges[i];
                        const reward = (challenge as any)?.rewardXp ?? (challenge as any)?.reward_xp ?? 0;
                        this._emitNotification('challenge_done', 'Challenge done!',
                            `${describeChallenge(challenge)} · +${reward} XP`,
                            { payload: { index: i }, dedupeKey: `challenge:${i}:${(dc as any).dayId ?? 0}` });
                    }
                }
            }
            this._lastDailyChallengeMask = newMask;
            // Phase J3 — surface season prize pool size when available. Pool
            // = 20% of total_rake_accumulated paid weekly to top-3.
            let poolStr = '—';
            if (season && season.totalRakeAccumulated > 0n) {
                const poolLamports = Number(season.totalRakeAccumulated) * 0.20;
                const poolSol = poolLamports / 1e9;
                poolStr = `${poolSol.toFixed(3)} SOL`;
            }
            this._setChallengeChips({
                day: String(streak),
                challenges: `${bitsDone}/${total}`,
                season: rank,
                pool: poolStr,
                rake: this._cachedRakeText,
            });
            this._updateStreakFlame(streak);
        } catch (e) {
            console.log(`${TAG} _hydrateDailyChallengeWidget | ERROR ${e}`);
            this._setChallengeChips({ day: '1', challenges: '0/3', season: '—', pool: '—', rake: this._cachedRakeText });
        }
    }

    /** Render the full DailyChallengePanel: streak card, 3 challenge rows, season summary. */
    private async _refreshDailyChallengePanel(): Promise<void> {
        if (!this._dailyChallengePanel) return;
        const pubkey = MWAManager.instance?.connectedPubkey ?? null;
        let stats: UserStatsState | null = null;
        let dc: DailyChallengeState | null = null;
        let season: SeasonState | null = null;
        try {
            [stats, dc, season] = await Promise.all([
                pubkey ? getUserStats(this._tdRpc, pubkey) : Promise.resolve(null),
                getCurrentDailyChallenge(this._tdRpc),
                getCurrentSeason(this._tdRpc),
            ]);
        } catch (e) {
            console.log(`${TAG} _refreshDailyChallengePanel | FETCH_ERR ${e}`);
        }

        // Streak card. Phase 17 (item 4): count-up tween when streak goes
        // up. Mono digits (B5) hold position so the value climbs cleanly.
        const streakCard = this._dailyChallengePanel.getChildByName('DailyStreakCard');
        const streakDay = streakCard?.getChildByName('StreakDayLabel')?.getComponent(Label);
        const streakBest = streakCard?.getChildByName('StreakBestLabel')?.getComponent(Label);
        const newStreak = stats?.currentStreak ?? 0;
        if (streakDay) {
            const fmt = (n: number) => `Day ${Math.round(n)}`;
            if (this._lastShownStreakDay < 0 || newStreak <= this._lastShownStreakDay) {
                // First render OR streak unchanged/broken — instant set.
                streakDay.string = fmt(newStreak);
            } else {
                // Streak went up — animate count-up over 600ms cubicOut.
                this._animateCountUp(streakDay, this._lastShownStreakDay, newStreak, 0.6, fmt);
            }
            this._lastShownStreakDay = newStreak;
        }
        if (streakBest) streakBest.string = `Best: ${stats?.bestStreak ?? 0}`;

        // 3 challenge rows.
        const bitmask = stats?.dailyChallengesBitmask ?? 0;
        const emptyChallenge: ChallengeDef = { kind: 0, target: 0, rewardXp: 0 };
        for (let i = 0; i < 3; i++) {
            const c = dc?.challenges[i] ?? emptyChallenge;
            const descL = this._dailyChallengePanel.getChildByName(`ChallengeRow_${i}`)?.getChildByName(`ChallengeDescriptionLabel_${i}`)?.getComponent(Label);
            const rewardL = this._dailyChallengePanel.getChildByName(`ChallengeRow_${i}`)?.getChildByName(`ChallengeRewardLabel_${i}`)?.getComponent(Label);
            const checkL = this._dailyChallengePanel.getChildByName(`ChallengeRow_${i}`)?.getChildByName(`ChallengeCheckmark_${i}`)?.getComponent(Label);
            const done = ((bitmask >> i) & 1) === 1;
            if (descL) descL.string = dc ? describeChallenge(c) : '— (waiting for today\'s rotation)';
            if (rewardL) rewardL.string = `+${c.rewardXp} XP`;
            if (checkL) {
                checkL.string = done ? '✓' : '·';
                checkL.color = done ? new Color(48, 198, 155, 255) : new Color(90, 100, 120, 255);
            }
        }

        // Season summary card.
        const seasonCard = this._dailyChallengePanel.getChildByName('SeasonSummaryCard');
        const rankL = seasonCard?.getChildByName('SeasonRankLabel')?.getComponent(Label);
        const podiumL = seasonCard?.getChildByName('SeasonPodiumLabel')?.getComponent(Label);
        const prizeL = seasonCard?.getChildByName('SeasonPrizeLabel')?.getComponent(Label);
        let myRank = 0;
        let myWins = stats?.seasonWins ?? 0;
        if (season && pubkey) {
            const idx = season.entries.findIndex((e) => e.player === pubkey);
            if (idx >= 0) { myRank = idx + 1; myWins = season.entries[idx].wins; }
        }
        if (rankL) rankL.string = myRank > 0 ? `Rank #${myRank}  ·  ${myWins} wins` : `Unranked  ·  ${myWins} wins`;
        if (podiumL) {
            const top3 = (season?.entries ?? []).slice(0, 3);
            if (top3.length === 0) {
                podiumL.string = 'Podium: be first — win a match this week';
            } else {
                podiumL.string = top3.map((e, i) => `${i + 1}. ${this._fmtMintShort(e.player)} · ${e.wins}w`).join('   ');
            }
        }
        if (prizeL) {
            const rakeSol = season ? Number(season.totalRakeAccumulated) / 1e9 : 0;
            prizeL.string = season ? `Prize pool accruing: ${rakeSol.toFixed(3)} SOL (20% of rake)` : 'Season not initialized';
        }
        console.log(`${TAG} _refreshDailyChallengePanel | DONE streak=${stats?.currentStreak ?? 0} bits=${bitmask.toString(2)} season_entries=${season?.entries.length ?? 0}`);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 10 pt2 — SquadPresetsOverlay handlers
    // ═══════════════════════════════════════════════════════════════

    private _renderPresetRows(): void {
        if (!this._squadPresetsOverlay) return;
        this._renderedPresets = SquadPresets.list();
        const emptyL = this._squadPresetsOverlay.getChildByName('PresetsEmptyLabel');
        if (emptyL) emptyL.active = this._renderedPresets.length === 0;
        for (let i = 0; i < this._presetRowNodes.length; i++) {
            const rN = this._presetRowNodes[i];
            const p = this._renderedPresets[i];
            if (!p) { rN.active = false; continue; }
            rN.active = true;
            const nameL = rN.getChildByName(`PresetNameLabel_${i}`)?.getComponent(Label);
            const symL = rN.getChildByName(`PresetSymbolsLabel_${i}`)?.getComponent(Label);
            if (nameL) nameL.string = p.name;
            if (symL) {
                const syms = p.slots.map((s) => s.symbol || '?').join(' · ');
                const winSuffix = p.winCount > 0 ? `  ·  ${p.winCount}W` : '';
                symL.string = `${syms}${winSuffix}`;
            }
        }
    }

    private _onPresetsClose(): void {
        if (!this._squadPresetsOverlay) return;
        this._squadPresetsOverlay.active = false;
        if (this._presetNameModal) this._presetNameModal.active = false;
    }

    private _onPresetRowTap(idx: number): void {
        const p = this._renderedPresets[idx];
        if (!p) return;
        console.log(`${TAG} _onPresetRowTap | APPLY id=${p.id} name="${p.name}"`);
        this._applySquadFromSlots(p.slots);
        showToast(`Loaded "${p.name}"`);
        this._onPresetsClose();
    }

    private _onPresetDeleteTap(idx: number): void {
        const p = this._renderedPresets[idx];
        if (!p) return;
        console.log(`${TAG} _onPresetDeleteTap | id=${p.id} name="${p.name}"`);
        SquadPresets.delete(p.id);
        this._renderPresetRows();
    }

    private _onPresetSavePrompt(): void {
        const slots = this._squad.slots.filter((s) => s != null);
        if (slots.length !== 3) {
            showToast('Pick 3 tokens first');
            return;
        }
        if (!this._presetNameModal || !this._presetNameEditBox) return;
        this._presetNameModal.active = true;
        this._presetNameEditBox.string = '';
        try { this._presetNameEditBox.setFocus?.(); } catch (_) { /* ignore */ }
    }

    private _onPresetSaveConfirm(): void {
        const name = this._presetNameEditBox?.string?.trim() ?? '';
        if (!name) {
            showToast('Enter a name for the preset');
            return;
        }
        const slots = this._squad.slots.filter((s) => s != null);
        if (slots.length !== 3) {
            showToast('Squad no longer complete');
            this._onPresetSaveCancel();
            return;
        }
        const saved = SquadPresets.save(
            name,
            slots.map((s) => ({ mint: s!.address, symbol: s!.symbol, logoUri: s!.logoUri })),
        );
        if (saved) showToast(`Saved "${saved.name}"`);
        else showToast('Save failed');
        this._onPresetSaveCancel();
        this._renderPresetRows();
    }

    private _onPresetSaveCancel(): void {
        if (this._presetNameModal) this._presetNameModal.active = false;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 10 pt2 — Quick Play Defaults card (Settings)
    // ═══════════════════════════════════════════════════════════════

    /** Phase 27 — Toggle one QP popover, closing the other two (mutual exclusivity). */
    private _toggleQPPopover(which: 'mode' | 'window' | 'wager'): void {
        const popovers = {
            mode:   this._qpModePopover,
            window: this._qpWindowPopover,
            wager:  this._qpWagerPopover,
        };
        const target = popovers[which];
        if (!target) return;
        const willOpen = !target.active;
        // Close all first, then open target if needed.
        for (const k of Object.keys(popovers) as Array<keyof typeof popovers>) {
            const p = popovers[k];
            if (p) p.active = (k === which && willOpen);
        }
        console.log(`${TAG} _toggleQPPopover | which=${which} open=${willOpen}`);
    }

    private _closeAllQPPopovers(): void {
        if (this._qpModePopover)   this._qpModePopover.active = false;
        if (this._qpWindowPopover) this._qpWindowPopover.active = false;
        if (this._qpWagerPopover)  this._qpWagerPopover.active = false;
    }

    private _onQPModeClick(uiKey: string, logicalKey: string): void {
        const ls = this._readLocalStorage();
        ls?.setItem('tokenduel:qp.mode', logicalKey);
        this._syncPreference({ qpMode: logicalKey });
        console.log(`${TAG} _onQPModeClick | ui=${uiKey} logical=${logicalKey}`);
        this._closeAllQPPopovers();
        this._refreshQPCard();
    }

    private _onQPWindowClick(w: string): void {
        const ls = this._readLocalStorage();
        ls?.setItem('tokenduel:qp.window', w);
        this._syncPreference({ qpWindow: w });
        console.log(`${TAG} _onQPWindowClick | window=${w}`);
        this._closeAllQPPopovers();
        this._refreshQPCard();
    }

    private _onQPWagerClick(key: string, idx: number): void {
        const ls = this._readLocalStorage();
        const idxStr = idx.toString();
        ls?.setItem('tokenduel:qp.wager', idxStr);
        this._syncPreference({ qpWager: idxStr });
        console.log(`${TAG} _onQPWagerClick | key=${key} idx=${idx}`);
        this._closeAllQPPopovers();
        this._refreshQPCard();
    }

    private _onQPTrackClick(track: 'paper' | 'real'): void {
        const ls = this._readLocalStorage();
        ls?.setItem('tokenduel:qp.track', track);
        this._syncPreference({ qpTrack: track });
        console.log(`${TAG} _onQPTrackClick | track=${track}`);
        // Slide indicator with a 0.15s ease-out cubic tween (Phase 18 polish standard).
        const targetX = track === 'paper' ? -78 : 78;
        if (this._qpTrackIndicator) {
            Tween.stopAllByTarget(this._qpTrackIndicator);
            tween(this._qpTrackIndicator)
                .to(0.15, { position: new Vec3(targetX, 0, 0) }, { easing: 'cubicOut' })
                .start();
        }
        // Phase 30 — teal glow halo follows the indicator's x.
        const halo = this._qpTrackIndicator?.parent?.getChildByName('QPTrackGlowHalo');
        if (halo) {
            Tween.stopAllByTarget(halo);
            tween(halo)
                .to(0.15, { position: new Vec3(targetX, 0, 0) }, { easing: 'cubicOut' })
                .start();
        }
        this._refreshQPCard();
    }

    /** Phase 27 — Read LS and update dropdown value labels + indicator + label colors. */
    private _refreshQPCard(): void {
        const ls = this._readLocalStorage();
        const logicalMode = (ls?.getItem('tokenduel:qp.mode') ?? 'oneVone');
        const windowKey = ls?.getItem('tokenduel:qp.window') ?? '30s';
        const wagerIdx = parseInt(ls?.getItem('tokenduel:qp.wager') ?? '2', 10);
        const track = (ls?.getItem('tokenduel:qp.track') ?? 'paper');

        // Dropdown value labels (Stage 3: trio replaces br10).
        const modeLabels: Record<string, string> = { oneVone: '1v1', trio: 'Trio', fourPlayer: '4p', eightPlayer: '8p' };
        const wagerLabels = ['0.01 SOL','0.05 SOL','0.1 SOL','0.25 SOL','0.5 SOL'];
        // Phase 30 — value labels drop the inline ▾ glyph; an explicit `›`
        // chevron child sibling now signals "tap to open" on each row.
        if (this._qpModeValueLabel)   this._qpModeValueLabel.string   = `${modeLabels[logicalMode] ?? '1v1'}`;
        if (this._qpWindowValueLabel) this._qpWindowValueLabel.string = `${windowKey}`;
        if (this._qpWagerValueLabel)  this._qpWagerValueLabel.string  = `${wagerLabels[wagerIdx] ?? wagerLabels[2]}`;

        // Highlight active option in each popover with ▣ prefix.
        const uiMode = ({ oneVone: '1v1', trio: 'trio', fourPlayer: '4p', eightPlayer: '8p' } as Record<string, string>)[logicalMode] ?? '1v1';
        const wagerKey = ['001','005','01','025','05'][wagerIdx] ?? '01';
        const optLabels: Record<string, string> = {
            '1v1': '1v1', 'trio': 'Trio', '4p': '4p', '8p': '8p',
            '30s': '30s', '1m': '1m', '5m': '5m', '1h': '1h', '24h': '24h', '7d': '7d',
            '001': '0.01 SOL', '005': '0.05 SOL', '01': '0.1 SOL', '025': '0.25 SOL', '05': '0.5 SOL',
        };
        const paint = (map: Map<string, Button>, activeKey: string) => {
            for (const [k, b] of map) {
                const lbl = b.node.getChildByName('Label')?.getComponent(Label);
                if (lbl) lbl.string = (k === activeKey ? '▣  ' : '   ') + optLabels[k];
                const spr = b.node.getComponent(Sprite);
                if (spr) spr.color = k === activeKey ? new Color(28, 92, 78, 255) : new Color(28, 34, 48, 255);
            }
        };
        paint(this._qpModeOptionButtons, uiMode);
        paint(this._qpWindowOptionButtons, windowKey);
        paint(this._qpWagerOptionButtons, wagerKey);

        // Track pill indicator + label colors.
        if (this._qpTrackIndicator) {
            const targetX = track === 'paper' ? -78 : 78;
            // Snap on first paint (no ongoing tween); tween triggered only by tap.
            this._qpTrackIndicator.setPosition(targetX, 0, 0);
        }
        if (this._qpTrackPaperLabel) this._qpTrackPaperLabel.color = track === 'paper' ? new Color(255, 255, 255, 255) : new Color(160, 170, 190, 255);
        if (this._qpTrackRealLabel)  this._qpTrackRealLabel.color  = track === 'real'  ? new Color(255, 255, 255, 255) : new Color(160, 170, 190, 255);
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION D PART 8 — Settings panel
    // ═══════════════════════════════════════════════════════════════

    private async _onOpenSettingsClick(source: 'home' | 'tokenDuel'): Promise<void> {
        if (!this._settingsPanel) return;
        this._settingsReturnPanel = source;
        console.log(`${TAG} _onOpenSettingsClick | source=${source} guest=${this._isGuest()}`);
        if (source === 'home') this._homePanel.active = false;
        else this._tokenDuelPanel.active = false;
        this._settingsPanel.active = true;
        this._hydrateSettingsPanel();
        // Guest mode — hide wallet card + username editbox + delete account +
        // the Disconnect row (now inside AccountSettingsCard). Sound + haptics
        // + fee schedule stay (no setup required).
        const guest = this._isGuest();
        const setActive = (name: string, active: boolean) => {
            const n = this._settingsPanel?.getChildByName(name);
            if (n) n.active = active;
        };
        setActive('WalletCard',                  !guest);
        setActive('ProfileCard',                 !guest);  // username editbox lives here
        setActive('DeleteAccountSettingsButton', !guest);
        // Phase 29 — DisconnectSettingsButton now nests inside AccountSettingsCard.
        const accountCard = this._settingsPanel?.getChildByName('AccountSettingsCard');
        const discRow = accountCard?.getChildByName('DisconnectSettingsButton');
        if (discRow) discRow.active = !guest;
    }

    private _onSettingsBackClick(): void {
        if (!this._settingsPanel) return;
        console.log(`${TAG} _onSettingsBackClick | return=${this._settingsReturnPanel}`);
        this._settingsPanel.active = false;
        if (this._settingsReturnPanel === 'home') this._homePanel.active = true;
        else this._tokenDuelPanel.active = true;
    }

    /**
     * Populate wallet name + pubkey + balance + saved username on panel show.
     */
    private _hydrateSettingsPanel(): void {
        const mwa = MWAManager.instance;
        const pubkey = mwa?.connectedPubkey ?? null;
        const walletName = this._resolveWalletName();

        if (this._settingsWalletNameLabel) {
            // Phase 29 — wallet card shows "Connected · {wallet}" when authed,
            // "Not connected" otherwise. Status dot mirrors connection state.
            this._settingsWalletNameLabel.string = pubkey ? `Connected · ${walletName}` : 'Not connected';
        }
        const statusDot = this._settingsPanel?.getChildByName('WalletCard')?.getChildByName('WalletStatusDot');
        const statusDotSpr = statusDot?.getComponent(Sprite);
        if (statusDotSpr) {
            statusDotSpr.color = pubkey ? new Color(20, 241, 149, 255) : new Color(93, 100, 133, 255);
        }
        const copyBtn = this._settingsPanel?.getChildByName('WalletCard')?.getChildByName('CopyPubkeyButton');
        if (copyBtn) copyBtn.active = !!pubkey;
        if (this._settingsWalletPubkeyLabel) {
            this._settingsWalletPubkeyLabel.string = pubkey ? this._fmtMintShort(pubkey) : '—';
        }
        if (this._settingsWalletBalanceLabel) {
            this._settingsWalletBalanceLabel.string = '';
            if (pubkey) {
                // Fire-and-forget balance fetch; label updates when it returns.
                this._rpc.getBalance(pubkey).then((lamports) => {
                    if (!this._settingsWalletBalanceLabel) return;
                    const sol = (lamports ?? 0) / 1e9;
                    this._settingsWalletBalanceLabel.string = `${sol.toFixed(2)} SOL`;
                }).catch(() => {
                    if (this._settingsWalletBalanceLabel) this._settingsWalletBalanceLabel.string = '(balance unavailable)';
                });
            }
        }
        if (this._settingsUsernameEditBox) {
            const saved = this._loadUsername();
            this._settingsUsernameEditBox.string = saved;
            // DB Stage 2 — hydrate from backend if available (covers cross-device case).
            if (pubkey) {
                (async () => {
                    try {
                        const { getUsername } = await import('../../token-duel/scripts/UserRpc');
                        const remote = await getUsername(pubkey);
                        if (remote && this._settingsUsernameEditBox) {
                            this._settingsUsernameEditBox.string = remote;
                            this._saveUsername(remote);
                        }
                    } catch (e) {
                        console.log(`${TAG} settings hydrate username | err=${e}`);
                    }
                })();
            }
        }
        if (this._settingsUsernameSavedLabel) this._settingsUsernameSavedLabel.string = '';
        // Part 10 pt2: refresh Quick Play defaults card tints from localStorage.
        this._refreshQPCard();
        console.log(`${TAG} _onOpenSettingsClick | pubkey=${pubkey ? pubkey.substring(0, 8) + '…' : 'null'} wallet_name="${walletName}"`);
    }

    private _resolveWalletName(): string {
        // Phase 29 — never display a URL in the UI (the old MWA `walletUriBase`
        // returned strings like "https://jup.ag/solana-wallet-adapter" which
        // read as a debug leak). Prefer a clean package name / wallet name
        // (e.g. "Seed Vault", "Phantom"); fall back to a generic label.
        const mwa = MWAManager.instance as any;
        const cached = mwa?.cachedWalletPackage ?? mwa?.walletName;
        if (typeof cached === 'string' && cached.length > 0 && !/^https?:\/\//i.test(cached)) {
            return cached;
        }
        return 'Mobile Wallet Adapter';
    }

    /** Called on every keystroke — reset the "saved ✓" flash. */
    private _onUsernameTyping(): void {
        if (this._settingsUsernameSavedLabel) this._settingsUsernameSavedLabel.string = '';
    }

    /**
     * Commit username on editing-did-ended.
     *
     * DB Stage 2: writes to backend `users` table first (cross-device truth),
     * then mirrors to localStorage for sync access. If the backend rejects
     * (validation error / taken username), surfaces the error and keeps the
     * old local value. Falls back to localStorage-only when offline.
     */
    private _onUsernameCommit(): void {
        if (!this._settingsUsernameEditBox) return;
        const val = (this._settingsUsernameEditBox.string ?? '').trim();
        const pubkey = MWAManager.instance?.connectedPubkey;
        if (!pubkey) {
            // No wallet connected — keep local fallback path.
            this._saveUsername(val);
            if (this._settingsUsernameSavedLabel) {
                this._settingsUsernameSavedLabel.string = val ? `saved locally  "${val}"` : 'cleared';
            }
            return;
        }
        if (!val) {
            // User cleared — local-only for now (backend doesn't support null username via this endpoint).
            this._saveUsername('');
            if (this._settingsUsernameSavedLabel) this._settingsUsernameSavedLabel.string = 'cleared';
            return;
        }
        if (this._settingsUsernameSavedLabel) this._settingsUsernameSavedLabel.string = 'saving…';
        (async () => {
            try {
                const { setUsername } = await import('../../token-duel/scripts/UserRpc');
                const saved = await setUsername(pubkey, val);
                this._saveUsername(saved);
                this._displayNameCache.set(pubkey, saved);
                if (this._settingsUsernameSavedLabel) {
                    this._settingsUsernameSavedLabel.string = `saved ✓  "${saved}"`;
                }
                console.log(`${TAG} _onUsernameCommit | OK pubkey=${pubkey.slice(0, 8)}… name="${saved}"`);
            } catch (e: any) {
                const msg = String(e?.message ?? e);
                if (this._settingsUsernameSavedLabel) {
                    this._settingsUsernameSavedLabel.string = `✕ ${msg}`;
                }
                console.log(`${TAG} _onUsernameCommit | FAIL pubkey=${pubkey.slice(0, 8)}… err=${msg}`);
            }
        })();
    }

    private _loadUsername(): string {
        try {
            const v = (globalThis as any).sys?.localStorage?.getItem?.('tokenduel:username')
                   ?? (globalThis as any).localStorage?.getItem?.('tokenduel:username')
                   ?? '';
            return typeof v === 'string' ? v : '';
        } catch {
            return '';
        }
    }

    private _saveUsername(val: string): void {
        try {
            const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
            if (ls && typeof ls.setItem === 'function') {
                ls.setItem('tokenduel:username', val);
            }
        } catch (e) {
            console.log(`${TAG} _saveUsername | ERROR ${e}`);
        }
    }

    /**
     * Phase 29 — copy the connected wallet's pubkey to the system clipboard.
     * Uses navigator.clipboard.writeText (Chromium WebView available on every
     * supported Solana phone build). Falls back to a "copy failed" toast on
     * error. Fires soft haptics + a confirmation toast on success.
     */
    private _onCopyPubkey(): void {
        const pubkey = MWAManager.instance?.connectedPubkey;
        if (!pubkey) {
            showToast('No wallet connected');
            return;
        }
        const onOk = () => {
            try { Haptics.fire(HapticType.SOFT); } catch (_) { /* editor no-op */ }
            playSound('tap');
            showToast('Address copied');
        };
        try {
            const nav = (globalThis as any).navigator;
            if (nav?.clipboard?.writeText) {
                nav.clipboard.writeText(pubkey).then(onOk).catch((e: any) => {
                    console.log(`${TAG} _onCopyPubkey | clipboard FAIL ${e}`);
                    showToast('Copy failed');
                });
                return;
            }
            console.log(`${TAG} _onCopyPubkey | navigator.clipboard unavailable`);
            showToast('Clipboard unavailable');
        } catch (e) {
            console.log(`${TAG} _onCopyPubkey | ERROR ${e}`);
            showToast('Copy failed');
        }
    }

    /**
     * Phase G7 — friendly mapping for `MWAManager.lastError.code` so toasts
     * can surface what actually happened. Falls back to the raw message.
     */
    private _friendlyMwaError(code: string | undefined, msg: string | undefined): string {
        switch (code) {
            case 'NOT_CONNECTED':              return 'Wallet disconnected — reconnect and try again';
            case 'UNSUPPORTED':                return 'Your wallet does not support this operation';
            case 'EMPTY_SIGNATURE':            return 'Wallet returned no signature — try again';
            case 'INSUFFICIENT_FUNDS_FOR_RENT':return 'Wallet balance too low for rent — top up SOL and retry';
            case 'RPC_BROADCAST_FAILED':       return 'Network couldn\'t broadcast the tx — retry in a moment';
            case 'RPC_BLOCKHASH_FAILED':       return 'Could not fetch a recent blockhash — check your network';
            case 'TX_BUILD_FAILED':            return 'Transaction build failed — please report this';
            default:
                if (typeof msg === 'string' && msg.length > 0) {
                    if (/cancel|reject|deny|user/i.test(msg)) return 'Transaction cancelled in wallet';
                    if (/timeout/i.test(msg)) return 'Wallet didn\'t respond in time — open the app and try again';
                    return msg.length > 80 ? `${msg.slice(0, 80)}…` : msg;
                }
                return 'Wallet error — try again';
        }
    }

    /**
     * Phase G3 — display name resolution.
     *
     * For self (pubkey matches connected wallet), returns the user's saved
     * username if set. For other players (no name resolution available
     * client-side), returns a short truncated pubkey "ABCD…WXYZ". Always
     * returns a non-empty string.
     *
     * DB Stage 2: also resolves OTHER players' usernames via the backend
     * `users` table. Stale-while-revalidate: returns truncated pubkey
     * synchronously and kicks off an async fetch; next render picks up the
     * cached username. UserRpc.ts handles its own 60s in-memory TTL.
     */
    private _getDisplayName(pubkey: string | null | undefined): string {
        if (!pubkey || typeof pubkey !== 'string') return '?';
        // Guest pubkeys are local synthetic IDs (`guest_<hex>`), not real
        // base58 — render as "Guest" without trying to fetch a username.
        if (pubkey.startsWith('guest_')) return '👤 Guest';
        if (pubkey.length < 32) return '?';
        const myPubkey = MWAManager.instance?.connectedPubkey ?? '';
        if (myPubkey && myPubkey === pubkey) {
            const username = this._loadUsername();
            if (username && username.length > 0) return username;
        }
        // Sync local cache populated by async DB fetches.
        const cached = this._displayNameCache.get(pubkey);
        if (cached !== undefined) {
            return cached.length > 0 ? cached : `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
        }
        // Kick off async fetch; next render will use the cached value.
        void this._fetchDisplayName(pubkey);
        return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
    }

    /** Async fetch + populate _displayNameCache. Idempotent guard via _displayNameInflight. */
    private async _fetchDisplayName(pubkey: string): Promise<void> {
        if (this._displayNameInflight.has(pubkey)) return;
        this._displayNameInflight.add(pubkey);
        try {
            const { getUsername } = await import('../../token-duel/scripts/UserRpc');
            const name = await getUsername(pubkey);
            this._displayNameCache.set(pubkey, name ?? '');
        } catch (e) {
            // Mark as resolved-empty so we don't keep retrying every render.
            this._displayNameCache.set(pubkey, '');
            console.log(`${TAG} _fetchDisplayName | err pubkey=${pubkey.slice(0, 8)}… ${e}`);
        } finally {
            this._displayNameInflight.delete(pubkey);
        }
    }

    /** Phase N4: legacy entry name kept private; the only caller is the
     *  hub-tab handler (no Home button maps directly here anymore). */
    private _openPortfolioInternal(): void {
        if (!this._portfolioPanel) return;
        console.log(`${TAG} _openPortfolioInternal | OPEN top=${this._pfTopLevelTab} tab=${this._pfActiveTab}`);
        this._hideAllTopLevelPanelsExcept('portfolio');
        this._portfolioPanel.active = true;
        // Belt-and-suspenders: ensure the runtime hub-tab strip is visible.
        const pfStrip = this._portfolioPanel.getChildByName('HubTabStrip');
        if (pfStrip) pfStrip.active = true;
        if (this._pfPubkeyLabel) {
            const pk = MWAManager.instance?.connectedPubkey;
            this._pfPubkeyLabel.string = pk ? this._fmtMintShort(pk) : 'not connected';
        }
        this._refreshPortfolioTopLevel();
        this._refreshPortfolioTab();
        if (this._pfTopLevelTab === 'history') this._refreshMatchHistory(true);
    }

    private _onPortfolioBackClick(): void {
        if (!this._portfolioPanel) return;
        console.log(`${TAG} _onPortfolioBackClick | CLOSE`);
        this._portfolioPanel.active = false;
        // Phase N4: a fresh hub re-entry should always land on Portfolio.
        this._hubActiveTab = 'portfolio';
        this._setActivePanel('home');
    }

    private _onPortfolioTabClick(tab: 'paper' | 'real'): void {
        if (this._pfActiveTab === tab) return;
        this._pfActiveTab = tab;
        console.log(`${TAG} _onPortfolioTabClick | tab=${tab}`);
        this._refreshPortfolioTab();
    }

    private _refreshPortfolioTab(): void {
        // Tab button tint
        const paperSpr = this._pfPaperTab?.node.getComponent(Sprite);
        const realSpr = this._pfRealTab?.node.getComponent(Sprite);
        if (paperSpr) paperSpr.color = this._pfActiveTab === 'paper' ? new Color(48, 198, 155, 255) : new Color(28, 34, 48, 255);
        if (realSpr) realSpr.color = this._pfActiveTab === 'real' ? new Color(48, 198, 155, 255) : new Color(28, 34, 48, 255);
        const paperLbl = this._pfPaperTab?.node.getChildByName('Label')?.getComponent(Label);
        const realLbl = this._pfRealTab?.node.getChildByName('Label')?.getComponent(Label);
        if (paperLbl) paperLbl.color = this._pfActiveTab === 'paper' ? new Color(12, 18, 26, 255) : new Color(200, 210, 230, 255);
        if (realLbl) realLbl.color = this._pfActiveTab === 'real' ? new Color(12, 18, 26, 255) : new Color(200, 210, 230, 255);
        if (this._pfActiveTab === 'real') {
            const pubkey = MWAManager.instance?.connectedPubkey ?? '';
            if (!pubkey) {
                this._applyPortfolioRecord({
                    games: 0, wins: 0, losses: 0, profitLamports: 0,
                    xp: 0, level: 0, loaded: false,
                });
                return;
            }
            loadRealStats(this._tdRpc, pubkey).then((rec) => {
                this._applyPortfolioRecord(rec);
                console.log(`${TAG} _refreshPortfolioTab | REAL_LOADED games=${rec.games} wins=${rec.wins} losses=${rec.losses} xp=${rec.xp} level=${rec.level} loaded=${rec.loaded}`);
            }).catch((e) => {
                console.log(`${TAG} _refreshPortfolioTab | REAL_ERROR error=${e}`);
            });
            return;
        }
        // Paper tab uses localStorage; derive level client-side.
        const rec = Stats.load(this._pfActiveTab);
        this._applyPortfolioRecord({
            games: rec.games, wins: rec.wins, losses: rec.losses,
            profitLamports: rec.profitLamports, xp: rec.xp,
            level: levelFromXp(rec.xp), loaded: true,
        });
    }

    private _onPortfolioEmptyStateStart(): void {
        console.log(`${TAG} _onPortfolioEmptyStateStart | nav to TokenDuel host flow`);
        if (this._portfolioPanel) this._portfolioPanel.active = false;
        this._tokenDuelPanel.active = true;
        this._onStartMatch();
    }

    /**
     * Drives the hero P/L card, secondary cards, XP progress bar, and
     * empty-state visibility from a single normalized record. Called from
     * both Paper and Real branches of `_refreshPortfolioTab`.
     */
    private _applyPortfolioRecord(rec: {
        games: number; wins: number; losses: number;
        profitLamports: number; xp: number; level: number; loaded: boolean;
    }): void {
        const isEmpty = (this._pfActiveTab === 'real' && !rec.loaded) || rec.games === 0;
        if (this._pfEmptyState) this._pfEmptyState.active = isEmpty;
        for (const n of this._pfStatsViewNodes) n.active = !isEmpty;
        if (isEmpty) return;

        // Secondary cards (wins/losses/winrate/games) via existing map path.
        const winrate = rec.games > 0 ? `${Math.round((rec.wins / rec.games) * 100)}%` : '—';
        this._setPortfolioCards(new Map<string, string>([
            ['games',   String(rec.games)],
            ['wins',    String(rec.wins)],
            ['losses',  String(rec.losses)],
            ['winrate', winrate],
        ]));

        // Hero P/L value + edge tint.
        const pnlSol = rec.profitLamports / 1e9;
        const isPos = rec.profitLamports > 0;
        const isNeg = rec.profitLamports < 0;
        const green = new Color(48, 198, 155, 255);
        const red   = new Color(220, 90, 90, 255);
        const dim   = new Color(140, 150, 170, 255);
        const text  = new Color(244, 245, 249, 255);
        if (this._pfHeroPnLValue) {
            this._pfHeroPnLValue.string = isPos ? `+${pnlSol.toFixed(3)} SOL`
                                        : isNeg ? `${pnlSol.toFixed(3)} SOL`
                                                : '0 SOL';
            this._pfHeroPnLValue.color = isPos ? green : isNeg ? red : text;
        }
        if (this._pfHeroPnLEdge) this._pfHeroPnLEdge.color = isPos ? green : isNeg ? red : dim;
        if (this._pfHeroPnLSubtitle) {
            this._pfHeroPnLSubtitle.string =
                `Across ${rec.games} match${rec.games === 1 ? '' : 'es'}`;
        }

        // XP/Level card.
        const prog = levelProgress(rec.xp);
        if (this._pfXpValueLabel) this._pfXpValueLabel.string = `L${prog.level}`;
        if (this._pfXpProgressFill) {
            Tween.stopAllByTarget(this._pfXpProgressFill);
            tween(this._pfXpProgressFill)
                .to(0.4, { scale: new Vec3(prog.progress, 1, 1) }, { easing: 'cubicOut' })
                .start();
        }
        if (this._pfXpFooter) {
            const atLevel = xpForLevel(prog.level);
            const toLevel = xpForLevel(prog.level + 1);
            this._pfXpFooter.string = rec.xp === 0
                ? 'Earn XP by winning matches'
                : `${rec.xp - atLevel} / ${toLevel - atLevel} XP`;
        }
    }

    private _setPortfolioCards(values: Map<string, string>): void {
        for (const [key, val] of values) {
            const lbl = this._pfStatValues.get(key);
            if (lbl) lbl.string = val;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 9 — Portfolio top-level tabs + Match History
    // ═══════════════════════════════════════════════════════════════

    private _onPortfolioTopLevelTab(tab: 'stats' | 'history' | 'trophies'): void {
        if (this._pfTopLevelTab === tab) return;
        this._pfTopLevelTab = tab;
        console.log(`${TAG} _onPortfolioTopLevelTab | tab=${tab}`);
        if (tab === 'trophies') this._refreshTrophies();
        this._refreshPortfolioTopLevel();
        if (tab === 'stats') this._refreshPortfolioTab();
        if (tab === 'history') this._refreshMatchHistory(true);
    }

    /** Sync top-tab tints + toggle which view is visible. */
    private _refreshPortfolioTopLevel(): void {
        const tab = this._pfTopLevelTab;
        const active = new Color(48, 198, 155, 255);
        const inactive = new Color(28, 34, 48, 255);
        const activeLbl = new Color(12, 18, 26, 255);
        const inactiveLbl = new Color(200, 210, 230, 255);

        const tabMap: Array<[Button | null, typeof tab]> = [
            [this._pfStatsTab, 'stats'],
            [this._pfHistoryTab, 'history'],
            [this._pfTrophiesTab, 'trophies'],
        ];
        for (const [btn, tabKey] of tabMap) {
            if (!btn) continue;
            const spr = btn.node.getComponent(Sprite);
            if (spr) spr.color = tab === tabKey ? active : inactive;
            const lbl = btn.node.getChildByName('Label')?.getComponent(Label);
            if (lbl) lbl.color = tab === tabKey ? activeLbl : inactiveLbl;
        }

        const statsActive = tab === 'stats';
        for (const n of this._pfStatsViewNodes) n.active = statsActive;
        if (!statsActive && this._pfEmptyState) this._pfEmptyState.active = false;
        if (this._pfPaperTab) this._pfPaperTab.node.active = statsActive;
        if (this._pfRealTab)  this._pfRealTab.node.active  = statsActive;
        if (this._pfHistoryView) this._pfHistoryView.active = tab === 'history';
        // Part 11 B: trophies view.
        const trophiesView = this._portfolioPanel?.getChildByName('PortfolioTrophiesView');
        if (trophiesView) trophiesView.active = tab === 'trophies';
    }

    /**
     * Part 11 B: fetch + render trophies via Helius DAS API.
     * Empty state shown when no trophies (or Helius unreachable).
     */
    private async _refreshTrophies(): Promise<void> {
        const mwa = MWAManager.instance;
        const pubkey = mwa?.connectedPubkey;
        const trophiesView = this._portfolioPanel?.getChildByName('PortfolioTrophiesView');
        if (!trophiesView) return;
        const empty = trophiesView.getChildByName('PortfolioTrophiesEmptyLabel');
        if (!pubkey) {
            if (empty) empty.active = true;
            for (const tile of this._pfTrophyTiles) tile.active = false;
            return;
        }
        const { getPlayerTrophies, rankIcon } = await import('../../token-duel/scripts/TrophyRpc');
        const trophies = await getPlayerTrophies(pubkey);
        this._pfTrophyEntries = trophies;
        console.log(`${TAG} _refreshTrophies | DONE count=${trophies.length}`);
        if (empty) empty.active = trophies.length === 0;
        for (let i = 0; i < this._pfTrophyTiles.length; i++) {
            const tile = this._pfTrophyTiles[i];
            const t = trophies[i];
            if (!t) { tile.active = false; continue; }
            tile.active = true;
            // UX Phase 2b: procedural medal/trophy on the 'Emoji' node instead of glyph.
            const emojiN = tile.getChildByName('Emoji');
            const titleLbl = tile.getChildByName('Title')?.getComponent(Label);
            const winsLbl = tile.getChildByName('Wins')?.getComponent(Label);
            if (emojiN) IconLibrary.attach(emojiN, rankIcon(t.rank), { size: 64 });
            if (titleLbl) titleLbl.string = `Week #${t.weekId}`;
            if (winsLbl) winsLbl.string = t.wins > 0 ? `${t.wins} wins` : '';
        }
    }

    /**
     * Fetch + render one page of match history. `reset=true` clears the list
     * and starts over (used on tab switch); `reset=false` appends using the
     * saved cursor (Load-more button).
     */
    private async _refreshMatchHistory(reset: boolean): Promise<void> {
        if (this._matchHistoryLoading) return;
        const mwa = MWAManager.instance;
        const pubkey = mwa?.connectedPubkey ?? '';
        if (!pubkey) {
            if (this._pfHistoryEmptyLabel) this._pfHistoryEmptyLabel.string = 'Connect your wallet to see match history.';
            if (this._pfHistoryEmptyLabel) this._pfHistoryEmptyLabel.node.active = true;
            this._renderMatchHistoryRows([]);
            if (this._pfHistoryLoadMoreButton) this._pfHistoryLoadMoreButton.node.active = false;
            return;
        }
        if (reset) {
            this._matchHistoryEntries = [];
            this._matchHistoryCursor = null;
            this._matchHistoryCache.clear();
            if (this._pfHistoryEmptyLabel) {
                this._pfHistoryEmptyLabel.string = 'Loading match history…';
                this._pfHistoryEmptyLabel.node.active = true;
            }
            this._renderMatchHistoryRows([]);
        }
        this._matchHistoryLoading = true;
        try {
            const page = await fetchMatchHistoryPage({
                rpc: this._tdRpc,
                userPubkey: pubkey,
                beforeSig: this._matchHistoryCursor ?? undefined,
                matchCache: this._matchHistoryCache,
            });
            if (reset) this._matchHistoryEntries = page.entries;
            else this._matchHistoryEntries = this._matchHistoryEntries.concat(page.entries);
            this._matchHistoryCursor = page.nextCursor;
            this._renderMatchHistoryRows(this._matchHistoryEntries);
            if (this._pfHistoryEmptyLabel) {
                const empty = this._matchHistoryEntries.length === 0;
                this._pfHistoryEmptyLabel.node.active = empty;
                if (empty) this._pfHistoryEmptyLabel.string = 'No matches yet — play a Real match to see history.';
            }
            if (this._pfHistoryLoadMoreButton) this._pfHistoryLoadMoreButton.node.active = !!this._matchHistoryCursor;
            console.log(`${TAG} _refreshMatchHistory | DONE reset=${reset} total=${this._matchHistoryEntries.length} next=${this._matchHistoryCursor ?? '-'}`);
        } catch (e) {
            console.log(`${TAG} _refreshMatchHistory | ERROR ${e}`);
            if (this._pfHistoryEmptyLabel) {
                this._pfHistoryEmptyLabel.string = 'Could not load match history.';
                this._pfHistoryEmptyLabel.node.active = true;
            }
        } finally {
            this._matchHistoryLoading = false;
        }
    }

    private _onHistoryLoadMore(): void {
        console.log(`${TAG} _onHistoryLoadMore | cursor=${this._matchHistoryCursor ?? '-'}`);
        if (!this._matchHistoryCursor) return;
        this._refreshMatchHistory(false);
    }

    /** Populate the row pool from the cumulative entry list, newest first. */
    private _renderMatchHistoryRows(entries: MatchHistoryEntry[]): void {
        for (let i = 0; i < this._pfHistoryRows.length; i++) {
            const row = this._pfHistoryRows[i];
            const entry = entries[i];
            if (!entry) { row.active = false; continue; }
            row.active = true;
            const dateL = row.getChildByName('Date')?.getComponent(Label);
            const modeL = row.getChildByName('Mode')?.getComponent(Label);
            const wagerL = row.getChildByName('Wager')?.getComponent(Label);
            const placeL = row.getChildByName('Placement')?.getComponent(Label);
            const payoutL = row.getChildByName('Payout')?.getComponent(Label);
            if (dateL) dateL.string = this._fmtHistoryDate(entry.at);
            if (modeL) {
                // Stage 3 modeU8: 0=1v1, 1=Trio, 2=4p, 3=8p.
                const modeName = MODES[(['oneVone', 'trio', 'fourPlayer', 'eightPlayer'][entry.mode] ?? 'oneVone') as keyof typeof MODES]?.shortLabel ?? '—';
                const windowLabel = TIME_WINDOWS[(['30s', '1m', '5m', '1h', '24h', '7d'][entry.timeWindow] ?? '30s') as TimeWindowId]?.label ?? '';
                modeL.string = `${modeName} · ${windowLabel}${entry.wasForceSettled ? ' · AFK' : ''}`;
            }
            if (wagerL) wagerL.string = `${(Number(entry.wagerLamports) / 1e9).toFixed(3)} SOL`;
            if (placeL) {
                const label = entry.placement < 0
                    ? 'n/a'
                    : `${this._ordinal(entry.placement + 1)} / ${entry.requiredPlayers}`;
                placeL.string = label;
            }
            if (payoutL) {
                if (entry.placement < 0) {
                    payoutL.string = '—';
                    payoutL.color = new Color(140, 150, 170, 255);
                } else if (entry.payoutLamports > 0n) {
                    const net = entry.payoutLamports - entry.wagerLamports;
                    const sol = Number(net) / 1e9;
                    payoutL.string = `${sol >= 0 ? '+' : ''}${sol.toFixed(3)} SOL`;
                    payoutL.color = sol >= 0 ? new Color(48, 198, 155, 255) : new Color(220, 90, 90, 255);
                } else {
                    const sol = -Number(entry.wagerLamports) / 1e9;
                    payoutL.string = `${sol.toFixed(3)} SOL`;
                    payoutL.color = new Color(220, 90, 90, 255);
                }
            }
        }
    }

    private _fmtHistoryDate(unixSec: number): string {
        if (!unixSec) return '—';
        const d = new Date(unixSec * 1000);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${mm}/${dd} ${hh}:${mi}`;
    }

    private _ordinal(n: number): string {
        if (n === 1) return '1st';
        if (n === 2) return '2nd';
        if (n === 3) return '3rd';
        return `${n}th`;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 12 C — Live match ticker
    // ═══════════════════════════════════════════════════════════════

    /**
     * Start polling the on-chain match set every 30s and rotating the
     * displayed line every 6s. Called from `_showHome`; cleaned up by
     * `_stopMatchTicker` when leaving Home or on disconnect.
     */
    private _startMatchTicker(): void {
        this._stopMatchTicker();
        // Immediate first fetch so ticker populates within seconds of Home
        // becoming visible rather than 30s later.
        void this._refreshMatchTicker();
        this._tickerPollTimer = setInterval(() => {
            void this._refreshMatchTicker();
        }, 30_000) as unknown as number;
        this._tickerRotateTimer = setInterval(() => {
            this._rotateTickerDisplay();
        }, 6_000) as unknown as number;
    }

    private _stopMatchTicker(): void {
        if (this._tickerPollTimer !== null) {
            clearInterval(this._tickerPollTimer);
            this._tickerPollTimer = null;
        }
        if (this._tickerRotateTimer !== null) {
            clearInterval(this._tickerRotateTimer);
            this._tickerRotateTimer = null;
        }
    }

    private async _refreshMatchTicker(): Promise<void> {
        const { fetchRecentMatches } = await import('../../token-duel/scripts/MatchTickerRpc');
        const entries = await fetchRecentMatches(this._tdRpc, 10);
        this._tickerEntries = entries;
        this._tickerRotateIdx = 0;
        this._rotateTickerDisplay();
    }

    private _rotateTickerDisplay(): void {
        const tickerNode = this._homePanel?.getChildByName('HomeMatchTicker');
        if (!tickerNode) return;
        if (this._tickerEntries.length === 0) {
            tickerNode.active = false;
            this._tickerDisplayedEntry = null;
            return;
        }
        tickerNode.active = true;
        const entry = this._tickerEntries[this._tickerRotateIdx % this._tickerEntries.length];
        this._tickerRotateIdx += 1;
        // Stash the entry so HomeMatchTicker tap can route into spectator view.
        this._tickerDisplayedEntry = entry;
        // 2026-04-26 lobby restructure: feed the 5 chip Val labels instead of
        // a single one-line string. Lazy-import keeps the module out of the
        // Home-show hot path.
        import('../../token-duel/scripts/MatchTickerRpc').then(({ extractTickerParts }) => {
            const parts = extractTickerParts(entry, Math.floor(Date.now() / 1000));
            this._setMatchStatusChips(parts);
        }).catch(() => { /* module already loaded in most cases */ });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 14 — Tournaments
    // ═══════════════════════════════════════════════════════════════

    /**
     * Open TournamentPanel for a specific match PDA. Subscribes via the
     * existing SpectatorRpc infra (poll + ws) and renders the 10-slot
     * roster + medal state on each update.
     */
    private _onOpenTournament(matchPda: string): void {
        if (!this._tournamentPanel) {
            // Scene missing the panel (e.g. user hasn't rebuilt) — fall back
            // to SpectatorPanel, which still works fine for BR10 matches.
            this._onOpenSpectator(matchPda);
            return;
        }
        if (this._tournamentUnsubscribe) {
            try { this._tournamentUnsubscribe(); } catch (_) { /* ignore */ }
            this._tournamentUnsubscribe = null;
        }
        console.log(`${TAG} _onOpenTournament | OPEN match=${matchPda.slice(0, 8)}...`);
        this._tournamentActiveMatchPda = matchPda;
        this._tournamentLastMatchState = null;

        this._stopMatchTicker();
        this._stopTournamentCountdown();
        this._homePanel.active = false;
        this._tournamentPanel.active = true;

        // UX Phase 2b: emoji stripped; IconBadge sword attached at bind time.
        if (this._tournamentTitleLabel) this._tournamentTitleLabel.string = 'Tournament';
        if (this._tournamentMatchLabel) this._tournamentMatchLabel.string = `match ${matchPda.slice(0, 4)}…${matchPda.slice(-4)}`;
        if (this._tournamentStatusLabel) this._tournamentStatusLabel.string = 'Connecting…';
        if (this._tournamentPrizeLabel) this._tournamentPrizeLabel.string = 'Prize pool: — · top-3 payout';
        for (const slot of this._tournamentSlotNodes) slot.active = false;
        if (this._tournamentJoinButton) this._tournamentJoinButton.node.active = false;

        import('../../token-duel/scripts/SpectatorRpc').then(({ subscribeToMatch }) => {
            if (this._tournamentActiveMatchPda !== matchPda) return;
            this._tournamentUnsubscribe = subscribeToMatch(this._tdRpc, matchPda, {
                onState: (m) => this._renderTournamentState(m),
                onWsConnected: () => {
                    if (this._tournamentStatusLabel) this._tournamentStatusLabel.string = 'Live · backend connected';
                },
                onWsClosed: (reason) => {
                    if (this._tournamentStatusLabel) this._tournamentStatusLabel.string = `Polling only · ws closed (${reason.slice(0, 24)})`;
                },
            });
        }).catch((e) => console.log(`${TAG} _onOpenTournament | IMPORT_ERR ${e}`));
    }

    private _onTournamentBack(): void {
        console.log(`${TAG} _onTournamentBack | CLOSE`);
        if (this._tournamentUnsubscribe) {
            try { this._tournamentUnsubscribe(); } catch (_) { /* ignore */ }
            this._tournamentUnsubscribe = null;
        }
        this._tournamentActiveMatchPda = null;
        this._tournamentLastMatchState = null;
        if (this._tournamentPanel) this._tournamentPanel.active = false;
        this._homePanel.active = true;
        this._startMatchTicker();
        void this._fetchTournamentHostOnce().then(() => this._startTournamentCountdown());
    }

    /**
     * Join the specific tournament match. Since matchmaking's discovery path
     * might route the player to a different BR10 match, we build the join
     * tx directly targeting `matchPda` via a dedicated AnchorBackend call.
     */
    private _onTournamentJoin(): void {
        const m = this._tournamentLastMatchState;
        if (!m) { showToast('Tournament state not loaded yet'); return; }
        if (m.status !== 0 || m.playerCount >= m.requiredPlayers) {
            showToast('Tournament is no longer joinable');
            return;
        }
        const mwa = MWAManager.instance;
        if (!mwa?.connectedPubkey) { showToast('Connect your wallet first'); return; }
        const connectedPk = mwa.connectedPubkey;
        if (m.players.slice(0, m.playerCount).includes(connectedPk)) {
            showToast('You are already in this tournament');
            return;
        }
        console.log(`${TAG} _onTournamentJoin | match=${m.pda.slice(0, 8)}... tier=${m.wagerTier} wager=${m.wagerLamports}`);
        showToast('Joining tournament — sign the tx in your wallet');
        (async () => {
            const initResult = await this._ensureUserStatsInitialized();
            if (initResult !== 'ok') {
                showToast('Could not init stats — try again');
                return;
            }
            try {
                const bh = await this._rpc.getLatestBlockhash('confirmed');
                if (!bh) throw new Error('no blockhash');
                const txBytes = AnchorBackend.buildJoinMatchJoinTx(connectedPk, m.pda, bh.blockhash);
                const sig = await mwa.signAndSendTransaction(txBytes);
                if (!sig) {
                    showToast('Wallet rejected the tx');
                    return;
                }
                console.log(`${TAG} _onTournamentJoin | OK sig=${sig}`);
                showToast('Joined! Wait for the roster to fill.');
                // Roster auto-refreshes via SpectatorRpc's 3s poll.
            } catch (e: any) {
                console.log(`${TAG} _onTournamentJoin | ERROR ${e?.message ?? e}`);
                showToast(`Join failed: ${(e?.message ?? String(e)).slice(0, 48)}`);
            }
        })();
    }

    private _renderTournamentState(m: MatchState | null): void {
        if (!this._tournamentPanel || !this._tournamentPanel.active) return;
        if (!m) {
            if (this._tournamentStatusLabel) this._tournamentStatusLabel.string = 'Tournament closed';
            return;
        }
        this._tournamentLastMatchState = m;

        // Status banner + prize pool.
        const statusKey = ['Waiting', 'LIVE', 'Settled', 'Cancelled'][m.status] ?? '?';
        if (this._tournamentStatusLabel && !this._tournamentStatusLabel.string.startsWith('Live')) {
            this._tournamentStatusLabel.string = `${statusKey} · ${m.playerCount}/${m.requiredPlayers}`;
        }
        if (this._tournamentPrizeLabel) {
            const pot = (Number(m.wagerLamports) * m.requiredPlayers) / 1e9;
            this._tournamentPrizeLabel.string = `Prize pool: ${pot.toFixed(3)} SOL · top-3 payout`;
        }
        if (this._tournamentMatchLabel) {
            this._tournamentMatchLabel.string = `${m.pda.slice(0, 4)}…${m.pda.slice(-4)} · BR10`;
        }

        // Sort slots by height DESC when Settled so medals reflect final ranks.
        const sortedByHeight: Array<{ slot: number; height: number; pk: string }> = [];
        for (let i = 0; i < m.playerCount; i++) {
            sortedByHeight.push({ slot: i, height: m.heights[i] === 0xffffffff ? -1 : m.heights[i], pk: m.players[i] });
        }
        if (m.status === 2) sortedByHeight.sort((a, b) => b.height - a.height);
        // UX Phase 2b: medals by IconLibrary name (not emoji).
        const medalBySlot = new Map<number, IconName>();
        if (m.status === 2) {
            if (sortedByHeight[0]) medalBySlot.set(sortedByHeight[0].slot, 'medalGold');
            if (sortedByHeight[1]) medalBySlot.set(sortedByHeight[1].slot, 'medalSilver');
            if (sortedByHeight[2]) medalBySlot.set(sortedByHeight[2].slot, 'medalBronze');
        }

        // Render 10 slots. Empty slots are inactive; filled ones show pk+height.
        for (let i = 0; i < this._tournamentSlotNodes.length; i++) {
            const slot = this._tournamentSlotNodes[i];
            const pk = m.players[i];
            const h = m.heights[i];
            const hasPlayer = i < m.playerCount && pk && pk !== '11111111111111111111111111111111';
            slot.active = hasPlayer;
            if (!hasPlayer) continue;
            const pkLabel = slot.getChildByName('Pubkey')?.getComponent(Label);
            const hLabel = slot.getChildByName('Height')?.getComponent(Label);
            const medalNode = slot.getChildByName('Medal');
            if (pkLabel) pkLabel.string = `P${i + 1}  ${pk.slice(0, 4)}…${pk.slice(-4)}`;
            if (hLabel) hLabel.string = h === 0xffffffff ? 'H:—' : `H:${h}`;
            // UX Phase 2b: medal rendered via IconLibrary (clears label + draws icon).
            if (medalNode) {
                const medalIcon = medalBySlot.get(i);
                if (medalIcon) {
                    IconLibrary.attach(medalNode, medalIcon, { size: 32 });
                    medalNode.active = true;
                } else {
                    // Clear to empty — remove Graphics so no leftover medal shows.
                    const g = medalNode.getComponent(Graphics);
                    if (g) medalNode.removeComponent(g);
                    const medalLabel = medalNode.getComponent(Label);
                    if (medalLabel) medalLabel.string = '';
                }
            }
        }

        // Join button: Waiting + free slot + player not already in + not the host.
        if (this._tournamentJoinButton) {
            const connectedPk = MWAManager.instance?.connectedPubkey ?? '';
            const alreadyJoined = m.players.slice(0, m.playerCount).includes(connectedPk);
            const joinable = m.status === 0 && m.playerCount < m.requiredPlayers && connectedPk !== '' && !alreadyJoined;
            this._tournamentJoinButton.node.active = joinable;
        }
    }

    /**
     * One-shot fetch of the backend's tournament host pubkey. Called once
     * on first Home display; subsequent Home visits reuse the cached value.
     * Sets `TOURNAMENT_HOST_PUBKEY` via the mutable getter/setter pattern.
     */
    private async _fetchTournamentHostOnce(): Promise<void> {
        if (this._tournamentHostFetched) return;
        this._tournamentHostFetched = true;
        // betting-duel polish: the default RECEIPT_BACKEND_URL is
        // `http://10.0.2.2:3000` which only resolves inside the Android
        // emulator. On real devices the fetch throws and spams logs every
        // Home load. Gate the fetch so real-device users see one clean
        // "skipping tournament host fetch" line and nothing more.
        if (!RECEIPT_BACKEND_URL || RECEIPT_BACKEND_URL.includes('10.0.2.2')) {
            console.log(`${TAG} _fetchTournamentHostOnce | SKIP url=${RECEIPT_BACKEND_URL || '(unset)'} — set globalThis.TD_RECEIPT_URL to enable tournaments`);
            return;
        }
        try {
            const url = `${RECEIPT_BACKEND_URL}/tournaments/host`;
            const res = await fetch(url, { headers: { accept: 'application/json' } });
            if (!res.ok) {
                console.log(`${TAG} _fetchTournamentHostOnce | HTTP ${res.status} — tournaments disabled`);
                return;
            }
            const body = await res.json() as { host: string; cadenceMs?: number };
            if (body.host) {
                const { setTournamentHostPubkey } = await import('../../token-duel/scripts/constants');
                setTournamentHostPubkey(body.host);
                if (body.cadenceMs && body.cadenceMs > 0) this._tournamentCadenceMs = body.cadenceMs;
                console.log(`${TAG} _fetchTournamentHostOnce | OK host=${body.host.slice(0, 8)}... cadence=${body.cadenceMs ?? '?'}ms`);
            }
        } catch (e) {
            console.log(`${TAG} _fetchTournamentHostOnce | ERROR ${e} — tournaments disabled`);
        }
    }

    /**
     * Start tournament polling + countdown timers. Polls every 30s for the
     * next upcoming tournament; updates the badge text every 1s so the
     * countdown feels live. Hides the badge when no tournament is visible.
     */
    private _startTournamentCountdown(): void {
        this._stopTournamentCountdown();
        void this._refreshTournamentBadge();
        this._tournamentPollTimer = setInterval(() => {
            void this._refreshTournamentBadge();
        }, 30_000) as unknown as number;
        this._tournamentCountdownTimer = setInterval(() => {
            this._repaintTournamentBadge();
        }, 1_000) as unknown as number;
    }

    private _stopTournamentCountdown(): void {
        if (this._tournamentPollTimer !== null) {
            clearInterval(this._tournamentPollTimer);
            this._tournamentPollTimer = null;
        }
        if (this._tournamentCountdownTimer !== null) {
            clearInterval(this._tournamentCountdownTimer);
            this._tournamentCountdownTimer = null;
        }
    }

    private async _refreshTournamentBadge(): Promise<void> {
        if (!this._tournamentBadge) return;
        try {
            const { fetchUpcomingTournaments } = await import('../../token-duel/scripts/MatchTickerRpc');
            const entries = await fetchUpcomingTournaments(this._tdRpc);
            if (entries.length === 0) {
                this._nextTournamentMatchPda = null;
                this._tournamentBadge.active = false;
                return;
            }
            const soonest = entries[0];
            // Phase N4 — emit tournament_starting on first discovery of a new
            // tournament matchPda. Dedupe-key so 30s polling doesn't re-fire.
            const isNewMatch = this._nextTournamentMatchPda !== soonest.pda;
            this._nextTournamentMatchPda = soonest.pda;
            this._nextTournamentCreatedAt = Number(soonest.createdAt);
            this._nextTournamentIsActive = soonest.status === 1;
            this._nextTournamentPlayerCount = soonest.playerCount ?? 0;
            this._nextTournamentRequiredPlayers = soonest.requiredPlayers ?? 10;
            this._nextTournamentWagerLamports = Math.round((soonest.wagerSol ?? 0) * 1e9);
            this._tournamentBadge.active = true;
            if (isNewMatch && soonest.status === 0) {
                this._emitNotification('tournament_starting', 'Tournament available',
                    `${soonest.playerCount}/${soonest.requiredPlayers} joined · ${soonest.wagerSol.toFixed(3)} SOL · tap to join.`,
                    { payload: { matchPda: soonest.pda }, dedupeKey: `tournament:${soonest.pda}` });
            }
            // Also hide the regular match ticker when a tournament is up —
            // both live at y=555 and would visually overlap otherwise.
            const ticker = this._homePanel?.getChildByName('HomeMatchTicker');
            if (ticker) ticker.active = false;
            this._repaintTournamentBadge();
        } catch (e) {
            console.log(`${TAG} _refreshTournamentBadge | ERROR ${e}`);
        }
    }

    /** Renders the countdown text based on cached state. Called every 1s. */
    private _repaintTournamentBadge(): void {
        if (!this._tournamentBadge || !this._tournamentBadge.active) return;
        const labelNode = this._tournamentBadge.getChildByName('Label');
        const label = labelNode?.getComponent(Label);
        if (!label) return;
        if (this._nextTournamentIsActive) {
            // UX overhaul Phase 1: emoji rendered via IconBadge sibling.
            label.string = 'TOURNAMENT LIVE — tap to spectate';
            return;
        }
        // Phase H1 — richer copy: include filled count + wager so players can
        // see urgency at a glance ("7/10 full · 0.001 SOL · tap to join").
        const nowSec = Math.floor(Date.now() / 1000);
        const elapsedSec = Math.max(0, nowSec - this._nextTournamentCreatedAt);
        const mm = Math.floor(elapsedSec / 60);
        const ss = elapsedSec % 60;
        const filled = `${this._nextTournamentPlayerCount}/${this._nextTournamentRequiredPlayers}`;
        const wagerSol = this._nextTournamentWagerLamports / 1e9;
        const wagerStr = wagerSol > 0 ? ` · ${wagerSol.toFixed(3)} SOL` : '';
        const ageStr = mm > 0 ? `${mm}m ${ss.toString().padStart(2, '0')}s ago` : `${ss}s ago`;
        label.string = `Tournament · ${filled} full${wagerStr} · ${ageStr} · tap to join`;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 12 D — Spectator Mode
    // ═══════════════════════════════════════════════════════════════

    /**
     * Tap-through from HomeMatchTicker: opens SpectatorPanel and subscribes
     * to the match's on-chain state + (optional) backend live WS.
     *
     * We reuse `_setActivePanel('home')` state for the under-panel, but
     * toggle SpectatorPanel/HomePanel visibility directly rather than
     * adding a new case to the enum — spectator is an overlay flow, not
     * a top-level navigation target.
     */
    private _onOpenSpectator(matchPda: string): void {
        // betting-duel Block 9: spectator panel was designed around stack-jump
        // block-drop events. On betting-duel, races are deterministic from
        // entry prices — there's nothing interesting to watch mid-race.
        // Defer a proper delta-based spectator view to a later phase.
        showToast('Spectator view coming soon');
        console.log(`${TAG} _onOpenSpectator | GATED (betting-duel) match=${matchPda.slice(0, 8)}`);
        return;
        if (!this._spectatorPanel) {
            showToast('Spectator not available — regenerate scene');
            return;
        }
        if (this._spectatorUnsubscribe) {
            // Defensive: tearing down any stray subscription before opening new.
            try { this._spectatorUnsubscribe(); } catch (_) { /* ignore */ }
            this._spectatorUnsubscribe = null;
        }
        console.log(`${TAG} _onOpenSpectator | OPEN match=${matchPda.slice(0, 8)}...`);
        this._spectatorMatchPda = matchPda;
        this._spectatorLastMatch = null;
        this._spectatorEventLines = [];

        // Flip panels. Ticker timers get stopped by `_setActivePanel` when
        // leaving Home — we sidestep that by NOT calling it, just toggling
        // visibility directly so Home state persists for the back button.
        this._stopMatchTicker();
        this._homePanel.active = false;
        this._spectatorPanel.active = true;

        // Reset UI to "connecting" state.
        // UX Phase 2b: emoji stripped; IconBadge eye attached at bind time.
        if (this._spectatorTitleLabel) this._spectatorTitleLabel.string = 'Spectating';
        if (this._spectatorMatchLabel) this._spectatorMatchLabel.string = `match ${matchPda.slice(0, 4)}…${matchPda.slice(-4)}`;
        if (this._spectatorStatusLabel) this._spectatorStatusLabel.string = 'Connecting…';
        for (const row of this._spectatorPlayerRows) row.active = false;
        for (const row of this._spectatorEventRows) row.active = false;
        if (this._spectatorJoinButton) this._spectatorJoinButton.node.active = false;

        // Subscribe. SpectatorRpc handles both on-chain poll (3s) and
        // optional backend WS. Sub callbacks are lazy-dispatched to the
        // render methods below.
        import('../../token-duel/scripts/SpectatorRpc').then(({ subscribeToMatch }) => {
            if (this._spectatorMatchPda !== matchPda) {
                // User already navigated away before the dynamic import resolved.
                return;
            }
            this._spectatorUnsubscribe = subscribeToMatch(this._tdRpc, matchPda, {
                onState: (m) => this._renderSpectatorState(m),
                onDrop: (ev) => this._onSpectatorDropEvent({
                    kind: 'drop',
                    xPos: ev.xPos,
                    outcome: ev.outcome,
                    blockIdx: ev.blockIdx,
                    tsMs: ev.tsMs,
                }),
                onMatchOver: (ev) => this._onSpectatorDropEvent({
                    kind: 'match-over',
                    finalHeight: ev.finalHeight,
                    tsMs: ev.at * 1000,
                }),
                onWsConnected: () => {
                    if (this._spectatorStatusLabel) this._spectatorStatusLabel.string = 'Live · backend connected';
                },
                onWsClosed: (reason) => {
                    if (this._spectatorStatusLabel) this._spectatorStatusLabel.string = `Polling only · ws closed (${reason.slice(0, 28)})`;
                },
            });
        }).catch((e) => {
            console.log(`${TAG} _onOpenSpectator | IMPORT_ERR ${e}`);
            if (this._spectatorStatusLabel) this._spectatorStatusLabel.string = 'Spectator module unavailable';
        });
    }

    private _onSpectatorBack(): void {
        console.log(`${TAG} _onSpectatorBack | CLOSE match=${this._spectatorMatchPda?.slice(0, 8) ?? '?'}`);
        if (this._spectatorUnsubscribe) {
            try { this._spectatorUnsubscribe(); } catch (_) { /* ignore */ }
            this._spectatorUnsubscribe = null;
        }
        this._spectatorMatchPda = null;
        this._spectatorLastMatch = null;
        this._spectatorEventLines = [];
        if (this._spectatorPanel) this._spectatorPanel.active = false;
        this._homePanel.active = true;
        this._startMatchTicker();
    }

    /**
     * Join-this-match tap from SpectatorPanel. Only surfaced when the match
     * is Waiting with an open slot. We route through the standard join flow
     * rather than duplicating the sign-and-send ceremony.
     */
    private _onSpectatorJoin(): void {
        const m = this._spectatorLastMatch;
        if (!m) { showToast('Match state not loaded yet'); return; }
        if (m.status !== 0 || m.playerCount >= m.requiredPlayers) {
            showToast('Match no longer joinable');
            return;
        }
        console.log(`${TAG} _onSpectatorJoin | START mode=${m.mode} tier=${m.wagerTier}`);
        // Close spectator view; kick off the real-join flow with the
        // spectated match's mode + wager tier. `_submitRealJoinMatch` does
        // discovery which may land on this match (or a fresh one).
        this._onSpectatorBack();
        this._realMatchMode = m.mode;
        this._realMatchWagerTier = m.wagerTier;
        this._realMatchWagerLamports = Number(m.wagerLamports);
        // Stage 3 mode rebalance: 0=1v1, 1=Trio, 2=4p, 3=8p.
        const modeIdMap: Record<number, string> = { 0: 'oneVone', 1: 'trio', 2: 'fourPlayer', 3: 'eightPlayer' };
        this._pickerSelectedMode = modeIdMap[m.mode] ?? 'oneVone';
        this._pickerSelectedWagerIndex = m.wagerTier;
        this._pickerSelectedTrack = 'real';
        // Fire the async join — WaitingPanel surfaces progress.
        const modeDef = MODES[this._pickerSelectedMode as keyof typeof MODES] ?? MODES.oneVone;
        this._showWaitingPanel({
            mode: modeDef.label,
            wagerSol: Number(m.wagerLamports) / 1e9,
            track: 'real',
            status: 'Joining match — sign tx',
            requiredPlayers: modeDef.requiredPlayers,
        });
        (async () => {
            const initResult = await this._ensureUserStatsInitialized();
            if (initResult !== 'ok') {
                if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Could not init stats — tap Play Bot or Cancel';
                return;
            }
            const joinResult = await this._submitRealJoinMatch(m.mode, m.wagerTier);
            if (!joinResult) {
                if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Join tx failed — tap Play Bot or Cancel';
                return;
            }
            this._activeRealMatchPda = joinResult.matchPda;
            if (this._waitingStatusLabel) this._waitingStatusLabel.string = `Match ${joinResult.matchPda.substring(0, 8)}… · waiting for opponents`;
            const outcome = await this._runRealPollLoop(joinResult.matchPda);
            if (outcome === 'active') {
                this._pendingRealMatch = true;
                this._hideWaitingPanel();
                this._setStakeClusterVisible(true);
                this._refreshSquadActionButtons();
                showToast('Opponent found — tap Commit to start');
            } else if (outcome === 'timeout') {
                if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'No opponent in 2 min — Play Bot or Cancel+Refund';
            } else if (outcome === 'settled' || outcome === 'cancelled') {
                this._activeRealMatchPda = null;
                this._hideWaitingPanel();
                showToast(outcome === 'settled' ? 'Match already settled' : 'Match cancelled');
            }
        })().catch((e) => {
            console.log(`${TAG} _onSpectatorJoin | REAL_FLOW_ERROR error=${e}`);
            if (this._waitingStatusLabel) this._waitingStatusLabel.string = `Error: ${e?.message ?? e}`;
        });
    }

    /**
     * Render on-chain MatchState onto SpectatorPanel — player rows with
     * short-pubkey + height, status label, join-button visibility.
     */
    private _renderSpectatorState(m: MatchState | null): void {
        if (!this._spectatorPanel || !this._spectatorPanel.active) return;
        if (!m) {
            if (this._spectatorStatusLabel) this._spectatorStatusLabel.string = 'Match not found — may have closed';
            return;
        }
        this._spectatorLastMatch = m;

        // Status line summary. WS-connected stamp is set separately by WS cbs.
        const statusLabel = ['Waiting', 'Active', 'Settled', 'Cancelled'][m.status] ?? '?';
        if (this._spectatorStatusLabel && !this._spectatorStatusLabel.string.startsWith('Live')) {
            this._spectatorStatusLabel.string = `${statusLabel} · ${m.playerCount}/${m.requiredPlayers}`;
        }
        if (this._spectatorMatchLabel) {
            const sol = (Number(m.wagerLamports) / 1e9).toFixed(3);
            this._spectatorMatchLabel.string = `${m.pda.slice(0, 4)}…${m.pda.slice(-4)} · ${sol} SOL`;
        }

        // Player rows. `players[i]` can be the default-pubkey when a slot is
        // empty; we detect by the all-1s encoding and hide those rows.
        for (let i = 0; i < this._spectatorPlayerRows.length; i++) {
            const row = this._spectatorPlayerRows[i];
            const pk = m.players[i];
            const h = m.heights[i];
            const hasPlayer = i < m.playerCount && pk && pk !== '11111111111111111111111111111111';
            row.active = hasPlayer;
            if (!hasPlayer) continue;
            const pkLabel = row.getChildByName('Pubkey')?.getComponent(Label);
            const hLabel = row.getChildByName('Height')?.getComponent(Label);
            if (pkLabel) pkLabel.string = `P${i + 1}  ${pk.slice(0, 4)}…${pk.slice(-4)}`;
            if (hLabel) {
                // u32::MAX = not-yet-settled sentinel. Show "—" until resolve.
                const display = h === 0xffffffff ? '—' : `H:${h}`;
                hLabel.string = display;
            }
        }

        // Join button: Waiting + has free slot + not already joined.
        if (this._spectatorJoinButton) {
            const connectedPk = MWAManager.instance?.connectedPubkey ?? '';
            const alreadyJoined = m.players.slice(0, m.playerCount).includes(connectedPk);
            const joinable = m.status === 0 && m.playerCount < m.requiredPlayers && connectedPk !== '' && !alreadyJoined;
            this._spectatorJoinButton.node.active = joinable;
        }
    }

    /**
     * Append a drop or match-over event to the event feed (keep last 10,
     * newest on top).
     */
    private _onSpectatorDropEvent(ev: { kind: 'drop'; xPos: number; outcome: 'ok' | 'miss'; blockIdx: number; tsMs: number }
                                    | { kind: 'match-over'; finalHeight: number; tsMs: number }): void {
        let line: string;
        const hhmmss = new Date(ev.tsMs).toLocaleTimeString().slice(0, 8);
        if (ev.kind === 'drop') {
            const sym = ev.outcome === 'ok' ? '✓' : '✗';
            line = `${hhmmss} ${sym} drop #${ev.blockIdx + 1} x=${ev.xPos.toFixed(2)}`;
        } else {
            // UX Phase 2b: emoji replaced with bullet glyph that renders clean everywhere.
            line = `${hhmmss} ▶ match over · final height ${ev.finalHeight}`;
        }
        this._spectatorEventLines.unshift(line);
        if (this._spectatorEventLines.length > this._spectatorEventRows.length) {
            this._spectatorEventLines.length = this._spectatorEventRows.length;
        }
        for (let i = 0; i < this._spectatorEventRows.length; i++) {
            const row = this._spectatorEventRows[i];
            const txt = this._spectatorEventLines[i];
            row.active = !!txt;
            if (!txt) continue;
            const label = row.getChildByName('Text')?.getComponent(Label);
            if (label) label.string = txt;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 11 C — Audio + Haptics Settings
    // ═══════════════════════════════════════════════════════════════

    private _onToggleSound(): void {
        const next = !isSoundEnabled();
        setSoundEnabled(next);
        if (next) playSound('tap'); // immediate feedback that sound is now on
        Haptics.fire(HapticType.SOFT);
        this._refreshAudioCard();
    }

    private _onToggleHaptics(): void {
        const next = !Haptics.isEnabled();
        Haptics.setEnabled(next);
        if (next) Haptics.fire(HapticType.MEDIUM); // feedback on enable
        this._refreshAudioCard();
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 11 A — Share to X
    // ═══════════════════════════════════════════════════════════════

    /**
     * Post-match share: compose a tweet-intent URL with the sharecard PNG URL
     * baked into it. X unfurls the image automatically when the backend
     * returns a valid Twitter card image.
     *
     * Gracefully toasts + no-ops if no shareable match is in view.
     */
    /**
     * Part 13: refresh the HomeRakeChip with the connected player's current
     * rake tier + level. Safe to call when no wallet is connected — chip
     * hides. Called after wallet connect, after every stats refresh, and on
     * panel re-entry.
     */
    private async _refreshRakeChip(): Promise<void> {
        // 2026-04-26 lobby restructure: HomeRakeChip removed; rake value now
        // lives in the ChallengeSeasonCard's RAKE chip. Cache the formatted
        // text so _hydrateDailyChallengeWidget can merge it.
        const mwa = MWAManager.instance;
        const pubkey = mwa?.connectedPubkey;
        if (!pubkey) {
            this._cachedRakeText = '—';
            this._setChallengeChips({ rake: this._cachedRakeText });
            return;
        }
        try {
            const stats = await loadRealStats(this._tdRpc, pubkey);
            const level = stats.loaded ? Math.max(1, stats.level) : 1;
            this._cachedLevel = level;
            const bps = rakeBpsForLevel(level);
            this._cachedRakeText = `${(bps / 100).toFixed(1)}% (Lv ${level})`;
            this._setChallengeChips({ rake: this._cachedRakeText });
        } catch (e) {
            console.log(`${TAG} _refreshRakeChip | ERROR ${e}`);
            this._cachedRakeText = '—';
            this._setChallengeChips({ rake: this._cachedRakeText });
        }
    }

    /**
     * Part 13: open the public fee-schedule page in the device browser.
     * Mirrors the X-share pattern — uses `sys.openURL` when available.
     */
    private _onOpenFees(): void {
        const url = `${RECEIPT_BACKEND_URL}/fees`;
        console.log(`${TAG} _onOpenFees | opening ${url}`);
        try {
            const sysAny = (globalThis as any).sys;
            if (sysAny?.openURL) {
                sysAny.openURL(url);
                Haptics.fire(HapticType.SOFT);
                playSound('tap');
            } else {
                showToast('Cannot open browser — sys.openURL unavailable');
            }
        } catch (e) {
            console.log(`${TAG} _onOpenFees | ERROR ${e}`);
            showToast('Failed to open fees page');
        }
    }

    private _onPostMatchShare(): void {
        if (!this._lastShareMatchPda || !this._lastShareQuery) {
            showToast('Nothing to share (paper match)');
            return;
        }
        const imgUrl = `${RECEIPT_BACKEND_URL}/sharecard/${this._lastShareMatchPda}.png?${this._lastShareQuery}`;
        const text = `Just played a match on Token Duel 🏆 Stack-Jump with live Solana token prices.`;
        const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(imgUrl)}`;
        console.log(`${TAG} _onPostMatchShare | opening tweet_url=${tweetUrl.substring(0, 120)}...`);
        try {
            // Cocos 3.8 exposes sys.openURL on Android (launches default browser
            // with ACTION_VIEW). If it's missing, silently fall back to toast.
            const sysAny = (globalThis as any).sys;
            if (sysAny?.openURL) {
                sysAny.openURL(tweetUrl);
                Haptics.fire(HapticType.SOFT);
                playSound('tap');
            } else {
                showToast('Cannot open X — sys.openURL unavailable');
            }
        } catch (e) {
            console.log(`${TAG} _onPostMatchShare | ERROR ${e}`);
            showToast('Share failed');
        }
    }

    private _refreshAudioCard(): void {
        const card = this._settingsPanel?.getChildByName('AudioSettingsCard');
        if (!card) return;
        const soundOn = isSoundEnabled();
        const hapOn = Haptics.isEnabled();
        // Phase 29 — toggle row layout. Each row keeps a static "Sound" /
        // "Haptics" label and signals state via a recolored ON/OFF pill on the
        // right. The row's own background sprite stays neutral; the pill is
        // the only thing that flips colour. Icons are also state-driven.
        this._setPrefRowState('SoundToggleButton',   soundOn, soundOn ? 'speaker'   : 'speakerMuted');
        this._setPrefRowState('HapticsToggleButton', hapOn,   hapOn   ? 'vibration' : 'hand');
    }

    /**
     * Phase 30 — apply ON/OFF state to a Preferences toggle row using a real
     * toggle switch: track recolors (teal ↔ slate), knob slides ±12px (180ms
     * backOut), icon pulses 1.0 → 1.18 → 1.0 (220ms total).
     */
    private _setPrefRowState(rowName: string, on: boolean, iconName: IconName): void {
        const card = this._settingsPanel?.getChildByName('AudioSettingsCard');
        const row = card?.getChildByName(rowName);
        if (!row) return;

        const trackNode = row.getChildByName(`${rowName}SwitchTrack`);
        const trackSpr = trackNode?.getComponent(Sprite);
        if (trackSpr) {
            trackSpr.color = on ? new Color(20, 241, 149, 255) : new Color(37, 43, 66, 255);
        }

        const knobNode = row.getChildByName(`${rowName}SwitchKnob`);
        if (knobNode) {
            const trackX = trackNode?.position.x ?? 254;
            const targetX = on ? trackX + 12 : trackX - 12;
            Tween.stopAllByTarget(knobNode);
            tween(knobNode)
                .to(0.18, { position: new Vec3(targetX, knobNode.position.y, 0) }, { easing: 'backOut' })
                .start();
        }

        const iconChildName = rowName === 'SoundToggleButton' ? 'PrefSoundIcon' : 'PrefHapticsIcon';
        const iconChild = row.getChildByName(iconChildName);
        if (iconChild) {
            try { IconLibrary.attach(iconChild, iconName, { size: 22 }); }
            catch (e) { console.log(`${TAG} _setPrefRowState | icon attach FAIL ${e}`); }
            Tween.stopAllByTarget(iconChild);
            iconChild.setScale(1, 1, 1);
            tween(iconChild)
                .to(0.11, { scale: new Vec3(1.18, 1.18, 1) }, { easing: 'backOut' })
                .to(0.11, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicIn' })
                .start();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 9 — First-run tutorial overlay
    // ═══════════════════════════════════════════════════════════════

    private _tutorialHasBeenSeen(): boolean {
        try {
            const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
            return ls?.getItem?.(this._TUTORIAL_FLAG) === 'true';
        } catch (_) { return false; }
    }

    private _markTutorialSeen(): void {
        try {
            const ls = (globalThis as any).sys?.localStorage ?? (globalThis as any).localStorage;
            ls?.setItem?.(this._TUTORIAL_FLAG, 'true');
            console.log(`${TAG} _markTutorialSeen | DONE`);
        } catch (e) { console.log(`${TAG} _markTutorialSeen | ERROR ${e}`); }
    }

    private _showTutorial(): void {
        if (!this._tutorialOverlay || this._tutorialCards.length === 0) {
            console.log(`${TAG} _showTutorial | NO_OVERLAY — skipping`);
            this._resolveTutorial();
            return;
        }
        console.log(`${TAG} _showTutorial | SHOW`);
        this._tutorialStep = 0;
        for (let i = 0; i < this._tutorialCards.length; i++) {
            this._tutorialCards[i].active = false;
            if (this._tutorialGlows[i]) this._tutorialGlows[i].active = false;
            Tween.stopAllByTarget(this._tutorialCards[i]);
        }
        this._tutorialOverlay.active = true;
        this._tutorialAnimating = true;
        const c0 = this._tutorialCards[0];
        if (this._tutorialGlows[0]) this._tutorialGlows[0].active = true;
        c0.active = true;
        c0.setPosition(0, -80, 0);
        c0.setScale(0.92, 0.92, 1);
        const op0 = c0.getComponent(UIOpacity) ?? c0.addComponent(UIOpacity);
        op0.opacity = 0;
        this._tutorialMascots[0]?.setState(this._TUTORIAL_MASCOT_STATES[0]);
        tween(c0)
            .to(0.35, { position: new Vec3(0, 0, 0), scale: new Vec3(1, 1, 1) }, { easing: 'cubicOut' })
            .call(() => { this._tutorialAnimating = false; })
            .start();
        tween(op0).to(0.35, { opacity: 255 }, { easing: 'cubicOut' }).start();
    }

    private _onTutorialTap(): void {
        if (this._tutorialAnimating) return;
        const next = this._tutorialStep + 1;
        console.log(`${TAG} _onTutorialTap | step=${this._tutorialStep} → ${next}/${this._tutorialCards.length}`);
        if (next >= this._tutorialCards.length) {
            this._tutorialAnimating = true;
            const cur = this._tutorialCards[this._tutorialStep];
            const op = cur.getComponent(UIOpacity) ?? cur.addComponent(UIOpacity);
            tween(cur)
                .to(0.25, { position: new Vec3(0, 60, 0) }, { easing: 'cubicIn' })
                .call(() => {
                    this._markTutorialSeen();
                    if (this._tutorialOverlay) this._tutorialOverlay.active = false;
                    this._tutorialAnimating = false;
                    this._resolveTutorial();
                })
                .start();
            tween(op).to(0.25, { opacity: 0 }, { easing: 'cubicIn' }).start();
            return;
        }
        this._tutorialAnimating = true;
        const cur = this._tutorialCards[this._tutorialStep];
        const curGlow = this._tutorialGlows[this._tutorialStep];
        const nxt = this._tutorialCards[next];
        const nxtGlow = this._tutorialGlows[next];
        const curOp = cur.getComponent(UIOpacity) ?? cur.addComponent(UIOpacity);
        tween(cur)
            .to(0.25, { position: new Vec3(-400, 0, 0) }, { easing: 'cubicIn' })
            .call(() => {
                cur.active = false;
                if (curGlow) curGlow.active = false;
            })
            .start();
        tween(curOp).to(0.25, { opacity: 0 }, { easing: 'cubicIn' }).start();
        nxt.active = true;
        if (nxtGlow) nxtGlow.active = true;
        nxt.setPosition(400, 0, 0);
        nxt.setScale(1, 1, 1);
        const nxtOp = nxt.getComponent(UIOpacity) ?? nxt.addComponent(UIOpacity);
        nxtOp.opacity = 0;
        this._tutorialMascots[next]?.setState(this._TUTORIAL_MASCOT_STATES[next]);
        tween(nxt)
            .delay(0.10)
            .to(0.25, { position: new Vec3(0, 0, 0) }, { easing: 'cubicOut' })
            .call(() => {
                this._tutorialStep = next;
                this._tutorialAnimating = false;
            })
            .start();
        tween(nxtOp).delay(0.10).to(0.25, { opacity: 255 }, { easing: 'cubicOut' }).start();
    }

    private _resolveTutorial(): void {
        const fn = this._tutorialDismissed;
        this._tutorialDismissed = null;
        if (fn) fn();
    }
}
