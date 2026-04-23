/**
 * AppUI.ts — Unified UI controller for Landing + Home panels.
 *
 * Landing: single "Connect Wallet" button → OS picker selects wallet.
 * Home: Sign Message, Sign Tx, Sign & Send, Capabilities, Reconnect, Disconnect, Delete.
 */

import { _decorator, Component, Label, Button, Node, Sprite, Color, EditBox, ScrollView, Slider, SpriteFrame, ImageAsset, Texture2D, assetManager, UITransform, tween, Vec3, Tween, Graphics } from 'cc';
import { MWAManager } from '../../solana-mwa/scripts/MWAManager';
import { SolanaRpc } from '../../solana-mwa/scripts/SolanaRpc';
import { buildMemoTransaction } from '../../solana-mwa/scripts/TransactionBuilder';
import { AnchorBackend } from '../../token-duel/scripts/AnchorBackend';
import { STAKE_LAMPORTS, STAKE_MIN_SOL, STAKE_MAX_SOL, STAKE_DEFAULT_SOL, FEED_ROW_LIMIT } from '../../token-duel/scripts/constants';
import { MWA_AUTHORIZED, MWA_AUTH_FAILED, MWA_DISCONNECTED, MWA_STATUS } from '../../solana-mwa/scripts/MWAEvents';
import { getAppIdentity } from '../../solana-mwa/scripts/AppIdentity';
import { TokenDuelRpc, Holding } from '../../token-duel/scripts/TokenDuelRpc';
import { TokenDuelGame, RaceSnapshot } from '../../token-duel/scripts/TokenDuelGame';
import { decodeScore } from '../../token-duel/scripts/ScoreEncoding';
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
import { WAGER_TIERS_LAMPORTS, WAGER_TIERS_LABELS, WAGER_DISPLAY_TO_TIER, MODES, TIME_WINDOWS, TimeWindowId, DEFAULT_TIME_WINDOW } from '../../token-duel/scripts/ModeDefs';
import { fetchMatchHistoryPage, MatchHistoryEntry } from '../../token-duel/scripts/MatchHistoryRpc';
import { MatchState } from '../../token-duel/scripts/MatchRpc';
// ReceiptSession / physics-backend flow removed on betting-duel.
// (Previous `import { ReceiptSession } from '../../token-duel/scripts/ReceiptSigner';`)
import { initSound, playSound, setVolume as setSoundVolume, getVolume as getSoundVolume, setEnabled as setSoundEnabled, isEnabled as isSoundEnabled } from '../../token-duel/scripts/Sound';
import { Haptics, HapticType } from '../../token-duel/scripts/Haptics';
import { RECEIPT_BACKEND_URL } from '../../token-duel/scripts/constants';
import { checkUserStatsExists, xpBucketFor, getUserStats, UserStatsState } from '../../token-duel/scripts/UserStatsRpc';
import { loadRealStats } from '../../token-duel/scripts/RealStats';
import { getMatch } from '../../token-duel/scripts/MatchRpc';
import { fetchLeaderboard, LeaderboardEntry as ModeLeaderboardEntry } from '../../token-duel/scripts/LeaderboardRpc';
import { levelFromXp, levelProgress, computeModePayout, xpForPlacement, rakeBpsForLevel } from '../../token-duel/scripts/PayoutCalc';
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
type FilterChipKey = 'newest' | 'liq_desc' | 'liq_asc' | 'all' | 'liq1k' | 'liq5k' | 'liq10k';
import { showToast } from './AndroidToast';

const { ccclass } = _decorator;
const TAG = '[AppUI]';

@ccclass('AppUI')
export class AppUI extends Component {

    // Panels
    private _landingPanel: Node = null!;
    private _homePanel: Node = null!;
    private _tokenDuelPanel: Node = null!;

    // Landing elements
    private _connectButton: Button = null!;
    private _reconnectButton: Button = null!;
    private _landingStatus: Label = null!;

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
    // Block 3 — countdown overlay
    private _countdownOverlay: Node | null = null;
    private _countdownBigLabel: Label | null = null;
    private _countdownSquadLabel: Label | null = null;
    // Block 8 — signing overlay
    private _signingOverlay: Node | null = null;
    private _signingSpinnerLabel: Label | null = null;
    private _signingStatusLabel: Label | null = null;

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

    // Session 14 B1-B5: squad action buttons + pick mode state.
    private _squadPickButton: Button | null = null;
    private _squadPickLabel: Label | null = null;
    private _squadDropButton: Button | null = null;
    private _squadDropLabel: Label | null = null;
    private _squadRunButton: Button | null = null;
    private _squadRunLabel: Label | null = null;
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
    private _openPortfolioButton: Button | null = null;
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

    // Part 9: first-run tutorial overlay.
    private _tutorialOverlay: Node | null = null;
    private _tutorialBubbles: Node[] = [];
    private _tutorialIndexLabel: Label | null = null;
    private _tutorialStep: number = 0;
    private _tutorialDismissed: (() => void) | null = null;
    private readonly _TUTORIAL_FLAG = 'tokenduel:tutorialSeen';

    // Part 10 Bundle 3 / pt2: DailyChallengePanel + SquadPresetsOverlay + QP-defaults.
    private _dailyChallengePanel: Node | null = null;
    private _squadPresetsOverlay: Node | null = null;
    private _presetRowNodes: Node[] = [];
    private _presetNameModal: Node | null = null;
    private _presetNameEditBox: EditBox | null = null;
    /** Presets currently rendered into the overlay; indexed parallel to _presetRowNodes. */
    private _renderedPresets: SquadPreset[] = [];
    /** QuickPlay defaults radio-button tracking — grouped by row for tint sync. */
    private _qpModeButtons: Map<string, Button> = new Map();
    private _qpWindowButtons: Map<string, Button> = new Map();
    private _qpWagerButtons: Map<string, Button> = new Map();
    private _qpTrackButtons: Map<string, Button> = new Map();

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
    private _homeRakeChip: Label | null = null;
    private _waitingRakeLabel: Label | null = null;
    private _postMatchRakeLabel: Label | null = null;
    private _cachedLevel: number = 1;

    // Part 14: tournament discovery + countdown state.
    private _tournamentBadge: Node | null = null;
    private _tournamentPollTimer: number | null = null;
    private _tournamentCountdownTimer: number | null = null;
    private _nextTournamentMatchPda: string | null = null;
    private _nextTournamentCreatedAt: number = 0; // unix sec of match.createdAt
    private _nextTournamentIsActive: boolean = false;
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
    private _wagerDropdown: Node | null = null;
    private _wagerDropdownRows: Button[] = [];
    // Part 9: TimeWindow axis — stored as TimeWindowId, mapped to u8 at tx-build time.
    private _pickerWindowButtons: Map<string, Button> = new Map();
    private _pickerSelectedWindow: TimeWindowId = DEFAULT_TIME_WINDOW;
    // Last match outcome — set when a bot match resolves so post-game flow can use it.
    private _lastMatchOutcome: { won: boolean; opponentHeight: number; xp: number; track: 'paper' | 'real' } | null = null;

    // Session D Part 4: real-mode on-chain state.
    private _activeRealMatchPda: string | null = null;
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
    // Squad slot buttons (3) — label child shows symbol or "+"
    private _squadSlotButtons: Button[] = [];
    private _squadSlotLabels: Label[] = [];
    private _squadSlotLogoSprites: Sprite[] = [];
    private _squadSlotSymbolLabels: Label[] = [];
    private _squadSlotDeltaLabels: Label[] = [];
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
        console.log(`${TAG} start | START`);

        // Part 11 C: initialize Sound subsystem. Idempotent; loads 5 AudioClips
        // from `resources/audio/`. Missing clips no-op silently.
        initSound(this.node);

        // Find panels
        this._landingPanel = this.node.getChildByName('LandingPanel')!;
        this._homePanel = this.node.getChildByName('HomePanel')!;
        this._tokenDuelPanel = this.node.getChildByName('TokenDuelPanel')!;

        if (!this._landingPanel || !this._homePanel || !this._tokenDuelPanel) {
            console.log(`${TAG} start | FAIL panels not found landing=${!!this._landingPanel} home=${!!this._homePanel} tokenDuel=${!!this._tokenDuelPanel}`);
            return;
        }

        // ── Landing elements ──
        this._connectButton = this._landingPanel.getChildByName('ConnectButton')?.getComponent(Button)!;
        this._reconnectButton = this._landingPanel.getChildByName('ReconnectButton')?.getComponent(Button)!;
        this._landingStatus = this._landingPanel.getChildByName('StatusLabel')?.getComponent(Label)!;
        console.log(`${TAG} start | ConnectButton=${!!this._connectButton} ReconnectButton=${!!this._reconnectButton} StatusLabel=${!!this._landingStatus}`);

        this._connectButton?.node.on(Button.EventType.CLICK, this._onConnect, this);
        this._reconnectButton?.node.on(Button.EventType.CLICK, this._onReconnect, this);

        // ── Wire home buttons ──
        const homeBtnNames = [
            'QuickPlayButton',
            'PlayTokenDuelButton',
            'SignMessageButton', 'SignTxButton', 'SignSendButton',
            'CapabilitiesButton', 'DisconnectButton', 'DeleteButton',
        ];
        const homeHandlers = [
            this._onQuickPlay,
            this._onPlayTokenDuel,
            this._onSignMessage, this._onSignTransaction, this._onSignAndSend,
            this._onCapabilities, this._onDisconnect, this._onDelete,
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

        this._pubkeyLabel = this._homePanel.getChildByName('PubkeyLabel')?.getComponent(Label)!;
        this._homeStatus = this._homePanel.getChildByName('HomeStatusLabel')?.getComponent(Label)!;

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
            this._raceHeroSubtitleLabel  = this._racePanel.getChildByName('RaceHeroSubtitleLabel')?.getComponent(Label) ?? null;
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
            console.log(`${TAG} start | RacePanel wired cards=${this._raceTokenCards.length} countdown=${!!this._raceCountdownLabel} hero=${!!this._raceHeroDeltaLabel} cancel=${!!this._raceCancelButton} opp_card=${!!this._raceOpponentCard} opp_strip=${!!this._raceOpponentStrip} opp_rows=${this._raceOpponentRows.length}/7`);
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
        const balanceNode = this._tokenDuelPanel.getChildByName('BalanceChipLabel');
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

        // Filter chip row — 7 chips + Columns button (stub).
        const filterChipDefs: Array<{ name: string; key: FilterChipKey }> = [
            { name: 'FilterChip_newest',   key: 'newest'   },
            { name: 'FilterChip_liq_desc', key: 'liq_desc' },
            { name: 'FilterChip_liq_asc',  key: 'liq_asc'  },
            { name: 'FilterChip_all',      key: 'all'      },
            { name: 'FilterChip_liq1k',    key: 'liq1k'    },
            { name: 'FilterChip_liq5k',    key: 'liq5k'    },
            { name: 'FilterChip_liq10k',   key: 'liq10k'   },
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
        console.log(`${TAG} start | TokenDuel filter_chips wired=${chipsWired}/7 columns_btn=${!!this._columnsButton}`);

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

        // Session 14 B1: Squad action buttons.
        const squadPickNode = this._tokenDuelPanel.getChildByName('SquadPickButton');
        this._squadPickButton = squadPickNode?.getComponent(Button) ?? null;
        this._squadPickLabel = squadPickNode?.getChildByName('Label')?.getComponent(Label) ?? null;
        this._squadPickButton?.node.on(Button.EventType.CLICK, () => this._onSquadPickClick(), this);
        const squadDropNode = this._tokenDuelPanel.getChildByName('SquadDropButton');
        this._squadDropButton = squadDropNode?.getComponent(Button) ?? null;
        this._squadDropLabel = squadDropNode?.getChildByName('Label')?.getComponent(Label) ?? null;
        this._squadDropButton?.node.on(Button.EventType.CLICK, () => this._onSquadDropClick(), this);
        const squadRunNode = this._tokenDuelPanel.getChildByName('SquadRunButton');
        this._squadRunButton = squadRunNode?.getComponent(Button) ?? null;
        this._squadRunLabel = squadRunNode?.getChildByName('Label')?.getComponent(Label) ?? null;
        this._squadRunButton?.node.on(Button.EventType.CLICK, () => this._onSquadRunClick(), this);

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
        console.log(`${TAG} start | TokenDuel squad_actions pick=${!!this._squadPickButton} drop=${!!this._squadDropButton} run=${!!this._squadRunButton} drop_overlay=${!!this._squadDropOverlay} pills=${this._squadDropPills.length}/3`);

        // Session 14 C: Leaderboard + Portfolio entry buttons + panel bindings.
        const lbOpenNode = this._tokenDuelPanel.getChildByName('OpenLeaderboardButton');
        this._openLeaderboardButton = lbOpenNode?.getComponent(Button) ?? null;
        this._openLeaderboardButton?.node.on(Button.EventType.CLICK, () => this._onOpenLeaderboardClick(), this);
        const pfOpenNode = this._tokenDuelPanel.getChildByName('OpenPortfolioButton');
        this._openPortfolioButton = pfOpenNode?.getComponent(Button) ?? null;
        this._openPortfolioButton?.node.on(Button.EventType.CLICK, () => this._onOpenPortfolioClick(), this);

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
            for (let r = 0; r < 10; r++) {
                const rN = this._leaderboardPanel.getChildByName(`LBRow_${r}`);
                if (rN) this._lbRowNodes.push(rN);
            }
            // Session D Part 7: per-mode filter tabs. Part 10 pt2 adds
            // `season` (modeU8=4 sentinel) as the 5th tab for This Week wins.
            const tabKeys: { key: string; modeU8: number }[] = [
                { key: '1v1', modeU8: 0 },
                { key: '4p',  modeU8: 1 },
                { key: '8p',  modeU8: 2 },
                { key: 'br10', modeU8: 3 },
                { key: 'season', modeU8: 4 },
            ];
            for (const t of tabKeys) {
                const btnN = this._leaderboardPanel.getChildByName(`LBTab_${t.key}`);
                const btn = btnN?.getComponent(Button);
                if (btn) {
                    this._lbTabButtons.set(t.key, btn);
                    btn.node.on(Button.EventType.CLICK, () => this._onLeaderboardTabClick(t.modeU8, t.key), this);
                }
            }
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

        // Part 9: TutorialOverlay bindings.
        this._tutorialOverlay = this.node.getChildByName('TutorialOverlay') ?? null;
        if (this._tutorialOverlay) {
            // Part 11 D1: 4 bubbles now (added squad-delta explainer).
            for (let i = 0; i < 4; i++) {
                const b = this._tutorialOverlay.getChildByName(`TutorialBubble_${i}`);
                if (b) this._tutorialBubbles.push(b);
            }
            this._tutorialIndexLabel = this._tutorialOverlay.getChildByName('TutorialBubbleIndex')?.getComponent(Label) ?? null;
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
            }
            const reconnBtn = this._settingsPanel.getChildByName('ReconnectSettingsButton')?.getComponent(Button);
            reconnBtn?.node.on(Button.EventType.CLICK, () => this._onReconnect(), this);
            const disconnBtn = this._settingsPanel.getChildByName('DisconnectSettingsButton')?.getComponent(Button);
            disconnBtn?.node.on(Button.EventType.CLICK, () => this._onDisconnect(), this);
            const delBtn = this._settingsPanel.getChildByName('DeleteAccountSettingsButton')?.getComponent(Button);
            delBtn?.node.on(Button.EventType.CLICK, () => this._onDelete(), this);

            // Part 13 D: Fee schedule link. Opens /fees page externally.
            const feesBtn = this._settingsPanel.getChildByName('FeesLinkButton')?.getComponent(Button);
            feesBtn?.node.on(Button.EventType.CLICK, () => this._onOpenFees(), this);

            // Part 11 C: AudioSettingsCard toggles.
            const audioCard = this._settingsPanel.getChildByName('AudioSettingsCard');
            if (audioCard) {
                const soundBtn = audioCard.getChildByName('SoundToggleButton')?.getComponent(Button);
                soundBtn?.node.on(Button.EventType.CLICK, () => this._onToggleSound(), this);
                const hapBtn = audioCard.getChildByName('HapticsToggleButton')?.getComponent(Button);
                hapBtn?.node.on(Button.EventType.CLICK, () => this._onToggleHaptics(), this);
                this._refreshAudioCard();
            }

            // Part 10 pt2: Quick Play defaults radio rows.
            const qpCard = this._settingsPanel.getChildByName('QuickPlayDefaultsCard');
            if (qpCard) {
                const modeKeys: Array<[string, string]> = [['1v1','oneVone'],['4p','fourPlayer'],['8p','eightPlayer'],['br10','battleRoyale']];
                for (const [ui, logical] of modeKeys) {
                    const b = qpCard.getChildByName(`QPMode_${ui}`)?.getComponent(Button);
                    if (b) {
                        this._qpModeButtons.set(ui, b);
                        b.node.on(Button.EventType.CLICK, () => this._onQPModeClick(ui, logical), this);
                    }
                }
                for (const w of ['1h','1d','3d','7d']) {
                    const b = qpCard.getChildByName(`QPWindow_${w}`)?.getComponent(Button);
                    if (b) {
                        this._qpWindowButtons.set(w, b);
                        b.node.on(Button.EventType.CLICK, () => this._onQPWindowClick(w), this);
                    }
                }
                for (let i = 0; i < 5; i++) {
                    const key = ['001','005','01','025','05'][i];
                    const b = qpCard.getChildByName(`QPWager_${key}`)?.getComponent(Button);
                    if (b) {
                        this._qpWagerButtons.set(key, b);
                        const idx = i;
                        b.node.on(Button.EventType.CLICK, () => this._onQPWagerClick(key, idx), this);
                    }
                }
                for (const t of ['paper','real']) {
                    const b = qpCard.getChildByName(`QPTrack_${t}`)?.getComponent(Button);
                    if (b) {
                        this._qpTrackButtons.set(t, b);
                        b.node.on(Button.EventType.CLICK, () => this._onQPTrackClick(t as 'paper'|'real'), this);
                    }
                }
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
            for (const key of ['games', 'wins', 'losses', 'winrate', 'pnl', 'xp']) {
                const cN = this._portfolioPanel.getChildByName(`PFStatCard_${key}`);
                const vL = cN?.getChildByName('Value')?.getComponent(Label) ?? null;
                if (vL) this._pfStatValues.set(key, vL);
            }
        }
        console.log(`${TAG} start | TokenDuel lb_panel=${!!this._leaderboardPanel} rows=${this._lbRowNodes.length}/10 pf_panel=${!!this._portfolioPanel} stats=${this._pfStatValues.size}/6`);

        // Session 14 B5: start with empty squad + stake cluster hidden; Run Squad reveals it.
        this._setStakeClusterVisible(false);
        this._refreshSquadActionButtons();

        // Session D Part 2: ModePickerOverlay bindings.
        this._modePickerOverlay = this._tokenDuelPanel.getChildByName('ModePickerOverlay') ?? null;
        if (this._modePickerOverlay) {
            // Scrim button (tap-outside to cancel)
            const scrimBtn = this._modePickerOverlay.getComponent(Button);
            scrimBtn?.node.on(Button.EventType.CLICK, () => this._onPickerCancel(), this);
            // Mode buttons
            for (const key of ['oneVone', '4p', '8p', 'br10']) {
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
            const windowKeys: TimeWindowId[] = ['1h', '1d', '3d', '7d'];
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
        }
        console.log(`${TAG} start | ModePickerOverlay wired=${!!this._modePickerOverlay} modes=${this._pickerModeButtons.size} wagers=${this._pickerWagerButtons.size} toggles=${!!this._pickerPaperToggle}/${!!this._pickerRealToggle} cta=${!!this._pickerStartButton} wager_readout=${!!this._pickerWagerReadout}`);

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
        // Part 13: rake labels across panels.
        this._homeRakeChip      = this._homePanel.getChildByName('HomeRakeChip')?.getComponent(Label) ?? null;
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
            }
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
        const mwa = MWAManager.instance;
        if (!mwa) {
            this._showLanding();
            return;
        }
        try {
            const result = await mwa.reauthorize();
            if (result) {
                console.log(`${TAG} _attemptAutoSignIn | SUCCESS pubkey=${result.pubkey} — showing Home`);
                showToast('Extensible auth cache — session restored', true);
                this._showHome();
            } else {
                console.log(`${TAG} _attemptAutoSignIn | FAIL reauthorize returned null — showing Landing`);
                this._showLanding();
            }
        } catch (e: any) {
            console.log(`${TAG} _attemptAutoSignIn | EXCEPTION err=${e?.message || e} — showing Landing`);
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
        if (this._landingStatus) this._landingStatus.string = 'Tap Connect to link your wallet';
        if (this._reconnectButton) this._reconnectButton.node.active = hasCached;
        this._setLandingEnabled(true);
    }

    private _showHome(): void {
        console.log(`${TAG} _showHome | switching to home panel`);
        this._setActivePanel('home');
        const mwa = MWAManager.instance;
        const pubkey = mwa?.connectedPubkey ?? '';
        if (this._pubkeyLabel) {
            const short = pubkey.length > 8
                ? pubkey.substring(0, 4) + '...' + pubkey.substring(pubkey.length - 4)
                : pubkey || 'Not connected';
            const walletName = mwa?.walletDisplayName() ?? '';
            this._pubkeyLabel.string = walletName ? `${short} (${walletName})` : short;
        }
        if (this._homeStatus) this._homeStatus.string = 'Connected \u2014 choose an action';
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

        // Hide Sign Message button on wallets that don't implement sign_messages
        // (Phantom, Solflare). See MWAManager.supportsSignMessages() and
        // KNOWN_ISSUES.md #11 for the evidence.
        const signMsgBtnNode = this._homePanel.getChildByName('SignMessageButton');
        if (signMsgBtnNode) {
            const supported = mwa?.supportsSignMessages() ?? true;
            signMsgBtnNode.active = supported;
            if (!supported) {
                console.log(`${TAG} _showHome | hiding SignMessageButton — wallet doesn't declare sign_messages support (pkg="${mwa?.connectedWalletPackage || '(unknown)'}")`);
            }
        }
        console.log(`${TAG} _showHome | DONE pubkey=${this._pubkeyLabel?.string}`);
    }

    private _showTokenDuel(): void {
        console.log(`${TAG} _showTokenDuel | switching to Token Duel panel`);
        this._setActivePanel('tokenDuel');
        this._resetStakeFlow();
        this._hideLegacyBettingDuelNodes();
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

    private _setActivePanel(which: 'landing' | 'home' | 'tokenDuel'): void {
        this._landingPanel.active = which === 'landing';
        this._homePanel.active = which === 'home';
        this._tokenDuelPanel.active = which === 'tokenDuel';
        // Part 12 C: stop ticker timers when Home is not the active panel.
        if (which !== 'home') this._stopMatchTicker();
        // Part 14: stop tournament countdown when leaving Home.
        if (which !== 'home') this._stopTournamentCountdown();
        console.log(`${TAG} _setActivePanel | DONE which=${which} landing=${this._landingPanel.active} home=${this._homePanel.active} tokenDuel=${this._tokenDuelPanel.active}`);
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

    private async _onConnect(): Promise<void> {
        console.log(`${TAG} onConnect | START — opening OS wallet picker`);
        this._setLandingEnabled(false);
        if (this._landingStatus) this._landingStatus.string = 'Opening wallet...';

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
            const shortPk = `${result.pubkey.substring(0, 4)}...${result.pubkey.substring(result.pubkey.length - 4)}`;
            if (hasSiws) {
                showToast(`Signed in with Solana: ${shortPk}`, true);
            } else {
                showToast(`Connected: ${shortPk}`);
                showToast('Auth cached');
            }
            this._showHome();
        } else {
            console.log(`${TAG} onConnect | FAIL result=null`);
            showToast('Authorization failed');
            if (this._landingStatus) this._landingStatus.string = 'Authorization failed';
            this._setLandingEnabled(true);
        }
    }

    private async _onReconnect(): Promise<void> {
        console.log(`${TAG} onReconnect | START`);
        this._setLandingEnabled(false);
        if (this._landingStatus) this._landingStatus.string = 'Reconnecting...';

        const result = await MWAManager.instance?.reauthorize();
        if (result) {
            console.log(`${TAG} onReconnect | SUCCESS pubkey=${result.pubkey}`);
            showToast('Reconnected');
            this._showHome();
        } else {
            console.log(`${TAG} onReconnect | FAIL result=null`);
            showToast('Reconnect failed');
            if (this._landingStatus) this._landingStatus.string = 'Reconnect failed';
            this._setLandingEnabled(true);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  HOME HANDLERS
    // ═══════════════════════════════════════════════════════════════════

    private _onPlayTokenDuel(): void {
        console.log(`${TAG} onPlayTokenDuel | transitioning to Token Duel panel`);
        this._showTokenDuel();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Part 10 Bundle 2 — Quick Play + Squad Presets + Suggested Squad
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Quick Play: the zero-to-first-match button. Auto-fills squad from top
     * 24h gainers, applies cached picker defaults from Settings (or sensible
     * defaults), and kicks the standard pickerStart flow. Falls back to
     * VETTED_MINTS random trio if Birdeye gainers are unavailable.
     */
    private async _onQuickPlay(): Promise<void> {
        console.log(`${TAG} _onQuickPlay | START`);
        // Defaults. Future Settings UI will let the user override these.
        const ls = this._readLocalStorage();
        const modeId = (ls?.getItem?.('tokenduel:qp.mode') as keyof typeof MODES) ?? 'oneVone';
        const wagerIdx = parseInt(ls?.getItem?.('tokenduel:qp.wager') ?? '0', 10) || 0;
        const windowId = (ls?.getItem?.('tokenduel:qp.window') as TimeWindowId) ?? DEFAULT_TIME_WINDOW;
        const track = (ls?.getItem?.('tokenduel:qp.track') as 'paper' | 'real') ?? 'paper';

        this._pickerSelectedMode = MODES[modeId] ? modeId : 'oneVone';
        this._pickerSelectedWagerIndex = wagerIdx;
        this._pickerSelectedWindow = windowId;
        this._pickerSelectedTrack = track;

        // Show Token Duel panel (needed for game-area + WaitingPanel lifecycle).
        this._showTokenDuel();

        // Auto-fill squad.
        const filled = await this._autoFillSquadForQuickPlay();
        if (!filled) {
            showToast('Squad fill failed — tap tokens manually');
            return;
        }
        // Kick off via the standard _onPickerStart flow (mode/wager/window/track already set).
        try { this._onPickerStart(); } catch (e) { console.log(`${TAG} _onQuickPlay | STARTER_ERROR ${e}`); }
    }

    private async _autoFillSquadForQuickPlay(): Promise<boolean> {
        // Strategy 1: last-winning squad.
        try {
            const preset = SquadPresets.getLastWinning();
            if (preset && preset.winCount > 0) {
                this._applySquadFromSlots(preset.slots);
                console.log(`${TAG} _autoFillSquadForQuickPlay | USED_LAST_WINNING name="${preset.name}"`);
                return true;
            }
        } catch (_) { /* fall through */ }

        // Strategy 2: top 3 24h gainers.
        try {
            this._ensureBirdeye();
            const rows = await this._birdeye!.getTrending('gainers', 3);
            if (rows && rows.length >= 3) {
                this._applySquadFromRows(rows.slice(0, 3));
                console.log(`${TAG} _autoFillSquadForQuickPlay | USED_GAINERS`);
                return true;
            }
        } catch (e) { console.log(`${TAG} _autoFillSquadForQuickPlay | GAINERS_ERROR ${e}`); }

        // Strategy 3: VETTED_MINTS random.
        try {
            const trio = randomVettedTrio();
            this._applySquadFromSlots(trio.map((t) => ({ mint: t.mint, symbol: t.symbol, logoUri: '' })));
            console.log(`${TAG} _autoFillSquadForQuickPlay | USED_VETTED`);
            return true;
        } catch (e) { console.log(`${TAG} _autoFillSquadForQuickPlay | VETTED_ERROR ${e}`); }

        return false;
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
            const filtered = this._pickerSelectedWindow === '3d' || this._pickerSelectedWindow === '7d'
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
        if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Tap to drop — stack as high as you can';

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
        });
        // Block 3: 3-2-1-GO countdown before race starts. Race is shown
        // (via _showRacePanel above) so the user sees entry state in the
        // background; countdown is the top-of-stack attention grabber.
        const squadSyms = gameHoldings.map((h) => h?.symbol || '?').filter((s) => s !== '?');
        this._showCountdown(squadSyms, () => {
            // `start()` is async (awaits Birdeye). Fire-and-forget; any tap
            // events before entry prices resolve are gated by the PortfolioRace
            // `_running` flag.
            this._game?.start().catch((e) => console.log(`${TAG} onStartGame | START_ERROR error=${e}`));
        });
    }

    private _onGameOver(height: number, deltas: Record<string, number>): void {
        console.log(`${TAG} onGameOver | height=${height} deltas=${JSON.stringify(deltas)}`);
        this._sessionDeltas = deltas;
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
                    if (this._tokenDuelStatus) this._tokenDuelStatus.string = 'Settle tx failed — retry from wallet';
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
        this._raceActiveHoldings = holdings.slice();
        this._raceLastDeltaSign = 0;
        this._raceTickBindingGapLogged = false;
        this._raceLatestSnapshot = null;
        this._raceEntryNoticeShown = false;

        // Block 2: opponent card — Paper gets a LiveSquadBot, Real hides
        // the card (no WS broadcast path yet; opponent revealed at end).
        // Round 4: Paper now dispatches on mode.requiredPlayers — 1v1 uses
        // the big card; 4p/8p use the 7-row leaderboard strip.
        const isPaper = this._pickerSelectedTrack === 'paper';
        const modeDef = MODES[this._pickerSelectedMode as keyof typeof MODES] ?? MODES.oneVone;
        const botCount = Math.max(0, modeDef.requiredPlayers - 1);

        // Clear prior bot state on every race start.
        this._liveSquadBot = null;
        this._liveSquadBots = [];
        if (this._raceOpponentCard) this._raceOpponentCard.active = false;
        if (this._raceOpponentStrip) this._raceOpponentStrip.active = false;
        for (const row of this._raceOpponentRows) row.active = false;

        if (isPaper && botCount === 1) {
            // 1v1 — big opponent card (unchanged from round 3).
            if (this._raceOpponentCard) this._raceOpponentCard.active = true;
            const windowMs = TIME_WINDOWS[this._pickerSelectedWindow]?.durationMs ?? TIME_WINDOWS[DEFAULT_TIME_WINDOW].durationMs;
            if (this._raceOpponentName) this._raceOpponentName.string = 'Bot';
            if (this._raceOpponentAvatar) this._raceOpponentAvatar.string = '🤖';
            if (this._raceOpponentSymbols) this._raceOpponentSymbols.string = 'picking squad…';
            import('../../token-duel/scripts/SquadBot').then(({ LiveSquadBot }) => {
                const bot = new LiveSquadBot(windowMs);
                this._liveSquadBot = bot;
                this._liveSquadBots = [bot];
                if (this._priceFeed) {
                    bot.start(this._priceFeed).then(() => {
                        const squad = bot.getSquad();
                        const syms = squad.map((s) => s.symbol).filter(Boolean);
                        if (this._raceOpponentSymbols) {
                            this._raceOpponentSymbols.string = syms.length > 0 ? syms.join(' · ') : '— · — · —';
                        }
                        console.log(`${TAG} _showRacePanel | live_bot ready squad=[${syms.join(',')}]`);
                    }).catch((e) => console.log(`${TAG} _showRacePanel | live_bot_start_error ${e}`));
                }
            }).catch((e) => console.log(`${TAG} _showRacePanel | squadbot_import_error ${e}`));
        } else if (isPaper && botCount > 1) {
            // 4p / 8p — leaderboard strip with N-1 bots.
            if (this._raceOpponentStrip) this._raceOpponentStrip.active = true;
            const windowMs = TIME_WINDOWS[this._pickerSelectedWindow]?.durationMs ?? TIME_WINDOWS[DEFAULT_TIME_WINDOW].durationMs;
            const visibleRows = Math.min(botCount, this._raceOpponentRows.length);
            for (let i = 0; i < visibleRows; i++) {
                const row = this._raceOpponentRows[i];
                if (row) row.active = true;
                if (this._raceOpponentRowNames[i]) this._raceOpponentRowNames[i].string = `Bot ${i + 1}`;
                if (this._raceOpponentRowSymbols[i]) this._raceOpponentRowSymbols[i].string = 'picking squad…';
                if (this._raceOpponentRowDeltas[i]) this._raceOpponentRowDeltas[i].string = '0.00%';
                if (this._raceOpponentRowGaps[i]) this._raceOpponentRowGaps[i].string = '';
            }
            console.log(`${TAG} _showRacePanel | STRIP_MODE mode=${this._pickerSelectedMode} bots=${visibleRows}/${botCount} (truncated=${botCount > visibleRows})`);
            import('../../token-duel/scripts/SquadBot').then(({ LiveSquadBot }) => {
                for (let i = 0; i < visibleRows; i++) {
                    const bot = new LiveSquadBot(windowMs);
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
            if (this._raceOpponentAvatar) this._raceOpponentAvatar.string = '👤';
            if (this._raceOpponentSymbols) this._raceOpponentSymbols.string = 'waiting for squad…';
            if (this._raceOpponentDelta) this._raceOpponentDelta.string = '—';
            if (this._raceOpponentGap) this._raceOpponentGap.string = '';
            // Opponent card should be visible on Real now that backend WS
            // can deliver their squad mints for client-side delta compute.
            if (this._raceOpponentCard) this._raceOpponentCard.active = true;
            this._subscribeOpponentSquad();
        }

        // Populate + activate N cards; hide the rest.
        const n = Math.min(holdings.length, this._raceTokenCards.length);
        for (let i = 0; i < this._raceTokenCards.length; i++) {
            const card = this._raceTokenCards[i];
            if (!card) continue;
            const show = i < n;
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
        if (this._raceCountdownLabel)    this._raceCountdownLabel.string = '—:—';
        if (this._raceHeroDeltaLabel) {
            this._raceHeroDeltaLabel.string = '+0.00%';
            this._raceHeroDeltaLabel.color  = new Color(255, 255, 255);
        }
        if (this._raceHeroSubtitleLabel) this._raceHeroSubtitleLabel.string = 'Fetching entry prices…';
        this._racePanel.active = true;
        if (this._gameArea) this._gameArea.active = false;
        const symbols = holdings.slice(0, n).map((h) => h?.symbol || '?').join(',');
        console.log(`${TAG} _showRacePanel | SHOW tokens=${n} cards_available=${this._raceTokenCards.length} symbols=[${symbols}]`);
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
            for (const m of mints) {
                const e = entry[m];
                const c = current[m];
                if (!Number.isFinite(e) || !Number.isFinite(c) || e <= 0) continue;
                sum += ((c - e) / e) * 100;
                count++;
            }
            if (count === 0) return;
            const oppDelta = sum / count;
            this._opponentDeltaPct = oppDelta;
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
        this._racePanel.active = false;
        console.log(`${TAG} _hideRacePanel | HIDDEN last_snapshot_portfolio=${this._raceLatestSnapshot?.portfolioDeltaPct?.toFixed(2) ?? 'null'}%`);
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
        // Countdown
        if (this._raceCountdownLabel) {
            const s = Math.max(0, Math.ceil(snap.remainingMs / 1000));
            const mm = Math.floor(s / 60).toString();
            const ss = (s % 60).toString().padStart(2, '0');
            this._raceCountdownLabel.string = `${mm}:${ss}`;
        }

        // Hero delta
        const deltaPct = snap.portfolioDeltaPct;
        const sign = deltaPct >= 0 ? '+' : '';
        const green = new Color(51, 204, 85);
        const red = new Color(255, 85, 85);
        const neutral = new Color(255, 255, 255);
        if (this._raceHeroDeltaLabel) {
            this._raceHeroDeltaLabel.string = `${sign}${deltaPct.toFixed(2)}%`;
            this._raceHeroDeltaLabel.color = snap.resolvedCount === 0 ? neutral : (deltaPct >= 0 ? green : red);
        }
        if (this._raceHeroSubtitleLabel) {
            this._raceHeroSubtitleLabel.string = snap.resolvedCount === 0
                ? 'Waiting for price feed…'
                : `Portfolio change (${snap.resolvedCount} token${snap.resolvedCount === 1 ? '' : 's'})`;
        }

        // Per-token cards
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

        // Haptic + sound on zero-cross (ignore first tick to avoid false-trigger at t=0).
        const curSign: 1 | -1 | 0 = deltaPct > 0 ? 1 : (deltaPct < 0 ? -1 : 0);
        if (this._raceLastDeltaSign !== 0 && curSign !== 0 && curSign !== this._raceLastDeltaSign) {
            try { Haptics.fire(HapticType.MEDIUM); } catch (_) { /* editor no-op */ }
            try { playSound(curSign > 0 ? 'stack' : 'miss'); } catch (_) { /* asset may be missing */ }
        }
        if (curSign !== 0) this._raceLastDeltaSign = curSign;

        // Block 2: opponent card (Paper only — live bot delta).
        // Round 4: dispatch on big-card vs strip — big card for 1v1, strip
        // for 4p/8p with N-1 bots iterated.
        if (this._pickerSelectedTrack === 'paper' && this._raceOpponentCard?.active && this._liveSquadBot) {
            // 1v1 big card (unchanged).
            const botSnap = this._liveSquadBot.deltaAt(snap.elapsedMs);
            if (this._raceOpponentDelta) {
                const s = botSnap.portfolioDeltaPct >= 0 ? '+' : '';
                this._raceOpponentDelta.string = `${s}${botSnap.portfolioDeltaPct.toFixed(2)}%`;
                this._raceOpponentDelta.color = botSnap.portfolioDeltaPct >= 0 ? green : red;
            }
            if (this._raceOpponentGap) {
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
        } else if (this._pickerSelectedTrack === 'paper' && this._raceOpponentStrip?.active && this._liveSquadBots.length > 1) {
            // 4p / 8p leaderboard strip — update each row from its LiveSquadBot.
            const neutral = new Color(140, 150, 170);
            for (let i = 0; i < this._liveSquadBots.length && i < this._raceOpponentRows.length; i++) {
                const botSnap = this._liveSquadBots[i].deltaAt(snap.elapsedMs);
                const deltaLbl = this._raceOpponentRowDeltas[i];
                const gapLbl = this._raceOpponentRowGaps[i];
                if (deltaLbl) {
                    const s = botSnap.portfolioDeltaPct >= 0 ? '+' : '';
                    deltaLbl.string = `${s}${botSnap.portfolioDeltaPct.toFixed(2)}%`;
                    deltaLbl.color = botSnap.portfolioDeltaPct >= 0 ? green : red;
                }
                if (gapLbl) {
                    const gap = deltaPct - botSnap.portfolioDeltaPct;
                    const abs = Math.abs(gap).toFixed(2);
                    if (gap > 0.05) {
                        gapLbl.string = `+${abs}pp`;
                        gapLbl.color = green;
                    } else if (gap < -0.05) {
                        gapLbl.string = `-${abs}pp`;
                        gapLbl.color = red;
                    } else {
                        gapLbl.string = '≈';
                        gapLbl.color = neutral;
                    }
                }
            }
        }

        // betting-duel live opponent delta (Real track). Opponent mints + entry
        // prices are captured via WS once both players have published their
        // squads; this tick updates their current delta from the same Birdeye
        // spot-price feed that drives the player's own portfolio race.
        if (this._pickerSelectedTrack === 'real' && this._raceOpponentCard?.active) {
            this._updateOpponentDeltaTick(deltaPct);
        }
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
        if (this._signingSpinnerLabel) {
            const node = this._signingSpinnerLabel.node;
            Tween.stopAllByTarget(node);
            node.angle = 0;
            tween(node).by(1.0, { angle: -360 }).repeatForever().start();
        }
        console.log(`${TAG} _showSigningOverlay | SHOW status="${status}"`);
    }

    private _hideSigningOverlay(): void {
        if (!this._signingOverlay) return;
        this._signingOverlay.active = false;
        if (this._signingSpinnerLabel) Tween.stopAllByTarget(this._signingSpinnerLabel.node);
        console.log(`${TAG} _hideSigningOverlay | HIDE`);
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
        const steps: Array<{ text: string; color: Color; haptic: HapticType }> = [
            { text: '3', color: new Color(218, 165, 32), haptic: HapticType.SOFT },
            { text: '2', color: new Color(218, 165, 32), haptic: HapticType.SOFT },
            { text: '1', color: new Color(236, 88, 122), haptic: HapticType.MEDIUM },
            { text: 'GO!', color: new Color(48, 198, 155), haptic: HapticType.HEAVY },
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
                this._countdownBigLabel.string = step.text;
                this._countdownBigLabel.color = step.color;
                const node = this._countdownBigLabel.node;
                node.scale = new Vec3(0.6, 0.6, 1);
                tween(node).to(0.35, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'backOut' })
                    .to(0.15, { scale: new Vec3(1, 1, 1) })
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
        const map: Record<FeedTabOrVirtual, string> = {
            'new':         '⚡ New Pairs  ▾',
            'trending':    '🔥 Trending  ▾',
            'gainers':     '📈 Top Gainers  ▾',
            'smart_money': '🧠 Smart Money  ▾',
            'watchlist':   '★ Watchlist  ▾',
            'top10':       '🏆 Top 10  ▾',
        };
        this._feedTabDropdownLabel.string = map[tab] ?? '▾';
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
        if (this._watchlistMode) {
            const n = this._watchlistChecked.size;
            if (spr) spr.color = n > 0 ? new Color(48, 198, 155, 255) : new Color(36, 76, 68, 255);
            if (this._watchlistStarLabel) {
                this._watchlistStarLabel.string = `+ ${n} to Watchlist`;
                this._watchlistStarLabel.color = n > 0 ? new Color(12, 18, 26, 255) : new Color(160, 200, 190, 255);
            }
            return;
        }
        const anyIn = Watchlist.size() > 0;
        if (spr) spr.color = anyIn ? new Color(70, 52, 14, 255) : new Color(28, 34, 48, 255);
        if (this._watchlistStarLabel) {
            this._watchlistStarLabel.string = anyIn ? '★ Watchlist' : '☆ Watchlist';
            this._watchlistStarLabel.color = anyIn ? new Color(218, 165, 32, 255) : new Color(180, 190, 210, 255);
        }
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

            // Session 14: checkbox visible in watchlist mode OR squad-pick mode.
            const chkSpr = this._feedRowCheckboxes[i];
            const anyCheckMode = this._watchlistMode || this._squadPickMode;
            if (chkSpr?.node) {
                chkSpr.node.active = anyCheckMode;
                const checked = this._squadPickMode
                    ? this._squadPickChecked.has(row.address)
                    : this._watchlistChecked.has(row.address);
                chkSpr.color = checked ? new Color(48, 198, 155, 255) : new Color(45, 52, 70, 255);
                const iconN = chkSpr.node.getChildByName('CheckmarkIcon');
                if (iconN) iconN.active = checked;
            }
            // Session 14 A2: shift logo right when any check mode is active
            // so the checkbox gets its own column and doesn't overlap the logo.
            // Row width is 680 (see generate-scenes.js); half-width = 340.
            const logoNode = this._feedRowLogoSprites[i]?.node;
            if (logoNode) {
                const targetX = anyCheckMode ? -280 : -310;
                const p = logoNode.position;
                if (p.x !== targetX) logoNode.setPosition(targetX, p.y, p.z);
            }

            // Logo.
            const logo = this._feedRowLogoSprites[i];
            if (logo?.node) logo.node.active = true;
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
        this._selectedRowMint = row.address;
        console.log(`${TAG} _onFeedRowTap | SELECT_OPEN_DETAIL index=${i} symbol="${row.symbol}" address=${row.address}`);
        this._renderFeedRows(this._currentFeedRows);
        this._showTokenDetail(row);
    }

    private _onSquadSlotTap(i: number): void {
        console.log(`${TAG} _onSquadSlotTap | index=${i} had=${this._squad.slots[i]?.symbol ?? 'empty'}`);
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
            if (!slot) {
                symLbl.string = '+';
                symLbl.color = new Color(200, 200, 200, 255);
                if (dltLbl) { dltLbl.string = ''; dltLbl.node.active = false; }
                if (logo) { logo.spriteFrame = null; logo.node.active = false; }
                if (btn) btn.node.active = false;
            } else {
                const d = slot.change24hPct;
                const sign = d > 0 ? '+' : '';
                const pctStr = Number.isFinite(d) && d !== 0 ? `${sign}${d.toFixed(1)}%` : '—';
                symLbl.string = slot.symbol ?? '?';
                symLbl.color = new Color(240, 242, 250, 255);
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
                if (btn) btn.node.active = true;
            }
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
            this._balanceChipLabel.string = `◼ ${sol.toFixed(4)} SOL`;
            console.log(`${TAG} _refreshBalanceChip | DONE owner="${owner.substring(0, 8)}..." lamports=${bal} sol=${sol.toFixed(4)}`);
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
        if (this._landingPanel.active && this._landingStatus) this._landingStatus.string = message;
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
        if (this._detailMintChipLabel) this._detailMintChipLabel.string = this._fmtMintShort(row.address) + ' 📋';
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
                label.string = `🔥 Day ${stats.currentStreak} streak — keep the fire going`;
                banner.active = true;
                console.log(`${TAG} _hydrateStreakBanner | SHOW streak=${stats.currentStreak}`);
            } else {
                banner.active = false;
            }
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
        // If a real match is live, try to refund (only succeeds after 120s timeout).
        if (this._activeRealMatchPda) {
            const matchPda = this._activeRealMatchPda;
            this._realPollAbortFlag = true;
            (async () => {
                if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Requesting refund — sign cancel tx';
                const ok = await this._submitCancelMatch(matchPda);
                if (!ok) {
                    if (this._waitingStatusLabel) this._waitingStatusLabel.string = 'Cancel failed — match not yet timed out (120s)';
                    return;
                }
                this._activeRealMatchPda = null;
                this._hideWaitingPanel();
                showToast('Refunded — match cancelled');
            })().catch((e) => {
                console.log(`${TAG} _onWaitingCancel | ERROR error=${e}`);
                if (this._waitingStatusLabel) this._waitingStatusLabel.string = `Cancel error: ${e?.message ?? e}`;
            });
            return;
        }
        this._hideWaitingPanel();
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
        const previousLevel = outcome.previousLevel ?? outcome.newLevel; // if not supplied, assume no level change
        const leveledUp = outcome.newLevel > previousLevel;

        if (this._postMatchTitleLabel) {
            // Session D Part 6: title reflects placement for multi-player modes.
            let title: string;
            const nth = (n: number): string => {
                const r = n + 1;
                if (r === 1) return '1st';
                if (r === 2) return '2nd';
                if (r === 3) return '3rd';
                return `${r}th`;
            };
            if (outcome.placement != null && outcome.totalPlayers != null && outcome.totalPlayers > 2) {
                title = `${nth(outcome.placement)} of ${outcome.totalPlayers}`;
            } else {
                title = outcome.won ? 'You Won!' : 'Close one…';
            }
            this._postMatchTitleLabel.string = title;
            this._postMatchTitleLabel.color = outcome.won ? new Color(48, 198, 155, 255) : new Color(236, 88, 122, 255);
        }
        if (this._postMatchTrackLabel) {
            const modeLbl = outcome.modeLabel ?? '1v1 Duel';
            this._postMatchTrackLabel.string = `${outcome.track === 'real' ? 'Real' : 'Paper'} · ${modeLbl}`;
        }
        if (this._postMatchPayoutLabel) {
            const sol = outcome.payoutLamports / 1e9;
            // Set a start frame immediately (prevents flash of stale prior value)
            // then tween to final over 1.2s when there's a positive payout.
            this._postMatchPayoutLabel.string = outcome.won ? '+0.000 SOL' : '— 0.000 SOL';
            if (outcome.won && sol > 0) {
                this._animatePayoutTicker(this._postMatchPayoutLabel, sol, 1.2);
            }
        }

        // betting-duel: decode encoded u32 scores back into portfolio delta % for display.
        const playerDeltaPct   = decodeScore(outcome.playerHeight);
        const opponentDeltaPct = decodeScore(outcome.opponentHeight);
        const deltaDiff        = Math.abs(playerDeltaPct - opponentDeltaPct);
        console.log(`${TAG} _showPostMatchPanel | DECODED player_score=${outcome.playerHeight} player=${playerDeltaPct.toFixed(2)}% opp_score=${outcome.opponentHeight} opp=${opponentDeltaPct.toFixed(2)}% diff_pp=${deltaDiff.toFixed(2)} won=${outcome.won} track=${outcome.track}`);

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
                this._postMatchSubtitleLabel.string = outcome.won
                    ? `Your portfolio beat theirs by ${deltaDiff.toFixed(2)} pp.`
                    : `They beat you by ${deltaDiff.toFixed(2)} pp.`;
                this._postMatchSubtitleLabel.color = new Color(180, 190, 210, 255);
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
        let xpCardString = `+${outcome.xpGained}`;
        if (outcome.totalXp && outcome.totalXp > 0) {
            const prog = levelProgress(outcome.totalXp);
            xpCardString = `+${outcome.xpGained}\n${outcome.totalXp} · ${Math.round(prog.progress * 100)}%→L${prog.level + 1}`;
        }
        const fmtPct = (p: number): string => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
        const values = new Map([
            ['you', fmtPct(playerDeltaPct)],
            ['opp', fmtPct(opponentDeltaPct)],
            ['xp',  xpCardString],
            ['lvl', String(outcome.newLevel)],
        ]);
        for (const [k, v] of values) {
            const lbl = this._postMatchCardValues.get(k);
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

        // Tint LEVEL card when leveled up.
        const lvlLabel = this._postMatchCardValues.get('lvl');
        if (lvlLabel) {
            lvlLabel.color = leveledUp ? new Color(48, 198, 155, 255) : new Color(255, 255, 255, 255);
        }

        console.log(`${TAG} _showPostMatchPanel | won=${outcome.won} player=${outcome.playerHeight} opp=${outcome.opponentHeight} xp=${outcome.xpGained} total_xp=${outcome.totalXp ?? '?'} level_was=${previousLevel} level_now=${outcome.newLevel} level_up=${leveledUp} payout_sol=${(outcome.payoutLamports / 1e9).toFixed(4)} track=${outcome.track}`);

        // Part 11 C: PostMatch audio — victory fanfare on 1st, level-up chime
        // layered on top if the XP gain pushed into a new level.
        if (outcome.won && outcome.placement === 0) {
            playSound('victory');
        }
        if (leveledUp) {
            // Slight delay so the two clips don't collide when both fire.
            setTimeout(() => playSound('level_up'), 400);
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
    }

    /**
     * Show/hide + tween the TrophyLabel on PostMatchPanel based on placement.
     * Placement is 0-indexed (0 = 1st place). Idempotent per panel show.
     */
    private _animatePostMatchTrophy(placement: number): void {
        if (!this._postMatchPanel) return;
        const trophyN = this._postMatchPanel.getChildByName('TrophyLabel');
        if (!trophyN) return;
        const trophyL = trophyN.getComponent(Label);
        if (!trophyL) return;

        Tween.stopAllByTarget(trophyN);
        trophyN.active = placement <= 2;
        if (!trophyN.active) {
            console.log(`${TAG} _animatePostMatchTrophy | HIDE placement=${placement}`);
            return;
        }

        const emoji = placement === 0 ? '🏆' : placement === 1 ? '🥈' : '🥉';
        trophyL.string = emoji;
        trophyN.setScale(0.01, 0.01, 1);
        trophyN.angle = 0;

        if (placement === 0) {
            // 1st place: full celebration — scale-from-0 + bounce + 360° spin.
            // Peak scale dropped 1.4 → 1.15 so the trophy stays inside its
            // 200×100 box and doesn't overshoot into neighboring cards.
            tween(trophyN)
                .to(0.3, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backOut' })
                .to(0.2, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'cubicIn' })
                .to(0.1, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'cubicOut' })
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
            console.log(`${TAG} _animatePostMatchTrophy | RUNNER_UP placement=${placement} emoji=${emoji}`);
        }
    }

    /**
     * Session D Part 8: spawn 12 confetti emoji labels from the trophy center
     * and fan them outward with randomized angle + distance + rotation.
     * Confetti nodes are pre-built in the scene as children of TrophyLabel
     * (`Confetti_0..11`). We reset each one's transform, then tween.
     */
    private _animateConfetti(trophyN: Node): void {
        for (let i = 0; i < 12; i++) {
            const confN = trophyN.getChildByName(`Confetti_${i}`);
            if (!confN) continue;
            Tween.stopAllByTarget(confN);
            confN.active = true;
            confN.setPosition(0, 0, 0);
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
                    position: new Vec3(tx, ty, 0),
                    scale: new Vec3(1.0, 1.0, 1),
                }, { easing: 'cubicOut' })
                .call(() => { confN.active = false; })
                .start();
            tween(confN)
                .by(0.9, { angle: spin }, { easing: 'cubicOut' })
                .start();
        }
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
        tween(proxy)
            .to(durationS, { v: toSol }, {
                easing: 'quadOut',
                onUpdate: () => {
                    label.string = `+${proxy.v.toFixed(3)} SOL`;
                    const now = Date.now();
                    if (now < stopAt && now - lastTickMs >= tickEvery) {
                        lastTickMs = now;
                        try { playSound('stack'); } catch (e) { console.log(`${TAG} _animatePayoutTicker | SOUND_ERROR error=${e}`); }
                    }
                },
            })
            .call(() => {
                label.string = `+${toSol.toFixed(3)} SOL`;
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
        // Session D Part 6: all 4 modes active. Scene maps scene-level key
        // ('4p', '8p', 'br10') → ModeId.
        const sceneToModeId: Record<string, string> = {
            oneVone: 'oneVone',
            '4p':    'fourPlayer',
            '8p':    'eightPlayer',
            br10:    'battleRoyale',
        };
        const modeId = sceneToModeId[key] ?? 'oneVone';
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

    private _onPickerCancel(): void {
        console.log(`${TAG} _onPickerCancel | CLOSE`);
        if (this._modePickerOverlay) this._modePickerOverlay.active = false;
    }

    private _onPickerStart(): void {
        const wager = WAGER_TIERS_LAMPORTS[this._pickerSelectedWagerIndex];
        const track = this._pickerSelectedTrack;
        console.log(`${TAG} _onPickerStart | mode=${this._pickerSelectedMode} wager_lamports=${wager} track=${track}`);

        // Session D Part 4: real-mode on-chain flow — init stats + join match + poll.
        if (track === 'real') {
            if (this._modePickerOverlay) this._modePickerOverlay.active = false;
            const modeDef = MODES[this._pickerSelectedMode as keyof typeof MODES] ?? MODES.oneVone;
            this._showWaitingPanel({
                mode: modeDef.label,
                wagerSol: wager / 1e9,
                track: 'real',
                status: 'Checking wallet…',
                requiredPlayers: modeDef.requiredPlayers,
            });
            // Cache selections so settle flow knows what to do. Session D Part 6: derive modeU8 from picker.
            const modeMap: Record<string, number> = { oneVone: 0, fourPlayer: 1, eightPlayer: 2, battleRoyale: 3 };
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
                const joinResult = await this._submitRealJoinMatch(this._realMatchMode, this._realMatchWagerTier);
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
                } else if (outcome === 'settled' || outcome === 'cancelled') {
                    this._activeRealMatchPda = null;
                    this._hideWaitingPanel();
                    showToast(outcome === 'settled' ? 'Match already settled' : 'Match cancelled');
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
    ): Promise<{ matchPda: string; action: 'create' | 'join' } | null> {
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.connectedPubkey) return null;
        const pubkey = mwa.connectedPubkey;
        console.log(`${TAG} _submitRealJoinMatch | START mode_u8=${mode} tier=${wagerTierIndex}`);

        // XP bucket from on-chain UserStats (default 0 if not initialized).
        const stats = await loadRealStats(this._tdRpc, pubkey);
        const xpBucket = stats.loaded ? stats.xpBucket : 0;

        // Session D Part 6: resolve ModeId from modeU8 byte.
        const modeIdMap: Record<number, 'oneVone' | 'fourPlayer' | 'eightPlayer' | 'battleRoyale'> = {
            0: 'oneVone', 1: 'fourPlayer', 2: 'eightPlayer', 3: 'battleRoyale',
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
            return { matchPda: result.matchPda, action: result.action };
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            console.log(`${TAG} _submitRealJoinMatch | FAIL ${msg}`);
            if (this._waitingStatusLabel) this._waitingStatusLabel.string = `Join failed: ${msg.substring(0, 60)}`;
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
        console.log(`${TAG} _submitSettleMatch | START match=${matchPda} height=${height} verified_path=${this._useVerifiedPath}`);
        // Fresh read so winner derivation uses latest heights + settled_count.
        const matchState = await getMatch(this._tdRpc, matchPda);
        if (!matchState) {
            console.log(`${TAG} _submitSettleMatch | NO_MATCH match=${matchPda}`);
            return false;
        }

        // betting-duel: verified path is dead code. Always legacy `settle_match`.
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

    /** Submit cancel_match. Only succeeds if ≥ 120s elapsed since match created. */
    private async _submitCancelMatch(matchPda: string): Promise<boolean> {
        const mwa = MWAManager.instance;
        if (!mwa || !mwa.connectedPubkey) return false;
        console.log(`${TAG} _submitCancelMatch | START match=${matchPda}`);
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
    private _refreshModePickerUi(): void {
        // Session D Part 6: all 4 modes are active.
        const sceneToModeId: Record<string, string> = {
            oneVone: 'oneVone',
            '4p':    'fourPlayer',
            '8p':    'eightPlayer',
            br10:    'battleRoyale',
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
        // Status line
        if (this._pickerStatusLabel) {
            const modeLabel = MODES[this._pickerSelectedMode as keyof typeof MODES]?.label ?? '—';
            const windowLabel = TIME_WINDOWS[this._pickerSelectedWindow]?.label ?? '—';
            const label = `${modeLabel} · ${WAGER_TIERS_LABELS[this._pickerSelectedWagerIndex]} · ${windowLabel} · ${this._pickerSelectedTrack === 'paper' ? 'Paper' : 'Real'}`;
            this._pickerStatusLabel.string = label;
        }
        if (this._pickerWagerReadout) {
            this._pickerWagerReadout.string = `Wager: ${WAGER_TIERS_LABELS[this._pickerSelectedWagerIndex]} · tap Start to confirm`;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  betting-duel polish — Wager control row (TokenDuelPanel bottom)
    // ═══════════════════════════════════════════════════════════════

    /** Refresh the wager value button label + start button enabled state. */
    private _refreshWagerControlRow(): void {
        const label = WAGER_TIERS_LABELS[this._pickerSelectedWagerIndex] ?? '0.05 SOL';
        if (this._wagerValueLabel) this._wagerValueLabel.string = `💰 ${label}  ▾`;
        const filled = this._squad.filled;
        const ready = filled === 3;
        if (this._wagerStartButton) {
            this._wagerStartButton.interactable = ready;
            if (this._wagerStartLabel) {
                this._wagerStartLabel.string = ready ? '▶ Start Match' : `Pick ${3 - filled} more`;
            }
        }
        if (this._wagerHintLabel) {
            this._wagerHintLabel.string = ready
                ? `Ready · ${label} · tap Start to launch`
                : `Pick ${3 - filled} more token${3 - filled === 1 ? '' : 's'} to start`;
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

    /** User tapped the Start Match button — open ModePicker for mode/window/track confirmation. */
    private _onWagerStartTap(): void {
        const filled = this._squad.filled;
        if (filled !== 3) {
            showToast(`Pick ${3 - filled} more token${3 - filled === 1 ? '' : 's'} to start`);
            console.log(`${TAG} _onWagerStartTap | NOT_READY filled=${filled}/3`);
            return;
        }
        if (this._wagerDropdown) this._wagerDropdown.active = false;
        this._syncBackdrop();
        console.log(`${TAG} _onWagerStartTap | OPEN_PICKER wager_idx=${this._pickerSelectedWagerIndex}`);
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
            (this._columnsPopoverNode && this._columnsPopoverNode.active) ||
            (this._searchPopoverNode && this._searchPopoverNode.active) ||
            (this._wagerDropdown && this._wagerDropdown.active)
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
        if (this._columnsPopoverNode) { this._columnsPopoverNode.active = false; this._columnsPopoverOpen = false; }
        if (this._searchPopoverNode) this._searchPopoverNode.active = false;
        if (this._wagerDropdown) this._wagerDropdown.active = false;
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
        // Drop button
        if (this._squadDropButton) {
            this._squadDropButton.interactable = filled > 0 && !this._squadLocked;
            const spr = this._squadDropButton.node.getComponent(Sprite);
            if (spr) spr.color = filled > 0 && !this._squadLocked ? new Color(40, 50, 68, 255) : new Color(26, 30, 42, 255);
        }
        if (this._squadDropLabel) this._squadDropLabel.string = filled > 0 ? `Manage Squad (${filled})` : 'Manage Squad';
        // Run button
        if (this._squadRunButton) {
            const canRun = filled >= 1 && !this._squadPickMode && !this._squadLocked;
            this._squadRunButton.interactable = canRun;
            const spr = this._squadRunButton.node.getComponent(Sprite);
            if (spr) spr.color = canRun ? new Color(56, 148, 252, 255) : new Color(30, 50, 80, 255);
        }
        if (this._squadRunLabel) this._squadRunLabel.string = this._squadLocked ? 'Locked' : '▶ Run Squad';
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

    private _onSquadRunClick(): void {
        if (this._squad.filled < 1) {
            console.log(`${TAG} _onSquadRunClick | NOOP filled=0`);
            showToast('Pick at least 1 token');
            return;
        }
        // Session D Part 2: open ModePickerOverlay if present; else legacy stake-cluster fallback.
        if (this._modePickerOverlay) {
            console.log(`${TAG} _onSquadRunClick | OPEN_PICKER filled=${this._squad.filled}`);
            this._modePickerOverlay.active = true;
            this._refreshModePickerUi();
            return;
        }
        console.log(`${TAG} _onSquadRunClick | NO_PICKER — legacy stake cluster fallback`);
        this._setStakeClusterVisible(true);
        this._refreshSquadActionButtons();
        showToast('Squad locked — set stake + commit');
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION 14 C — Leaderboard + Portfolio entry points
    // ═══════════════════════════════════════════════════════════════

    private async _onOpenLeaderboardClick(): Promise<void> {
        if (!this._leaderboardPanel) return;
        console.log(`${TAG} _onOpenLeaderboardClick | OPEN mode=${this._lbFilterMode}`);
        // betting-duel polish: force-hide every other top-level panel so no
        // stale text (e.g. "Token Duel" title) bleeds behind the leaderboard
        // rows on device. `_setActivePanel` only knows about landing/home/
        // tokenDuel; this covers the full set.
        this._hideAllTopLevelPanelsExcept('leaderboard');
        this._leaderboardPanel.active = true;
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
     * Session D Part 8: populate the PersonalRankCard below the leaderboard
     * rows. Shows: user's rank on the current mode (if in top-10) or "not
     * yet ranked" + their W–L/Level/P/L from on-chain UserStats.
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

        // Find own rank in the current mode's top-10.
        let rankStr = 'Not yet ranked · win to climb';
        try {
            const entries = await fetchLeaderboard(this._tdRpc, this._lbFilterMode);
            const mine = entries.findIndex((e) => e.player === pubkey);
            if (mine >= 0) {
                const mode = modeFromU8(this._lbFilterMode);
                rankStr = `Rank #${mine + 1} on ${mode.label}`;
            }
        } catch (e) {
            console.log(`${TAG} _refreshPersonalRankCard | LEADERBOARD_ERR ${e}`);
        }

        // Populate stats from on-chain UserStats.
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
        console.log(`${TAG} _refreshPersonalRankCard | mode=${this._lbFilterMode} pubkey=${pubkey.substring(0, 8)}… rank="${rankStr}"`);
    }

    /** Highlight the active mode tab (teal) and dim the others. */
    private _refreshLeaderboardTabTints(): void {
        const map: Record<number, string> = { 0: '1v1', 1: '4p', 2: '8p', 3: 'br10', 4: 'season' };
        const activeKey = map[this._lbFilterMode];
        for (const [key, btn] of this._lbTabButtons) {
            const spr = btn.node.getComponent(Sprite);
            if (!spr) continue;
            spr.color = key === activeKey
                ? new Color(48, 198, 155, 255)
                : new Color(38, 44, 64, 255);
        }
    }

    /** Fetch the active-mode Leaderboard PDA and render rows. */
    private async _refreshLeaderboardPanelRows(): Promise<void> {
        const titleL = this._leaderboardPanel?.getChildByName('LeaderboardTitleLabel')?.getComponent(Label);
        if (titleL) {
            const label = modeFromU8(this._lbFilterMode).label;
            titleL.string = `🏆 Leaderboard · ${label}`;
        }
        let entries: ModeLeaderboardEntry[] = [];
        try {
            entries = await fetchLeaderboard(this._tdRpc, this._lbFilterMode);
        } catch (e) {
            console.log(`${TAG} _refreshLeaderboardPanelRows | ERROR mode=${this._lbFilterMode} error=${e}`);
        }
        const nowSec = Math.floor(Date.now() / 1000);
        for (let i = 0; i < this._lbRowNodes.length; i++) {
            const n = this._lbRowNodes[i];
            const entry = entries[i];
            if (!entry || entry.height === 0) { n.active = false; continue; }
            n.active = true;
            const rankL = n.getChildByName('RankLabel')?.getComponent(Label);
            const playerL = n.getChildByName('PlayerLabel')?.getComponent(Label);
            const heightL = n.getChildByName('HeightLabel')?.getComponent(Label);
            const elapsedL = n.getChildByName('ElapsedLabel')?.getComponent(Label);
            if (rankL) rankL.string = `${i + 1}.`;
            if (playerL) playerL.string = this._fmtMintShort(entry.player);
            if (heightL) heightL.string = `H${entry.height}`;
            if (elapsedL) {
                const diffSec = Math.max(0, nowSec - Number(entry.settledAt));
                elapsedL.string = diffSec < 60 ? `${diffSec}s ago`
                                : diffSec < 3600 ? `${Math.floor(diffSec / 60)}m ago`
                                : diffSec < 86400 ? `${Math.floor(diffSec / 3600)}h ago`
                                : `${Math.floor(diffSec / 86400)}d ago`;
            }
            const spr = n.getComponent(Sprite);
            if (spr) {
                spr.color = i === 0 ? new Color(60, 48, 14, 255)
                          : i === 1 ? new Color(40, 42, 50, 255)
                          : i === 2 ? new Color(45, 32, 18, 255)
                          :           new Color(18, 22, 32, 255);
            }
        }
        console.log(`${TAG} _refreshLeaderboardPanelRows | DONE mode=${this._lbFilterMode} rows=${entries.length}`);
    }

    private _onLeaderboardBackClick(): void {
        if (!this._leaderboardPanel) return;
        console.log(`${TAG} _onLeaderboardBackClick | CLOSE`);
        this._leaderboardPanel.active = false;
        this._tokenDuelPanel.active = true;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 10 pt2 — Season tab (🏆 This Week) render path
    // ═══════════════════════════════════════════════════════════════

    /**
     * Fetch the current Season PDA and render entries into the same LBRow_*
     * pool the mode tabs use, but with a `wins` column instead of `height`.
     * Updates the title label + height-label (repurposed) accordingly.
     */
    private async _refreshSeasonTab(): Promise<void> {
        const titleL = this._leaderboardPanel?.getChildByName('LeaderboardTitleLabel')?.getComponent(Label);
        if (titleL) titleL.string = '🏆 Leaderboard · This Week';
        let season: SeasonState | null = null;
        try {
            season = await getCurrentSeason(this._tdRpc);
        } catch (e) {
            console.log(`${TAG} _refreshSeasonTab | ERROR ${e}`);
        }
        const entries: SeasonEntry[] = season?.entries ?? [];
        const nowSec = Math.floor(Date.now() / 1000);
        for (let i = 0; i < this._lbRowNodes.length; i++) {
            const n = this._lbRowNodes[i];
            const e = entries[i];
            if (!e || e.wins === 0) { n.active = false; continue; }
            n.active = true;
            const rankL = n.getChildByName('RankLabel')?.getComponent(Label);
            const playerL = n.getChildByName('PlayerLabel')?.getComponent(Label);
            const heightL = n.getChildByName('HeightLabel')?.getComponent(Label);
            const elapsedL = n.getChildByName('ElapsedLabel')?.getComponent(Label);
            if (rankL) rankL.string = `${i + 1}.`;
            if (playerL) playerL.string = this._fmtMintShort(e.player);
            if (heightL) heightL.string = `${e.wins}w`;
            if (elapsedL) {
                const diffSec = Math.max(0, nowSec - Number(e.at));
                elapsedL.string = diffSec < 60 ? `${diffSec}s ago`
                                : diffSec < 3600 ? `${Math.floor(diffSec / 60)}m ago`
                                : diffSec < 86400 ? `${Math.floor(diffSec / 3600)}h ago`
                                : `${Math.floor(diffSec / 86400)}d ago`;
            }
            const spr = n.getComponent(Sprite);
            if (spr) {
                spr.color = i === 0 ? new Color(60, 48, 14, 255)
                          : i === 1 ? new Color(40, 42, 50, 255)
                          : i === 2 ? new Color(45, 32, 18, 255)
                          :           new Color(18, 22, 32, 255);
            }
        }
        console.log(`${TAG} _refreshSeasonTab | DONE season_id=${season?.seasonId ?? 'null'} entries=${entries.length}`);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Part 10 pt2 — DailyChallengePanel hydration + render
    // ═══════════════════════════════════════════════════════════════

    /**
     * Short status for the Home DailyStreakStrip — one fetch, fail-soft on
     * missing PDAs (pre-bootstrap) or missing UserStats (v1 not migrated yet).
     */
    private async _hydrateDailyChallengeWidget(): Promise<void> {
        const strip = this._homePanel.getChildByName('DailyStreakStrip');
        const label = strip?.getChildByName('Label')?.getComponent(Label);
        if (!label) return;
        const pubkey = MWAManager.instance?.connectedPubkey ?? null;
        if (!pubkey) {
            label.string = '🔥 Connect wallet to start your streak';
            return;
        }
        try {
            const [stats, dc, seasonRank] = await Promise.all([
                getUserStats(this._tdRpc, pubkey),
                getCurrentDailyChallenge(this._tdRpc),
                getUserSeasonRank(this._tdRpc, pubkey),
            ]);
            const streak = stats?.currentStreak ?? 0;
            const bitsDone = stats ? countCompleted(stats.dailyChallengesBitmask) : 0;
            const total = dc?.challenges.length ?? 3;
            const rank = seasonRank ? `#${seasonRank.rank}` : '—';
            label.string = `🔥 Day ${streak} · ${bitsDone}/${total} challenges · Season ${rank}`;
        } catch (e) {
            console.log(`${TAG} _hydrateDailyChallengeWidget | ERROR ${e}`);
            label.string = '🔥 Day 1 · Play a match to start your streak';
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

        // Streak card.
        const streakCard = this._dailyChallengePanel.getChildByName('DailyStreakCard');
        const streakDay = streakCard?.getChildByName('StreakDayLabel')?.getComponent(Label);
        const streakBest = streakCard?.getChildByName('StreakBestLabel')?.getComponent(Label);
        if (streakDay) streakDay.string = `Day ${stats?.currentStreak ?? 0}`;
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

    private _onQPModeClick(uiKey: string, logicalKey: string): void {
        const ls = this._readLocalStorage();
        ls?.setItem('tokenduel:qp.mode', logicalKey);
        console.log(`${TAG} _onQPModeClick | ui=${uiKey} logical=${logicalKey}`);
        this._refreshQPCard();
    }

    private _onQPWindowClick(w: string): void {
        const ls = this._readLocalStorage();
        ls?.setItem('tokenduel:qp.window', w);
        console.log(`${TAG} _onQPWindowClick | window=${w}`);
        this._refreshQPCard();
    }

    private _onQPWagerClick(key: string, idx: number): void {
        const ls = this._readLocalStorage();
        ls?.setItem('tokenduel:qp.wager', idx.toString());
        console.log(`${TAG} _onQPWagerClick | key=${key} idx=${idx}`);
        this._refreshQPCard();
    }

    private _onQPTrackClick(track: 'paper' | 'real'): void {
        const ls = this._readLocalStorage();
        ls?.setItem('tokenduel:qp.track', track);
        console.log(`${TAG} _onQPTrackClick | track=${track}`);
        this._refreshQPCard();
    }

    /** Read current LS values and tint all 4 QP radio rows. */
    private _refreshQPCard(): void {
        const ls = this._readLocalStorage();
        const logicalMode = (ls?.getItem('tokenduel:qp.mode') ?? 'oneVone');
        const windowKey = ls?.getItem('tokenduel:qp.window') ?? '1d';
        const wagerIdx = parseInt(ls?.getItem('tokenduel:qp.wager') ?? '2', 10);
        const track = (ls?.getItem('tokenduel:qp.track') ?? 'paper');
        const uiMode = ({ oneVone: '1v1', fourPlayer: '4p', eightPlayer: '8p', battleRoyale: 'br10' } as Record<string, string>)[logicalMode] ?? '1v1';
        const wagerKey = ['001','005','01','025','05'][wagerIdx] ?? '01';
        const active = new Color(48, 198, 155, 255);
        const inactive = new Color(28, 34, 48, 255);
        const tint = (map: Map<string, Button>, activeKey: string) => {
            for (const [k, b] of map) {
                const spr = b.node.getComponent(Sprite);
                if (spr) spr.color = k === activeKey ? active : inactive;
            }
        };
        tint(this._qpModeButtons, uiMode);
        tint(this._qpWindowButtons, windowKey);
        tint(this._qpWagerButtons, wagerKey);
        tint(this._qpTrackButtons, track);
    }

    // ═══════════════════════════════════════════════════════════════
    //  SESSION D PART 8 — Settings panel
    // ═══════════════════════════════════════════════════════════════

    private async _onOpenSettingsClick(source: 'home' | 'tokenDuel'): Promise<void> {
        if (!this._settingsPanel) return;
        this._settingsReturnPanel = source;
        console.log(`${TAG} _onOpenSettingsClick | source=${source}`);
        if (source === 'home') this._homePanel.active = false;
        else this._tokenDuelPanel.active = false;
        this._settingsPanel.active = true;
        this._hydrateSettingsPanel();
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
            this._settingsWalletNameLabel.string = pubkey ? walletName : 'Not connected';
        }
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
                    this._settingsWalletBalanceLabel.string = `${sol.toFixed(4)} SOL`;
                }).catch(() => {
                    if (this._settingsWalletBalanceLabel) this._settingsWalletBalanceLabel.string = '(balance unavailable)';
                });
            }
        }
        if (this._settingsUsernameEditBox) {
            const saved = this._loadUsername();
            this._settingsUsernameEditBox.string = saved;
        }
        if (this._settingsUsernameSavedLabel) this._settingsUsernameSavedLabel.string = '';
        // Part 10 pt2: refresh Quick Play defaults card tints from localStorage.
        this._refreshQPCard();
        console.log(`${TAG} _onOpenSettingsClick | pubkey=${pubkey ? pubkey.substring(0, 8) + '…' : 'null'} wallet_name="${walletName}"`);
    }

    private _resolveWalletName(): string {
        // MWAManager may expose the wallet identity post-authorization; if not,
        // fall back to "MWA" (Mobile Wallet Adapter generic).
        const mwa = MWAManager.instance as any;
        const cached = mwa?.cachedWalletPackage ?? mwa?.walletUriBase ?? mwa?.walletName;
        if (typeof cached === 'string' && cached.length > 0) return cached;
        return 'Mobile Wallet Adapter';
    }

    /** Called on every keystroke — reset the "saved ✓" flash. */
    private _onUsernameTyping(): void {
        if (this._settingsUsernameSavedLabel) this._settingsUsernameSavedLabel.string = '';
    }

    /** Commit username to sys.localStorage on editing-did-ended. */
    private _onUsernameCommit(): void {
        if (!this._settingsUsernameEditBox) return;
        const val = (this._settingsUsernameEditBox.string ?? '').trim().substring(0, 24);
        this._saveUsername(val);
        if (this._settingsUsernameSavedLabel) {
            this._settingsUsernameSavedLabel.string = val ? `saved ✓  "${val}"` : 'cleared';
        }
        console.log(`${TAG} _onUsernameCommit | saved="${val}"`);
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

    private _onOpenPortfolioClick(): void {
        if (!this._portfolioPanel) return;
        console.log(`${TAG} _onOpenPortfolioClick | OPEN top=${this._pfTopLevelTab} tab=${this._pfActiveTab}`);
        this._tokenDuelPanel.active = false;
        this._portfolioPanel.active = true;
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
        this._tokenDuelPanel.active = true;
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
            // Session D Part 4: hydrate Real tab from on-chain UserStats PDA.
            const mwa = MWAManager.instance;
            const pubkey = mwa?.connectedPubkey ?? '';
            if (!pubkey) {
                this._setPortfolioCards(new Map([
                    ['games', '—'], ['wins', '—'], ['losses', '—'],
                    ['winrate', '—'], ['pnl', '—'], ['xp', '—'],
                ]));
                return;
            }
            loadRealStats(this._tdRpc, pubkey).then((rec) => {
                const winrate = rec.games > 0 ? `${Math.round((rec.wins / rec.games) * 100)}%` : '—';
                const pnlSol = rec.profitLamports / 1e9;
                const pnlStr = rec.profitLamports === 0 ? '—' : (pnlSol >= 0 ? `+${pnlSol.toFixed(3)}` : `${pnlSol.toFixed(3)}`);
                const xpStr = rec.loaded ? `${rec.xp} · L${rec.level}` : '—';
                this._setPortfolioCards(new Map([
                    ['games',   rec.games > 0 ? String(rec.games) : (rec.loaded ? '0' : '—')],
                    ['wins',    rec.wins > 0 ? String(rec.wins) : (rec.loaded ? '0' : '—')],
                    ['losses',  rec.losses > 0 ? String(rec.losses) : (rec.loaded ? '0' : '—')],
                    ['winrate', winrate],
                    ['pnl',     pnlStr],
                    ['xp',      xpStr],
                ]));
                console.log(`${TAG} _refreshPortfolioTab | REAL_LOADED games=${rec.games} wins=${rec.wins} losses=${rec.losses} xp=${rec.xp} level=${rec.level} loaded=${rec.loaded}`);
            }).catch((e) => {
                console.log(`${TAG} _refreshPortfolioTab | REAL_ERROR error=${e}`);
            });
            return;
        }

        // Paper tab uses localStorage.
        const rec = Stats.load(this._pfActiveTab);
        const winrate = rec.games > 0 ? `${Math.round((rec.wins / rec.games) * 100)}%` : '—';
        const pnlSol = rec.profitLamports / 1e9;
        const pnlStr = rec.profitLamports === 0 ? '—' : (pnlSol >= 0 ? `+${pnlSol.toFixed(3)}` : `${pnlSol.toFixed(3)}`);
        const xpLevel = rec.xp > 0 ? `${rec.xp} · L${levelFromXp(rec.xp)}` : '—';
        this._setPortfolioCards(new Map<string, string>([
            ['games', rec.games > 0 ? String(rec.games) : '—'],
            ['wins',  rec.wins > 0 ? String(rec.wins) : '—'],
            ['losses', rec.losses > 0 ? String(rec.losses) : '—'],
            ['winrate', winrate],
            ['pnl', pnlStr],
            ['xp', xpLevel],
        ]));
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
        for (const [, lbl] of this._pfStatValues) {
            const cardNode = lbl.node.parent;
            if (cardNode) cardNode.active = statsActive;
        }
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
        const { getPlayerTrophies, rankEmoji } = await import('../../token-duel/scripts/TrophyRpc');
        const trophies = await getPlayerTrophies(pubkey);
        this._pfTrophyEntries = trophies;
        console.log(`${TAG} _refreshTrophies | DONE count=${trophies.length}`);
        if (empty) empty.active = trophies.length === 0;
        for (let i = 0; i < this._pfTrophyTiles.length; i++) {
            const tile = this._pfTrophyTiles[i];
            const t = trophies[i];
            if (!t) { tile.active = false; continue; }
            tile.active = true;
            const emojiLbl = tile.getChildByName('Emoji')?.getComponent(Label);
            const titleLbl = tile.getChildByName('Title')?.getComponent(Label);
            const winsLbl = tile.getChildByName('Wins')?.getComponent(Label);
            if (emojiLbl) emojiLbl.string = rankEmoji(t.rank);
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
                const modeName = MODES[(['oneVone', 'fourPlayer', 'eightPlayer', 'battleRoyale'][entry.mode] ?? 'oneVone') as keyof typeof MODES]?.shortLabel ?? '—';
                const windowLabel = TIME_WINDOWS[(['1h', '1d', '3d', '7d'][entry.timeWindow] ?? '1d') as TimeWindowId]?.label ?? '';
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
        // We lazily import formatTickerLine to avoid dragging the module into
        // the Home-show hot path when there's nothing to render.
        import('../../token-duel/scripts/MatchTickerRpc').then(({ formatTickerLine }) => {
            const labelNode = tickerNode.getChildByName('Label');
            const label = labelNode?.getComponent(Label);
            if (label) label.string = formatTickerLine(entry, Math.floor(Date.now() / 1000));
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

        if (this._tournamentTitleLabel) this._tournamentTitleLabel.string = '⚔ Tournament';
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
        const medalBySlot = new Map<number, string>();
        if (m.status === 2) {
            if (sortedByHeight[0]) medalBySlot.set(sortedByHeight[0].slot, '🥇');
            if (sortedByHeight[1]) medalBySlot.set(sortedByHeight[1].slot, '🥈');
            if (sortedByHeight[2]) medalBySlot.set(sortedByHeight[2].slot, '🥉');
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
            const medalLabel = slot.getChildByName('Medal')?.getComponent(Label);
            if (pkLabel) pkLabel.string = `P${i + 1}  ${pk.slice(0, 4)}…${pk.slice(-4)}`;
            if (hLabel) hLabel.string = h === 0xffffffff ? 'H:—' : `H:${h}`;
            if (medalLabel) medalLabel.string = medalBySlot.get(i) ?? '';
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
            this._nextTournamentMatchPda = soonest.pda;
            this._nextTournamentCreatedAt = Number(soonest.createdAt);
            this._nextTournamentIsActive = soonest.status === 1;
            this._tournamentBadge.active = true;
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
            label.string = '⚔ TOURNAMENT LIVE — tap to spectate';
            return;
        }
        // Countdown = (createdAt + cadenceSec) - nowSec. But tournaments fill
        // via real-player joins; the "start time" is really "when it's full
        // OR force_settle fires." For UX, show "waiting for players · N filled/10"
        // when it's just sitting there, and a countdown only once it's filling.
        const nowSec = Math.floor(Date.now() / 1000);
        const elapsedSec = Math.max(0, nowSec - this._nextTournamentCreatedAt);
        const mm = Math.floor(elapsedSec / 60);
        const ss = elapsedSec % 60;
        label.string = `⚔ Tournament · waiting ${mm}:${ss.toString().padStart(2, '0')} · tap to join`;
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
        if (this._spectatorTitleLabel) this._spectatorTitleLabel.string = '👁 Spectating';
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
        const modeIdMap: Record<number, string> = { 0: 'oneVone', 1: 'fourPlayer', 2: 'eightPlayer', 3: 'battleRoyale' };
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
            line = `${hhmmss} 🏁 match over · final height ${ev.finalHeight}`;
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
        const chip = this._homeRakeChip;
        if (!chip) return;
        const mwa = MWAManager.instance;
        const pubkey = mwa?.connectedPubkey;
        if (!pubkey) {
            chip.node.active = false;
            return;
        }
        try {
            const stats = await loadRealStats(this._tdRpc, pubkey);
            const level = stats.loaded ? Math.max(1, stats.level) : 1;
            this._cachedLevel = level;
            const bps = rakeBpsForLevel(level);
            chip.string = `Your rake: ${(bps / 100).toFixed(1)}% (lvl ${level})`;
            chip.node.active = true;
        } catch (e) {
            console.log(`${TAG} _refreshRakeChip | ERROR ${e}`);
            chip.node.active = false;
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
        const soundBtn = card.getChildByName('SoundToggleButton');
        const hapBtn = card.getChildByName('HapticsToggleButton');
        const soundOn = isSoundEnabled();
        const hapOn = Haptics.isEnabled();
        const soundLabel = soundBtn?.getChildByName('Label')?.getComponent(Label);
        const hapLabel = hapBtn?.getChildByName('Label')?.getComponent(Label);
        if (soundLabel) soundLabel.string = soundOn ? '🔊 Sound: ON' : '🔈 Sound: OFF';
        if (hapLabel) hapLabel.string = hapOn ? '📳 Haptics: ON' : '✋ Haptics: OFF';
        const soundSpr = soundBtn?.getComponent(Sprite);
        const hapSpr = hapBtn?.getComponent(Sprite);
        if (soundSpr) soundSpr.color = soundOn ? new Color(48, 198, 155, 255) : new Color(60, 70, 90, 255);
        if (hapSpr) hapSpr.color = hapOn ? new Color(48, 198, 155, 255) : new Color(60, 70, 90, 255);
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
        if (!this._tutorialOverlay || this._tutorialBubbles.length === 0) {
            // No overlay in scene — skip straight to resolve so the game starts.
            console.log(`${TAG} _showTutorial | NO_OVERLAY — skipping`);
            this._resolveTutorial();
            return;
        }
        console.log(`${TAG} _showTutorial | SHOW`);
        this._tutorialStep = 0;
        for (let i = 0; i < this._tutorialBubbles.length; i++) {
            this._tutorialBubbles[i].active = i === 0;
        }
        if (this._tutorialIndexLabel) this._tutorialIndexLabel.string = `1 / ${this._tutorialBubbles.length}`;
        this._tutorialOverlay.active = true;
    }

    private _onTutorialTap(): void {
        this._tutorialStep += 1;
        console.log(`${TAG} _onTutorialTap | step=${this._tutorialStep}/${this._tutorialBubbles.length}`);
        if (this._tutorialStep >= this._tutorialBubbles.length) {
            this._markTutorialSeen();
            if (this._tutorialOverlay) this._tutorialOverlay.active = false;
            this._resolveTutorial();
            return;
        }
        for (let i = 0; i < this._tutorialBubbles.length; i++) {
            this._tutorialBubbles[i].active = i === this._tutorialStep;
        }
        if (this._tutorialIndexLabel) this._tutorialIndexLabel.string = `${this._tutorialStep + 1} / ${this._tutorialBubbles.length}`;
    }

    private _resolveTutorial(): void {
        const fn = this._tutorialDismissed;
        this._tutorialDismissed = null;
        if (fn) fn();
    }
}
