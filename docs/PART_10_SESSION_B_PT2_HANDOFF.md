# Token Duel — Part 10 Session B pt2 Handoff

_Last updated: 2026-04-22. This document is the canonical pickup point for the next session._

## TL;DR — what's shipped, what's left

Session A (Bundle 1, cheat-resistance) and Session B pt1 (Bundle 2 + 3 foundation) are complete. The **Rust program and all client data plumbing are production-ready**; only UI polish + backend cron + a few auxiliary scripts remain.

**To deploy what's shipped right now:**
```bash
# 1. Redeploy the program (bigger bytecode than current devnet deploy)
cd /Users/devlegacy/Desktop/cocos-solana-mwa/programs/token-duel
cargo check                                              # should be clean
anchor build && anchor deploy --provider.cluster devnet
# Admin wallet needs ≥1.8 SOL — 8FAPokEsm1CFbSsJ53DM8Bfe7QBmSN4TDrAQR2qXdcXe

# 2. Bootstrap today's retention PDAs (MUST run before any settle ix)
cd ../../scripts
npm run init-daily-challenge
npm run init-season

# 3. Smoke-test the new settle path
npm run smoke-match                                       # legacy path
npm run smoke-match -- --window 1h                        # Part 9 windows still work

# 4. Rebuild APK and test Quick Play on device
cd ..
rm -rf library/ temp/ build/android/proj/build/
# ... rebuild in Cocos Creator → adb install -r
```

On device after APK reinstall: Home panel has a `⚡ Quick Play` button + `🔥 Day N · x/3 challenges` streak strip. Quick Play works end-to-end (auto-picks top-3 gainers, starts a paper 1v1 match). 📚 Presets / 💡 Suggest buttons work in TokenDuel top bar. Streak strip shows placeholder toast (full DailyChallengePanel is pt2).

---

## Coding remainder — ~1,170 LOC across 5 areas

### 1. Scenes (`generate-scenes.js`) — ~300 LOC

#### 1a. `SquadPresetsOverlay` (new full-panel overlay)
- Mirror `SquadDropOverlay` pattern at `generate-scenes.js:930–963`.
- Scrim (dark 70% black), tap-outside-to-close.
- Title "SQUAD PRESETS" at y=400.
- 5 preset rows at y=300/230/160/90/20, each 600×56: on the left show `name` (18pt, white) + squad symbols (14pt, gray); on the right a small `🗑️` delete button (40×40).
- Bottom "💾 Save current squad" button at y=-100 (420×56, gold) — opens an EditBox modal.
- `PresetNameModal` child: small 420×180 card centered at y=-30 with an EditBox (uses `mkEditBox(sb, 'PresetNameEditBox', parent, 'Preset name', 0, 20, 380, 44, 17)`) + Save/Cancel buttons.

#### 1b. `DailyChallengePanel` (new full-panel overlay, sibling of LeaderboardPanel)
- Mirror `LeaderboardPanel` scene structure at `generate-scenes.js:1264–1350`.
- BackButton (top-left) + title "🔥 Today's Challenges" (32pt, gold).
- Streak card at y=440, 600×100, two labels: big "Day 7" (40pt) + small "Best: 12" (16pt).
- 3 challenge rows at y=280, y=180, y=80 — each 600×80, sprite bg, with:
  - Left: `ChallengeDescriptionLabel_0/1/2` (pre-filled at render time via `DailyChallengeRpc.describeChallenge`)
  - Center: `ChallengeRewardLabel_0/1/2` ("+150 XP")
  - Right: `ChallengeCheckmark_0/1/2` (label "✓" or "·", green if completed)
- Season summary card at y=-60, 600×120: "Season rank #N · X wins · Top 3 podium"
- Add the panel to canvas children at the bottom of `generate()` alongside LeaderboardPanel.

#### 1c. `SettingsPanel` `QuickPlayDefaultsCard` (new card)

⚠ **CORRECTION (2026-04-22):** An earlier draft of this doc said y=120 was empty. It's NOT — `ReconnectSettingsButton` sits at y=120 (verified at `generate-scenes.js:1643`). The ACTIONS section spans y=120 / y=40 / y=-40 (Reconnect / Disconnect / Delete).

You have two placement options:
- **Option A (recommended)** — Insert card BETWEEN Profile and Actions by shifting Actions down:
  - Move `stReconnectBtn` y=120 → y=-140
  - Move `stDisconnectBtn` y=40 → y=-220
  - Move `stDeleteBtn` y=-40 → y=-300
  - Move `stStatus` label y=-580 → stays (or nudge to -640)
  - Insert `QuickPlayDefaultsCard` at y=80, 660×200
- **Option B** — Shrink PROFILE card and squeeze the QP card above Actions: requires compressing PROFILE from 150→100h and is flakier. Skip.

- Card: 660×200, sprite bg `(22, 28, 42)`, header label "QUICK PLAY DEFAULTS" at card-top-left.
- 4 radio rows using `mkBtnXY` pattern:
  - Mode row at y=+60: `QPMode_oneVone / _4p / _8p / _br10`, 140×40 each, spaced ±210/±70
  - Window row at y=+20: `QPWindow_1h / _1d / _3d / _7d`, 140×40 each, same spacing
  - Wager row at y=-20: 5 chips `QPWager_001 / _005 / _01 / _025 / _05`, 112×40 each, -240/-120/0/120/240
  - Track row at y=-60: `QPTrack_paper / _real`, 150×44, ±80
- Selected tints emerald `(48, 198, 155)`; unselected dark `(28, 34, 48)` — mirror `_refreshModePickerUi` colors.

#### 1d. `LeaderboardPanel` 5th "This Week" season tab
- Current 4 tabs at `generate-scenes.js:1286–1299` use x coords `-228 / -76 / 76 / 228`, width 140.
- Recompute for 5 tabs: x = `-296 / -148 / 0 / 148 / 296`, width 130.
- Add `LbTab_season` (rightmost), label "🏆 This Week".
- Row pool (LBRow_0..9) stays the same — just gets a second render path.

### 2. AppUI.ts — ~400 LOC

#### 2a. Home daily widget hydration
```typescript
private async _hydrateDailyChallengeWidget(): Promise<void> {
    const strip = this._homePanel.getChildByName('DailyStreakStrip')
        ?.getChildByName('Label')?.getComponent(Label);
    if (!strip) return;
    const mwa = MWAManager.instance;
    const pubkey = mwa?.connectedPubkey;
    if (!pubkey) { strip.string = '🔥 Connect wallet to start your streak'; return; }
    try {
        const [stats, dc, season] = await Promise.all([
            getUserStats(this._tdRpc, pubkey),
            getCurrentDailyChallenge(this._tdRpc),
            getUserSeasonRank(this._tdRpc, pubkey),
        ]);
        const streak = stats?.currentStreak ?? 0;
        const bitsDone = stats ? countCompleted(stats.dailyChallengesBitmask) : 0;
        const total = dc?.challenges.length ?? 3;
        const rank = season ? `#${season.rank}` : '—';
        strip.string = `🔥 Day ${streak} · ${bitsDone}/${total} challenges · Season ${rank}`;
    } catch (e) {
        strip.string = '🔥 Day 1 · Play a match to start your streak';
    }
}
```
Call from `_showHome()` after the panel activates.

#### 2b. `_refreshDailyChallengePanel()` — full panel render
- Fetch stats + current DailyChallenge + current Season in parallel.
- For each of the 3 challenge rows, set description via `describeChallenge(dc.challenges[i])`, reward via `+${c.rewardXp} XP`, checkmark based on `(stats.dailyChallengesBitmask >> i) & 1`.
- Season podium: `season.entries.slice(0, 3).map((e, i) => `${i+1}. ${e.player.slice(0,4)}...${e.player.slice(-4)} · ${e.wins}w`)`.

#### 2c. `_renderSeasonRows()` + season tab handler

**Correction (2026-04-22):** The actual handler name is `_onLeaderboardTabClick` (not `_onLbTabClick`). Signature at `assets/demo/scripts/AppUI.ts:4887`:
```typescript
private async _onLeaderboardTabClick(modeU8: number, tabKey: string): Promise<void>
```
It sets `this._lbFilterMode = modeU8` and calls `_refreshLeaderboardTabTints()` + `_refreshLeaderboardPanelRows()` + `_refreshPersonalRankCard()`. To add season handling:

- Extend `_lbFilterMode` to accept a sentinel (e.g. `4` = season mode — modeU8 values are 0..3 so 4 is free). Don't use `-1` because `_lbFilterMode` is typed `number` and the existing `fetchLeaderboard` signature takes a u8-ish number.
- Inside `_onLeaderboardTabClick`, if `modeU8 === 4`, branch to `_refreshSeasonTab()` instead of `_refreshLeaderboardPanelRows()`.
- `_refreshLeaderboardTabTints` (at `AppUI.ts:~4950`) already uses a map — extend it to include the season tab.
- `_refreshSeasonTab()`: fetch `getCurrentSeason`, render entries into the same `LBRow_*` pool with columns (rank · pubkey · wins) instead of (rank · pubkey · height).
- Personal rank card at bottom: "Rank #N on This Week · X wins · Y season SOL" (pull own stats.season_wins).

#### 2d. Proper `SquadPresetsOverlay` handlers
- Replace v1 auto-save-by-date with:
  - `_onOpenSquadPresets` — show the overlay, call `_renderPresetRows()`.
  - `_renderPresetRows()` — iterate `SquadPresets.list()`, populate 5 row nodes, hide unused.
  - `_onPresetRowTap(id)` — apply preset to `_squad`, close overlay.
  - `_onPresetDeleteTap(id)` — `SquadPresets.delete(id)` + re-render.
  - `_onPresetSavePrompt` — show `PresetNameModal`, EditBox focus.
  - `_onPresetSaveConfirm` — read EditBox text, call `SquadPresets.save(name, currentSlots)`, close modal + re-render.

#### 2e. Settings Quick-Play defaults handlers
- 4 radio-row tint-sync methods: `_onQPModeClick(modeId)` / `_onQPWindowClick(windowId)` / `_onQPWagerClick(idx)` / `_onQPTrackClick(track)`.
- Each persists to the corresponding `tokenduel:qp.mode|window|wager|track` localStorage key + calls `_refreshQPCard()` to update tints.
- `_refreshQPCard()` reads current values from localStorage and applies tints to each row's 4/5/2 buttons.
- Hook into `_onSettingsShow` or equivalent panel-open handler.

#### 2f. Remove `_onOpenDailyChallenges` placeholder
- Current implementation at `AppUI.ts` ~line 1600 just shows a toast.
- Replace with: `this._homePanel.active = false; this._dailyChallengePanel!.active = true; this._refreshDailyChallengePanel();`
- Also wire a Back button on the panel to reverse.

### 3. Backend (`backend/src/`) — ~300 LOC

#### 3a. `backend/src/admin_signer.ts` (new)
```typescript
import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
export function loadAdminKeypair(): Keypair {
    const secret = process.env.ADMIN_SECRET;
    if (!secret) throw new Error('ADMIN_SECRET env var required for cron');
    return Keypair.fromSecretKey(bs58.decode(secret));
}
export async function sendAdminTx(
    connection: Connection, admin: Keypair, txBytes: Uint8Array,
): Promise<string> { /* deserialize, sign, sendAndConfirm, log explorer link */ }
```

#### 3b. `backend/src/cron.ts` (new)
- Compute next 00:00 UTC offset at startup, `setTimeout` for first run, then `setInterval` every 86_400_000 ms.
- Each tick:
  - Today's `day_id = floor(now/86400)` → `buildInitDailyChallengeTx` with rotation[day_id % 14] → send.
  - If Sunday (`(day_id + 4) % 7 === 0` because Unix epoch was a Thursday): `buildInitSeasonTx` for next week.
  - If Monday: `buildPaySeasonTx` for previous week (24h grace).
- Respect `CRON_DRY_RUN=1` env: log instead of send.
- Respect `RUN_NOW=daily|weekly|payout` env: fire that one immediately then sleep; useful for testing.

#### 3c. `backend/challenges.json` (new)
- Extract the 14-day `ROTATION` array from `scripts/init-daily-challenge.ts:34–49`.
- Keep the TS script reading from this JSON too so backend + manual script stay in sync.

#### 3d. Wire into `backend/src/server.ts`
- After `httpServer.listen(...)`, call `startCron()`. Guard with `if (process.env.CRON_ENABLED !== 'false')` so local dev can skip.

### 4. Admin scripts (`scripts/`) — ~80 LOC

#### 4a. `scripts/pay-season.ts` (new)
```typescript
// Usage: npm run pay-season -- --season <id>
// 1. Load admin keypair
// 2. Fetch Season PDA for --season
// 3. Read entries[0..3] to get recipient pubkeys
// 4. Call AnchorBackend.buildPaySeasonTx(admin, seasonId, recipients, blockhash)
// 5. Sign + confirm, log explorer link
```
Register in `scripts/package.json`: `"pay-season": "ts-node pay-season.ts"`.

#### 4b. `scripts/smoke-match.ts` — `--verified` flag
- Current arg parser accepts `--mode` + `--window`.
- Add `--verified` boolean flag.
- When set, after creating the match, use `AnchorBackend.buildSettleMatchVerifiedTx` instead of `buildSettleMatchTx`.
- Requires calling a local backend (spin up via `backend/npm run dev` in another tab, or skip this flag for CI).
- Steps: POST `/session/start` → open WS → send fake drop events matching physics → finalize → receive receipt → include Ed25519 precompile ix + verified settle ix in one tx → send.

### 5. Rust — ~60 LOC

#### `force_settle.rs` retention integration
Currently `programs/token-duel/src/instructions/force_settle.rs` mutates UserStats but skips retention hooks. This means winners in AFK-reclaimed matches don't get streak/season credit.

**Fix:**
1. Add `daily_challenge: Account<'info, DailyChallenge>` + `season: Account<'info, Season>` to `ForceSettle` accounts struct (mirror `SettleMatch`).
2. In the handler, after the per-player stats mutation at lines ~150–190:
   ```rust
   let daily_challenges_snapshot = ctx.accounts.daily_challenge.challenges;
   for slot_idx in 0..n {
       // ... existing deserialize + XP/profit ...
       let bonus_xp = apply_retention_updates(
           &mut stats, won, mode_u8, match_time_window, required_players,
           &daily_challenges_snapshot, &mut ctx.accounts.season,
           players[slot_idx], clock.unix_timestamp,
       );
       stats.xp = stats.xp.saturating_add(bonus_xp);
       stats.level = level_from_xp(stats.xp);
       // ... existing reserialize ...
   }
   ```
3. Also add `match_time_window` to the scope-1 tuple extraction (mirror what settle_match does).
4. Client `AnchorBackend.buildForceSettleTx` — append daily_challenge + season accounts before remaining_accounts (same layout as buildSettleMatchTx).

### 6. Scene verifier (`scripts/verify-scene-bindings.ts`) — ~30 LOC

Add entries for all new scene nodes:
- `QuickPlayButton`, `DailyStreakStrip`, `OpenSquadPresetsButton`, `SuggestSquadButton` (already in Home / TokenDuel but missing from verifier).
- Once pt2 scenes ship: `SquadPresetsOverlay`, `PresetNameModal`, `PresetNameEditBox`, each `PresetRow_0..4`, `DailyChallengePanel`, `DailyStreakCard`, each `ChallengeDescriptionLabel_0..2` + `ChallengeRewardLabel_0..2` + `ChallengeCheckmark_0..2`, `SeasonSummaryCard`, `QuickPlayDefaultsCard` + all 15 radio buttons, `LbTab_season`.

Also clean up 7 stale entries (from the solpulse trade-tab rewrite — pre-Part 9, never removed): `HeroTile1Button`, `HeroTile2Button`, `HeroTile3Button`, `FeedTabTrending`, `FeedTabGainers`, `FeedTabNew`, `FeedTabTop10`.

---

## Execution order for pt2 session

1. **Rust: force_settle retention fix** — smallest scope, ships with the same redeploy. ~15 min.
2. **Scene work first (bottom-up):** SquadPresetsOverlay, DailyChallengePanel, Settings QuickPlayDefaultsCard, LeaderboardPanel 5th tab. ~90 min.
3. **Regen scene + scene verifier updates.** ~15 min.
4. **AppUI wiring (top-down):** Home widget hydration, DailyChallengePanel handler, season tab render path, proper SquadPresets handlers, Settings QP handlers. ~180 min.
5. **Backend cron:** admin_signer + cron + challenges.json extract + server.ts wire. ~75 min.
6. **Scripts:** pay-season.ts + smoke-match --verified flag. ~45 min.
7. **Final verification:** cargo check clean, scene regen clean, tsc --noEmit clean, backend test:session green, verify-scene green. ~30 min.

**Total: ~7-8h focused work.** Pad +30% for debugging = plan for one full session.

---

## Deploy-day checklist (after pt2 ships)

```bash
# 1. Rust compiles + program redeploys
cargo check && anchor build
anchor deploy --provider.cluster devnet   # admin needs ≥1.8 SOL

# 2. Bootstrap today's retention PDAs + (if Sunday) next season
cd scripts
npm run init-daily-challenge
npm run init-season

# 3. Backend key rotation (if going to prod)
npm run keygen-receipt-signer
# → paste new pubkey into programs/token-duel/src/state.rs RECEIPT_SIGNER_PUBKEY
# → paste new secret into backend/.env.production as RECEIPT_SIGNER_SECRET
# → re-deploy program + backend

# 4. Start backend cron
cd ../backend
# On Railway: cron runs inside main dyno automatically.
# Local dev: CRON_ENABLED=true npm run dev

# 5. Smoke-test
cd ../scripts
npm run smoke-match                         # legacy, with retention
npm run smoke-match -- --verified           # full flow + Ed25519 receipt
npm run pay-season -- --season <prev_week>  # test payout path (mock)

# 6. Rebuild APK, install on device
rm -rf library/ temp/ build/android/proj/build/
# ... Cocos Creator build → adb install -r

# 7. Manual flows to spot-check
#    - Cold launch → Connect → ⚡ Quick Play → plays paper 1v1 in 2 taps
#    - Home streak strip shows "Day 1 · 0/3 challenges"
#    - Win a real match → streak bumps, challenge bit flips, PostMatch toast
#    - Settings → Quick Play Defaults → change mode/wager/window/track → back → Quick Play uses new defaults
#    - TokenDuel → 💡 Suggest → fills top-3 gainers for current window
#    - TokenDuel → 📚 Presets → save current → delete → re-apply
#    - LeaderboardPanel → 🏆 This Week → shows top-10 by wins
#    - DailyChallengePanel → 3 challenge rows + streak card + season podium
#    - 48h later → streak still intact if you played within; resets day 3
```

---

## Reference — what's shipped (for context while planning pt2)

Every file below is done, compiles, and is ready to redeploy:

### Rust (`programs/token-duel/src/`)
- `state.rs` — UserStats v2 (112 B), DailyChallenge (38 B), Season (446 B), Season::try_insert
- `error.rs` — 7 new variants
- `instructions/migrate_user_stats.rs`, `initialize_daily_challenge.rs`, `initialize_season.rs`, `pay_season.rs`, `retention_hooks.rs` — all new
- `instructions/settle_match.rs` + `settle_match_verified.rs` — daily_challenge + season accounts injected, retention_hooks call, season rake accrual
- `instructions/initialize_user_stats.rs` — v2 field init
- `instructions/mod.rs` + `lib.rs` — new modules + dispatchers

### Client TS (`assets/token-duel/scripts/`)
- `UserStatsRpc.ts` — v1/v2 aware parser
- `DailyChallengeRpc.ts` — new (+ describeChallenge, countCompleted)
- `SeasonRpc.ts` — new (+ getUserSeasonRank)
- `AnchorBackend.ts` — buildMigrateUserStatsTx, buildInitDailyChallengeTx, buildInitSeasonTx, buildPaySeasonTx, derive+current helpers; settle builders auto-inject retention PDAs
- `VettedMints.ts`, `SquadPresets.ts` — new
- `constants.ts` — DAILY_CHALLENGE + SEASON seeds

### Client AppUI (`assets/demo/scripts/AppUI.ts`)
- `QuickPlayButton` + `_onQuickPlay` (last-winning → gainers → vetted fallback chain)
- `DailyStreakStrip` wired to `_onOpenDailyChallenges` (placeholder toast)
- `📚` / `💡` buttons + `_onOpenSquadPresets` (v1 auto-save-by-date) / `_onSuggestSquad`
- `_ensureUserStatsInitialized` detects v1 80-byte accounts and auto-signs migrate

### Scenes (`generate-scenes.js`)
- HomePanel recompacted for QuickPlayButton + DailyStreakStrip
- TokenDuelPanel top bar: 📚 / 💡 icon buttons

### Admin scripts (`scripts/`)
- `init-daily-challenge.ts` — 14-day rotation config
- `init-season.ts`
- `keygen-receipt-signer.ts` (Session A)

### Backend (`backend/`) — Session A
- Full Node + Express + ws + tweetnacl server
- physics / receipt / session tests all green
- Dockerfile + railway.json + fly.toml + README

---

## Current devnet state

- **Program ID:** `14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd` (needs redeploy with Part 10 bytecode)
- **Admin wallet:** `8FAPokEsm1CFbSsJ53DM8Bfe7QBmSN4TDrAQR2qXdcXe` (≥1.8 SOL for upgrade)
- **Test player:** `5KsqXhGmLyPFLvZUk8VnHbHhXjCrYMQWxai3faADsDst`
- **Receipt signer (dev):** `EiAotb9jwAbGjAWZ54bgHsS4QmUGQdETZL1Zmey4qRVA` (deterministic from seed `token-duel-receipt-signer-devnet-v1`; hardcoded in `state.rs` + derived by backend when `RECEIPT_SIGNER_SECRET` env is unset)
- **Birdeye API key:** embedded in `constants.ts`, Premium + Websocket tier

## Hackathon deadline

**Colosseum Frontier submission: May 11, 2026.** Current date: 2026-04-22. **19 days of runway.**

Pt2 takes ~1 session. That leaves plenty of time for a polish session (share cards, haptics, sound) and pitch video recording before deadline.

---

## Useful prior-art references

- `docs/UX_AUDIT_AND_ROADMAP.md` — pre-Part-9 audit; still accurate for the big-picture gap list
- `docs/DEPLOY_RUNBOOK.md` — Session D deploy steps (outdated for Part 10 but covers anchor deploy flow)
- `docs/GAME_MODES.md` — mode taxonomy post-Part 9
- `/Users/devlegacy/.claude/plans/gleaming-zooming-volcano.md` — full plan with decision log (Sessions A + B)
