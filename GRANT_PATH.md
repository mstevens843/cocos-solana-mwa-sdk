# Grant Path — Strategic Positioning

**Companion to `PITCH.md`.** Where `PITCH.md` is the market thesis and hero reel, this doc is the strategic posture for the Colosseum submission and the Solana Foundation grant application that follows it. Read this before writing the pitch video, the demo, or the Colosseum project description.

---

## What This Project Is (and Isn't)

This is **ecosystem infrastructure**, not a startup.

- **Is:** An open-source MWA SDK contribution that fills a gap Solana Mobile needs filled, **plus a working Anchor program and demo game** that exercise the full MWA surface on-chain. The third MWA SDK alongside the two the Solana Foundation has already funded — with more technical depth because it ships its own escrow program, not just the client SDK.
- **Isn't:** A company, a consumer product, a VC-backed bet. There is no Cocos MWA Inc. There is no seed round. There is no pitch to hire engineers or go full-time against the 20-person Cocos engine team.

This framing is deliberate. Judges will evaluate two very different bars depending on how the project is presented:

| If pitched as...          | Bar is...                                                  |
| ------------------------- | ---------------------------------------------------------- |
| Startup / consumer product | Live users, revenue or retention, full-time team, GTM     |
| Ecosystem infrastructure   | Working code, real gap filled, parity precedent, open-source license |

The second bar is the one this project clears cleanly. Aim there.

---

## The Precedent — A Proven Path

The Solana Foundation has already funded MWA SDKs for the other two major game engines:

1. **Unity MWA SDK** — Solana Foundation grant, funded.
2. **Godot MWA SDK** — Solana Foundation grant, funded.
3. **Cocos MWA SDK** — this project. Same problem, same scope, same solution — for the engine that dominates Asia.

The entire grant case is: **"you funded MWA for Unity and Godot. Cocos is the third and largest-in-Asia engine. Same surface area. Same contributor. Here it is, already shipped and verified on Seeker — plus an on-chain Anchor program (`14H1RLeqzU2rCnpnsLakVCtcmfZcuS4LvzwfhiY3AQbd` on devnet → moves to mainnet pre-submission) demonstrating the SDK drives real economic flows, not just wallet prompts."**

That's a grant argument a reviewer can accept on sight. It doesn't require imagining a market, projecting traction, or validating a business model. The precedent does the work.

---

## Why This Is a Public Good

- **Open source** (MIT). No captured value, no token, no royalty, no proprietary layer.
- **No economic moat attempted.** The SDK will be free for anyone to fork, embed, or commercialize.
- **Fills a concrete ecosystem gap.** Before this, there was no way to build a Solana Mobile game in Cocos. Now there is.
- **Follows the pattern Solana already blessed.** The Foundation already decided MWA SDKs per engine are worth paying for. This is one of those.
- **Unlocks other builders.** The SDK is not the game — it is the plumbing under other people's games. Success is measured in the work it enables, not the users it captures.

This is exactly what Colosseum's **Public Good** prize exists for.

---

## Colosseum Submission Lane

**Target prizes (in order of fit):**

1. **Public Good prize — $10K.** Primary target. The project fits the framing cleanly.
2. **Runner-up — $10K (20 slots).** Secondary target; technical execution is strong enough to compete.
3. **Grand Champion — $30K.** Do not optimize for this. It's a founder accelerator slot. A solo contributor shipping an SDK will not beat a founding team with live users.

**What to skip in the submission:**
- Do not claim "full-time commitment" to a company that doesn't exist.
- Do not project revenue.
- Do not promise a WeChat mini-game bridge rollout. `PITCH.md` has that vision for later — it is not a hackathon deliverable.
- Do not invent a team.

**What to lead with instead:**
- "Third MWA SDK for the third major engine. Solana funded the first two."
- "Parity-plus with both funded grants, verified on Seeker hardware."
- "MIT, open-source, designed to be used and forked."

---

## Post-Hackathon — The Grant Application

Colosseum is the visibility event. **The Solana Foundation grant is the actual funding goal.**

Sequence:

1. Submit to Colosseum by **May 11, 2026**.
2. Win Public Good or runner-up — use it as third-party validation.
3. Apply to the Solana Foundation grant program citing: (a) the Unity and Godot MWA SDK precedent, (b) the Colosseum placement, (c) the already-shipped codebase + hardware verification + demo game.
4. If granted, use the funding to maintain the SDK, translate docs to Mandarin, and engage the Cocos developer forum — the real adoption work.

This is a clearer and more honest path than trying to turn an SDK into a startup.

---

## Demo Game — Proof, Not Product

The demo is not a game. It is a **proof-of-MWA** wrapped in the smallest possible Cocos scene.

Recommended surface:
1. **Connect wallet** (authorize, any installed wallet).
2. **Sign In With Solana** (SIWS).
3. **Sign a message** (show the signature).
4. **Sign and send a transaction** — transfer 0.001 SOL on devnet, show the tx hash, link to explorer.
5. **Disconnect / deauthorize.**

That's it. One scene. One minute of footage. Every MWA method visible in the demo video.

Do not build a game with enemies, scoring, sprites, menus, or level design. The scope trap is real — every hour spent polishing a game is an hour not spent tightening the pitch.

---

## Pitch Video Framing (3 minutes)

Lose the founder story. Use the contributor story.

**Rough arc:**
- **0:00–0:20** — The thesis. "Solana funded MWA SDKs for Unity and Godot. Cocos — the #1 engine in Asia — had nothing. I built it."
- **0:20–1:00** — The market, from `PITCH.md` §3. Hero stats: 1.7M devs, 2B+ players, WeChat mini-games.
- **1:00–2:00** — The demo. The 5-step proof game, live.
- **2:00–2:30** — Parity-plus table vs Unity/Godot grants. Hardware verification on Seeker.
- **2:30–3:00** — The ask: public good prize, Foundation grant, use it to maintain and translate.

**What not to say:**
- "We are building a company."
- "We have a team of X."
- "We project Y users in Z months."
- Any projection, roadmap beyond 12 months, or moonshot framing. That's PITCH.md material — inspirational context, not submission claims.

---

## Anti-Patterns to Avoid

- **Overclaiming.** No users means no users. "Verified on Seeker hardware by the author" is the honest and strongest framing.
- **Pretending to be a team.** Solo contributor is fine for this lane. The grant path does not require co-founders.
- **Hiding the scope.** The SDK is the submission. The demo is a demo. Be direct about that.
- **Optimizing for Grand Champion.** Every minute spent there is a minute not spent on Public Good / Foundation grant materials, where the actual win is.

---

## Summary

- `PITCH.md` — market thesis, hero reel, long-horizon vision. Use for narrative, slides, hero stats.
- `GRANT_PATH.md` (this doc) — strategic posture for the Colosseum submission and the Solana Foundation grant application. Use for framing the pitch video, the submission copy, and the demo scope.

Two docs, two jobs. Keep them separate so the ambitious vision in `PITCH.md` doesn't pollute the humble-infra posture of the submission.
