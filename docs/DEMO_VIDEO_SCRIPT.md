# Token Duel — Demo Video Script

For Colosseum Frontier submission (deadline May 11, 2026).
Target runtime: 3 minutes pitch + 2–3 minutes tech demo = 5–6 minutes total.

## Pitch arc (3 min)

1. **Hook (0:00–0:15)** — "Stack Jump, but the blocks come from live Solana
   token prices. Pump = wider blocks = easier game."
2. **Problem (0:15–0:45)** — Mobile crypto games are either trust-everything
   casinos or trust-server casinos. Neither is credibly fair.
3. **Solution (0:45–1:30)** — Token Duel: cheat-resistance via Ed25519 + server
   receipts, transparent economics via public `/fees` page + admin dashboard,
   real-time visibility via spectator mode.
4. **Retention + viral (1:30–2:15)** — Daily challenges, streak bonuses,
   cNFT trophies for weekly top-3, share-to-X with match sharecard PNG.
5. **Close (2:15–3:00)** — Play-to-win + Solana-native fee transparency.
   Launch May 11. Watch the live admin dashboard at
   `https://token-duel-backend.fly.dev/admin`.

## Tech demo arc (2–3 min)

### Beat 1 — Cheat resistance (0:00–0:35)
- Device: Android phone. Open Token Duel.
- Connect Phantom/Solflare via MWA.
- Show Home with "Your rake: 3.2% (lvl 8)" chip next to pubkey.
- Quick Play → real match → play 30s → win.
- Cut to admin dashboard on laptop: **green card "Receipts signed: +1"**
  ticks. Green log stream shows the new receipt with `VERIFIED` tag.

### Beat 2 — Economic transparency (0:35–1:15) · PART 13 FOCUS
- Still on admin dashboard: zoom to the **3 purple rake cards** (Today /
  Week / All-time).
- Cut to `https://token-duel-backend.fly.dev/fees` on desktop browser.
- Scroll the **level → rake table** (1 through 10+). Highlight the row
  matching the player's level from Beat 1 (lvl 8 → 3.45%).
- Scroll to the **flow bars** ("where does the rake go?"). Pause 2s on
  the 90/7/3 split.
- Cut back to admin dashboard: zoom into the **"Top Tokens — winrate"
  table**. If BONK or WIF is in the top row, say the winrate aloud.

### Beat 3 — Live multiplayer proof (1:15–2:00)
- Device A (phone in video frame): Home → tap `HomeMatchTicker` ("⚡ 4p · 2/4
  joined · 0.050 SOL · 1h · 12s ago").
- `SpectatorPanel` opens. Heights tick live; event log shows drops.
- Cut briefly to device B (hidden, off-camera) playing the same match —
  drop a block, B's phone tick.
- Back on A: drop event arrives in event log within 200ms.
- Cut back to admin dashboard: **"Recent settlements"** purple log ticks
  as the match completes.

### Beat 4.5 — Tournament drama (1:50–2:25) · PART 14 FOCUS
- Home panel on device A: `HomeTournamentBadge` visible, purple, says
  `⚔ Tournament · waiting 1:32 · tap to join`.
- Tap badge → TournamentPanel opens, 10-slot roster with slots 0 (host)
  and 1 (previous joiner) filled.
- Cut to admin dashboard on laptop: zoom on the gold **"⚔ Tournaments
  today"** card ticking (e.g., "5"). Sub-text: "seeded · 3/5 completed
  all-time."
- Pre-recorded: roster fills to 10/10, match goes LIVE, heights tick.
- Cut to settle moment: 🥇🥈🥉 medals appear next to top-3 slots. Admin
  dashboard ticks `completed` count.

### Beat 5 — Retention payoff (2:25–3:00)
- Back on device A: Portfolio → Trophies tab.
- Show cNFT trophy from last week's weekly payout (if available, else
  skip — admin terminal shows `npm run pay-season` output confirming
  last week's trophy mint signatures).
- Open Phantom's Collectibles tab → the trophy appears there too.

## Voiceover cues — additions

- "Tournaments spin up every 15 minutes. The protocol seeds the pot.
  Real players fill the slots. Winner takes gold, everyone watches live."
  (Beat 4.5)
- "This isn't matchmaking — it's an arena." (Beat 4.5, if tight on time)

## Shot-by-shot shooting list

### Setup pre-record
- [ ] Backend running on public host, admin dashboard reachable
- [ ] Two Android devices, both with Token Duel installed, both
      connected to same backend
- [ ] Third laptop rendering admin dashboard + fees.html fullscreen
- [ ] Phantom installed on device A with a couple of cNFT trophies
      already minted (run `npm run pay-season -- --season <prev_week>`
      twice in test clusters)
- [ ] Seed 4-5 fake matches on devnet so HomeMatchTicker has
      something to rotate through
- [ ] Seed 15+ settlements across 5+ different mints so the
      Top-Tokens table has data (BONK / WIF / POPCAT / BOME / MEW
      are recognizable memecoins)

### B-roll
- [ ] Laptop admin dashboard: 2 minutes continuous footage with
      cards ticking + logs scrolling. Use for cutaways.
- [ ] fees.html: pan across the level table slowly — use for beat 2.
- [ ] Phantom cNFT gallery: 15-second close-up of a trophy.

### Device shots
- [ ] Home screen tight crop — shows rake chip + ticker + streak
- [ ] Quick Play gameplay — 30 seconds of tap-to-drop
- [ ] Spectator view — show heights ticking
- [ ] PostMatch screen with rake line visible

## Voiceover cues

- "Every fee goes to three places — and every destination is on-chain."
  (Beat 2, on flow bars)
- "Your level earns you a rake discount. Level 1 pays 5%, level 10
  pays 3% — a 40% fee cut for loyal players." (Beat 2, on table)
- "BONK's won 62% of matches this week — is that token's holders
  just better players, or is the token pumping more than others?
  Either way, the data is public." (Beat 2, if relevant)
- "You're watching a match you're not in, live, on-chain." (Beat 3)
- "One backend node. 500 concurrent sessions. No database."
  (B-roll over admin dashboard)

## Editing notes

- Keep rake numbers **big + bold** in overlays. The point is: "we
  are not hiding fees."
- Don't over-explain the Ed25519 precompile in the video — viewers
  either know what that is (judges: tech-depth badge earned) or
  don't (non-technical: they see "cheat-proof," which is enough).
- Time-compress the gameplay shots (fast-cut, not real-time) unless
  a specific block-drop moment is the shot.
- Music: upbeat synth, NO vocals (pitch voiceover competes).
