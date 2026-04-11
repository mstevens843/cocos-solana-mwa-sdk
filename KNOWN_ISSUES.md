# Known Issues — Cocos Creator MWA SDK

## Issue #1: Scene Transitions Cause Infinite Loop (CONFIRMED ENGINE BUG)

**Status:** Cannot fix — Cocos Creator 3.8.8 engine bug. 1-scene workaround is the permanent architecture.
**Severity:** Critical (blocks all multi-scene approaches)
**Affects:** `director.loadScene()` on native Android with any custom TypeScript component
**Branch with attempts:** `feature/two-scene` on GitHub

### The Bug

When calling `director.loadScene('Home')` from Landing scene on native Android, the Cocos Creator 3.8.8 SystemJS module loader (`@cocos/systemjs`) enters an infinite loop:

1. `director.loadScene('Home')` returns `true` (scene IS found, loading starts)
2. Landing scene destruction begins (`runSceneImmediate` phase 4)
3. During `onDestroy`, the engine re-evaluates `System.register("chunks:///_virtual/LandingUI.ts", ...)` — dumping the entire minified module source as an error
4. This triggers another `onDestroy` → another `System.register` → infinite loop
5. Home scene never activates — no `[HomeUI]` or `[SceneRouter]` logs ever appear

The loop repeats at ~15ms intervals indefinitely. Each cycle produces two lines:
```
D Cocos: [LandingUI] onDestroy | START
E Cocos: System.register("chunks:///_virtual/LandingUI.ts", ...)
```

### What We Proved with Deterministic Logging

- `loadScene('Home')` returns `true` — the scene IS registered in the build (confirmed via `bundle._config.scenes` enumeration showing `TOTAL_SCENES=2`)
- `preloadScene('Home')` succeeds — `preloadScene('Home') OK`
- Component is valid at transition time — `isValid=true node_valid=true`
- The `onLaunched` callback is never reached — the engine never gets past scene destruction
- The bug fires regardless of whether the component was embedded in scene JSON or added dynamically via `addComponent()`

### What We Tried (All Failed)

#### Attempt 1: Direct `loadScene` call
LandingUI embedded in scene JSON, `director.loadScene('Home')` called directly after authorize.
**Result:** Infinite `System.register` loop for `LandingUI.ts`.

#### Attempt 2: `scheduleOnce` deferred transition
Deferred `loadScene` to next frame via `this.scheduleOnce(() => director.loadScene('Home'), 0)`.
**Result:** Same infinite loop.

#### Attempt 3: MWAManager as root-level scene node
Moved MWAManager from Canvas child to direct Scene child in both scenes. Added `restoreFromCache()` state recovery. Added `preloadScene()`. Added transition guards.
**Result:** Same infinite loop.

#### Attempt 4: SceneRouter (shared component, dynamic `addComponent`)
Created a single `SceneRouter` component used in both scene JSONs. LandingUI/HomeUI removed from scene JSON entirely — added dynamically via `addComponent('LandingUI')` at runtime. Theory: if the same components are in both scenes, no module unloading occurs during transition.
**Result:** Same infinite loop. The bug fires for ANY TypeScript component that exists when `director.loadScene()` destroys the old scene, whether it was in scene JSON or added dynamically. The SceneRouter approach proved the bug is in the engine's module lifecycle, not in scene deserialization.

### Root Cause (Engine Level)

The Cocos Creator 3.8.8 native Android runtime uses `@cocos/systemjs` for module loading. TypeScript files are compiled to `System.register()` format with `_cclegacy._RF.push()` calls. During `runSceneImmediate()`, when the old scene is destroyed, the engine's module system re-evaluates the `System.register()` call for component modules instead of just destroying the component instances. This creates a feedback loop where re-evaluation triggers re-destruction.

This bug does NOT occur:
- In the Cocos Creator editor preview (web-based, different module loader)
- In the 1-scene approach (no `director.loadScene()` call)
- In Unity (`SceneManager.LoadScene` — `DontDestroyOnLoad` is a first-class feature)
- In Godot (`change_scene_to_file` — `autoload` singletons live outside scene tree)

### Why the 1-Scene Approach Works

The single-scene architecture with LandingPanel/HomePanel show/hide avoids `director.loadScene()` entirely. Panel switching is done via `node.active = true/false`, which never triggers scene destruction or module re-evaluation. This is architecturally equivalent to 2 scenes — the user sees different "screens" — without hitting the broken engine code path.

### Potential Future Fix

- Upgrade to Cocos Creator 3.9+ or 4.x when available — test if `director.loadScene()` works
- File a bug report on [cocos/cocos-engine](https://github.com/cocos/cocos-engine/issues) with the `System.register` reproduction steps
- Monitor `@cocos/systemjs` npm package for patches

### References

- `feature/two-scene` branch: All 4 attempts preserved with full code and commit history
- [Cocos Engine director.ts source (v3.8.8)](https://github.com/cocos/cocos-engine/blob/v3.8.8/cocos/game/director.ts) — `runSceneImmediate` implementation
- [GitHub Issue #13400](https://github.com/cocos/cocos-engine/issues/13400) — Related `director.runScene` crash
- [GitHub Issue #18139](https://github.com/cocos/cocos-engine/issues/18139) — Scene frame lifecycle bugs
- [Cocos Forum: addPersistRootNode](https://forum.cocosengine.org/t/can-not-be-made-persist-because-its-not-under-root-node/35466) — Root node requirement

---

## Issue #2: Build Cache Doesn't Detect TypeScript Changes

**Status:** Workaround required (clear cache manually)
**Severity:** Medium

### Problem
Cocos Creator's `library/` and `temp/` directories cache compiled assets and frequently fail to detect external TypeScript file changes. The build serves stale code even after modifying `.ts` files.

### Workaround
Delete both directories before rebuilding:
```bash
rm -rf ~/Desktop/cocos-solana-mwa/temp/ ~/Desktop/cocos-solana-mwa/library/
```
Then reopen the Cocos Creator editor to force a full recompile.

---

## Issue #3: `gradle.properties` Regenerated with Defaults

**Status:** Workaround required (re-patch after every Build)
**Severity:** Low

### Problem
Cocos Creator Build regenerates `gradle.properties` with default values (minSdk=21, empty NDK path) after every Build operation.

### Workaround
Re-patch `gradle.properties` with the correct NDK path and SDK versions after each Build, before Make.

---

## Issue #4: Sprite Components Require Explicit `_spriteFrame` References

**Status:** Fixed (documented for future reference)
**Severity:** Was Critical (caused all-black UI)

### Problem
Externally generated scene JSON files (from `generate-scenes.js`) initially had `_spriteFrame: null` on all `cc.Sprite` components. In Cocos Creator, a Sprite with no sprite frame renders as completely invisible — colors defined on the component have no effect because there's nothing to paint them onto.

### Fix
Set `_spriteFrame` to reference built-in engine sprites:
- Buttons: `{ "__uuid__": "20835ba4-6145-4fbc-a58a-051ce700aa3e@f9941" }` (default_btn_normal, 9-slice)
- Backgrounds: `{ "__uuid__": "57520716-48c8-4a19-8acf-41c9f8777fb0@f9941" }` (default_sprite, simple)

This is now handled correctly in `generate-scenes.js`.

---

## Issue #5: MWA Sign-In Chain Timing

**Status:** Fixed (compound command approach)
**Severity:** Was High

### Problem
Chaining `signMessage` immediately after `authorize` in separate MWA sessions causes Seed Vault to dismiss the second intent. The wallet rejects rapid back-to-back session requests.

### Fix
Use compound `authorize_and_sign` command that performs both authorize and sign-in message confirmation in a single MWA session. Implemented in `MWAManager.authorize()` and the Java `MWASessionManager.authorizeAndSign()`.
