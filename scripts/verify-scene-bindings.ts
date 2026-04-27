/**
 * Session 4 E1 — Scene-bindings regression harness.
 *
 * Parses `assets/demo/scenes/Main.scene` and asserts every node name that
 * `AppUI.start()` (and friends) calls `getChildByName` on exists exactly
 * where the code expects it. Catches scene/AppUI drift — a frequent class
 * of bug when `generate-scenes.js` renames a node but AppUI's bindings
 * haven't caught up.
 *
 * Run:
 *   cd scripts
 *   npx ts-node verify-scene-bindings.ts
 *
 * Exit code: 0 = all pass, 1 = at least one missing binding.
 *
 * How it works:
 *   1. Load Main.scene (array of serialized Cocos objects).
 *   2. Build a map of `_name` → node entry.
 *   3. For each expected node, verify it exists (by name) AND that the
 *      expected components exist on it (cc.Button, cc.Label, cc.EditBox, …).
 *
 * The expected list is maintained in this file — treat it as the contract
 * between generate-scenes.js and AppUI.ts. Update both sides when the
 * scene changes.
 */

import * as fs from 'fs';
import * as path from 'path';

const TAG = '[verify-scene-bindings]';
const SCENE_PATH = path.resolve(__dirname, '../assets/demo/scenes/Main.scene');

/** Each entry: node name → array of required component types. */
const REQUIRED: Array<{ name: string; components: string[]; note?: string }> = [
    // ── Panels ──
    { name: 'LandingPanel',  components: ['cc.UITransform'] },
    { name: 'HomePanel',     components: ['cc.UITransform'] },
    { name: 'TokenDuelPanel', components: ['cc.UITransform'] },

    // ── Landing ──
    { name: 'ConnectButton',   components: ['cc.Button'] },
    { name: 'ReconnectButton', components: ['cc.Button'] },
    { name: 'PlayAsGuestButton',  components: ['cc.Button'] },
    // PlayAsGuestSubtitle removed — Landing CTA stack now stacks Connect/Reconnect/Guest
    // with subtitles INSIDE each button rect (no separate subtitle node).
    { name: 'StatusLabel',     components: ['cc.Label'], note: 'matches on both Landing and TokenDuel — that is OK' },

    // ── Home ── 2026-04-26 lobby restructure: HUD header (WalletPill +
    // SecureDot + WalletNameLabel), full-width LevelXp card with progress
    // bar + XP label, MatchStatus card with header + 5 chips, Challenge
    // card with 5 chips, "CHOOSE MATCH TYPE" section title, action trio
    // (subtitles + chevrons INSIDE buttons), Training card with mascot +
    // 3 labels + reparented HomeStatusLabel. Disconnect / Delete /
    // SignOutGuest REMOVED — those flows live in SettingsPanel only
    // (DisconnectSettingsButton, DeleteAccountSettingsButton).
    { name: 'StartMatchButton',    components: ['cc.Button'] },
    { name: 'FindMatchButton',     components: ['cc.Button'] },
    { name: 'BotMatchButton',      components: ['cc.Button'] },
    { name: 'StartMatchSubtitle',  components: ['cc.Label'] },
    { name: 'FindMatchSubtitle',   components: ['cc.Label'] },
    { name: 'BotMatchSubtitle',    components: ['cc.Label'] },
    { name: 'StartMatchChevron',   components: ['cc.UITransform', 'cc.Label'] },
    { name: 'FindMatchChevron',    components: ['cc.UITransform', 'cc.Label'] },
    { name: 'BotMatchChevron',     components: ['cc.UITransform', 'cc.Label'] },
    { name: 'FindMatchButtonCountBadge', components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'FindMatchButtonCountLabel', components: ['cc.Label'] },
    { name: 'WalletPill',          components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'WalletPillSecureDot', components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'WalletNameLabel',     components: ['cc.Label'] },
    { name: 'PubkeyLabel',         components: ['cc.Label'] },
    { name: 'StreakFlameContainer', components: ['cc.UITransform'] },
    { name: 'StreakFlameIcon',      components: ['cc.Label'] },
    { name: 'StreakCountLabel',     components: ['cc.Label'] },
    { name: 'HomeStatusLabel',     components: ['cc.Label'] },
    { name: 'HomeXpProgressLabel', components: ['cc.Label'] },
    { name: 'HomeXpBarTrack',      components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'HomeXpBarFill',       components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'HomeChooseMatchLabel', components: ['cc.Label'] },
    { name: 'HomeMatchTickerHeader', components: ['cc.Label'] },
    { name: 'HomeMatchChipVal_mode',     components: ['cc.Label'] },
    { name: 'HomeMatchChipVal_players',  components: ['cc.Label'] },
    { name: 'HomeMatchChipVal_stake',    components: ['cc.Label'] },
    { name: 'HomeMatchChipVal_duration', components: ['cc.Label'] },
    { name: 'HomeMatchChipVal_created',  components: ['cc.Label'] },
    { name: 'HomeChalChipVal_day',        components: ['cc.Label'] },
    { name: 'HomeChalChipVal_challenges', components: ['cc.Label'] },
    // V2: HomeChalChipVal_season removed — SEASON chip dropped from
    // SecondaryStats card to slim cognitive load.
    { name: 'HomeChalChipVal_pool',       components: ['cc.Label'] },
    { name: 'HomeChalChipVal_rake',       components: ['cc.Label'] },
    { name: 'HomeTrainingCard',           components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'HomeTrainingTitleLabel',     components: ['cc.Label'] },
    { name: 'HomeTrainingBodyLabel',      components: ['cc.Label'] },
    { name: 'HomeTrainingHintLabel',      components: ['cc.Label'] },
    // V2 — new home nodes: scrim, wallet glow, training mascot glow, CTA hint, divider
    { name: 'HomeContentScrim',           components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'WalletPillGlow',             components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'TrainingMascotGlow',         components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'TrainingCtaHint',            components: ['cc.Label'] },
    { name: 'HomeMatchChipDivider',       components: ['cc.UITransform', 'cc.Sprite'] },

    // ── TokenDuelPanel — core game ──
    { name: 'BackButton',           components: ['cc.Button'] },
    { name: 'StakeCommitButton',    components: ['cc.Button'] },
    { name: 'StartGameButton',      components: ['cc.Button'] },
    { name: 'ClaimPayoutButton',    components: ['cc.Button'] },
    { name: 'GameArea',             components: ['cc.UITransform'] },
    { name: 'HeightLabel',          components: ['cc.Label'] },
    { name: 'TokenBadgeLabel',      components: ['cc.Label'] },
    { name: 'BlockTemplate',        components: ['cc.Sprite'] },
    { name: 'GameOverLabel',        components: ['cc.Label'] },

    // ── Session 3 — feed + squad + stake ──
    { name: 'BalanceChipLabel',     components: ['cc.Label'] },
    { name: 'SearchEditBox',        components: ['cc.EditBox'] },
    { name: 'FeedScrollView',       components: ['cc.ScrollView'] },
    { name: 'SquadSlot_0',          components: ['cc.Button'] },
    { name: 'SquadSlot_1',          components: ['cc.Button'] },
    { name: 'SquadSlot_2',          components: ['cc.Button'] },
    { name: 'StakeSlider',          components: ['cc.Slider'] },
    { name: 'StakeValueLabel',      components: ['cc.Label'] },
    { name: 'StakeChip_001',        components: ['cc.Button'] },
    { name: 'StakeChip_010',        components: ['cc.Button'] },
    { name: 'StakeChip_100',        components: ['cc.Button'] },

    // ── Session 4 B3 — search clear ──
    { name: 'SearchClearButton',    components: ['cc.Button'] },

    // ── Part 10 Bundle 2 — squad helpers ──
    // (QuickPlayButton retired — Bot Match takes over the same role; see Home section above.)
    { name: 'DailyStreakStrip',       components: ['cc.Button'] },
    { name: 'OpenSquadPresetsButton', components: ['cc.Button'] },
    { name: 'SuggestSquadButton',     components: ['cc.Button'] },

    // ── Part 10 Bundle 3 / pt2 — SquadPresetsOverlay ──
    { name: 'SquadPresetsOverlay',    components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'PresetsScrim',           components: ['cc.Button'] },
    { name: 'PresetSaveButton',       components: ['cc.Button'] },
    { name: 'PresetNameModal',        components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'PresetNameEditBox',      components: ['cc.EditBox'] },
    { name: 'PresetSaveConfirmButton', components: ['cc.Button'] },
    { name: 'PresetSaveCancelButton', components: ['cc.Button'] },

    // ── Part 10 pt2 — DailyChallengePanel ──
    { name: 'DailyChallengePanel',    components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'DailyStreakCard',        components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'StreakDayLabel',         components: ['cc.Label'] },
    { name: 'StreakBestLabel',        components: ['cc.Label'] },
    { name: 'SeasonSummaryCard',      components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'SeasonHeaderLabel',      components: ['cc.Label'] },
    { name: 'SeasonRankLabel',        components: ['cc.Label'] },
    { name: 'SeasonPodiumLabel',      components: ['cc.Label'] },

    // ── Part 10 pt2 — SettingsPanel QuickPlayDefaultsCard (Phase 27 popovers) ──
    // QP segment buttons were retired in favor of three popovers + a track
    // toggle. Updated REQUIRED list to match current scene-gen output.
    { name: 'QuickPlayDefaultsCard',     components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'QPModePopover_1v1',         components: ['cc.Button'] },
    { name: 'QPModePopover_4p',          components: ['cc.Button'] },
    { name: 'QPModePopover_8p',          components: ['cc.Button'] },
    { name: 'QPModePopover_trio',        components: ['cc.Button'] },
    { name: 'QPWindowPopover_30s',       components: ['cc.Button'] },
    { name: 'QPWindowPopover_1m',        components: ['cc.Button'] },
    { name: 'QPWindowPopover_5m',        components: ['cc.Button'] },
    { name: 'QPWindowPopover_1h',        components: ['cc.Button'] },
    { name: 'QPWindowPopover_24h',       components: ['cc.Button'] },
    { name: 'QPWindowPopover_7d',        components: ['cc.Button'] },
    { name: 'QPWagerPopover_001',        components: ['cc.Button'] },
    { name: 'QPWagerPopover_005',        components: ['cc.Button'] },
    { name: 'QPWagerPopover_01',         components: ['cc.Button'] },
    { name: 'QPWagerPopover_025',        components: ['cc.Button'] },
    { name: 'QPWagerPopover_05',         components: ['cc.Button'] },
    { name: 'QPTrackToggle',             components: ['cc.UITransform'] },
    { name: 'QPTrackPaperLabel',         components: ['cc.Label'] },
    { name: 'QPTrackRealLabel',          components: ['cc.Label'] },

    // ── Part 10 pt2 — LeaderboardPanel season tab ──
    { name: 'LBTab_season',           components: ['cc.Button'] },

    // ── Part 11 D1 — 4-card tutorial (renamed from TutorialBubble_* in carousel refactor) ──
    { name: 'TutorialOverlay',        components: ['cc.UITransform', 'cc.Sprite', 'cc.Button'] },
    { name: 'TutorialCard_0',         components: ['cc.UITransform'] },
    { name: 'TutorialCard_1',         components: ['cc.UITransform'] },
    { name: 'TutorialCard_2',         components: ['cc.UITransform'] },
    { name: 'TutorialCard_3',         components: ['cc.UITransform'] },

    // ── betting-duel polish — wager chip row removed from ModePicker; replaced
    //    by WagerControlRow on TokenDuelPanel + read-only readout in picker. ──
    { name: 'PickerWagerReadout',     components: ['cc.Label'] },
    { name: 'WagerValueButton',       components: ['cc.Button'] },
    { name: 'WagerStartButton',       components: ['cc.Button'] },
    { name: 'WagerHintLabel',         components: ['cc.Label'] },
    { name: 'WagerDropdown',          components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'WagerDropdownRow_0',     components: ['cc.Button'] },
    { name: 'WagerDropdownRow_7',     components: ['cc.Button'] },
    // ── betting-duel polish — squad slots now carry logo + delta children ──
    { name: 'CheckmarkIcon',          components: ['cc.Label'] },
    // ── betting-duel round-3 polish — HelpButton + Opponent squad symbols ──
    { name: 'HelpButton',             components: ['cc.Button'] },
    { name: 'OpponentSymbolsLabel',   components: ['cc.Label'] },
    // ── betting-duel round-4 — Paper N-bot leaderboard strip (4p / 8p) ──
    { name: 'RaceOpponentStrip',      components: ['cc.UITransform'] },
    { name: 'RaceOpponentRow_0',      components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'RaceOpponentRow_6',      components: ['cc.UITransform', 'cc.Sprite'] },

    // ── Part 11 D3 — WaitingPanel streak banner ──
    { name: 'WaitingStreakBanner',    components: ['cc.Label'] },

    // ── Part 11 A — PostMatch share-to-X ──
    { name: 'PostMatchShareButton',   components: ['cc.Button'] },

    // ── Part 11 B — Portfolio Trophies tab + tile pool ──
    { name: 'PortfolioTrophiesTab',   components: ['cc.Button'] },
    { name: 'PortfolioTrophiesView',  components: ['cc.UITransform'] },
    { name: 'PortfolioTrophiesEmptyLabel', components: ['cc.Label'] },

    // ── Part 11 C — Audio + Haptics settings card ──
    { name: 'AudioSettingsCard',      components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'SoundToggleButton',      components: ['cc.Button'] },
    { name: 'HapticsToggleButton',    components: ['cc.Button'] },

    // ── Part 12 C — Home live match ticker ──
    { name: 'HomeMatchTicker',        components: ['cc.Button'] },

    // ── Part 12 D — Spectator mode ──
    { name: 'SpectatorPanel',         components: ['cc.UITransform'] },
    { name: 'SpectatorBackButton',    components: ['cc.Button'] },
    { name: 'SpectatorTitleLabel',    components: ['cc.Label'] },
    { name: 'SpectatorMatchLabel',    components: ['cc.Label'] },
    { name: 'SpectatorPlayerList',   components: ['cc.UITransform'] },
    { name: 'SpectatorEventList',    components: ['cc.UITransform'] },
    { name: 'SpectatorJoinButton',    components: ['cc.Button'] },

    // ── Part 13 — Economics depth: rake surfacing + fee schedule link ──
    // 2026-04-26 lobby restructure: HomeRakeChip retired; rake now lives
    // inside the Home ChallengeSeasonCard as HomeChalChipVal_rake.
    { name: 'WaitingRakeLabel',       components: ['cc.Label'] },
    { name: 'PostMatchRakeLabel',     components: ['cc.Label'] },
    { name: 'FeesLinkButton',         components: ['cc.Button'] },

    // ── Part 14 — Tournament mode: badge + panel ──
    { name: 'HomeTournamentBadge',      components: ['cc.Button'] },
    { name: 'TournamentPanel',          components: ['cc.UITransform'] },
    { name: 'TournamentBackButton',     components: ['cc.Button'] },
    { name: 'TournamentTitleLabel',     components: ['cc.Label'] },
    { name: 'TournamentMatchLabel',     components: ['cc.Label'] },
    { name: 'TournamentStatusLabel',    components: ['cc.Label'] },
    { name: 'TournamentPrizePoolLabel', components: ['cc.Label'] },
    { name: 'TournamentRoster',         components: ['cc.UITransform'] },
    { name: 'TournamentJoinButton',     components: ['cc.Button'] },

    // ── betting-duel Phase 3: live portfolio race screen ──
    // 2026-04-26 battle-UI polish: PlayerIdentityCard + RaceHeroSubtitleLabel
    // dropped in favor of compact top row (Lv chip + Timer + hero %).
    { name: 'RacePanel',              components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'RaceCountdownLabel',     components: ['cc.Label'] },
    { name: 'RaceHeroDeltaLabel',     components: ['cc.Label'] },
    { name: 'RacePlayerLevelChip',    components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'RacePlayerLevelChipLabel', components: ['cc.Label'] },
    { name: 'PlayerTokenContributionBar_0', components: ['cc.Graphics'] },
    { name: 'PlayerTokenContributionBar_1', components: ['cc.Graphics'] },
    { name: 'PlayerTokenContributionBar_2', components: ['cc.Graphics'] },
    { name: 'OpponentTokenContributionBar_0', components: ['cc.Graphics'] },
    { name: 'OpponentTokenContributionBar_1', components: ['cc.Graphics'] },
    { name: 'OpponentTokenContributionBar_2', components: ['cc.Graphics'] },
    { name: 'RaceCancelButton',       components: ['cc.Button'] },

    // ── UX overhaul Phase 2: procedural mascot on HomePanel ──
    // The MascotController component (custom UUID) builds its own graphics
    // children at onLoad — verifier only checks the container node + UITransform.
    { name: 'MascotContainer',        components: ['cc.UITransform'] },

    // ── UX overhaul Phase 2b: second mascot on PostMatchPanel so celebrate
    // plays on the panel the user is looking at. ──
    { name: 'PostMatchMascotContainer', components: ['cc.UITransform'] },

    // ── Phase A — top-level lobby browser (FindMatchPanel) ──
    // (OpenFindMatchButton chrome icon retired; FindMatchButton in the home
    //  CTA trio is now the entry point — see Home section above.)
    { name: 'FindMatchPanel',               components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'FindMatchBackButton',          components: ['cc.Button'] },
    { name: 'FindMatchTitleLabel',          components: ['cc.Label'] },
    { name: 'FindMatchRefreshButton',       components: ['cc.Button'] },
    { name: 'FindMatchCountLabel',          components: ['cc.Label'] },
    { name: 'FilterMode_all',               components: ['cc.Button'] },
    { name: 'FilterMode_oneVone',           components: ['cc.Button'] },
    { name: 'FilterMode_4p',                components: ['cc.Button'] },
    { name: 'FilterMode_8p',                components: ['cc.Button'] },
    { name: 'FilterMode_trio',              components: ['cc.Button'] },
    { name: 'FilterWindow_all',             components: ['cc.Button'] },
    { name: 'FilterWindow_1h',              components: ['cc.Button'] },
    { name: 'FilterWindow_1d',              components: ['cc.Button'] },
    { name: 'FilterWindow_3d',              components: ['cc.Button'] },
    { name: 'FilterWindow_7d',              components: ['cc.Button'] },
    { name: 'FilterWager_all',              components: ['cc.Button'] },
    { name: 'FilterWager_low',              components: ['cc.Button'] },
    { name: 'FilterWager_mid',              components: ['cc.Button'] },
    { name: 'FilterWager_high',             components: ['cc.Button'] },
    { name: 'FilterWager_whale',            components: ['cc.Button'] },
    { name: 'FilterHideFullToggle',         components: ['cc.Button'] },

    // ── Phase 2b — segmented-control container cards behind chip rows ──
    { name: 'TabRowContainer',              components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'ModeRowContainer',             components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'WindowRowContainer',           components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'WagerRowContainer',            components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'FindMatchEmptyLabel',          components: ['cc.Label'] },
    { name: 'FindMatchHostButton',          components: ['cc.Button'] },
    { name: 'FindMatchStatusLabel',         components: ['cc.Label'] },
    { name: 'FindMatchTab_Open',            components: ['cc.Button'] },
    { name: 'FindMatchTab_Live',            components: ['cc.Button'] },

    // ── Phase E — bot difficulty toggle on ModePickerOverlay ──
    { name: 'PickerDifficultyEasy',         components: ['cc.Button'] },
    { name: 'PickerDifficultyMedium',       components: ['cc.Button'] },
    { name: 'PickerDifficultyHard',         components: ['cc.Button'] },

    // ── Phase H4 — LevelUpOverlay cinematic ──
    { name: 'LevelUpOverlay',               components: ['cc.UITransform', 'cc.Sprite', 'cc.Button'] },
    { name: 'LevelUpTitleLabel',            components: ['cc.Label'] },
    { name: 'LevelUpBigLevel',              components: ['cc.Label'] },
    { name: 'LevelUpCaptionLabel',          components: ['cc.Label'] },
    { name: 'LevelUpRakeLabel',             components: ['cc.Label'] },
    { name: 'LevelUpHintLabel',             components: ['cc.Label'] },

    // ── Phase A — Join confirm overlay + locked-wager chip on TokenDuelPanel ──
    { name: 'JoinMatchConfirmOverlay',      components: ['cc.UITransform'] },
    { name: 'JoinConfirmScrim',             components: ['cc.UITransform', 'cc.Sprite', 'cc.Button'] },
    { name: 'JoinConfirmCard',              components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'JoinConfirmTitleLabel',        components: ['cc.Label'] },
    { name: 'JoinConfirmSubtitleLabel',     components: ['cc.Label'] },
    { name: 'JoinConfirmModeBadge',         components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'JoinConfirmModeBadgeLabel',    components: ['cc.Label'] },
    { name: 'JoinConfirmTrackChip',         components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'JoinConfirmTrackChipLabel',    components: ['cc.Label'] },
    { name: 'JoinConfirmWagerHeroLabel',    components: ['cc.Label'] },
    { name: 'JoinConfirmWindowLabel',       components: ['cc.Label'] },
    { name: 'JoinConfirmCapacityLabel',     components: ['cc.Label'] },
    { name: 'JoinConfirmHostLabel',         components: ['cc.Label'] },
    { name: 'JoinConfirmAgeLabel',          components: ['cc.Label'] },
    { name: 'JoinConfirmCapacityBar',       components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'JoinConfirmCapacityBarFill',   components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'JoinConfirmCancelButton',      components: ['cc.Button'] },
    { name: 'JoinConfirmGoButton',          components: ['cc.Button'] },
    { name: 'JoinConfirmHintLabel',         components: ['cc.Label'] },
    { name: 'WagerLockChip',                components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'WagerLockChipLabel',           components: ['cc.Label'] },
    { name: 'WagerBotChip',                 components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'WagerBotChipLabel',            components: ['cc.Label'] },

    // ── Stage 2 — Top-right Level chip on Home + TokenDuel ──
    { name: 'HomeLevelChip',                components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'HomeLevelChipLabel',           components: ['cc.Label'] },
    // TokenDuelLevelChip is an alias-only inner node holding the Lv label —
    // no Sprite of its own (the surrounding pill carries the bg sprite).
    { name: 'TokenDuelLevelChip',           components: ['cc.UITransform'] },
    { name: 'TokenDuelLevelChipLabel',      components: ['cc.Label'] },

    // ── Phase N2 — NotificationToastOverlay (3 stacked slots) ──
    { name: 'NotificationToastOverlay',     components: ['cc.UITransform'] },

    // ── Phase N3 — Bell + badge on HomePanel + NotificationPanel ──
    { name: 'NotificationBellButton',       components: ['cc.Button'] },
    { name: 'NotificationBellBadge',        components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'NotificationBadgeLabel',       components: ['cc.Label'] },
    { name: 'NotificationPanel',            components: ['cc.UITransform', 'cc.Sprite', 'cc.Button'] },
    { name: 'NotifPanelCard',               components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'NotifHeaderLabel',             components: ['cc.Label'] },
    { name: 'NotifCloseButton',             components: ['cc.Button'] },
    { name: 'NotifMarkAllReadButton',       components: ['cc.Button'] },
    { name: 'NotifListContainer',           components: ['cc.UITransform'] },
    { name: 'NotifEmptyLabel',              components: ['cc.Label'] },
];

/** Parametric rows: PresetRow_0..4, ChallengeRow_0..2 + labels, ChallengeDescriptionLabel_0..2, etc. */
const PARAMETRIC_PRESETS = 5;
const PARAMETRIC_CHALLENGES = 3;

/** Part 11 B — Portfolio trophy tile pool (6 tiles). */
const TROPHY_TILE_COUNT = 6;

/** Part 12 D — Spectator event-stream row pool (10 rows). */
const SPECTATOR_EVENT_ROW_COUNT = 10;

/** Part 12 D — Spectator player-list row pool (10 players). */
const SPECTATOR_PLAYER_ROW_COUNT = 10;

/** betting-duel Phase 3 — RacePanel token card pool (5 slots). */
const RACE_TOKEN_CARD_COUNT = 5;

/** Phase A — FindMatchPanel match-card row pool (8 rows). */
const MATCH_CARD_ROW_COUNT = 8;

/** Phase N2 — Notification toast slot pool (3 stacked slots). */
const NOTIF_TOAST_SLOT_COUNT = 3;

/** Phase N3 — NotificationPanel row pool (8 rows). */
const NOTIF_ROW_COUNT = 8;

/** Feed rows are parametric: 20 pooled instances. Verify separately. */
const FEED_ROW_COUNT = 20;

interface SceneEntry {
    __type__: string;
    _name?: string;
    node?: { __id__: number };
}

function main(): void {
    console.log(`${TAG} START scene=${SCENE_PATH}`);
    let entries: SceneEntry[];
    try {
        entries = JSON.parse(fs.readFileSync(SCENE_PATH, 'utf8'));
    } catch (e: any) {
        console.log(`${TAG} FAIL cannot read/parse scene error=${e?.message ?? e}`);
        process.exit(1);
    }

    // Build: nodeIdx → Set of component __type__ strings.
    const nodeComps = new Map<number, Set<string>>();
    const nameToIdx = new Map<string, number[]>(); // multi-map — some names repeat (e.g. "Label" children)
    entries.forEach((e, idx) => {
        if (e.__type__ === 'cc.Node' && e._name) {
            if (!nameToIdx.has(e._name)) nameToIdx.set(e._name, []);
            nameToIdx.get(e._name)!.push(idx);
            nodeComps.set(idx, new Set());
        }
    });
    // Attach components to their nodes.
    for (const e of entries) {
        if (e.node?.__id__ !== undefined && typeof e.__type__ === 'string') {
            const set = nodeComps.get(e.node.__id__);
            if (set) set.add(e.__type__);
        }
    }

    const failures: string[] = [];
    let passed = 0;

    for (const req of REQUIRED) {
        const indices = nameToIdx.get(req.name);
        if (!indices || indices.length === 0) {
            failures.push(`MISSING node="${req.name}" — not found in scene`);
            continue;
        }
        // If a name repeats, accept the first match that has at least one of
        // the required components. (Labels often repeat as children of Buttons.)
        let matched = false;
        for (const idx of indices) {
            const comps = nodeComps.get(idx) ?? new Set();
            const hasAll = req.components.every((c) => comps.has(c));
            if (hasAll) {
                matched = true;
                break;
            }
        }
        if (!matched) {
            const sample = [...(nodeComps.get(indices[0]) ?? [])].join(',');
            failures.push(`COMPONENT_MISSING node="${req.name}" want=[${req.components.join(',')}] got=[${sample}]`);
        } else {
            passed++;
        }
    }

    // Feed rows.
    for (let i = 0; i < FEED_ROW_COUNT; i++) {
        const name = `FeedRow_${i}`;
        const indices = nameToIdx.get(name);
        if (!indices || indices.length === 0) {
            failures.push(`MISSING node="${name}"`);
            continue;
        }
        const comps = nodeComps.get(indices[0]) ?? new Set();
        if (!(comps.has('cc.Button') && comps.has('cc.Sprite'))) {
            failures.push(`COMPONENT_MISSING node="${name}" want=[cc.Button,cc.Sprite]`);
        } else {
            passed++;
        }
    }

    // Part 10 pt2 — PresetRow_0..4 + PresetDeleteButton_0..4.
    for (let i = 0; i < PARAMETRIC_PRESETS; i++) {
        for (const [suffix, wantComps] of [
            [`PresetRow_${i}`, ['cc.Button', 'cc.Sprite']],
            [`PresetDeleteButton_${i}`, ['cc.Button']],
        ] as const) {
            const indices = nameToIdx.get(suffix);
            if (!indices || indices.length === 0) {
                failures.push(`MISSING node="${suffix}"`);
                continue;
            }
            const comps = nodeComps.get(indices[0]) ?? new Set();
            if (!wantComps.every((c) => comps.has(c))) {
                failures.push(`COMPONENT_MISSING node="${suffix}" want=[${wantComps.join(',')}]`);
            } else {
                passed++;
            }
        }
    }

    // Part 10 pt2 — ChallengeDescriptionLabel_0..2 / ChallengeRewardLabel_0..2 / ChallengeCheckmark_0..2.
    for (let i = 0; i < PARAMETRIC_CHALLENGES; i++) {
        for (const nm of [`ChallengeDescriptionLabel_${i}`, `ChallengeRewardLabel_${i}`, `ChallengeCheckmark_${i}`]) {
            const indices = nameToIdx.get(nm);
            if (!indices || indices.length === 0) {
                failures.push(`MISSING node="${nm}"`);
                continue;
            }
            const comps = nodeComps.get(indices[0]) ?? new Set();
            if (!comps.has('cc.Label')) {
                failures.push(`COMPONENT_MISSING node="${nm}" want=[cc.Label]`);
            } else {
                passed++;
            }
        }
    }

    // Part 11 B — Trophy tile pool (6 tiles).
    for (let i = 0; i < TROPHY_TILE_COUNT; i++) {
        const name = `TrophyTile_${i}`;
        const indices = nameToIdx.get(name);
        if (!indices || indices.length === 0) {
            failures.push(`MISSING node="${name}"`);
            continue;
        }
        const comps = nodeComps.get(indices[0]) ?? new Set();
        if (!(comps.has('cc.UITransform') && comps.has('cc.Sprite'))) {
            failures.push(`COMPONENT_MISSING node="${name}" want=[cc.UITransform,cc.Sprite]`);
        } else {
            passed++;
        }
    }

    // Part 12 D — SpectatorEventRow_0..9 + SpectatorPlayerRow_0..9 (row pools).
    for (let i = 0; i < SPECTATOR_EVENT_ROW_COUNT; i++) {
        const name = `SpectatorEventRow_${i}`;
        const indices = nameToIdx.get(name);
        if (!indices || indices.length === 0) {
            failures.push(`MISSING node="${name}"`);
            continue;
        }
        passed++;
    }
    for (let i = 0; i < SPECTATOR_PLAYER_ROW_COUNT; i++) {
        const name = `SpectatorPlayerRow_${i}`;
        const indices = nameToIdx.get(name);
        if (!indices || indices.length === 0) {
            failures.push(`MISSING node="${name}"`);
            continue;
        }
        passed++;
    }

    // betting-duel Phase 3 — RacePanel token cards + per-card labels.
    for (let i = 0; i < RACE_TOKEN_CARD_COUNT; i++) {
        const names = [
            `RaceTokenCard_${i}`,
            `TokenSymbolLabel_${i}`,
            `TokenEntryLabel_${i}`,
            `TokenCurrentLabel_${i}`,
            `TokenDeltaLabel_${i}`,
        ];
        for (const name of names) {
            const indices = nameToIdx.get(name);
            if (!indices || indices.length === 0) {
                failures.push(`MISSING node="${name}"`);
                continue;
            }
            passed++;
        }
    }

    // Phase N2 — NotificationToastSlot_0..2 + each slot's children.
    for (let i = 0; i < NOTIF_TOAST_SLOT_COUNT; i++) {
        const names = [
            `NotificationToastSlot_${i}`,
            `ToastColorStripe_${i}`,
            `ToastIconContainer_${i}`,
            `ToastTitleLabel_${i}`,
            `ToastBodyLabel_${i}`,
            `ToastDismissButton_${i}`,
            `ToastProgressBar_${i}`,
        ];
        for (const name of names) {
            const indices = nameToIdx.get(name);
            if (!indices || indices.length === 0) {
                failures.push(`MISSING node="${name}"`);
                continue;
            }
            passed++;
        }
    }

    // Phase N3 — NotificationPanel row pool (NotifRow_0..7) + each row's children.
    for (let i = 0; i < NOTIF_ROW_COUNT; i++) {
        const names = [
            `NotifRow_${i}`,
            `NotifRowStripe_${i}`,
            `NotifRowIcon_${i}`,
            `NotifRowTitleLabel_${i}`,
            `NotifRowBodyLabel_${i}`,
            `NotifRowTimeLabel_${i}`,
            `NotifRowUnreadDot_${i}`,
        ];
        for (const name of names) {
            const indices = nameToIdx.get(name);
            if (!indices || indices.length === 0) {
                failures.push(`MISSING node="${name}"`);
                continue;
            }
            passed++;
        }
    }

    // Phase A — FindMatchPanel row pool (MatchCardRow_0..7) + per-row labels + Join button.
    for (let i = 0; i < MATCH_CARD_ROW_COUNT; i++) {
        const names = [
            `MatchCardRow_${i}`,
            `MatchCardModeLabel_${i}`,
            `MatchCardWagerLabel_${i}`,
            `MatchCardWindowLabel_${i}`,
            `MatchCardSubLabel_${i}`,
            `MatchCardJoinButton_${i}`,
        ];
        for (const name of names) {
            const indices = nameToIdx.get(name);
            if (!indices || indices.length === 0) {
                failures.push(`MISSING node="${name}"`);
                continue;
            }
            passed++;
        }
    }

    // Report.
    if (failures.length > 0) {
        console.log(`${TAG} FAIL passed=${passed} failed=${failures.length}`);
        for (const f of failures) console.log(`${TAG}   ${f}`);
        process.exit(1);
    }
    console.log(`${TAG} ALL_PASS passed=${passed} feed_rows=${FEED_ROW_COUNT}`);
    process.exit(0);
}

main();
