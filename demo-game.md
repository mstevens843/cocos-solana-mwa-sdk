# Demo Game — Design Doc

Planning notes for the Cocos × Solana MWA demo game. Branch: `demo-game`. Target: one Cocos scene, ≤60s session, crypto mechanically in the loop, all mandatory MWA methods firing with in-game reason.

---

## Hard Constraints

**MWA method coverage (from wallet-compatibility audit):**

| Method                          | Wallet support                     | Role in demo             |
| ------------------------------- | ---------------------------------- | ------------------------ |
| `authorize` (connect)           | All                                | **Mandatory** on entry   |
| `sign_transactions`             | All                                | **Mandatory** loop call  |
| `sign_and_send_transactions`    | Most (Backpack fallback path ready)| **Mandatory** loop call  |
| `sign_messages`                 | Not Phantom / Solflare             | Optional / advanced path |
| SIWS (`sign_in_with_solana`)    | Not Phantom / Solflare             | Optional / advanced path |
| `deauthorize`                   | All                                | End-of-session           |

**Rule:** the core game loop must function on any wallet using only `authorize` + `sign_transactions` + `sign_and_send_transactions`. `sign_messages` / SIWS surface as a gated "advanced" path for wallets that support them — shows the parity-plus story without breaking Phantom/Solflare users.

**Other constraints:**
- One Cocos scene. No level design, no menus beyond what's required.
- ≤60s session length — dopamine loop must resolve before attention dies.
- Crypto is *mechanically* in the loop, not a leaderboard paste-on. Remove the chain → the game visibly breaks.
- Must work on Seeker (Seed Vault) and on commodity wallets. Devnet SOL only.

---

## Research Summary

Full detail in `/Users/devlegacy/.claude/plans/proud-humming-trinket-agent-ab23fc797738a2908.md` (crypto mechanics) and `/Users/devlegacy/.claude/plans/proud-humming-trinket-agent-a2c31c7eaaf4cdf0b.md` (Cocos form factor).

**Five patterns for genuine crypto-in-loop (ranked by single-scene fit):**
1. **Stake-to-Commit** — lock SOL on a promise; hit target = refund + bonus, miss = forfeit. (Moonwalk archetype.) Remove the stake, the game dies. Hits `sign_and_send` twice (stake, settle).
2. **On-Chain High Score / PDA write** — score written to a Solana program; cheat-proof leaderboard. Hits `sign_and_send`.
3. **Tournament Pot / Escrow** — entry fee to a program; winner takes the pot minus rake. Hits `sign_and_send`.
4. **Loot/Score Mint (receipt NFT)** — completing a run mints a tiny NFT of the score/seed/timestamp. Hits `sign_and_send`.
5. **Commit-Reveal** — sign a secret off-chain first, reveal on-chain later. Meaningful when fairness / anti-frontrun matters. Hits `sign_messages` + `sign_and_send`.

**Cocos hyper-casual form factors with best stake-layer fit** (from the WeChat mini-games / Cocos template catalogue):
- Timer/precision tap (Stack, Helix Jump) — skill-framed
- Slingshot physics (Monster Strike-lite)
- Slot/spin reel — gambling-framed
- Crash / cash-out (Aviator) — gambling-framed, max dopamine
- Dodge / survival (Flappy-lite) — skill-framed
- Swipe/flick (Fruit Ninja-lite) — skill-framed

**Framing trade-off:**
- **Skill game** = clean optics, reads as a *game*, safer for Colosseum + Foundation grant review. Lower dopamine density.
- **Gambling-framed** (crash / slot) = stake IS the mechanic, highest dopamine, but some reviewers read it as "crypto casino clone." Solana dApp Store allows both, but it narrows the story.

---

## Engine Strengths Alignment (why these genres, not others)

Why all 10 concepts below are 2D hyper-casual / reel / physics-tap shapes: those are exactly the genres Cocos is structurally built for, and exactly the genres Unity and Unreal are structurally *bad* at on the hardware Asia plays on. Every idea in the shortlist leans into a Cocos strength, not away from one.

**Cocos's four real moats (from research, sources in `/Users/devlegacy/.claude/plans/proud-humming-trinket-agent-a4bb0bac983a4f070.md`):**

1. **Runtime size.** Cocos runtime ~2–4 MB. Unity's floor is ~8 MB *before* game code. WeChat mini-games hard-cap the main package at **4 MB** — Unity physically can't ship there. Google's data: every 6 MB of APK = 1% install-rate drop.
2. **2D specialization.** Cocos is TypeScript + 2D-first. Unity is a 3D engine that can do 2D; Cocos is a 2D engine that can do 3D. For sprite-driven mini-games, Cocos wins on asset pipeline, boot time, and memory.
3. **Genre fit.** 93% of top-grossing Japanese mobile titles include gacha; Asian mobile is structurally 2D-gacha-dominant. Cocos's commercial lineage (Monster Strike $7B+, Lotsa Slots, Top War, ONE PIECE Treasure Cruise) is all in the reel / gacha / physics-tap / 4X territory.
4. **Multi-store export.** One Cocos project builds for native Android + iOS + Web + WeChat + Douyin + Alipay + Huawei QuickGame + OPPO/vivo mini-game stores. Unity can't match this from one codebase.

**Where Unity still wins in Asia** (useful to know so we don't claim otherwise): 3D open-world mobile (Genshin → Unity), 3D MOBAs (Honor of Kings original → Unity), AR/XR. Unreal owns the top-fidelity cap (Black Myth Wukong, Honor of Kings: World).

**Idea-to-strength map:**

| # | Concept                 | Cocos strength it leans into                       | Commercial lineage on Cocos           |
| - | ----------------------- | -------------------------------------------------- | ------------------------------------- |
| 1 | Stack Climb             | 2D physics-tap, tiny runtime                        | Cocos Store template category         |
| 2 | Aviator-lite (Crash)    | Minimal 2D animation, reveal-driven                 | Casino/slots genre Cocos owns         |
| 3 | Flappy-Stake            | Classic 2D side-scroll; Badland lineage             | Badland (Apple Design Award, Cocos)   |
| 4 | **Slingshot Bees**      | **2D slingshot physics — Monster Strike's exact genre** | **Monster Strike $7B+ LTG (Cocos)** |
| 5 | **Spin-to-Claim Slots** | **Reel animation — Lotsa Slots's exact genre**      | **Lotsa Slots top-100 US iOS (Cocos)** |
| 6 | Dodge Sprint            | 2D endless runner, low memory                       | Snake Rescue (5M DL in 6 mo, Cocos)   |
| 7 | Precision Tempo Tap     | 2D rhythm / tap-bar                                 | Musical Poet (Cocos WeChat hit)       |
| 8 | **Moonstep Mini**       | **Smallest possible 2D — fits inside WeChat's 4 MB cap** | Moonwalk Fitness (#2 Seeker dApp)   |
| 9 | Meme-Swipe              | 2D swipe physics — Fruit Ninja pattern              | Fishing.io (Cocos, 2-week build)      |
| 10| Tournament Tap-Race     | 2D tap + state sync; Cocos multi-store ready        | Top War pattern                       |

**Three ideas with the strongest "Cocos was built for this" pitch:**

- **#4 Slingshot Bees** — Monster Strike is built on Cocos and grossed $7B+. Judges ask "why Cocos?" → "because the #1 slingshot-physics mobile game in history is built on it."
- **#5 Spin-to-Claim Slots** — Cocos owns the casino/reel genre in Asia. Lotsa Slots lineage.
- **#8 Moonstep Mini** — small enough to ship as a WeChat mini-game later (fits the 4 MB cap). Direct bridge to the `PITCH.md` Year-2 vision (Solana assets inside WeChat mini-games). Unity literally can't follow us there.

**Judge-defense ammo** (paste into pitch/Q&A):
- *"Why Cocos and not Unity?"* → WeChat's 4 MB main-package cap and the 1%-per-6-MB install-rate curve. Unity can't physically ship to WeChat mini-games; Cocos owns 70%+ of that $5.56B market.
- *"Isn't this just a hyper-casual demo?"* → Yes, deliberately — that's where Cocos leads globally (72% of WeChat Creative Mini Games) and where Unity has no answer.
- *"What if your demo needs 3D?"* → It doesn't, and neither does the market we're unlocking. 93% of top-grossing Japan mobile is gacha, which is 2D. Cocos's lane *is* the lane.

---

## 10 Game Concepts

Scored on: **Dopamine (D)** 1–5 · **Build complexity (B)** 1–5 (lower=cheaper) · **Judge optics (O)** 1–5 (higher=safer).

| # | Concept | Framing | D | B | O | Notes |
|---|---|---|:---:|:---:|:---:|---|
| 1 | **Stack Climb** — tap to drop blocks perfectly; misalignment shrinks the stack. Stake per run, tiered payout by height reached. | Skill | 4 | 2 | 5 | Cleanest Colosseum story. Stack genre already in Cocos Store templates. |
| 2 | **Aviator-lite (Crash)** — multiplier climbs each second, tap to cash out before it crashes. Stake = entry, payout = stake × multiplier. | Gambling | 5 | 2 | 2 | Highest dopamine. Stake is literally the mechanic. "Crypto casino" read risk. |
| 3 | **Flappy-Stake** — tap to hover, thread pipes, die instantly. Stake per attempt, tiered payout by score. | Skill | 4 | 1 | 4 | Cheapest build. Risk: "too generic." |
| 4 | **Slingshot Bees** — drag-aim-release to hit hive targets. One shot per stake, payout per target destroyed, on-chain receipt of best shot. | Skill | 4 | 4 | 5 | Monster Strike-lite. Great pitch-video B-roll. More physics tuning. |
| 5 | **Spin-to-Claim Slots** — 3-reel spin, provably-fair seed committed on-chain, jackpot pool funded by entry fees. | Gambling | 5 | 2 | 2 | Simplest animation. Strong commit-reveal demo. Worst gambling optics. |
| 6 | **Dodge Sprint** — auto-running swipe-lanes dodger, 30s round, stake per run, NFT receipt of top runs. | Skill | 3 | 3 | 4 | Subway-Surfers-lite. Decent dopamine, moderate build. |
| 7 | **Precision Tempo Tap** — tap to the beat on a moving bar; chain perfects for multiplier. Stake per song, payout by accuracy tier. | Skill | 4 | 3 | 5 | Musical-Poet pattern. Great B-roll. Needs audio assets. |
| 8 | **Moonstep Mini** — a *non-walking* Moonwalk homage: commit to hit 30 successful taps in 30s; stake SOL; settle payout on threshold. Deliberate nod to the #2 dApp on Seeker. | Skill/commit | 3 | 1 | 5 | Cheapest, most on-brand for the "Cocos for Solana Mobile" story. Direct Moonwalk comp. |
| 9 | **Meme-Swipe** — Fruit-Ninja-style, swipe rising memes for points, miss the bomb. Stake per round, NFT-receipt of best cuts. | Skill | 4 | 3 | 4 | Clip-worthy, shareable, matches Scrolly/meme vibe. |
| 10 | **Tournament Tap-Race** — 60s solo run writes score to a shared tournament PDA; top-N at timer end split the pot. | Skill + pot | 4 | 4 | 5 | Hits escrow + leaderboard + receipt patterns all at once. Highest MWA surface, highest build. |

**Shortlist considered:** #1 Stack Climb · #4 Slingshot Bees · #8 Moonstep Mini · B. Sixty-Second Draft (CFL homage) · A. Token Duel (new).

**Dropped for clone-risk:**
- **#8 Moonstep Mini** — stake-to-commit + pool-of-players + "step/Moon" branding is Moonwalk's signature. Do not ship.
- **B. Sixty-Second Draft** — portfolio-draft-settles-on-live-prices is Crypto Fantasy League's signature. Same Seeker-dApp clone shadow as Moonstep.

**Locked pick: A. Token Duel.** Novel combo (Stack genre + player-picked token squad + live-price difficulty + on-chain leaderboard); no existing Seeker dApp does this.

---

## LOCKED — A. Token Duel (Session-3 rebuild)

**Chosen mechanic.** Classic Stack Jump core loop, but the falling blocks are skinned with **a 3-token squad the player picks from Solana's entire market** via a live Birdeye feed. Each token's 24h % change controls how wide the block lands. Skill-based stacking, on-chain escrow + payout + leaderboard.

**Evolution:** v1 read your top-3 wallet holdings. v2 (this branch, Session 3) lets you pick any 3 Solana tokens from a live Trending / Gainers / New-listings / Search feed. Wallet holdings remain the fallback when the squad is empty.

**60-second play loop:**

1. **Connect.** On app open, `authorize` via MWA.
2. **Pick a squad.** Browse the live Birdeye feed (Trending / Gainers / New / 🏆 Top 10). Tap rows to fill 3 squad slots. Search by symbol or mint address. Live 24h deltas tint each row green/red.
3. **Set stake.** Drag the slider (0.001–0.1 SOL) or tap a snap chip.
4. **Commit.** Tap *Stake + Commit* → `signAndSendTransaction` routes per wallet (native sign+send on Phantom/Jupiter, sign+RPC fallback on Backpack, universal-safe for Solflare/Seed Vault). On-chain Anchor `commit` ix escrows the stake into a per-session PDA.
5. **Play.** Tower builds. Falling blocks cycle through your 3 squad tokens; each block's landing width is set by that token's 24h change:
   - ≥ +5% → 100% width (easy)
   - 0% to +5% → 80%
   - 0% to −5% → 60%
   - ≤ −5% → 40% (hard)

   Horizontal indicator oscillates above the stack; tap to drop. Mistiming slices the overhang. Miss = game over.
6. **Settle.** `signAndSendTransaction` claims payout by height tier + writes to the on-chain leaderboard:
   - 0–10 blocks = forfeit (stake → protocol pool)
   - 11–20 = 50% refund
   - 21–35 = 100% refund
   - 36+ = 2× payout (pool covers the bonus)
7. **(Optional, advanced wallets)** Before the stake tx, a "pick your hero token" prompt uses `sign_messages` to commit which of your squad members will have the highest % at settle time. Silently skipped on wallets that don't support sign_messages.
8. **Check the board.** 🏆 Top 10 tab renders the leaderboard PDA: rank / player / height / elapsed.

**Why this wins for this submission:**

- **Crypto is the mechanic, not a paywall.** Real 24h price deltas drive the difficulty curve and the leaderboard is on-chain — remove the chain, the game has no inputs and no persistence.
- **Player agency + skill + gambling feel.** Picking a squad from 20+ live tokens vs. passively reading holdings.
- **Live market data, live game.** Feed polls every 15–30s; squad tiles pulse when deltas drift.
- **Cocos sweet spot.** Pure 2D, single scene, Cocos-native widgets (EditBox / ScrollView / Slider / Mask). Small asset pipeline. Fits WeChat's 4 MB cap envelope.
- **Solo-buildable.** Rectangle-overlap math, Birdeye HTTP calls, Anchor CPI — no physics engine, no backend.
- **No clone shadow.** Stack + squad-picker + live-price difficulty + on-chain leaderboard is a novel combo; no existing Seeker dApp does this.
- **All five MWA methods used with real reasons.**

---

## MWA Method Mapping — Token Duel

| Game moment | MWA call | Purpose |
|---|---|---|
| App open | `authorize` | Connect wallet; SDK caches pubkey + walletUriBase |
| *(Optional, advanced path)* Pick hero token | `sign_messages` | Commit hero choice off-chain; reveal at settle. Skipped on wallets that reject sign_messages. |
| Stake + commit (single tap) | `sign_and_send_transactions` | Wallet signs + broadcasts Anchor `commit` ix; escrow PDA takes the stake |
| Game over / settle | `sign_and_send_transactions` | Anchor `settle` ix distributes payout + writes to leaderboard PDA |
| Session end | `deauthorize` | Clean disconnect surfaced in UI |

**Five MWA methods** in one ≤60s play session, each load-bearing.

---

## Anchor Contract Design — Token Duel

One Anchor program, two instructions, no custom token:

- `commit_stake(amount_lamports, session_seed, optional_commit_hash)` — escrow SOL to a per-player PDA; record session start, amount, and optional hero-token commit hash.
- `settle(height_tier, result_proof)` — pay out based on tier. v1: result proof signed by a server key you control. v2 upgrade: oracle / commit-reveal for trustless settlement.

**Off-chain data:** Jupiter price API or Pyth feed for 24h % change. Fetch at round start; freeze per session so mid-round price jitter doesn't feel unfair.

Devnet only. No custom token. No leaderboard in v1.

---

## Files Touched (preview)

- New: `demo-game/` Cocos project under repo root (inspect `demo-game` branch first for reusable `example-app/` scaffolding).
- New: `programs/token-duel/` Anchor program.
- New: `docs/DEMO_GAME.md` — scene walkthrough for the pitch video edit.

---

## Next Steps

1. **Inspect `demo-game` branch** for existing example-app scaffolding — decide fork vs fresh project.
2. **Anchor program first.** Get `commit_stake` + `settle` working on devnet with a test harness before touching Cocos.
3. **Wire SDK calls** — bridge the existing MWA SDK methods to the two program instructions.
4. **Cocos scene** — tower, falling block, oscillating indicator, HUD. Placeholder colored blocks for v1; swap in real token logos later.
5. **Price oracle** — Jupiter API fetch at round start, cached for session.
6. **Record the 30-second pitch-video clip** — clean play-through with stake + settle tx overlays and explorer links visible. That IS the hackathon deliverable.

---

## Verification

- Play-through on Seeker: `authorize` → stake review (`sign_transactions`) → stake confirm (`sign_and_send`) → play → settle (`sign_and_send`) → `deauthorize`. On-screen log overlay captures each call with wallet prompt screenshots.
- Same play-through on Phantom or Solflare: core loop succeeds; the `sign_messages` hero-pick step is cleanly hidden; no errors surfaced.
- Stake deposit and payout both visible on a devnet explorer, linked from the demo UI.
- Both outcome paths demonstrable in the pitch video: (a) success tier (≥21 blocks), (b) forfeit tier (<11 blocks).
- ≤60s full session from boot to settled outcome.
