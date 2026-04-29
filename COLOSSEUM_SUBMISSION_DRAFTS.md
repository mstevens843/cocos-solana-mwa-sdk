# Colosseum Frontier — Submission Form Drafts

Copy-paste source for the three pages of the Colosseum project form. Edit in place; character counts are tracked under each field. Source material: `PITCH.md` (market thesis + hero stats), `GRANT_PATH.md` (strategic posture), `README.md` (technical content).

---

## Page 1 — Project Info

### Project Name (already filled)

```
Cocos Creator MWA SDK for Solana
```

### Brief Description (PUBLIC, ≤500 chars — already filled at 473/500)

Existing copy looks fine. Keep as-is unless we want to reuse the WeChat hook. Optional sharper rewrite if we want to push the hero number to the front:

```
The first Solana Mobile Wallet Adapter SDK for Cocos Creator — the dominant mobile game engine in Asia (40–45% of China's mobile games, 60%+ of Korea's top 10, $5.56B WeChat mini-games). Brings Seed Vault auth, wallet connection, transaction signing, and SPL token ops to 1.7M Cocos developers. Built by the developer who shipped the Solana Mobile MWA grants for Unity and Godot. Full MWA 2.0 parity. Hardware-verified on Seeker. MIT-licensed with docs and demo game.
```
*~498 chars. Optional swap — current copy is also fine.*

### Project Website (PUBLIC, optional)

**Recommendation:** Leave blank for now. The GitHub repo is the project home. If we want a one-pager later, we can spin a `github.io` from the README in 30 minutes.

### What are you building, and who is it for? (≤1000 chars)

```
The first Solana Mobile Wallet Adapter SDK for Cocos Creator — the dominant mobile game engine in Asia. Cocos powers 40–45% of China's mobile games, 60%+ of South Korea's top 10, and the $5.56B WeChat mini-game economy. Until this SDK, none of those 1.7M Cocos developers could ship a Solana game.

Two audiences:
1) Asian mobile studios already on Cocos who want player-owned assets, on-chain leaderboards, or token economies without rewriting their stack.
2) Solana Mobile / Seeker, which launched into a market where Solana had near-zero engine coverage. This SDK closes that gap.

Ships full MWA 2.0 parity — authorize, SIWS, sign_messages (batch), sign_and_send_transactions, deauthorize, clone_authorization — plus parity-plus features beyond the funded Unity and Godot grants: installed-wallet detection, Seeker hardware detection, biometric-bundled authorize. Hardware-verified on Seeker. MIT-licensed.
```
*~960 chars.*

### Why did you decide to build this, and why build it now? (≤1000 chars)

```
Three windows lined up that haven't lined up before:

1) The Solana Foundation already funded MWA SDKs for Unity and Godot — confirming engine-side wallet adapters are worth paying for. Cocos, the third and Asia-largest engine, was the one missing.

2) Solana Seeker is shipping into Asia, where Cocos is the incumbent mobile engine. Engine + distribution alignment only happens once.

3) Cocos 4 went fully open source in 2026, and WeChat mini-games crossed $5.56B in 2024 (+99% YoY) — the exact category Cocos dominates, with no on-chain primitive inside it.

Why me: I shipped the Unity and Godot MWA SDK grants. Same surface area, same contributor, same testing methodology, already verified on Seeker hardware. Building now means Asian Solana game devs ship today instead of next year, and the "one MWA SDK per major engine" precedent stays consistent.

This is a public good — MIT, no token, no captured value. The SDK is plumbing under other people's games, not a startup.
```
*~970 chars.*

### What technologies are you using? (free-form, public)

```
Cocos Creator 3.8 (TypeScript), Solana Mobile Wallet Adapter 2.0, Solana Seed Vault, Anchor (Rust) on-chain program, @solana/web3.js, native Java/Kotlin Android bridge, SQLite (auth-token cache), Phantom / Solflare / Backpack / Jupiter / Seed Vault wallets, Solana devnet + mainnet.
```

### Category (PUBLIC)

`Gaming` ✅ already selected.

### Mobile-focused dApp checkbox

**Check YES.**

---

## Page 2 — Media and Code

### Project Logo or Graphic (PUBLIC, ≤3MB)

**Existing assets** (all 1024×1024, ~1.5MB, all uploadable as-is):

| File | Description | Strengths | Weaknesses |
|---|---|---|---|
| `mascot-animations/public/mascot-ref.png` ALSO `assets/demo/resources/mascot/mascot-ref.png` | Chibi gold Solana coin with sparkles | Direct Solana visual signal; already the Token Duel brand mark; polished art that pops vs. text-heavy directory cards | No "Cocos" or "SDK" signal in the image itself |
| `assets/demo/resources/icons/mascot_3.png` | Purple-hooded "builder" character holding a Solana coin | Strong dev/builder energy with Solana association — feels like an SDK project | Less recognizable as a project mark |
| `assets/demo/resources/icons/mascot.png` | Purple chibi with star wand | Cute, original | No Solana or gaming signal |

**Recommendation: use `mascot-ref.png` as-is.** Zero design work, signals Solana, matches the demo game's brand. The "Cocos × Solana MWA SDK" framing lives in the project name / description on the card, not on the logo image.

**Alt path** (if you want both Cocos and Solana signaled in the image): 30-min Figma — drop `mascot-ref.png` on a dark background, add "Cocos × Solana" wordmark text below. Same source asset, more text.

### GitHub Link (PUBLIC)

```
https://github.com/mstevens843/Cocos-Solana-MWA-SDK
```

**Pre-submit:** make sure the `betting-duel` branch is current and the README banner points judges there (see Repo Prep section in plan).

### Please share any important context about your repo (≤500 chars)

```
Two branches, one SDK.

`master` = SDK + clean example app exercising every MWA 2.0 method (authorize, SIWS, sign_messages batch, sign_and_send, deauthorize). The SDK alone, every API method visible.

`betting-duel` = same SDK + Token Duel, a portfolio-race video game built on top. The SDK driving an actual game.

Submitting `betting-duel`. SDK code at `assets/scripts/walletService/` is identical on both branches. Anchor program (devnet): 14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd.
```
*~487 chars. Contrast: master showcases SDK alone; betting-duel showcases SDK driving a game. SDK location, branch identity, on-chain program ID all surfaced.*

### Demo Video — submit a YouTube/Loom/Vimeo link (≤3 min)

**Status: recording needed.** Live product, not slides, not code walkthrough. Make demo public ✅.

**Tooling:** screen-record on Seeker (built-in screen recorder or Android Studio's `screenrecord`), webcam-free. Voiceover added in CapCut/Final Cut. Upload YouTube unlisted (or Loom).

**Read-off script (target ~3:00, trim during edit):**

```
[0:00–0:10]  Token Duel app icon on Seeker home screen. Tap to open.
   VO: "Token Duel — built in Cocos Creator, running on Solana Mobile."

[0:10–0:25]  Tap Connect Wallet. OS picker appears. Select Phantom or Solflare. Approve.
   VO: "MWA 2.0 connect. Same flow as Phantom Mobile or Solflare Mobile — now inside a Cocos game."

[0:25–0:40]  SIWS prompt appears. Approve.
   VO: "Sign In With Solana. Proves wallet ownership in a single round trip — no separate signature step."

[0:40–1:00]  Open Find Match panel. Pick a 60-second round.
   VO: "Token Duel is a live portfolio race. Pick three tokens; the wallet whose basket gains the most percentage in 60 seconds takes the pot."

[1:00–1:25]  Stake 0.1 SOL. signAndSendTransaction prompt. Approve. Cut to Solana Explorer showing confirmed tx.
   VO: "The stake goes through signAndSendTransaction. The Anchor program escrows it on-chain. Here's the tx on Solana Explorer."

[1:25–1:50]  Live race — show portfolio % ticking, cross finish line.
   VO: "60 seconds. Live token prices via Birdeye. Winner takes the pot."

[1:50–2:05]  Claim button. signAndSendTransaction. Approve. Balance updates.
   VO: "Claim is another signed transaction. The Anchor program pays out trustlessly."

[2:05–2:40]  Hard cut to master branch example app on Seeker. Quickly run: batch signMessages (3 msgs), deauthorize, reauthorize from cache, getCapabilities.
   VO: "The SDK is the product. The master branch ships every MWA 2.0 method — batch sign_messages, deauthorize, reauthorize from cache, getCapabilities. All verified on hardware."

[2:40–3:00]  Cut to GitHub repo. Pan over parity-plus table from README.
   VO: "Cocos Creator MWA SDK. Third Solana mobile engine SDK after Unity and Godot. MIT-licensed, open source. Link in description."
```

**Trim levers if over time:** drop the Solana Explorer cutaway (saves ~10s); compress the master-branch montage to 20s (saves ~15s); cut the closing pan and end on the parity-plus table (saves ~5s).

### Live Product Link

**Recommended:** GitHub Releases page for the prebuilt Token Duel APK:
```
https://github.com/mstevens843/Cocos-Solana-MWA-SDK/releases
```
*Create a tagged release on `betting-duel` with the APK attached before submitting. If the Solana dApp Store listing is approved by May 11, swap to that URL.*

### Access Instructions (judges)

```
Repo: clone https://github.com/mstevens843/Cocos-Solana-MWA-SDK and `git checkout betting-duel`. SDK code lives at `assets/scripts/walletService/`.

App: download the prebuilt Token Duel APK from the GitHub Releases tab. Install on any Android device — Seeker is recommended to exercise the Seed Vault path. Open Token Duel; the app supports Phantom, Solflare, Backpack, Jupiter, and Seed Vault.

Network: Solana devnet by default. Anchor program: 14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd. The demo video walks through every flow.

If the repo access ever errors, ping @mattinfra on Telegram.
```

### Pitch Video — separate from demo (≤2 min, PUBLIC)

**Status: recording needed.** Founder intro + thesis + parity-plus + ask. Webcam + slide overlays. Upload to YouTube as **public** (form requires it for the directory).

**Tooling:** OBS or Loom for webcam + slide-share. Slide deck can be 6 slides built quickly in Pitch.com or Figma using `PITCH.md` content directly.

**Read-off script (target ~2:00):**

```
[0:00–0:08]  ON CAMERA
   "Hi, I'm [name]. Full-stack Solana developer. I built the first Solana Mobile Wallet Adapter SDK for Cocos Creator."

[0:08–0:25]  SLIDE: Cocos hero stats (1.7M devs / $5.56B WeChat / 40-45% China / 60%+ Korea)
   "Cocos is the dominant mobile game engine in Asia. 40 to 45 percent of China's mobile games. 60 percent of South Korea's top 10. The 5.56 billion dollar WeChat mini-game economy."

[0:25–0:40]  ON CAMERA
   "1.7 million developers. 2 billion players reached. And until this SDK shipped, none of them could build a Solana game."

[0:40–0:58]  SLIDE: three engine logos side-by-side (Unity / Godot / Cocos)
   "The Solana Foundation already funded MWA SDKs for Unity and Godot. I shipped both — merged grant PRs, hardware-verified on Seeker. This is the third — for the engine that dominates Asia. Same contributor, same scope."

[0:58–1:18]  SLIDE: parity-plus table from README
   "Full MWA 2.0 parity — authorize, SIWS, batch sign_messages, sign_and_send_transactions. Plus parity-plus features the funded Unity and Godot grants don't ship: installed-wallet detection, Seeker hardware detection, biometric-bundled authorize."

[1:18–1:33]  SLIDE: Token Duel screenshot
   "To prove the SDK works, I built Token Duel — a live portfolio prediction game on top of it. It's the demo. The SDK is the product."

[1:33–1:48]  ON CAMERA
   "Hardware-verified on Solana Seeker. Tested with Phantom, Solflare, Backpack, Jupiter, and Seed Vault. MIT-licensed. Open source."

[1:48–2:00]  ON CAMERA
   "The ask: Public Good prize, plus a Solana Foundation grant follow-on to translate the docs to Mandarin and engage the Cocos developer forum. That's how we land the third engine in the ecosystem I already proved out twice."
```

**Slides needed (6 total):**
1. Title — Cocos × Solana MWA SDK + your name
2. Hero stats (1.7M / 2B / $5.56B / 40-45%)
3. Three engines (Unity / Godot / Cocos with grant labels)
4. Parity-plus table from README
5. Token Duel screenshot
6. Closing — repo URL + "Public Good. Open source."

**Trim levers if over time:** condense slide 3 voiceover (saves ~8s); cut "tested with [wallet list]" and lean on demo video for that (saves ~5s).

---

## Page 3 — Team

### Where is your team primarily based? (PUBLIC)

**Needed from you:** select your country.

### Team Members

```
@mattinfra (solo)
```

### Team Background — "Basics incomplete" (per-teammate section)

Open `Complete Your Section`. Fields surfaced so far: educational background, work history, anything else. Drafts below.

#### What's your educational background? (≤500 chars)

```
- BS, Business Information Systems - San Francisco State University (2016–2018). Dean's List. Treasurer, Information Management Systems Association.
- Certificate, Computer Software Engineering - Springboard (Jan 2024–Feb 2025). Full-stack: JavaScript, React, Node.js, PostgreSQL, Express, auth.
- Self-taught: Solana, Anchor, Android (Java/Kotlin), Cocos Creator.
```
*~340 chars. Bullets. Stack list at the end is just a fact, not a claim about when/how it was learned.*

#### Where have you worked or built before? (likely ≤1000 chars)

```
Full-stack Solana dev shipping mobile infrastructure.

SolPulse - Solana trading platform, built solo. 35-pillar intelligence engine, 1,200-concurrent-tx execution, MWA hardware signing. Live on web, iOS, Android, and the Solana dApp Store.

Godot MWA SDK (Solana Mobile grant): brought to React Native parity. Merged upstream PRs #449, #453, #454: signAndSend, getCapabilities, clearState, SIWS authorize, setIdentity, getAuthToken/setAuthToken cache. Fixed 10 bugs. Verified on Seeker with all wallet adapters.

Unity MWA SDK (Solana Mobile grant): merged PR #275 (WebGL auto-select); 5 PRs open (#274 SignMessage, #277 getCapabilities 2.0, #278 SIWS, #279 sign_and_send, #280 AuthToken). Fixed 11 bugs during hardware testing. Verified on Seeker, mainnet-beta.

Capacitor Solana MWA: first Capacitor plugin for MWA, open source.

Cocos Creator MWA SDK: this submission. Same pattern, third engine.
```
*Final user version. ~940 chars.*

### Did anyone not listed on the team here do meaningful work? (≤600 chars)

```
No. Solo project — every architectural decision, line of code, on-chain program, and on-device verification on Solana Seeker is mine.
```
*~140 chars.*

### Team Telegram Contact (REQUIRED)

**Needed from you:** confirm or set up a Telegram handle. The form uses this for prize distribution and accelerator interviews.

### X Profile (PUBLIC)

**Needed from you:** your X handle.

### Is there anything else judges should know? (≤500 chars)

```
SolPulse, my Solana trading app, is live on the Solana dApp Store since April 6: 200+ downloads, 11 reviews, 4.1 stars. The MWA SDK work for Cocos, Godot, and Unity is informed by real production wallet flows on Seeker hardware. The Cocos SDK was self-directed gap-spotting: the engine had no Solana integration, I built one. MIT, public good. Pursuing a Solana Foundation grant for maintenance and Mandarin docs.
```
*~410 chars. Updated 2026-04-29: drops Unity/Godot grant-precedent framing per user's call. Adds SolPulse dApp Store traction as credibility signal. Reads as "shipping solo dev with live users" rather than "guy assigned third SDK in a series."*

### Are you applying for the Colosseum accelerator program?

**Select NO.** Per `GRANT_PATH.md`: this is ecosystem infrastructure, not a startup. Public Good lane only.

---

## What I still need from you to fill the form

1. Country of residence.
2. Telegram handle (or confirm you'll create one).
3. X / Twitter handle.
4. Edits / approval on the long-form copy above.
5. Logo: confirm `mascot-ref.png` is OK as-is, or want the Figma wordmark variant?
