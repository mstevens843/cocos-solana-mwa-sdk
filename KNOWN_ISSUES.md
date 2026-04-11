# Known Issues — Cocos Creator MWA SDK

## Issue #1: Scene Transitions Cause Infinite Loop

**Status:** Workaround applied (single-scene approach)
**Severity:** Critical
**Affects:** `director.loadScene()` between Landing and Home scenes

### Problem
When calling `director.loadScene('Home')` after successful wallet authorization, Cocos Creator enters an infinite loop:
1. `loadScene('Home')` triggers Landing scene destruction
2. During `onDestroy`, the engine's module system (`System.register`) tries to re-register the LandingUI module
3. This crashes and loops — `onDestroy` fires repeatedly with `System.register` error spam
4. The Home scene never loads

### Root Cause
Custom script components embedded in scene files using compressed UUIDs (e.g., `209a7gDLAJA55mkaD+kaOP4`) trigger a module re-registration error during scene unload. This appears to be a Cocos Creator 3.8.8 engine bug when:
- Custom components are referenced by compressed UUID in `.scene` JSON files
- `director.loadScene()` is called to transition between scenes containing these components

### Workaround (Current)
Merged Landing and Home into a **single scene** with two panels that show/hide based on connection state. No `director.loadScene()` calls. This eliminates the bug entirely.

### Proper Fix (TODO)
Investigate whether:
1. Using uncompressed UUIDs in scene files avoids the bug
2. A different component registration approach (e.g., `@ccclass` with explicit registration) prevents the re-registration crash
3. This is fixed in Cocos Creator 3.9+ or COCOS 4
4. Scene transitions work if components are added via editor inspector rather than embedded in scene JSON

### Related Bugs Found During Development
- `game.addPersistRootNode()` only works on root-level nodes — MWAManager must reparent itself from Canvas to scene root before calling it
- Parent `onLoad()` fires before children in Cocos Creator — event registration must happen in `start()` not `onLoad()`
- Cocos Creator build cache (`library/`, `temp/`) doesn't always detect external TypeScript file changes — must delete these directories and reopen editor to force recompile
- Cocos Creator Build regenerates `gradle.properties` with default values (minSdk=21, empty NDK) — must re-patch after every Build
- MWA `sign_messages` creates a new session — chaining `signMessage` immediately after `authorize` causes Seed Vault to dismiss the second intent
