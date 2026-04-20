# Cocos × Solana Mobile

**Bringing Asia's dominant mobile game engine onchain.**

---

## The One-Liner

Cocos powers **40–45% of China's mobile games**, **60%+ of South Korea's top 10**, and the **$5.56B WeChat mini-game economy** — a stack of **1.7 million developers** reaching **2 billion+ players**. None of them could ship a Solana game before this SDK. We built the bridge.

---

## The Problem — Asia Is Missing From Solana Mobile

Solana Mobile launched Seeker into a market where Solana has almost no share. Asia-Pacific is the largest mobile gaming region on earth — **$60.1B/year, 63.4% of global mobile gaming revenue**, **1.5 billion gamers** [1][2]. It is also the fastest-growing Web3 gaming region: **$2.1B in 2024 at a 21.72% CAGR** [3].

Unity got a Solana MWA grant. Godot got a Solana MWA grant. **Cocos — the #1 engine in China, Korea, and Japan mini-games — had zero Solana integration.**

That gap isn't a footnote. It's the entire Asian mobile-games developer pool locked out of the one blockchain that built a mobile phone specifically for them. Seeker is a product looking for a developer population, and the population is building on Cocos.

---

## The Market We Unlock

Every number below has a source in the footer.

- **1.7M registered Cocos developers** across 203+ countries and regions [4][5].
- **2 billion+ players** reached by games built on Cocos; **1 billion+ cumulative device installs** [4].
- **40–45% of China's mobile games** built on Cocos. Historically as high as **70%** [6][7].
- **60%+ of South Korea's top 10 mobile games** are on Cocos [8].
- **30–40% of Japan's top mobile grossers** use Cocos [9].
- **53%+ of Asia's mini-game market** runs on Cocos [4].
- **WeChat Mini-Games: $5.56B revenue in 2024, +99% YoY**, 500–750M MAU, 400,000+ active developers. Cocos is the dominant toolkit [10][11][12].
- **Monster Strike (Cocos): $7.2B lifetime gross** — among the highest-grossing mobile games ever shipped [13].
- **Clash of Kings, ONE PIECE Treasure Cruise, Top War, Hero Wars, Lotsa Slots, Cash Frenzy** — all Cocos titles, all still generating top-chart revenue today [13][14].

Roll that up: one SDK, one install, and Solana Mobile is now reachable from the toolchain behind nearly half a billion monthly players.

---

## Why This Couldn't Exist Without Crypto

This is the exact market Colosseum is funding: *"products that enable new markets that couldn't exist without crypto, or improve existing markets by bringing them onchain."*

Asian mobile gaming already has in-app purchases, ad networks, fiat rails, and massive user bases. What it doesn't have — and **structurally can't have** without a chain — is:

- **Cross-game, player-owned assets.** A skin, a card, or a parcel earned in one title that retains value in another, in a secondary market, or outside the publisher's control.
- **Borderless micropayments** at mobile scale. A player in Jakarta sending a tenth of a cent to a player in Seoul without Visa interchange, KYC friction, or a regional payment rail.
- **Provable scarcity and provenance.** What makes digital-native assets actually native instead of just database rows a publisher can delete.
- **Player-side custody on the one phone built for it.** Solana Seeker's Seed Vault, reached through MWA, is the only hardware-rooted mobile wallet stack shipping today.

Every non-Solana attempt at mobile web3 gaming in Asia has collapsed into one of two failure modes: custodial (which defeats the point) or desktop (which is the wrong audience). MWA + Seed Vault is the rail that breaks that trade-off. Until this SDK, that rail ended at Unity and Godot — engines with single-digit share of the market we're describing.

We're not crypto-washing games. We're giving the largest mobile-game engine on earth the one rail that makes digital-native assets possible at mobile scale.

---

## Why Cocos, Why Now

Three things lined up that have never lined up before:

1. **Cocos 4 went fully open source in 2026** [15]. The friction to integrate, fork, and ship against Cocos is the lowest it has ever been.
2. **Solana Seeker is shipping into Asia**, where Cocos is the incumbent engine. Distribution and engine alignment only become possible once.
3. **WeChat mini-games cleared $5.56B in 2024** — a **99% year-over-year jump** into the exact category Cocos dominates. The revenue curve is going up the right-hand side of the chart, and today there is no onchain primitive inside it.

This window closes the moment another team ships. It hasn't, so we did.

---

## What We Built — And Why It's Ahead

**Full MWA 2.0 API parity** for Cocos Creator 3.8+:

- `authorize`, `reauthorize`, `deauthorize`, `delete_authorization`, `clone_authorization`
- `sign_in_with_solana` (SIWS)
- `sign_transactions` (batch), `sign_and_send_transactions`
- `sign_messages` (batch)

**Exceeds the funded Unity and Godot grants** in four places:

| Capability                               | Cocos (ours) | Godot grant | Unity grant |
| ---------------------------------------- | :----------: | :---------: | :---------: |
| Installed-wallet detection               |      Yes     |      —      |      —      |
| Device detection (Seeker / Saga)         |      Yes     |      —      |      —      |
| Batch `sign_messages`                    |      Yes     |  single only |  single only |
| Compound `authorize` + biometric         |      Yes     |      —      |      —      |

Plus:
- **Hardware-verified on Solana Seeker** with Seed Vault integration.
- **Zero npm dependencies** for transaction building — ships as a drop-in TypeScript module inside Cocos.
- **Persistent auth caching via SQLite** so a signed-in user stays signed in across sessions.
- A full example app with a **wallet compatibility matrix** — Phantom, Solflare, Backpack, Jupiter, Seed Vault — all tested end-to-end.

The SDK is the only Cocos-side MWA implementation in existence, and it already ships more capability than either of the grant-funded engines.

---

## The Vision

**Year 1 — land.** Template projects, Chinese-language docs, first Cocos Solana mobile titles in market. Workshops with Cocos's developer network.

**Year 2 — WeChat.** Bridge the SDK into the WeChat mini-game runtime. Solana assets, player-owned, inside a 500M-MAU ecosystem that has no onchain primitive today.

**Year 3 — default engine.** Cocos becomes the default engine for Solana Mobile games the way Unity is the default for EVM-mobile ecosystems. When someone in Shenzhen or Seoul decides to build a Solana mobile game, this is what they reach for.

The same flywheel that made Unity the default for Ethereum-adjacent mobile gaming is on the table here — and the only engine positioned to run it in Asia is Cocos.

---

## Hero Stats — For Video, Slides, Pitch Decks

- **1.7M developers** on Cocos.
- **2B+ players** reached.
- **$60.1B** Asia-Pacific mobile gaming, **$143B** by 2030.
- **$5.56B** WeChat mini-games in 2024, **+99% YoY**.
- **$2.1B** APAC Web3 gaming, **21.7% CAGR**.
- **40%** of China's mobile games, **60%+** of Korea's top 10, **30–40%** of Japan's top grossers.
- **$7.2B** lifetime gross — Monster Strike, built on Cocos.
- **One SDK.** First of its kind. Shipped at parity-plus with the funded Unity and Godot grants.

---

## Sources

1. Grand View Research — Asia-Pacific Mobile Gaming Market ($60.1B 2024, $143B by 2030). <https://www.grandviewresearch.com/horizon/outlook/mobile-gaming-market/asia-pacific>
2. Niko Partners — Asia & MENA games market 2025 ($86.6B, 1.5B gamers). <https://nikopartners.com/asia-mena-market-model-2025/>
3. Cervicorn — Web3 Gaming Market (APAC $2.1B, 21.72% CAGR). <https://www.cervicornconsulting.com/web3-gaming-market>
4. Cocos — "More than a game engine: Cocos completes $50M Series B" (1.7M devs, 203 countries, 2B players). <https://www.cocos.com/en/post/more-than-a-game-engine-cocos-completes-50-million-in-series-b-financing>
5. TechCrunch — Cocos $50M Series B (WeChat, $7.3B Chinese casual market). <https://techcrunch.com/2022/04/11/cocos-engine-series-b-50-million-china/>
6. SCMP — Chinese game engine Cocos powering mobile titles. <https://www.scmp.com/tech/tech-leaders-and-founders/article/3099271/chinese-game-engine-creator-cocos-fast-food>
7. TechNode — "70% of China mobile games built on Cocos" (historical). <https://technode.com/2014/10/29/chukong-70-mobile-phone-games-china-developed-cocos-game-engine/>
8. Cocos — Biggest Korean games using Cocos. <https://www.cocos.com/en/post/the-biggest-korean-games-using-the-cocos-engine>
9. Cocos — Best mobile games in Japan use Cocos. <https://www.cocos.com/en/post/the-best-mobile-games-in-japan-use-cocos>
10. PocketGamer.biz — WeChat Mini-Games $2.3B H1 2024, 400K devs. <https://www.pocketgamer.biz/behind-the-scenes-of-wechat-minigames-and-how-it-has-generated-23-billion-in-the-first-half-of-2024/>
11. iChongqing — WeChat Mini Games hits 1B users. <https://www.ichongqing.info/2025/07/02/wechat-mini-games-hits-1b-users-becomes-global-magnet-for-game-developers/>
12. Statista — WeChat mini-games MAU 2024. <https://www.statista.com/statistics/1463612/china-wechat-gaming-mini-progams-monthly-active-users/>
13. Cocos — Top 10 Games Built With Cocos (Monster Strike, Top War, ONE PIECE Treasure Cruise). <https://www.cocos.com/en/post/top-10-games-built-with-cocos-in-2021>
14. foxsterdev (Medium) — Cocos ratio in US top-100 grossing mobile games. <https://foxsterdev.medium.com/how-much-is-the-cocos-engine-based-ratio-in-the-top-100-grossing-mobile-games-for-the-usa-aaae6330a52f>
15. PRNewswire — Cocos 4 is here, fully open source (2026). <https://www.prnewswire.com/news-releases/cocos-4-is-here-fully-open-source-302652264.html>
