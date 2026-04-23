# Token Duel — UX Audit & Roadmap

_Last updated: 2026-04-21 · after Part 8 (final polish) shipped._

This document is the post-Part-8 debrief: a full walkthrough of how the game works today from the player's perspective, every loophole and fairness hole we've identified, and a prioritized roadmap of everything left to build if we keep shipping past the Colosseum Frontier hackathon submission.

Use this as the agenda for the next session.

---

## 1. What the game actually IS

**Stack-Jump (Stacker) tap game with a Web3 twist.**

- Classic Stack-Jump: base block at bottom, active block oscillates horizontally overhead, tap to drop it, overlap becomes the new top, miss → game over.
- Max height cap: **50 blocks**.
- Difficulty ramp: oscillation speeds up 10% every 5 blocks; floors at 50% of start.
- **The Web3 hook:** player picks a **squad of 3 tokens**. Each token's **24h price delta** (pulled live from Birdeye at game start) determines that token's **block width**:
  - ≥ +5% gain → 1.0× (220px, easy)
  - 0 to +5% → 0.8×
  - −5% to 0% → 0.6×
  - < −5% → 0.4× (88px, very hard)
- Blocks cycle through the 3 tokens (block 0 = A, 1 = B, 2 = C, 3 = A, …).
- Strategic tension: picking pumping tokens = easier game; picking dumpers = harder but same wager.
- Typical game duration: **30–90 seconds**.

Implementation: `assets/token-duel/scripts/TokenDuelGame.ts`.

---

## 2. Full user flow, screen by screen

### 2.1 Cold launch → Landing Panel

- `Connect Wallet` button (+ `Reconnect` if cached MWA auth token exists).
- Connect → OS wallet picker → wallet-side auth dialog → sign challenge → Home.
- Reconnect → reuses cached token, no wallet popup.

### 2.2 Home Panel

- Pubkey label at top.
- Buttons: **Play Token Duel**, Sign Message, Sign Tx, Sign & Send, Capabilities, Disconnect, Delete Account.
- Part 8: **⚙ Settings** gear (top-right).

### 2.3 Token Duel Panel (main hub)

- Top bar: ← Back, 🏆 Leaderboard, 👤 Portfolio, ⚙ Settings, balance chip `◼ X.XXXX SOL`.
- Search EditBox + feed-tab dropdown: New / Trending / Gainers / Smart Money / ★ Watchlist / 🏆 Top 10.
- Filter chips: Newest · Liq↓ · Liq↑ · All · ≥1k · ≥5k · ≥10k.
- 20-row feed: logo · symbol · score · DEX pill · age · liq · mcap · 1h% · 24h%.
- Squad zone: `Pick Squad` / `Drop Squad` / `▶ Run Squad` + 3 squad slot chips.
- Stake cluster (hidden until Run Squad tapped).

### 2.4 Tap ▶ Run Squad → ModePickerOverlay

- 4 mode buttons: **1v1 · 4p Pot · 8p Pot · Battle Royale** (all active after Part 6).
- 5 wager chips: 0.01 / 0.05 / 0.1 / 0.25 / 0.5 SOL.
- Track toggle: **Paper** / **Real**.
- `Start` button.

### 2.5a Paper flow

- Instant bot match — no on-chain tx.
- Bot handicap: first 5 games bots play 30% easier (`BOT_HANDICAP_MULTIPLIER = 0.7`).
- Tap game plays → height submitted → PostMatchPanel with placement + paper P/L.

### 2.5b Real flow

- First time: auto-signs `initialize_user_stats` tx (creates UserStats PDA).
- Matchmaking: `getProgramAccounts` scan for open matches matching `(mode, tier, xpBucket±3)`.
- If none: `join_match_create` with next `MatchCounter.seq`.
- Part 8: counter-race retries (3 attempts, 250/500/1000ms backoff).
- **WaitingPanel:** `N/M players · 0:00 / 2:00` ticker, Cancel button, Play-vs-Bot fallback after 2-minute timeout.
- Poll every 3s until match goes Active.
- Once full → game runs.

### 2.6 Tap game (TokenDuelGame)

- Overlay: base block, oscillating active block, Height label, token badge (`BONK +12%`).
- Tap, tap, tap → stack.
- Miss → 500ms fall animation → `_endGame` fires → submits height.

### 2.7 Settlement (real flow)

- `buildSettleMatchTxFor` — partial vs final settler logic.
- **Partial settler:** just writes height into their slot.
- **Final settler:** computes top-K winners from sorted heights, passes them as `remaining_accounts`.
- On-chain work: pays top-K from escrow, rakes 3% to Treasury, writes N `UserStats`, inserts winner into mode-specific `Leaderboard` PDA.
- Client polls for `status = Settled` (up to 30s).

### 2.8 PostMatchPanel

- Title: `1st of 4` / `2nd of 4` / …
- Track + mode label: `Real · 4p Pot`.
- Payout: `+0.140 SOL`.
- Subtitle: block-diff description or level-up flash.
- 4 stat cards: YOUR HEIGHT · OPP HEIGHT · XP EARNED · LEVEL.
- Part 7/8: 🏆 trophy bounces + spins + 12 confetti particles fan out on 1st-place; 🥈/🥉 fade in on 2nd/3rd.
- Buttons: ← Back · ▶ Play Again.

### 2.9 Leaderboard (top-right 🏆)

- Mode tabs: 1v1 / 4p / 8p / BR10.
- Top-10 rows: rank · pubkey (short) · H<height> · elapsed.
- Part 8: **Personal rank card** at bottom — `Rank #3 on 4p Pot` or `Not yet ranked · win to climb`, plus your W–L / Level / P/L.

### 2.10 Portfolio (top-right 👤)

- Paper / Real tab toggle.
- 6 stat cards: games · wins · losses · winrate · P/L · XP.

### 2.11 Settings (top-right ⚙, Part 8)

- Wallet section: name + pubkey + live balance.
- Profile section: local username EditBox (persists via `sys.localStorage`).
- Actions: Reconnect · Disconnect · Delete Account.

---

## 3. Loopholes & Fairness Issues

| # | Issue | Current state | Severity |
|---|---|---|---|
| 1 | **Last-settler advantage** — submitting last reveals other players' heights on-chain first | Theoretically exploitable, but the player still has to produce a height by playing | Medium — honor system |
| 2 | **Cheat client** — modified APK submits any u32 height without playing | No on-chain verification of gameplay | **High** — trust-client model |
| 3 | **AFK griefer** — joins match, never submits height | Match gets stuck; no timeout on Active status; funds stuck in escrow | **High** — funds trapped |
| 4 | **Mid-game crash** — app dies between join and settle | Wager in escrow, can't submit; no self-forfeit path | High |
| 5 | **Frontrunning** — bot watches mempool, joins matches with easy opponents | Possible on devnet; low stakes mitigate | Low for hackathon |
| 6 | **Stale price data** — 24h delta fetched once at game start | Each match uses own snapshot | Low, acceptable |
| 7 | **Squad re-use** — same 3 tokens across many matches | Intentional — squad is the "skin" | Not a bug |
| 8 | **Counter race** | Fixed in Part 8 (3-retry wrapper) | Mitigated |
| 9 | **Solflare Delete crash** | Known wallet bug | Documented |
| 10 | **4p/8p/BR10 losers get ZERO** — BR10 = 1 winner takes 50% of 5 SOL pot, 9 lose 0.5 SOL each | Working as designed; steep | Fairness? Consider "consolation" mode |

**Biggest hole: #3 (AFK griefer).** If any of the 4/8/10 players joins and ghosts, the match never settles and all wagers are stuck in escrow. `cancel_match` exists but only for `Waiting` status, not `Active`.

---

## 4. Missing Pieces — Feature Roadmap

### A. Time-window modes (user's idea — **killer feature**)

Currently: always 24h delta. User proposal: 1h / 1d / 3d / 7d.

- 1h mode → fast, meme-coin degens, high volatility = narrow blocks = hard
- 24h → current default, balanced
- 7d mode → blue-chip players, more stable deltas = more predictable blocks

**Second axis alongside mode (1v1/4p/8p/BR10), giving 4 × 4 = 16 distinct game shapes.**

Implementation sketch:
- `GameMode` enum stays; add `TimeWindow { H1=0, D1=1, D3=2, D7=3 }` passed to `join_match_create`.
- Birdeye `/defi/price_volume/multi` accepts a `type` param for exactly this.
- Scene adds a second chip row in ModePicker.
- Match PDA seeds extend to `[b"match", mode, tier, time_window, seq_le]` — breaking, needs redeploy.
- Per-mode × per-window leaderboards? (Probably too many PDAs — instead: per-mode board keyed by tuple `(mode, window)`.)

### B. Tournaments / seasons

- Weekly ladder per mode.
- Season-end prize pool from accumulated rake.
- Requires off-chain indexer OR a `SeasonAccount` PDA that resets weekly.

### C. Daily challenges / streaks

- "Win 3 matches today → bonus XP."
- "7-day login streak → free match entry."
- Purely client-side + `UserStats` flag fields.

### D. Match history

- Portfolio shows aggregate stats but not individual match logs.
- Index via `getSignaturesForAddress(userStatsPda)` + decode `MatchSettled` events.
- Pure client work.

### E. Replay / highlight reel

- Record heights per block-drop, replay on PostMatchPanel.
- Nice-to-have, not critical.

### F. In-match communication / emotes

- 4–8 player matches feel solo.
- Tiny emoji shelf (`gg`, 👑, 💀) via WebSocket or a `MatchChat` PDA.
- Heavy lift.

### G. Spectator mode

- Watch a live match before joining.
- Requires `subscribeAccountChange` on match PDA + live tower rendering.
- Nice differentiator, medium lift.

### H. Push notifications

- "Your match is ready!" when a 4p fills its last slot.
- Requires APNs/FCM setup — heavy lift.

### I. Fairness additions

- **`force_settle` / AFK reclaim ix** — if match Active for >5min and `settled_count < required_players`, anyone can call it; forfeits non-submitters, pays out remaining. **Fixes the #1 fairness hole.**
- **Cheat-resistance** — v2 path: server-signed height receipts via Ed25519 on-chain verification (`programs/token-duel/src/lib.rs` header already mentions this as "v2").
- **Loser consolation** — optional mode: 60/30/10% payout so even last place gets 10% back.

### J. Squad-level mechanics

- **Squad power** — sum of 3 token market caps → scales payouts.
- **Token badges** — "OG" for <24h-old tokens, "Blue Chip" for top-100 mcap.
- **Hot token multiplier** — if squad includes a token that pumped >20% today, next block gets 1.2× width.

### K. Social / viral

- **Share card** — post-match PNG with your tower, placement, win amount → share to X.
- **Invite code** — per-user; referrals get 5% rake rebate.
- **Friend list** — track other pubkeys, match-lobby invites.

### L. Economy polish

- **Participation refund** — 15% return to losers funded from rake (reduces Treasury revenue but smooths on-ramp).
- **Buy-in discount** — XP Level ≥ 5 gets -5% rake.
- **Streak bonus** — 3 wins in a row = +10% next payout.

### M. First-run / onboarding

- No tutorial screen explaining Stack-Jump mechanic or squad-delta tie-in.
- Tap-target overlay on first play: "Tap anywhere to drop the block. Match the block to the one below."
- ~30 lines of UI, huge UX gain.

### N. Haptics + sound

- Tap click, miss thud, victory fanfare.
- Android `HapticFeedbackConstants.VIRTUAL_KEY` via tiny native bridge.
- ~20% perceived polish for ~4 hours of work.

### O. Accessibility

- No color-blind mode for block colors.
- No font-size preference.
- Not critical for hackathon.

---

## 5. Prioritized Roadmap

### Tier S — would transform the product
1. **Time-window modes (1h/1d/3d/7d)** — user's idea; huge surface-area expansion for low code cost.
2. **AFK reclaim / `force_settle` ix** — fixes the #1 fairness hole, prevents stuck funds.
3. **Match history view** — single most-requested feature for any wager game.
4. **First-run tutorial** — judges + first players get lost without it.

### Tier A — high polish, moderate effort
5. Share-card to X — free viral growth.
6. Daily/weekly leaderboards — retention mechanic.
7. Haptics + sound — feel.

### Tier B — cool but not critical
8. Spectator mode, replays, emotes, streaks, squad power, loser consolation.

### Tier C — post-hackathon
9. Tournaments, push notifications, seasons, tokenized usernames.

---

## 6. Honest gap summary

We have a **complete vertical slice** — wallet → token picker → stake → matchmake → play → settle → profile. What we **don't** have:

- **Explanation** (onboarding, tutorial, "why pick these tokens").
- **Retention loops** (no daily reason to return).
- **Session permanence** (no match history, no replays, no shareable artifacts).
- **Liquidity protection** (AFK griefing can strand funds indefinitely in Active matches).
- **Variety beyond player count** (no time-window, no squad-size, no token-class modes).

For the **hackathon pitch**, the vertical slice + 4 modes + leaderboards/trophy/settings is demo-ready. For a **real shipping product**, Tier-S items 1–4 are the critical gap.

---

## 7. Suggested Part 9 scope

If we pick up in a new session, the highest-leverage Part 9 is:

**Part 9 — Tier S bundle: time windows + AFK reclaim + match history + tutorial**

- Rust: add `TimeWindow` byte to `MatchAccount` + Match PDA seeds; new `force_settle` ix with AFK timeout.
- Client: ModePickerOverlay gets a time-window chip row; PriceFeed passes the window to Birdeye; Matchmaker xpBucket→(mode,window) tuple.
- UI: MatchHistory panel under Portfolio (decodes `MatchSettled` events from signature log).
- UX: FirstRunTutorial overlay — 3 tooltips on first `_onTokenDuelGameStart`, dismissed forever via `sys.localStorage['tokenduel:tutorialSeen']`.

Estimated LOC: ~800. One focused session.

Alternative Part 9 scopes (user preference):
- **Pure polish:** tutorial + haptics + share card — no program redeploy.
- **Pure program:** time windows + AFK reclaim + loser consolation mode — heavy Rust, single redeploy.
- **Economy rework:** participation refund + streak bonus + level-based rake discount — UserStats schema change.
