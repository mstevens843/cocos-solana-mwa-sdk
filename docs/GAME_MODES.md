# Token Duel — Game Modes, XP, Matchmaking (Session D research)

> This is the design doc for the next major cycle. **Nothing in here is
> implemented yet.** Current state: 1v1 solo play, single Session PDA, global
> leaderboard, no XP, no matchmaking. Ship-gate: Sessions A+B+C must land and
> be stable before we touch the Anchor program.

## 1. Game modes (user-selectable)

| Mode | Players | Wager | Payout table | Notes |
|---|---|---|---|---|
| **1v1** | 2 | Equal | 100% to winner, minus 3% rake | Simplest matchmaker. Default. |
| **4p Pot** | 4 | Equal | 70% · 30% · 0% · 0% | Two "winners" feels better than winner-take-all at n=4. |
| **8p Pot** | 8 | Equal | 50% · 25% · 15% · 10% | Four placements. |
| **10p Battle Royale** | 10 | Equal | 50% · 25% · 15% · 10% · 0×6 | Top-4 paid. Marketable mode. |

All modes share: game = Stack-Jump height race. Each player commits once, plays once, settles with on-chain height. Payouts computed when **last** player settles (or match timeout).

**Rake**: 3% to a `Treasury` PDA. Fund grants, hosting, future indexing. Not user-configurable.

## 2. Wager tiers

Fixed tiers so matchmaking can group players quickly:

```
TIERS = [0.01, 0.05, 0.1, 0.25, 0.5]  // SOL
```

Players pick a tier at Run-Squad time. On-chain stake must exactly equal the tier.

## 3. Anchor program changes

### 3.1 New PDAs

**`Match`** (`[b"match", mode_id, wager_tier_id, seq_u64_le]`):
```rust
#[account]
pub struct Match {
    pub mode: u8,                 // 0=1v1 1=4p 2=8p 3=br10
    pub wager_lamports: u64,
    pub xp_bucket: u16,           // floor(avg_xp / 100)
    pub required_players: u8,     // 2|4|8|10 per mode
    pub players: [Pubkey; 10],    // fixed-size; unused slots = Pubkey::default()
    pub player_count: u8,
    pub heights: [u32; 10],       // 0 = not yet settled
    pub settled_count: u8,
    pub created_at: i64,
    pub started_at: i64,           // 0 until full
    pub closed_at: i64,
    pub status: u8,               // 0=Waiting 1=Active 2=Settled 3=Cancelled
    pub bump: u8,
}
```

**`UserStats`** (`[b"userstats", player_pubkey]`):
```rust
#[account]
pub struct UserStats {
    pub player: Pubkey,
    pub games_played: u32,
    pub wins: u32,
    pub losses: u32,
    pub profit_lamports: i64,     // cumulative P/L (can be negative)
    pub xp: u64,
    pub level: u16,               // derived: floor(cbrt(xp)) for Pokémon-cubic curve
    pub last_played_at: i64,
    pub bump: u8,
}
```

**`Treasury`** (`[b"treasury"]`): pure SOL vault for rake.

### 3.2 New instructions

- **`join_match(mode, wager_tier, user_xp_bucket)`** —
  Client scans open Match accounts via `getProgramAccounts` + memcmp on (mode, wager_tier, xp_bucket, status=Waiting). If found, signs a tx that:
  1. Transfers `wager_lamports` into the Match escrow.
  2. Writes player pubkey into first empty slot.
  3. If `player_count == required_players` after write: set `status=Active`, `started_at=now`.

  If no open Match: create a fresh Match PDA with seq = next-available counter, same write.

- **`settle_match(height)`** —
  Player writes their height into the Match's `heights[i]`. If `settled_count == required_players`:
  - Sort heights descending, compute payout per mode's table, transfer lamports from escrow to winners.
  - Transfer 3% to Treasury.
  - Emit `MatchSettled` event with final rankings + payouts.
  - Write each player's delta into their `UserStats` (ix composed via CPI to a small `update_stats` ix).
  - `status=Settled`, `closed_at=now`.

- **`cancel_match()`** (timeout fallback) —
  If now − created_at > match_timeout (e.g. 10 min) AND `status=Waiting`, anyone can call this to refund all joined players. Prevents stuck escrow.

- **`initialize_user_stats()`** — one-time per player; rent-payer = player.

### 3.3 Migration

- Existing Session/Leaderboard PDAs keep working — old solo flow can live alongside new match flow during rollout, OR we deprecate solo and migrate everyone to 1v1 mode against a "bot" (server-simulated opponent) for solo feel.
- Leaderboard PDA becomes "Top scores across all modes" and is written on `settle_match` for each settled player's height.

## 4. Matchmaking algorithm

**Client-side discovery**:
```ts
async function findOrCreateMatch(mode, tier, userXp) {
    const xpBucket = Math.floor(userXp / 100);
    for (let delta = 0; delta <= 3; delta++) {
        for (const sign of [0, 1, -1]) {
            const bucket = xpBucket + sign * delta;
            if (bucket < 0) continue;
            const matches = await rpc.getProgramAccounts(PROGRAM_ID, {
                filters: [
                    { memcmp: { offset: MODE_OFFSET, bytes: u8ToB58(mode) } },
                    { memcmp: { offset: WAGER_OFFSET, bytes: u64LEToB58(tierLamports) } },
                    { memcmp: { offset: BUCKET_OFFSET, bytes: u16LEToB58(bucket) } },
                    { memcmp: { offset: STATUS_OFFSET, bytes: u8ToB58(0 /* Waiting */) } },
                ]
            });
            if (matches.length) return matches[0];
        }
    }
    return null; // caller creates new match
}
```

**Timeout**: if no opponent joins within 2 minutes, UI offers "play vs bot" (solo fallback that settles against a simulated opponent with height sampled from historical distribution).

## 5. XP system (Pokémon-cubic curve)

- `xp_for_level(N) = N^3`   — Level 10 = 1000 XP, Level 20 = 8000 XP, Level 50 = 125000 XP.
- XP earned:
  - 1v1: win=+100, loss=+25.
  - 4p: 1st=+100, 2nd=+60, 3rd=+30, 4th=+15.
  - 8p: 1st=+150, 2-4=+80/60/40, 5-8=+20 participation.
  - BR10: 1st=+200, 2-4=+100/70/40, 5-10=+10 participation.
- Paper mode earns separate XP (doesn't carry to real). Keeps matchmaking buckets separate if we expose both.

## 6. UI additions (post-A/B/C)

- **Mode + wager picker**: shown when user taps `▶ Run Squad`. Three dropdowns:
  - Mode (1v1 / 4p / 8p / BR10)
  - Wager tier (0.01 / 0.05 / 0.1 / 0.25 / 0.5)
  - Paper vs Real toggle
- **Waiting screen**: shows "waiting for N opponents… (X/Y joined)" with Cancel + "Play vs bot" options.
- **Post-match screen**: shows final leaderboard for the match, XP gained, new level if leveled up.
- **Portfolio panel**: Real-tab now hydrates from on-chain `UserStats`.
- **Leaderboard panel**: filter by mode (1v1 / 4p / 8p / BR10) via tabs.

## 7. Timeline estimate

| Chunk | Effort |
|---|---|
| Anchor program: Match + UserStats + Treasury structs | 1 session |
| Anchor ixs: join / settle / cancel / init_stats | 1 session |
| Client matchmaker discovery + join flow | 1 session |
| Waiting + post-match + picker UI | 1 session |
| Portfolio-real + leaderboard-by-mode | 0.5 session |
| QA + polish + migration of existing sessions | 0.5 session |
| **Total** | **~5 sessions** |

## 8. Open questions (need user input before starting D)

1. **Paper mode in D**: include from day 1 or gate behind real? Gating keeps real-XP clean but fragments the community. Recommend **include both from day 1** with separate XP tracks.
2. **Rake destination**: Treasury PDA (unused for now) vs hackathon team wallet? Recommend Treasury so we can later govern it.
3. **Bot opponents**: bot heights sampled from real-player distribution (fair-feeling) or tuned-easier (onboarding-friendly)? Recommend **sampled from real** but with slight handicap for first 5 games to build confidence.
4. **Timeout**: 2 minutes for opponent join? Could be 30s–5m depending on player density.
5. **XP decay**: none for now. Post-D consideration.

## 9. Anchor file tree (proposed)

```
programs/token-duel/src/
├── lib.rs                    # existing, expanded entrypoint
├── state.rs                  # add Match, UserStats, Treasury
├── errors.rs
├── instructions/
│   ├── initialize.rs         # existing
│   ├── initialize_leaderboard.rs  # existing
│   ├── commit.rs             # existing — solo mode kept for back-compat
│   ├── settle.rs             # existing
│   ├── initialize_user_stats.rs   # NEW
│   ├── join_match.rs              # NEW
│   ├── settle_match.rs            # NEW
│   └── cancel_match.rs            # NEW
└── utils.rs                  # payout computation helpers
```

## 10. Client file tree (proposed)

```
assets/token-duel/scripts/
├── (existing)
├── Matchmaker.ts             # NEW — discovery + join flow
├── MatchRpc.ts               # NEW — parse Match PDA, compose tx
├── UserStatsRpc.ts           # NEW — read/write UserStats
└── game-modes/
    ├── ModeDefs.ts           # NEW — {id, name, players, payout, xp}
    └── PayoutCalc.ts         # NEW — pure fn, mirrors on-chain logic
assets/demo/scripts/
├── AppUI.ts                  # add mode picker + waiting panel + post-match panel
├── panels/MatchModePicker.ts # NEW
├── panels/WaitingPanel.ts    # NEW
└── panels/PostMatchPanel.ts  # NEW
```

## 11. Priorities if Session D is one session only

If forced to do D in ONE session (not recommended):

1. Ship 1v1 only, no 4p/8p/BR.
2. No XP (UserStats written but level computation / XP display deferred).
3. No bot opponent.
4. 2-min timeout with simple cancel button.
5. Leaderboard stays singleton (no mode-filter).

That fits in ~1 long session. Everything else is Sessions D2+.
