# Token Duel — Deploy Runbook

Complete sequence to go from a fresh checkout to a playable Cocos APK with on-chain match-making working on devnet.

---

## 0. Prereqs

- macOS / Linux with:
  - `cargo` + `rustc` (`1.79+`)
  - `anchor` CLI `0.31.1` (via `avm use 0.31.1`)
  - `solana-cli` `1.18+` or `agave-cli` `3.x`
  - `node` `20+` + `npm`
  - Cocos Creator `3.8.8`
  - Android SDK / platform-tools (for `adb`)
- `~/.config/solana/id.json` — admin keypair, funded with ≥2 SOL on devnet.
- `PATH` includes `~/.avm/bin` + `~/.local/share/solana/install/active_release/bin`.

Verify:

```bash
anchor --version     # 0.31.1
solana --version     # 1.18.x or 3.x
solana config get    # RPC URL should be https://api.devnet.solana.com
solana balance       # ≥2 SOL
```

Top up at <https://faucet.solana.com> if light.

---

## 1. Build + deploy the program

```bash
cd /Users/devlegacy/Desktop/cocos-solana-mwa   # repo root
anchor build
anchor deploy --provider.cluster devnet
```

Expected: `Program Id: 14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd` (the keypair at `target/deploy/token_duel-keypair.json` is stable across rebuilds).

If you see `insufficient funds for rent` → fund the admin wallet and retry. Program upgrades need ≥1.8 SOL on the admin.

---

## 2. One-shot admin inits

Run **once per fresh deploy**. Each is idempotent — re-running prints `ALREADY_INITIALIZED` and exits 0.

```bash
cd scripts
npm run init-leaderboard       # legacy singleton — solo settle path
npm run init-leaderboards      # Part 7: 4 per-mode boards (1v1/4p/8p/BR10)
npm run init-treasury
npm run init-match-counter
```

Each logs its PDA + tx signature with explorer link.

**Part 7 note:** `init-leaderboards` (plural) creates the per-mode Leaderboard PDAs at seeds `[b"leaderboard", &[mode]]` for modes 0..=3. The legacy `init-leaderboard` (singular) still inits the singleton PDA at `[b"leaderboard"]` used by the solo `settle` ix — the two are independent. If you skip `init-leaderboards`, `settle_match` will fail with `AccountNotInitialized` on whichever mode's board you try to write to.

---

## 3. Per-wallet UserStats init (for test wallets)

Each wallet needs its own `UserStats` PDA before it can play a real match. The Cocos app auto-signs this on the first Run Squad tap, but for CLI testing you can pre-seed:

```bash
npm run init-user-stats                      # uses ~/.config/solana/id.json
npm run init-user-stats -- --keypair path/to/other.json   # any keypair file
```

---

## 4. Run the end-to-end smoke test

Proves the full real-mode flow works: creates a match with the admin wallet, generates + airdrops a second keypair, joins from it, both settle, verifies payout + UserStats.

```bash
npm run smoke-match                   # default 1v1
npm run smoke-match -- --mode 4p      # 4-player 70/30 payout
npm run smoke-match -- --mode 8p      # 8-player 50/30/20 payout
npm run smoke-match -- --mode br10    # 10-player battle royale 50/25/15/10
```

Expected final lines: `LEADERBOARD_OK mode=<N> winner=… h=… landed` followed by `SUCCESS mode=<mode> winner=<pubkey> pot=<L> rake=<L>`. The per-mode leaderboard assertion verifies the mode-specific PDA received the winner's entry.

Any failure exits non-zero with a specific assertion line (`EXPECTED player_count=2, got=1`, etc.). Common fixes:

- `airdrop failed` → devnet rate limit; wait 30s + retry.
- `ALREADY_INITIALIZED` on initialize_user_stats is fine (not a failure).
- `AccountAlreadyInUse` on create → counter_seq moved since last read; just re-run.

---

## 5. Rebuild Cocos

```bash
cd /Users/devlegacy/Desktop/cocos-solana-mwa
node generate-scenes.js
rm -rf temp/ library/ build/android/proj/build/
# Cocos Creator → Build → Android → rebuild
```

Then `adb install -r build/android/proj/build/outputs/apk/release/*.apk`.

---

## 6. In-app verification

1. Open Token Duel → Connect wallet.
2. Pick ≥1 token → `▶ Run Squad` → ModePickerOverlay.
3. **Paper** + Start → WaitingPanel flashes → stake cluster reveals → commit + play → PostMatchPanel with XP pulse + optional level-up flash.
4. **Real** + Start → wallet prompts init_user_stats (first time), then join_match → WaitingPanel shows `1/2 players · M:SS / 2:00`.
5. From another wallet → Run Squad → same tier + Real → WaitingPanel flips to Active → both play → PostMatchPanel with real payout SOL.
6. Portfolio → Real tab → reflects the settled match.

---

## 6a. Admin withdrawals (Part 8)

Treasury accumulates 3% rake from every settled match. Pool may hold residual SOL from legacy solo-settle flows. Post-event, reclaim with:

```bash
npm run admin-withdraw -- --amount 0.5 --source treasury
npm run admin-withdraw -- --amount 1.0 --source pool
npm run admin-withdraw -- --amount 0.1 --source treasury --recipient <other-pubkey>
```

Amount is in SOL. Admin signer must equal `state::ADMIN_PUBKEY` (hardcoded in `programs/token-duel/src/state.rs` as `8FAPokEsm1CFbSsJ53DM8Bfe7QBmSN4TDrAQR2qXdcXe`). If you ship with a different admin wallet, **edit that constant + redeploy** before the first `admin_withdraw` call or it will fail with `Unauthorized`.

The ix clamps the requested amount to `balance - rent_exempt_floor` so the PDAs stay rent-alive. Script logs both the requested and actual withdrawn amount.

---

## 7. Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Settle tx failed` after game | Winner account mismatch on final settler | Re-read Match; `buildSettleMatchTxFor` re-computes. Retry from the game-over screen. |
| Stuck on `Joining match…` | Tx failed silently (user cancelled in wallet) | Close picker, retry. |
| WaitingPanel timeouts at 2:00 with no join | No opponent available at same wager+xp-bucket | Tap `Play vs Bot` to fall back to paper-bot. |
| `Cancel failed — match not yet timed out` | <120s since match created | Wait for the full timeout or play a bot match. |
| `NOT_INITIALIZED` on Portfolio Real tab | UserStats PDA doesn't exist yet | Play one real match (auto-inits) or run `npm run init-user-stats`. |
| `insufficient funds for rent` on init | Admin wallet dry | Fund at faucet.solana.com. |
| `WALLET_AUTH_MISMATCH` | App cached a different pubkey | Disconnect + reconnect from Home. |

---

## 8. Resetting devnet state

Devnet state survives re-deploys; to start fresh for a demo, the easiest is to use new pubkeys (fresh wallet + fresh admin keypair). Program upgrade *doesn't* wipe Match / UserStats / Treasury — those persist across upgrades unless the account layout changes (which requires dropping + re-init).

To drop + re-init a single PDA: use `solana-cli close <pda> <recipient>` if the program owns it and has a close ix (we don't; left as future work).

---

## 9. Further reading

- `docs/GAME_MODES.md` — Session D design doc (multi-mode expansion notes).
- `programs/token-duel/src/` — Rust program source.
- `assets/token-duel/scripts/*` — TS client primitives (RPC, tx builders, match-maker, bot).
- `assets/demo/scripts/AppUI.ts` — the big state machine that wires it all together.
