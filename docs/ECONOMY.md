# Token Duel — Economy Reference (Stage 3)

This document is the source-of-truth for the game's mode set, payout splits,
XP curve, level multipliers, and rake. It mirrors what's in
`programs/token-duel/src/state.rs`, `assets/token-duel/scripts/ModeDefs.ts`,
and `assets/token-duel/scripts/PayoutCalc.ts`. Any change in this doc must
be reflected in all three source-of-truth files.

Last updated: 2026-04-25 (Stage 3 release).

---

## 1. Mode Set

After the Stage 3 rebalance the game has four PvP modes. The 10-player
"Battle Royale" was retired (organic match-fill at 10 players was
unrealistic on devnet). A 3-player Trio mode was added to bridge the gap
between 1v1 and 4p.

| modeU8 | Key (TS / Rust) | Display Label | Players | Subtitle |
|---|---|---|---|---|
| 0 | `oneVone` / `OneVOne` | "1v1 Duel" | 2 | Solo head-to-head |
| 1 | `trio` / `Trio` | "Trio · 1v1v1" | 3 | Three-way free-for-all |
| 2 | `fourPlayer` / `FourPlayer` | "4p FFA" | 4 | Four-player free-for-all |
| 3 | `eightPlayer` / `EightPlayer` | "Battle Royale" | 8 | Eight-player royale |

**Wire-compat note**: `modeU8` indices 1, 2, 3 changed semantics in Stage 3.
Existing devnet matches stored under the old mapping have stale
`required_players` values. Run `scripts/audit-deploy-readiness.ts` before
each redeploy and either wait for stale matches to settle naturally or
accept the wipe.

---

## 2. Payout Splits

Pots are computed as `wager_lamports × required_players`. **Rake is taken
from the whole pot before split** (see Section 5). Distribution after rake
follows the per-mode basis-points table.

| Mode | BPS table | Splits | Concrete @ 0.05 SOL stake (pre-rake) |
|---|---|---|---|
| 1v1 | `[10000]` | 1st: 100% | Pot 0.10 → 1st = 0.10 (2× stake) |
| Trio | `[10000]` | 1st: 100% | Pot 0.15 → 1st = 0.15 (3× stake) |
| 4p | `[7500, 2500]` | 1st: 75% / 2nd: 25% | Pot 0.20 → 1st = 0.15 (3×), 2nd = 0.05 (1×) |
| 8p | `[6250, 2500, 1250]` | 1st: 62.5% / 2nd: 25% / 3rd: 12.5% | Pot 0.40 → 1st = 0.25 (5×), 2nd = 0.10 (2×), 3rd = 0.05 (1×) |

### Honest rake disclosure

Because rake is taken from the **full pot** before split, the "X× stake"
multipliers above describe the *gross* payout, not the net after fee. At
5% rake (Level 1), 2nd place in 4p gets `25% × (pot × 0.95)` = 0.0475 SOL
— roughly 95% of stake, *not* "money back" in the strict sense.

**Copy guidance for the team**:
- ✅ "Refund minus 5% fee" / "Near-stake payout"
- ✅ "Breakeven (after platform fee)"
- ❌ "Money back" / "Stake refunded in full"

Use `payoutPreview(mode, wagerLamports, level)` from
`assets/token-duel/scripts/PayoutCalc.ts` to render exact post-rake
lamport values in confirm overlays + ModePicker readouts.

---

## 3. XP Curve

The level curve is a closed-form quadratic-ish progression:

```
xp_for_level(N) = 250 × (N - 1) × (2N + 3)
```

This sits between Pokemon Medium-Slow (cubic) and Medium-Fast (linear). Early
levels are reachable in 2-4 wins (teaches the loop without auto-promotion);
mid-late levels grow to keep grinder progression visible.

| Level | Cumulative XP | Δ to Next |
|---|---|---|
| 1 | 0 | 1750 |
| 2 | 1750 | 2750 |
| 3 | 4500 | 3750 |
| 4 | 8250 | 4750 |
| 5 | 13000 | 5750 |
| 6 | 18750 | 6750 |
| 7 | 25500 | 7750 |
| 8 | 33250 | 8750 |
| 9 | 42000 | 9750 |
| 10 | 51750 | 10750 |

Level is computed on-chain (`level_from_xp`) and mirrored client-side
(`levelFromXp` in `PayoutCalc.ts`).

---

## 4. XP Awards per Mode/Rank

XP awards have two layers: a **base** value per mode/rank, and a **track
multiplier** applied at award time. The on-chain `xp_table()` returns the
**Real-track final** values directly (base × 2.0 baked in), so settle code
doesn't need to apply multipliers — Real on-chain matches earn the full
amount immediately.

### Base XP table per mode/rank

| Mode | 1st | 2nd | 3rd | 4th-8th |
|---|---|---|---|---|
| 1v1 | 100 | 0 | — | — |
| Trio | 175 | 0 | 0 | — |
| 4p | 250 | 80 | 0 | 0 |
| 8p | 500 | 125 | 65 | 0 |

### Track multipliers

| Track | Multiplier | Examples |
|---|---|---|
| Bot Match (vs bots) | × 0.5 | 1v1 win: 50 XP, 8p 1st: 250 XP |
| Paper-Real (PvP, no SOL) | × 1.0 | 1v1 win: 100 XP, 8p 1st: 500 XP |
| Real (SOL on-chain) | × 2.0 | 1v1 win: 200 XP, 8p 1st: 1000 XP |

### Example award progression at Level 1 (need 1750 XP for L2)

| Outcome | XP | Wins to L2 |
|---|---|---|
| Bot 1v1 win | 50 | 35 |
| Bot 8p 1st | 250 | 7 |
| Paper-Real 1v1 win | 100 | 18 |
| Real 1v1 win | 200 | 9 |
| Real 8p 1st | 1000 | 2 |

Real 8p 1st = 1000 XP = 57% of L1's 1750 — satisfying single-win
contribution but **no instant level-up** (preventing exploit smell).

### XP-on-loss policy

**No XP loss**. All non-podium ranks award 0 XP. Wins build progress;
losses are neutral. This avoids "rich get richer + poor punished" double-
penalty without requiring complex tilt mechanics.

---

## 5. Rake

Rake is level-scaled, linear from 5% at L1 → 3% at L10+:

```
rake_bps_for_level(level) = lerp(500, 300, clamp(level-1, 0, 9) / 9)
```

Rake is **per-player** in `compute_mode_payout` — each player's stake-share
of the pot has their own level's rake withheld. Total rake = sum of
per-player rake. Distributable pot = pot − total_rake.

### Rake-discount caveat (paper/bot)

`UserStats.level` on chain only reflects on-chain XP (Real matches).
Paper-bot wins build local XP that drives the displayed level chip, but
they do NOT reduce on-chain rake. Real matches are the only path to the
3% rake floor.

---

## 6. Storage Strategy (stepping-stone)

XP is stored in two places:

| Source | Storage | Persistence |
|---|---|---|
| Real matches (SOL) | On-chain `UserStats.xp` PDA | Permanent, cross-device |
| Paper-Real / Bot matches | Per-device localStorage (`Stats.load('paper').xp`) | Per-device only |

The displayed level on the top-right Lv chip combines both:
`total_xp = on_chain_xp + local_xp`. Level chip displays
`Lv N · X / Y` where X is XP into current level and Y is XP needed for next.

### Forward path (post-backend)

When the user upgrades the Render backend to the $7/mo Starter tier, paper
and bot XP migrates to a server-side `paper_xp_v1` Postgres table:

```sql
CREATE TABLE paper_xp_v1 (
    pubkey TEXT PRIMARY KEY,
    total_xp BIGINT NOT NULL DEFAULT 0,
    bot_xp BIGINT NOT NULL DEFAULT 0,
    paper_real_xp BIGINT NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Migration: on first request from each device after the backend is live,
client uploads its localStorage XP. Server keeps max(localUpload, current)
to prevent regressions.

---

## 7. Bot 5-Game Cap

Existing `UserStats.bot_games_remaining` (starts at 5) acts as a per-time
ceiling on bot XP awards. After exhausting 5 free training matches:

- Bot matches still play normally
- XP award becomes 0 (bots are pure practice/fun after the cap)
- This prevents per-time grind exploits since bot matches resolve faster than PvP

Per-wallet, not per-day. Future: could be reset weekly/monthly via a new
on-chain `reset_bot_games` instruction — out of scope for Stage 3.

---

## 8. Bot Difficulty Multipliers

Difficulty (easy/medium/hard) on bot matches affects **bot strength**, not
XP multipliers. Source: `BOT_DIFFICULTY_MULTIPLIERS` in
`assets/token-duel/scripts/ModeDefs.ts`.

| Difficulty | Bot height multiplier |
|---|---|
| Easy | 0.7 |
| Medium | 1.0 |
| Hard | 1.15 |

XP per bot win is independent of difficulty (always 0.5× base for that
mode/rank). Stacks with `BOT_HANDICAP_MULTIPLIER = 0.7` for new players
(first 5 games).

---

## 9. Files to keep in sync

When changing any value in this document, update **all three**:

1. **Rust on-chain** — `programs/token-duel/src/state.rs`
   - `GameMode` enum + `required_players()` + `payout_table()` + `xp_table()`
   - `xp_for_level()` + `level_from_xp()`
   - `rake_bps_for_level()` + `RAKE_BPS_MIN/MAX`

2. **TS client mirror** — `assets/token-duel/scripts/ModeDefs.ts`
   - `MODES` table (id, modeU8, requiredPlayers, payoutBps, xpTable)
   - `TRACK_XP_MULTIPLIER` (Stage 3)

3. **TS calc mirror** — `assets/token-duel/scripts/PayoutCalc.ts`
   - `xpForLevel()` / `levelFromXp()` / `levelProgress()`
   - `rakeBpsForLevel()` / `payoutPreview()`

4. **This doc** (`docs/ECONOMY.md`).

5. **Cargo unit tests** — `programs/token-duel/src/state.rs::tests` (run
   `cargo test -p token-duel --lib` to verify).

---

## 10. Verification

```bash
# Rust unit tests (curve thresholds + payout splits + rake math).
cargo test -p token-duel --lib

# Anchor build (zero stack-frame warnings expected).
anchor build

# Pre-deploy audit (lists open + active matches; flags breaking modeU8 changes).
npx ts-node scripts/audit-deploy-readiness.ts

# Scene + verifier gates.
node generate-scenes.js
npx ts-node scripts/verify-scene-bindings.ts

# Per-mode smoke (after redeploy).
npm run smoke-match -- --mode 1v1
npm run smoke-match -- --mode trio
npm run smoke-match -- --mode 4p
npm run smoke-match -- --mode 8p
```
