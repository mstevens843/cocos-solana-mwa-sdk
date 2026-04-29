# Video Production Plan (Colosseum Submission)

Two videos required by the Colosseum Frontier 2026 form. Decisions locked here so future-self can pick up cold.

Source-of-truth status:
- Logo asset rendered: `branding/project-logo.png` (1080x1080, MIT lockup)
- Hero stats and copy: `PITCH.md`
- Strategic posture: `GRANT_PATH.md` (Public Good lane, ecosystem infrastructure framing)
- Long-form form copy: `COLOSSEUM_SUBMISSION_DRAFTS.md` (older video scripts in there are superseded by this doc)

---

## Video 1: Demo Video (max 3 minutes)

**Format decision:** Screen recording of the app actually working on Solana Seeker, voiceover narration. No slides, no code walkthrough, no founder face. Live product only.

**What the judges want to see:** real wallet prompts, real on-chain transactions, real Solana Explorer links confirming the txs landed. The product doing the things the README claims.

**Tooling:**
- Capture: Seeker built-in screen recorder OR Android Studio `screenrecord` over adb
- Voiceover: record separately in QuickTime or CapCut, lay over the screen-cap in editing
- Edit: CapCut (free) or Final Cut, no fancy transitions needed
- Upload: YouTube unlisted (or public if comfortable). Loom and Vimeo also accepted by Colosseum

**Shot list (target ~3:00, trim during edit):**

```
[0:00 to 0:10]  Token Duel app icon on Seeker home screen. Tap to open.
   VO: "Token Duel, built in Cocos Creator, running on Solana Mobile."

[0:10 to 0:25]  Tap Connect Wallet. OS picker appears. Pick Phantom or Solflare. Approve.
   VO: "MWA 2.0 connect. Same flow as Phantom Mobile or Solflare Mobile, now inside a Cocos game."

[0:25 to 0:40]  SIWS prompt. Approve.
   VO: "Sign In With Solana. Proves wallet ownership in a single round trip, no separate signature step."

[0:40 to 1:00]  Open Find Match panel. Pick a 60-second round.
   VO: "Token Duel is a live portfolio race. Pick three tokens. Whoever's basket gains the most percentage in 60 seconds takes the pot."

[1:00 to 1:25]  Stake 0.1 SOL. signAndSendTransaction prompt. Approve.
   Cut to Solana Explorer showing confirmed tx.
   VO: "The stake goes through signAndSendTransaction. The Anchor program escrows it on-chain. Here's the tx on Solana Explorer."

[1:25 to 1:50]  Live race. Show portfolio percentage ticking. Cross finish line.
   VO: "60 seconds. Live token prices via Birdeye. Winner takes the pot."

[1:50 to 2:05]  Claim button. signAndSendTransaction. Approve. Balance updates.
   VO: "Claim is another signed transaction. The Anchor program pays out trustlessly."

[2:05 to 2:40]  Hard cut to master branch example app on Seeker. Quickly run: batch signMessages (3 msgs), deauthorize, reauthorize from cache, getCapabilities.
   VO: "The SDK is the product. The master branch ships every MWA 2.0 method. Batch sign_messages, deauthorize, reauthorize from cache, getCapabilities. All verified on hardware."

[2:40 to 3:00]  Cut to GitHub repo. Pan over the parity table from README.
   VO: "Cocos Creator MWA SDK. Third Solana mobile engine SDK. MIT-licensed, open source. Link in description."
```

**Trim levers if over time:**
- Drop the Solana Explorer cutaway (saves ~10s)
- Compress the master-branch montage to 20s (saves ~15s)
- End on the parity table without the closing pan (saves ~5s)

**Pre-flight checklist:**
- [ ] Token Duel APK installed on Seeker
- [ ] Seeker has at least 0.5 SOL on whichever cluster the demo uses (devnet by default; mainnet if Phase 7 is shipped before recording)
- [ ] Wallets installed: Phantom, Solflare, Backpack, Jupiter, Seed Vault
- [ ] Birdeye API key live and feeding the in-app token list
- [ ] Master branch APK also installed for the [2:05 to 2:40] cutaway segment
- [ ] Quiet recording environment

---

## Video 2: Pitch Video (max 2 minutes)

**Format decision:** Hybrid. About 30 to 40 seconds total on camera (intro + close), 80 to 90 seconds of voiceover over Remotion B-roll and slide imagery. Reuses the marketing-folder Remotion compositions.

**Why hybrid not pure animation:** Colosseum's prompt explicitly asks "introduce yourselves... we're interested in how you think and communicate." Pure animation hides the human, which fails their ask. Hybrid satisfies the human-presence requirement without demanding broadcast-quality presentation.

**Why hybrid not pure talking-head:** "Nothing fancy required" plus the existing marketing-folder Remotion assets give us free production value. Use them.

**Tooling:**
- Webcam: built-in laptop cam, or phone front camera. Frame waist-up, decent light, clean background
- Recording: QuickTime (Mac) or Loom for the on-camera segments
- B-roll source: `~/Desktop/marketing/` Remotion outputs (existing MP4s) plus the `ProjectLogo` still and any new compositions
- Edit: CapCut or Final Cut. Cuts only, no transitions
- Upload: YouTube public (Colosseum requires public for the pitch video specifically)

**Two-minute structure:**

```
[0:00 to 0:10]  ON CAMERA. Brief intro.
   "Hi, I'm Mat. Solo developer. I built the Cocos Creator MWA SDK for Solana."

[0:10 to 0:30]  CUT TO: Animated hero-stat reveal (Remotion comp).
   Voiceover continues:
   "Cocos is the dominant mobile game engine in Asia. 40 percent of China's mobile games. 60 percent of Korea's top 10. The 5.56 billion dollar WeChat mini-game economy. 1.7 million developers. And until this SDK shipped, none of them could ship a Solana game."

[0:30 to 0:55]  CUT TO: Three-engine slide (Cocos | flame | Solana mark, similar to the project logo).
   "Solana already has MWA SDKs for Unity and Godot. This is the third, for the engine that dominates Asia. Same surface area. Hardware-verified on Seeker."

[0:55 to 1:25]  CUT TO: README parity table animation (zoom into the wallet matrix).
   "Full MWA 2.0 parity. Authorize. SIWS. Batch sign_messages. Sign and send transactions. Tested with Phantom, Solflare, Backpack, Jupiter, and Seed Vault. All on real Seeker hardware."

[1:25 to 1:40]  CUT TO: Token Duel game footage (3 to 5 second clips from the demo video, sped up if needed).
   "To prove it works, I built Token Duel on top of it. Real Anchor program on devnet. Live token prices. The SDK driving a real game."

[1:40 to 2:00]  ON CAMERA. Close.
   "MIT-licensed. Open source. Public good. The third Solana mobile engine SDK. Repo link in the description. Thanks."
```

**Slides / animations needed (build in Remotion if not already done):**
1. Hero-stat reveal: 1.7M devs, 2B players, $5.56B WeChat, 40 percent China, 60 percent Korea, animated counter or fade-in stat cards
2. Three-engine lockup: similar to ProjectLogo but with Unity and Godot logomarks faded in/out alongside Cocos. Or skip and use the existing ProjectLogo still here
3. Parity table reveal: zoom into the README wallet matrix (can be a screen-record of scrolling the README on GitHub)
4. Token Duel highlight reel: 3 to 5 second cuts from the demo video material, compressed

Existing Remotion comps in `~/Desktop/marketing/remotion/src/` that may be reusable:
- `ProjectLogo` (the Cocos x Solana lockup we just built)
- `SolPulseZoom` family (camera-zoom motion, can adapt for a hero-stat reveal)
- `HelloWorld` (default Remotion demo, ignore)

**Trim levers if over time:**
- Compress the three-engine voiceover to 15s (saves ~10s)
- Cut the wallet name list and lean on the demo video for that (saves ~5s)
- Shorter on-camera close, ending on "MIT licensed, open source, public good. Thanks." (saves ~5s)

**Pre-flight checklist:**
- [ ] Webcam location with decent natural light, clean background
- [ ] Script printed or on a second screen for the on-camera segments
- [ ] Voiceover audio recorded clean (run a test clip first, listen back)
- [ ] All B-roll Remotion comps rendered to MP4 in `~/Desktop/marketing/`
- [ ] Token Duel demo footage already captured (the demo video provides this)

---

## Recording order recommendation

1. Record the demo video first. It's the harder technical capture and the source of footage you'll cut into the pitch video later.
2. Build any new Remotion B-roll compositions needed for the pitch video.
3. Record voiceover for the pitch video.
4. Record the two on-camera segments (intro + close) for the pitch video.
5. Edit pitch video, pulling B-roll from steps 2 and Token Duel clips from step 1.
6. Upload both. Demo as unlisted on YouTube. Pitch as public on YouTube.
7. Paste the YouTube URLs into the Colosseum form.

---

## What NOT to do

- Do not script a 30-second monologue about your founder origin story. The Public Good lane does not reward founder narrative the way the accelerator lane does. Lead with the work, not yourself.
- Do not over-produce. Colosseum specifically said "nothing fancy required." A clean cut beats a fancy cut.
- Do not include Token Duel mainnet shots until Phase 7 is actually shipped. Devnet is fine for the submission.
- Do not name-drop the accelerator program. The submission is opting out of accelerator (`COLOSSEUM_SUBMISSION_DRAFTS.md` page 3, "Accelerator: NO").
