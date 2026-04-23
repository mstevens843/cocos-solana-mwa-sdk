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
    { name: 'StatusLabel',     components: ['cc.Label'], note: 'matches on both Landing and TokenDuel — that is OK' },

    // ── Home ──
    { name: 'PlayTokenDuelButton', components: ['cc.Button'] },
    { name: 'SignMessageButton',   components: ['cc.Button'] },
    { name: 'SignTxButton',        components: ['cc.Button'] },
    { name: 'SignSendButton',      components: ['cc.Button'] },
    { name: 'CapabilitiesButton',  components: ['cc.Button'] },
    { name: 'DisconnectButton',    components: ['cc.Button'] },
    { name: 'DeleteButton',        components: ['cc.Button'] },
    { name: 'PubkeyLabel',         components: ['cc.Label'] },
    { name: 'HomeStatusLabel',     components: ['cc.Label'] },

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

    // ── Part 10 Bundle 2 — Quick Play + squad helpers ──
    { name: 'QuickPlayButton',        components: ['cc.Button'] },
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

    // ── Part 10 pt2 — SettingsPanel QuickPlayDefaultsCard ──
    { name: 'QuickPlayDefaultsCard',  components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'QPMode_1v1',             components: ['cc.Button'] },
    { name: 'QPMode_4p',              components: ['cc.Button'] },
    { name: 'QPMode_8p',              components: ['cc.Button'] },
    { name: 'QPMode_br10',            components: ['cc.Button'] },
    { name: 'QPWindow_1h',            components: ['cc.Button'] },
    { name: 'QPWindow_1d',            components: ['cc.Button'] },
    { name: 'QPWindow_3d',            components: ['cc.Button'] },
    { name: 'QPWindow_7d',            components: ['cc.Button'] },
    { name: 'QPWager_001',            components: ['cc.Button'] },
    { name: 'QPWager_005',            components: ['cc.Button'] },
    { name: 'QPWager_01',             components: ['cc.Button'] },
    { name: 'QPWager_025',            components: ['cc.Button'] },
    { name: 'QPWager_05',             components: ['cc.Button'] },
    { name: 'QPTrack_paper',          components: ['cc.Button'] },
    { name: 'QPTrack_real',           components: ['cc.Button'] },

    // ── Part 10 pt2 — LeaderboardPanel season tab ──
    { name: 'LBTab_season',           components: ['cc.Button'] },

    // ── Part 11 D1 — 4-bubble tutorial ──
    { name: 'TutorialOverlay',        components: ['cc.UITransform', 'cc.Sprite', 'cc.Button'] },
    { name: 'TutorialBubble_0',       components: ['cc.UITransform'] },
    { name: 'TutorialBubble_1',       components: ['cc.UITransform'] },
    { name: 'TutorialBubble_2',       components: ['cc.UITransform'] },
    { name: 'TutorialBubble_3',       components: ['cc.UITransform'] },
    { name: 'TutorialBubbleIndex',    components: ['cc.Label'] },
    { name: 'TutorialHintLabel',      components: ['cc.Label'] },

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
    { name: 'HomeRakeChip',           components: ['cc.Label'] },
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
    { name: 'RacePanel',              components: ['cc.UITransform', 'cc.Sprite'] },
    { name: 'RaceCountdownLabel',     components: ['cc.Label'] },
    { name: 'RaceHeroDeltaLabel',     components: ['cc.Label'] },
    { name: 'RaceHeroSubtitleLabel',  components: ['cc.Label'] },
    { name: 'RaceCancelButton',       components: ['cc.Button'] },
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
