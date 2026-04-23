# Token Duel — Fee Schedule

Transparent, on-chain, level-based rake. Every fee flow traceable on Solana
Explorer.

## TL;DR

- Rake floor: **3.00%** (level 10 or higher)
- Rake ceiling: **5.00%** (level 1 / uninitialized UserStats)
- Linear interpolation 1..10 → 500..300 bps
- Rake is deducted **per player** on each player's stake, not flat-rate on
  the pot. A squad of one whale + one grinder keeps the grinder's discount
  on their half of the pot.

## Level → rake table

| Level | Rake  | Basis points | Savings vs level 1 |
|------:|:------|-------------:|-------------------:|
|    1  | 5.00% | 500 bps      | —                  |
|    2  | 4.78% | 478 bps      | 0.22%              |
|    3  | 4.55% | 455 bps      | 0.45%              |
|    4  | 4.33% | 433 bps      | 0.67%              |
|    5  | 4.11% | 411 bps      | 0.89%              |
|    6  | 3.89% | 389 bps      | 1.11%              |
|    7  | 3.67% | 367 bps      | 1.33%              |
|    8  | 3.45% | 345 bps      | 1.55%              |
|    9  | 3.22% | 322 bps      | 1.78%              |
|  10+  | 3.00% | 300 bps      | 2.00%              |

Level is derived from XP via the Pokémon-cubic curve
(`xp_for_level(n) = n³`). Per-level XP grants are mode-specific and
documented in `programs/token-duel/src/state.rs`.

## Where does the rake go?

Flow is entirely on-chain via the program's `settle_match` +
`pay_season` instructions — no off-chain treasury movements, no admin
multi-sig, no custodial pass-through.

| Destination        | Approximate share | Instruction path              |
|--------------------|------------------:|-------------------------------|
| Top-N payouts      |              90% | `settle_match` (distributable) |
| Weekly payout pool |               7% | accrues in `Season.total_rake` |
| Protocol treasury  |               3% | `settle_match` → `Treasury`    |

The **Season PDA** for each calendar week collects the weekly payout
pool, then `pay_season` pays out top-3 season entrants (rank 1/2/3 get
60/30/10% of the pool). Payout fires every Sunday 00:00 UTC via the
backend cron.

## Authoritative sources

- Rust constants: `programs/token-duel/src/state.rs` — `RAKE_BPS_MIN = 300`, `RAKE_BPS_MAX = 500`
- Rake formula: `state.rs::rake_bps_for_level` — linear interp
- Per-player application: `state.rs::compute_mode_payout` — sums per-player rakes
- Settle paths that apply it: `instructions/{settle_match,settle_match_verified,force_settle}.rs`

## Live numbers

See the live page at `/fees` on the backend host for current
week-to-date + all-time rake totals, updated on every MatchSettled event
via the admin `logsSubscribe` listener.
