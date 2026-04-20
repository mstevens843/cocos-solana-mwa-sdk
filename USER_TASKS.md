# Token Duel — Your Tasks (human-required)

Tasks that require your hands, your wallet, or your decisions. Claude handles everything else autonomously. Ordered by priority.

---

## 🔴 Critical — do today

### T1 — Back up the program keypair (2 min)

**Why:** `target/deploy/token_duel-keypair.json` controls the program address on Solana. Lose it = the program at `14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd` is permanently un-upgradable.

**Do:**
1. Open the file in a text editor: `cat target/deploy/token_duel-keypair.json`
2. Copy the entire array (e.g. `[123, 45, 67, ...]`) into:
   - A password manager (1Password, Bitwarden, etc.) as a secure note titled `token-duel program keypair`, OR
   - An encrypted disk image / USB drive stored offline.
3. Do **NOT** commit it to a public Git repo. It's already in `.gitignore` via `target/`.

**Verify:** you can recover it from a second location. Test by deleting + re-downloading.

---

### T2 — Verify Phase 6 runs on Cocos (30 min)

**Why:** Phase 6 wired the Anchor program into AppUI but the Cocos TS compile hasn't been tested against the new `@solana/web3.js` + `js-sha256` imports. If it breaks, there's a 50-LOC fallback (hand-rolled PDA math, drop web3.js).

**Do:**
1. Open Cocos Creator 3.8 → open the `cocos-solana-mwa` project.
2. Close all preview windows.
3. Delete `library/` and `temp/` folders (Finder or `rm -rf library temp` in repo root).
4. Reopen the project in Cocos Creator. Wait for the editor to reimport (2–5 min).
5. Check the **Console** tab for any TS compile errors. Screenshot or paste any red errors back to Claude.
6. Build for Android: **Project → Build...** → Android native → start build. 5–15 min.
7. Install APK on your Seeker (or an Android with Phantom installed).
8. Launch app. Expect: Landing → Connect Wallet → Home → **Play Token Duel** (gold button) → Token Duel panel.
9. Tap **Sign Stake (0.01 SOL)**. The wallet prompt should show:
   - **Program:** `14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd`
   - **Instruction:** `commit` (or a hex discriminator if Seeker's UI doesn't decode it)
   - NOT a plain SOL-transfer prompt.
10. Approve → tap **Broadcast Tx** → wait. Status should say "Stake escrowed on-chain! Sig: ..." with a devnet explorer link.
11. Tap the link. You should see:
    - The `commit` instruction invocation.
    - Two new accounts: the session PDA + escrow PDA.
    - 0.01 SOL in the escrow account.
12. Finish the round: **Start Game** → miss → **Claim Payout** → approve → explorer shows `settle` instruction, session account closed.

**Expected failure modes + what to tell Claude:**
- "Cocos console shows `Cannot find module @solana/web3.js`" → Claude will inline the PDA math and drop the library.
- "Wallet prompt shows unknown program" → that's expected if Seeker doesn't have the program's IDL; the tx still works.
- "Broadcast failed" → paste the console log; likely a devnet RPC issue, retry.

**Don't do:** mainnet testing. Still on devnet until T14.

---

## 🟡 Important — do this week

### T13 — Fund the mainnet admin wallet (15 min)

**Why:** Phase 7 deploys the program to mainnet. Deploy costs ~1.2 SOL in program rent + ~0.05 SOL pool seed. Budget 3 SOL for safety.

**Dev admin pubkey (same keypair as devnet):** `8FAPokEsm1CFbSsJ53DM8Bfe7QBmSN4TDrAQR2qXdcXe`

**Do:**
1. Confirm current price: 1 SOL ≈ $? on CoinGecko. 3 SOL ≈ $X.
2. Decide: are you OK spending that for the hackathon demo? (Program rent is recoverable by closing the program post-event; pool seed may be recovered if we add an `admin_withdraw` instruction.)
3. From your personal wallet (Phantom / Backpack / Seeker), transfer **3 SOL mainnet** to `8FAPokEsm1CFbSsJ53DM8Bfe7QBmSN4TDrAQR2qXdcXe`.
4. Verify: `solana balance 8FAPokEsm1CFbSsJ53DM8Bfe7QBmSN4TDrAQR2qXdcXe --url mainnet-beta` shows ~3 SOL.

**When done:** tell Claude. Mainnet deploy (T14), pool init (T15), and client cluster swap (T16/T17) follow.

---

### T18 — Mainnet on-device verification (30 min)

**Why:** Same as T2 but on real mainnet SOL. Validates the full wallet matrix (Backpack now works, unlike devnet).

**Prerequisite:** T14 + T15 + T16 + T17 done (Claude handles these once T13 is funded).

**Do:**
1. Connect Seeker, rebuild the app (`library/` + `temp/` clear), install.
2. Connect with Seed Vault → go to Token Duel.
3. Stake 0.01 SOL (real mainnet). Full flow. Verify explorer shows mainnet txs.
4. Disconnect. Re-connect with Phantom, Jupiter, and Backpack — each one full flow.
5. Record any wallet-specific bugs in a note for Claude.

---

## 🟢 Pitch video + submission (final week)

### TV1 — Record two pitch-video takes (1 hr)

**Why:** Colosseum submission needs a 3-min founder pitch + 2-3-min technical demo.

**Do:**
1. Set up screen recording on Android (Seeker built-in or AZ Screen Recorder).
2. **Take 1 — skilled run:** connect → hero pick (Seed Vault) → sign stake → broadcast → play 20+ blocks → claim. Real mainnet explorer links visible.
3. **Take 2 — forfeit run:** same flow, miss after 3–5 blocks. Shows the tier-0 outcome.
4. Voice-over later: read from `PITCH.md` hero section + walk through the MWA-call log.
5. Edit in iMovie / DaVinci Resolve. Target: 3 min pitch + 2 min technical demo as two separate cuts.

---

### TS1 — Write Colosseum submission (2 hrs)

**Why:** Submission form at https://arena.colosseum.org asks for: project name, short description, long description, team, demo video, technical demo video, GitHub repo, pitch deck.

**Do:**
1. Project name: **Token Duel** (or **Cocos × Solana MWA SDK** if you want to lead with the SDK angle).
2. Short description (1 sentence): paste from `PITCH.md` hero line.
3. Long description: adapt `PITCH.md` body (~500–800 words).
4. Team: just you. List your GitHub + X handle.
5. GitHub: `https://github.com/mstevens843/Cocos-Solana-MWA-SDK` (master branch).
6. Grant your Colosseum account read access to the repo if private. (Check repo settings.)
7. Videos: uploaded to YouTube unlisted (Colosseum requires a public link).
8. Pitch deck: optional but strongly recommended. 5–8 slides: Problem, Market, Solution, Demo, Roadmap, Ask.

---

## 📋 Operational — ongoing / as-needed

### TO1 — Watch pool balance during demos

**Check:** `solana balance Gq2WfDRim2pu4x6FW3adpwMRah4uW46hNt3dTYeSFgp4 --url devnet` (or mainnet post-T14).

**If < 0.03 SOL:** top up via `scripts/init-pool.ts` (which Claude can re-run). Or have Claude add an `admin_withdraw` instruction so you can reclaim at demo end.

---

### TO2 — Airdrop devnet SOL if rate-limited

**If `solana airdrop N` returns 429:** go to https://faucet.solana.com → paste `8FAPokEsm1CFbSsJ53DM8Bfe7QBmSN4TDrAQR2qXdcXe` → get more.

---

## ❓ Decisions Claude needs from you (eventually)

- **Ship `admin_withdraw` instruction?** (~2 hrs Rust work.) If yes, you can reclaim seed capital from pool post-demo. If no, ~$20–40 USD of pool SOL stays stuck at the program address. Defer unless you want the capital back.
- **Emit Anchor `#[event]`s?** (~1 hr Rust.) Makes the explorer view of commit/settle more "production" — reviewer sees structured event logs. Optional polish.
- **Architecture diagram?** (~1 hr Mermaid/Figma.) Strongly recommended for pitch deck. Otherwise you'll be describing the tx flow verbally.

Claude will wait for your call before doing these.

---

## What Claude is doing right now (autonomous)

Not your problem — just for context:

- Rust fixes: moved pool-funding check upfront, added `Unauthorized` error code, annotated dead `settled=true` write.
- Next up: rebuild + redeploy to devnet, then write `smoke-tiers.ts` + `smoke-negatives.ts` to verify all 4 tiers and all 4 error paths on-chain.
- Then: README update + KNOWN_ISSUES update + GRANT_PATH.md sync.

Check back for progress reports.

---

## 🔴 Critical — Session 3 follow-up

### T5 — Rebuild + redeploy the Anchor program to devnet (5 min)

**Why:** Session 3 adds a `Leaderboard` PDA (`state.rs`) + `initialize_leaderboard` instruction + `settle` now requires the leaderboard account. The old deployed bytecode will reject new txs because the account list length changed. Until redeployed, the commit/settle flow on devnet will **fail** with an Anchor account mismatch error.

Claude's sandbox blocked the deploy because it modifies shared infra; you run it.

**Do (all in a terminal at project root):**
```bash
export PATH="$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
anchor build
anchor deploy --provider.cluster devnet
```
Program ID stays the same (`14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd`) — upgrade in place using the existing `target/deploy/token_duel-keypair.json`.

**Verify:** `solana program show 14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd --url devnet` shows the new bytecode's deploy slot.

### T6 — Init the Leaderboard PDA (1 min, one-time)

**After T5**, run:
```bash
cd scripts
npm run init-leaderboard
```
Expected: either a new-tx explorer link, OR `ALREADY_INITIALIZED` if you're re-running. Either outcome means the PDA is live.

### T7 — Smoke-test leaderboard (2 min)

```bash
cd scripts
npm run smoke-leaderboard
```
Runs 11 fresh keypairs through commit+settle at varied heights and asserts top-10 is sorted descending + lowest gets evicted. Prints `ALL_PASS` on success.

### T8 — Fund Jupiter wallet on devnet (still outstanding, Session 2)

Wallet `5KsqXhGmLyPFLvZUk8VnHbHhXjCrYMQWxai3faADsDst` was 0 SOL last device test. Fund via https://faucet.solana.com (1–2 devnet SOL) so the in-app commit tx can succeed at simulation.

---

## 🟡 Mainnet migration (when ready to ship)

### T9 — Fund mainnet admin

Your admin keypair (whatever `~/.config/solana/id.json` points to on the mainnet cluster) needs ~3 SOL for:
- Program deploy rent (≈2 SOL for a program this size)
- Pool pre-fund (0.1–1 SOL is fine for the demo)
- Leaderboard PDA rent (~0.003 SOL)
- Fee buffer

### T10 — Flip the cluster

Three-line change after mainnet build succeeds:
1. `assets/token-duel/scripts/constants.ts` — `CLUSTER = 'mainnet-beta'`, `RPC_URL = 'https://api.mainnet-beta.solana.com'`.
2. `assets/demo/scripts/DemoAppConfig.ts` — `cluster: 'mainnet-beta'` on the identity object.
3. `Anchor.toml` — `cluster = "mainnet-beta"` and `[programs.mainnet]` key.

### T11 — Mainnet deploy + init + smoke

```bash
anchor deploy --provider.cluster mainnet
cd scripts
npm run init-leaderboard   # fund mainnet admin first; may need to edit RPC_URL
npm run smoke-tiers        # uses real SOL — costs ≤0.1 SOL total
npm run smoke-leaderboard  # costs ≤0.2 SOL (11 rounds × fees)
```

### T12 — Record pitch video

Shot list is in `scripts/record-demo.md`.

---

## What Claude did in Session 3

- Full Phase A UI polish: `cc.EditBox` search, `cc.ScrollView` feed, `cc.Slider` stake, remote logo loading, squad delta pulse, per-tab feed cadence.
- Full Phase B Rust: `Leaderboard` PDA + `initialize_leaderboard` instruction + `settle.rs` leaderboard insert + TS client deserializer + UI tab.
- Init + smoke scripts for leaderboard.
- Deterministic logs at every new fault point.

Blocked: build + deploy (T5) and actual recording (T12) — both need you.
