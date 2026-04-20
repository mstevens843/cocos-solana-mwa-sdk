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
    { name: 'HeroTile1Button',      components: ['cc.Button'] },
    { name: 'HeroTile2Button',      components: ['cc.Button'] },
    { name: 'HeroTile3Button',      components: ['cc.Button'] },

    // ── Session 3 — feed + squad + stake ──
    { name: 'BalanceChipLabel',     components: ['cc.Label'] },
    { name: 'SearchEditBox',        components: ['cc.EditBox'] },
    { name: 'FeedTabTrending',      components: ['cc.Button'] },
    { name: 'FeedTabGainers',       components: ['cc.Button'] },
    { name: 'FeedTabNew',           components: ['cc.Button'] },
    { name: 'FeedTabTop10',         components: ['cc.Button'] },
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
];

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
