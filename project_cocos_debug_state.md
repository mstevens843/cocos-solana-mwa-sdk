---
name: Cocos MWA SDK Debug State - April 9 2026
description: Current debugging state for the Cocos Creator MWA SDK hackathon project - what works, what's broken, what to try next
type: project
originSessionId: e8109d5a-1cc0-48eb-a249-d4f750b8ff4c
---
## What WORKS
- MWA authorize flow: Connect → Seed Vault picker → approve → pubkey returned ✓
- JsbBridge communication: TS ↔ Java round-trip works perfectly ✓
- Auth caching: sys.localStorage persistence works ✓
- Reconnect detection: cached auth shows Reconnect button on reopen ✓
- Toast notifications: native Android toasts display correctly ✓
- All deterministic logging: 341 log statements fire correctly ✓
- Portrait orientation: fixed ✓
- NDK 27.2: stable builds ✓

## What's BROKEN
- **Scene transition infinite loop**: `director.loadScene('Home')` causes `System.register` error spam and infinite `onDestroy` loop. Documented in KNOWN_ISSUES.md
- **Build cache**: Cocos Creator doesn't reliably pick up TypeScript changes. Must use "Clear cache of project assets" in Build panel menu (right-click hamburger icon) before every Build
- **Start Scene**: Changing Start Scene in Build settings doesn't always take effect. The app keeps loading the old `scene.scene` instead of `Main.scene`
- **Single-scene approach (AppUI.ts + Main.scene)**: Created but never successfully deployed because the build keeps loading old code

## Files Created But Not Yet Deployed
- `AppUI.ts` — single unified UI controller (show/hide panels, no scene transitions)
- `Main.scene` — single scene with LandingPanel + HomePanel
- `KNOWN_ISSUES.md` — documents scene transition bug and other Cocos quirks

## Files That Must NOT Be Deleted
- `LandingUI.ts` — needed for dual-scene fix later
- `HomeUI.ts` — needed for dual-scene fix later  
- `Landing.scene` — needed for dual-scene fix later (was already deleted by generate-scenes.js)
- `Home.scene` — needed for dual-scene fix later (was already deleted by generate-scenes.js)

## Key Cocos Creator Quirks Discovered
1. `game.addPersistRootNode()` only works on ROOT nodes — must reparent first
2. Parent `onLoad()` fires before children — use `start()` for cross-component init
3. Build cache in `library/` doesn't detect external file changes — clear manually
4. Build regenerates `gradle.properties` with defaults (minSdk=21, empty NDK) — re-patch after every Build
5. Scene transitions with compressed UUID components cause infinite loop
6. Sign-in chain (signMessage after authorize) fails because Seed Vault rejects rapid back-to-back sessions

## Project Location
- `/Users/devlegacy/Desktop/cocos-solana-mwa/` — Cocos Creator project
- `/Users/devlegacy/Desktop/coco/` — SDK source files (reference copy)

## Next Steps
1. Research WHY the build keeps loading old scene despite Start Scene being set to Main
2. Consider building scene entirely in editor instead of JSON generation
3. Fix the single-scene approach so AppUI.ts actually loads
4. Then: colored buttons, bigger UI, all 7 action buttons matching Unity style
