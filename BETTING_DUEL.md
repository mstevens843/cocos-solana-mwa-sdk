# betting-duel branch

This branch forks from `demo-game` at commit `2bfe30b` (Parts 7–14 snapshot of the stack-jump game) to implement the **original Token Duel design**: a live portfolio prediction bet instead of a twitch stack-jump.

## What's different from `demo-game`

| | demo-game | betting-duel |
|---|---|---|
| Core game | Stack-Jump tap game (tower of blocks) | Live portfolio race (watch % deltas tick) |
| Winner | Highest tower height | Highest portfolio % change over window |
| Player skill | Tap timing | Token picking |
| Token role | Modulates block widths (4-bucket difficulty) | Directly determines outcome |
| Match length | Until miss or height 50 | Exactly the selected time window |
| On-chain program | Same Anchor program, no code changes | Same Anchor program, `height` reinterpreted as encoded delta score |

## Score encoding

Both branches submit a `u32` "height" to `settle_match`. On `betting-duel` we reinterpret this as:

```
score = clamp((portfolioDeltaPct * 100) + 1_000_000, 0, u32::MAX)
```

- `+25%` portfolio → score = 1,002,500
- `0%` portfolio → score = 1,000,000
- `−25%` portfolio → score = 997,500

The `+1,000,000` bias keeps negative deltas inside u32. Rank-by-score logic in `compute_mode_payout` still works: the highest `score` wins. No Rust changes.

## Stack-jump-specific files (deleted in Phase 1)

- `assets/token-duel/scripts/TokenDuelGame.ts` — tap game class
- `assets/token-duel/scripts/PriceFeedMock.ts` — deterministic mock deltas
- `assets/token-duel/scripts/BotOpponent.ts` — bot handicap for paper mode
- `backend/src/physics.ts` + `session.ts` WS handlers — physics cheat validator
- Scene nodes: `GameArea`, `BlockTemplate`, `HeightLabel`, `TokenBadgeLabel`, `GameOverLabel`, `ClaimButton`, `TutorialOverlay` (tutorial gets repurposed for race explainer)

## New files added

- `assets/token-duel/scripts/PortfolioRace.ts` — live polling + delta computation
- `assets/token-duel/scripts/ScoreEncoding.ts` — bidirectional delta-pct ↔ u32
- `BETTING_DUEL.md` — this file

## Phases

See `/Users/devlegacy/.claude/plans/silly-gathering-ember.md` for the full implementation plan.
