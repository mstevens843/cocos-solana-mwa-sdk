# Launch Crash Fix — `betting-duel`

Post-mortem and runbook for the bug that caused the Android APK to hard-exit
on every launch with a native SIGSEGV in `libcocos.so`. The same investigation
also surfaced and fixed three adjacent issues (missing resources bundle,
missing icon PNGs, Seedance mascot rendering with a white box / halo).

## Symptom

Every launch on Android produced an identical crash within ~40ms of `start()`
returning:

```
F libc    : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x28
            in tid <jsthread> (Thread-2), pid <app>
F DEBUG   : #00 pc 0c3fa60  /lib/arm64/libcocos.so
F DEBUG   : #01 pc 0c3af28  /lib/arm64/libcocos.so
F DEBUG   : #02 pc 0d45ec8  /lib/arm64/libcocos.so
F DEBUG   : #03 pc 19ab528  /lib/arm64/libcocos.so
```

The same fault address (`0x28`) and same call-stack offsets reproduced 5+
times in a row. JS code reached `start | DONE` cleanly with no exceptions —
no `[ONERROR]`, no `unhandledrejection`. The crash happened on the engine's
**first DRAW frame**, between `Director.EVENT_BEFORE_DRAW` and the
would-be `Director.EVENT_AFTER_DRAW`.

## Root cause

**Cocos Creator 3.8.8 native bug**: when a `cc.Graphics` component is added
to a node at runtime via `node.addComponent(Graphics)`, the C++ `RenderEntity`
that the engine sets as `node.userData` is not always populated by the time
the next DRAW frame walks the scene. The engine then calls
`UIModelProxy::activeSubModels()` which dereferences `_node->getUserData()` as
a `RenderEntity*`, hits null, and reads the `_renderDrawInfos` vector at
offset `0x28` → SIGSEGV.

Symbolicated stack (via `addr2line` against the unstripped
`libcocos.so` shipped in the build's RelWithDebInfo intermediates):

```
#0  std::vector<cc::RenderDrawInfo*>::size()
#1  js_cc_UIModelProxy_activeSubModels  (jsb_2d_auto.cpp:2923)
#2  jsbFunctionWrapper                   (HelperMacros.cpp:99)
#3  Builtins_CallApiCallbackGeneric      (V8 binding glue)
```

The only callers of `UIModelProxy::activeSubModels` in the engine are:
- `Graphics.updateRenderer()` at `cocos/2d/components/graphics.ts:739`
- `UIMeshRenderer` (not used in this project)

So the crashing component is always a `cc.Graphics`. The triggering code on
this branch was:

1. **`IconLibrary.attach()`** — when no PNG was registered yet (cold start
   before phase3 loads icons), the procedural fallback path called
   `node.addComponent(Graphics)` × 35 times in `_attachStaticIconBadges`.
2. **`MascotController._buildMascot()`** — created 12 dynamic Nodes
   (`MascotBody`, `MascotWand`, `MascotEyeL/R`, 8 `MascotSparkle_N`) and
   called `addComponent(Graphics)` on each to draw the procedural mascot.

Both ran synchronously inside `AppUI.start()`. The first DRAW frame after
`start()` returned hit one of these new Graphics with an unwired RenderEntity
and crashed.

## How we found it (the part worth remembering)

JS logs cannot see inside the C++ render walk. `console.log` from JS only
runs at JS-execution boundaries; once `start()` returns and the engine
begins its native frame loop, no JS code runs until the next frame's
`update` phase. If the crash is between BEFORE_DRAW and AFTER_DRAW,
**there is no JS log line that names the failing component**.

What does work: **symbolicate the native crash addresses against the
unstripped engine binary**.

The Android Cocos build leaves an unstripped `libcocos.so` at:

```
build/android/proj/build/CocosGame/intermediates/cxx/RelWithDebInfo/<hash>/obj/arm64-v8a/libcocos.so
```

Run NDK's `llvm-addr2line` against the crash PCs:

```bash
SO=$(find build/android -name libcocos.so -path '*RelWithDebInfo*' | head -1)
A2L=~/Library/Android/sdk/ndk/<version>/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-addr2line
for ADDR in 0xc3fa60 0xc3af28 0xd45ec8 0x19ab528; do
    "$A2L" -f -C -e "$SO" $ADDR
done
```

This took 30 seconds and named the exact function. The earlier hours of
"disable this panel and rebuild" bisecting were avoidable — when the crash
is in native code, symbolication is the right first move, not JS bisection.

## The fix

### 1. `assets/token-duel/scripts/IconLibrary.ts` — drop the runtime Graphics fallback

The Phase 1 procedural-draw path that ran `node.addComponent(Graphics)` is
removed. When no PNG is registered yet, `attach()` is a no-op and logs
`NO_PNG_YET`. Phase 3 re-calls `_attachStaticIconBadges()` once the PNGs
finish loading; the second call takes the Sprite path (no runtime Graphics).

```ts
// Phase 1 path: SKIP runtime-added cc.Graphics. Cocos 3.8.8 native renderer
// SIGSEGVs at offset 0x28 in UIModelProxy::activeSubModels when a Graphics
// is added to a Node at runtime and the first DRAW walk hits it before the
// RenderEntity userData is populated. Phase 3 re-calls
// _attachStaticIconBadges once PNG SpriteFrames are loaded; icons render
// via Sprite path then.
console.log(`${TAG} attach | NO_PNG_YET icon=${name} — skipping Graphics fallback`);
```

### 2. `assets/token-duel/scripts/MascotController.ts` — defer + default-hide procedural

Two changes:

(a) Move `_buildMascot()` out of `onLoad`'s synchronous body via
`scheduleOnce(..., 0)` so the engine has a frame to register render entities
before the procedural Graphics get walked:

```ts
onLoad(): void {
    this.scheduleOnce(() => {
        this._buildMascot();
        this.setState('idle');
    }, 0);
}
```

(b) After `_buildMascot()` constructs the procedural body/wand/eyes,
**default them to `active = false`**. They're only made visible by an
explicit `showProceduralFallback()` call when the Seedance frames fail to
load. This eliminates the 3+ second flash where the procedural mascot was
visible while phase3 loaded icons before mascot frames.

```ts
private _buildMascot(): void {
    // ...build child nodes + Graphics as before...
    if (this._bodyNode) this._bodyNode.active = false;
    if (this._wandNode) this._wandNode.active = false;
    if (this._eyeL) this._eyeL.active = false;
    if (this._eyeR) this._eyeR.active = false;
}

showProceduralFallback(): void {
    if (this._useSpriteSheet) return;
    if (this._bodyNode) this._bodyNode.active = true;
    if (this._wandNode) this._wandNode.active = true;
    if (this._eyeL) this._eyeL.active = true;
    if (this._eyeR) this._eyeR.active = true;
    const s = this._state;
    this._state = '__force__' as any;
    this.setState(s);
}
```

## Adjacent issues that surfaced and were fixed

### A. Missing `resources` bundle config

`assets/demo/resources/` was structured like a Cocos resources bundle but
its `.meta` file had empty `userData`. As a result `resources.load(...)` calls
in phase3 returned `Can not parse this input ... bundle:""` for every icon
and every mascot frame.

Fix: edit `assets/demo/resources.meta` to mark the folder as a bundle:

```json
"userData": {
    "isBundle": true,
    "bundleName": "resources",
    "priority": 1,
    "compressionType": { "android": "merge_dependence", ... },
    "isRemoteBundle": { "android": false, ... }
}
```

### B. Missing icon PNGs

Five icons were referenced by the code (`eye`, `bell`, `check`, `clock`,
`crown`) but had no corresponding files in `assets/demo/resources/icons/`.
Generated and dropped in. Added them to phase3's `iconNames` list in
`assets/demo/scripts/AppUI.ts` so they get loaded with the rest.

### C. Seedance mascot frames had no alpha + had a tinted halo

The 292 Seedance-generated PNGs in `assets/demo/resources/mascot/frames/`
were exported as `RGB` (no alpha channel) with a baked-in white background.
On device the mascot rendered inside a visible white rectangle.

Fix: `scripts/strip-mascot-bg.py` — runs in-place on every PNG.

Two-pass algorithm:

1. **Corner flood-fill** with `thresh=40`. Walks contiguous near-white
   pixels from each corner and replaces them with `(0,0,0,0)`. Catches the
   off-white background and the bright outer ring of the halo.
2. **BFS halo dilation**. Starting from already-transparent pixels, BFS to
   4-neighbor opaque pixels meeting `V > 0.85` AND `S < 0.30` in HSV. Eats
   the tinted halo from the outside in, stopping when it hits a saturated
   mascot pixel. Internal whites (e.g. eye highlights inside dark
   sunglasses frames) are preserved because they aren't connected to the
   outside transparency mask.

Result: average transparent area went from 41.7% (single-pass) to 75.1%.

### D. Phase3 load order — mascot first

Original order: 26 icons (serial, ~100ms each = ~2.6s) → mascot ref → mascot
frames → `setSpriteSheet`. Total ~4 seconds before the Seedance mascot
appeared. Reordered in `AppUI._loadPhase3Art()` so mascot ref + mascot
frames load **first** (in parallel via `Promise.all`), `setSpriteSheet` is
applied as soon as they're ready, then icons load serially in the
background. Mascot now appears within ~1s of launch.

## Verification

Build from Cocos Creator (do not skip this — `library/` and `temp/` should
be cleared first):

```bash
rm -rf library/ temp/
# Open Cocos Creator → Project → Build → Android → release
adb shell am force-stop com.solana.mwa.cocos
adb uninstall com.solana.mwa.cocos
adb install build/android/proj/build/CocosGame/outputs/apk/release/CocosGame-release.apk
```

Single grep that surfaces the whole launch sequence:

```bash
adb logcat -c && adb logcat | grep -E 'BUILD_STAMP|MASCOT_FIRST|setSpriteSheet|useSheet|NO_PNG|LOAD_FAIL|Fatal signal|DIR_AFTER_DRAW.*n=[1-3]\b'
```

Expected sequence:

1. `BUILD_STAMP v=2026-04-25-T1130-mascot-first` — proves new build deployed
2. `phase3 | MASCOT_FIRST start` — new reordered path
3. `mascot DONE` BEFORE `icons starting`
4. `setSpriteSheet | clean total=292`
5. `Mascot:update tick=N state=idle useSheet=true`
6. `DIR_AFTER_DRAW n=1, n=2, n=3` — frames advancing
7. **No `Fatal signal`, no `LOAD_FAIL`**

## Files changed

| File | Change |
|------|--------|
| `assets/token-duel/scripts/IconLibrary.ts` | Drop runtime Graphics fallback in `attach()` |
| `assets/token-duel/scripts/MascotController.ts` | Defer `_buildMascot` via `scheduleOnce`; default procedural nodes inactive; add `showProceduralFallback()` |
| `assets/demo/scripts/AppUI.ts` | Reorder `_loadPhase3Art` to load mascot before icons; new `iconNames` entries (`eye`, `bell`, `check`, `clock`, `crown`); fall back to `showProceduralFallback()` if Seedance load fails |
| `assets/demo/resources.meta` | Configure folder as Cocos `resources` bundle |
| `scripts/strip-mascot-bg.py` | New script: strips white bg + tinted halo from Seedance PNGs |
| `assets/demo/resources/icons/{bell,check,clock,crown,eye}.png` | New icon assets |
| `assets/demo/resources/mascot/frames/*.png` | Re-saved as RGBA with transparent background |

## Lessons

- **Native crashes need native debugging.** When the JS thread reaches a
  clean `start | DONE` and dies on the next frame inside `libcocos.so`,
  `addr2line` against the unstripped `.so` is the right first step. Bisecting
  by disabling JS subtrees was a waste of rebuilds.
- **Avoid `addComponent(Graphics)` at runtime in Cocos 3.8.8** — at minimum
  defer to a later tick, ideally pre-bake render components in the scene.
- **Cocos `resources` bundle is opt-in.** A folder named `resources` is not
  automatically bundled; the parent folder's `.meta` must declare
  `isBundle: true` and `bundleName: "resources"`.
- **Seedance/AI image exports are RGB by default** — always strip the
  background before bundling unless you've explicitly requested alpha.
