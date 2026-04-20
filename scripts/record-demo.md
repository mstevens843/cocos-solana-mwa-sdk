# Pitch + Tech-Demo Shot List

Two cuts. One 3-min pitch-video cut for submission, one 2-min technical demo cut for reviewers who click past the pitch. Record both in one session — same device, same lighting — and edit them apart.

Setup (do once):
- Mainnet deploy complete (see `USER_TASKS.md` T9-T11).
- Jupiter wallet funded with ≥0.2 mainnet SOL.
- Fresh Token Duel install. Clear `temp/` + `library/`, rebuild in Cocos.
- Android screen-record at 60fps via `adb shell screenrecord` or MacOS QuickTime tethered.
- Audio recorded separately (lapel mic) — sync in post.

---

## Pitch cut (3 min, for submission)

The vibe: "real Solana app, not a hackathon toy. Ships on the Android dApp store today."

**0:00 — 0:15 — Hook**
- Phone in landscape. Cocos splash. Show the app name "Cocos MWA SDK Demo".
- Voice: "This is Token Duel — the first token game built on Cocos Creator for Solana. Engine-native, wallet-native, on-chain."

**0:15 — 0:40 — Connect flow**
- Tap "Connect Wallet" → OS picker → Jupiter icon.
- Cut to Jupiter's approval screen: show the proper dApp name and URL in the header.
- Back to app: wallet address chip + balance chip.
- Voice: "One tap, OS picker, wallet-native auth. No seed phrases, no key export — MWA 2.0 end-to-end. This is the UX Android users expect."

**0:40 — 1:20 — Feed + squad picker**
- Tap "Trending" — show the ScrollView populate with live tokens (BONK, WIF, POPCAT). Let the logos load on camera so reviewers see real Birdeye data.
- Scroll the feed. Swipe "Gainers" — rows re-sort live.
- Tap a search input (e.g. `bonk`) — results narrow.
- Tap 3 tokens to build a squad. Slot tiles pulse with 24h delta colors.
- Voice: "Live price data from Birdeye. You pick any three tokens from Solana's entire market — not just what's in your wallet."

**1:20 — 1:50 — Stake**
- Drag the stake slider from 0.001 to 0.05 SOL. Label updates live.
- Tap "Stake + Commit" → wallet opens → one tap approve.
- Return to app — explorer link appears. Tap the link, show the tx on Solscan / Solana Explorer. Pause on the "Program Instructions: commit(amount, session_seed)" line.
- Voice: "One wallet prompt. Anchor program on mainnet escrows the stake. Reviewer can click the link and see the tx on-chain right now."

**1:50 — 2:30 — Play**
- Tap Start Game. Falling blocks skinned with squad symbols (BONK, WIF, POPCAT). Tap to stack. Get to height ≥ 21 for tier 2.
- Game Over overlay shows tier.
- Tap Claim Payout → wallet prompt → approve.
- Voice: "Skill-based stack challenge. Width of each block is driven by real 24-hour price delta. Win enough height, double your stake."

**2:30 — 2:50 — Leaderboard**
- Tap "🏆 Top 10" tab. Live entries from the on-chain leaderboard PDA. The just-settled player shows up near the top.
- Voice: "Every settled game writes to an on-chain leaderboard — ten entries, sort-insert-evict, pure Anchor."

**2:50 — 3:00 — Close**
- Pan to the Cocos logo in the splash + Solana logomark.
- Voice: "Cocos Creator × Solana Mobile. Same engine that ships 50% of Asia's mobile games. Now with first-class MWA support."

---

## Tech-demo cut (2 min, for engineering review)

Target audience: the Solana grant reviewer who skipped the pitch and is looking for substance.

**0:00 — 0:20 — Architecture**
- On-screen: architecture diagram (not yet drawn — see `USER_TASKS.md` optional).
- Voice: "Cocos 3.8 Android build. MWA via a Kotlin-Java bridge. Anchor program at `14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd`. Three instructions: commit, settle, initialize_leaderboard."

**0:20 — 0:50 — Logcat deep-dive**
- Run `adb logcat | grep -E '\[(MWA|AppUI|BirdeyeClient|TokenDuelRpc|AnchorBackend)'` on screen.
- Tap through a full commit → settle → claim flow. Point to:
  - `[BirdeyeClient] getTrending | DONE rows=N`
  - `[AppUI] onCommitStake | SENDING tx_bytes=N stake_lamports=N seed=N`
  - `[MWAManager] signAndSendTransactions | ROUTE route=native pkg=ag.jup.app`
  - `[MWAManager] signAndSendTransactions | SUCCESS sig=...`
- Voice: "Every network call, every fault point is logged with structured key=value fields. No silent failures."

**0:50 — 1:20 — Leaderboard verification**
- Run `cd scripts && npm run smoke-leaderboard` on the same mainnet deploy.
- Point to `ALL_PASS` at the end.
- Voice: "Leaderboard sort-insert-evict correctness is verified by a smoke test that runs eleven players through mainnet and asserts the lowest gets evicted."

**1:20 — 1:50 — Wallet matrix**
- Show a 2-column table of (wallet, commit-flow, claim-flow, leaderboard-read):
  - Jupiter ✓ ✓ ✓
  - Phantom ✓ ✓ ✓
  - Solflare ✓ ✓ ✓
  - Backpack ✓ (sign+RPC fallback) ✓ ✓
  - Seed Vault ✓ ✓ ✓
- Voice: "MWAManager auto-routes per wallet. Backpack falls back to sign+RPC because its native sign-and-send path crashes. Everything else uses native MWA 2.0."

**1:50 — 2:00 — Close**
- GitHub URL on screen: `github.com/mstevens843/Cocos-Solana-MWA-SDK`.
- Voice: "Open-source SDK. Full source, KNOWN_ISSUES doc, smoke tests. The third funded Solana Mobile game-engine SDK, after Unity and Godot."

---

## B-roll (capture opportunistically)

Record extras on the same session so the editor has options:
- Explorer page zoom on the leaderboard account data (base64 decoded).
- Multiple short plays: one forfeit (height ≤ 10), one full (21–35), one double (36+) so the pitch editor can pick whichever tier the music accents.
- Slow-mo of a falling block as it lands perfectly — for a pause moment before "double-payout approved".
- The app icon on the home screen with other Solana dApps (Jupiter, Backpack) nearby for credibility framing.

---

## Editing notes

- Pitch cut: music up-tempo, tight cuts, no pauses longer than 1s.
- Tech cut: let logs breathe — reviewers need to read them.
- Both cuts: overlay tx signature or explorer URL when it appears in-app; reviewers should be able to pause the video and copy the URL.
