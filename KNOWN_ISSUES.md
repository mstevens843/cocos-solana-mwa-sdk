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

---

## Issue #6: Solflare Mobile Crashes on `sign_messages` and `sign_and_deauthorize`

**Status:** Wallet-side bug — no SDK-side fix possible; surfaced with clearer error.
**Severity:** Medium (other wallets work; Solflare users blocked on these methods)
**Affects:** Solflare Mobile (`com.solflare.mobile`) — `sign_messages` RPC and by extension `sign_and_deauthorize` (the compound-command path used by "Delete Account" since it internally calls `signMessagesDetached`)
**Reproduces on:** React Native, Unity, Godot, Cocos — independent of app engine

### Symptom
Connect to Solflare → tap Sign Message OR tap Delete Account → Solflare opens → Solflare app freezes and crashes (user sees the native "App isn't responding" or an immediate close). Cocos logs show the WebSocket close as a null-cause exception:

```
E [MWASessionManager]: signMessages | EXCEPTION class=... msg=null
E [MWASessionManager]: signMessages | WALLET_CRASHED (null cause ...)
D [MWABridgePlugin]: sendError | id=req_002 code=WALLET_CRASHED message=Wallet app crashed during signing...
```

Equivalently for `sign_and_deauthorize`:
```
E [MWASessionManager]: signAndDeauthorize | EXECUTION_ERROR cause=null msg=null
E [MWASessionManager]: signAndDeauthorize | WALLET_CRASHED (null cause on ExecutionException)
D [MWABridgePlugin]: sendError | id=req_002 code=WALLET_CRASHED message=Wallet app crashed during signing...
```

### Why It Happens
Solflare's MWA sign handler has a known bug that crashes the Solflare process for certain inputs. The Cocos SDK's WebSocket to Solflare is then closed without a protocol-level reply, so `MobileWalletAdapterClient.signMessagesDetached().get()` throws without a descriptive cause. This is a wallet-side issue reproduced independently on other MWA SDKs — there is no app-side fix.

### What We Do in Cocos
1. **Detect the wallet-crashed signal** — in `MWASessionManager.java`, both `signMessages` and `signAndDeauthorize` catch blocks treat a null-cause `ExecutionException` or a null-message generic `Exception` as `WALLET_CRASHED` rather than the generic `WALLET_ERROR`.
2. **Surface a specific error** — `MWAManager.ts` `signMessage` and `deleteAccount` both populate `lastError.code = 'WALLET_CRASHED'`. `AppUI.ts` `_onSignMessage` and `_onDelete` branch on this and show a long-duration toast "Wallet crashed — try Backpack, Phantom, or Jupiter" instead of the generic "Sign message failed" / "Delete cancelled" so users know to switch wallets rather than retry Solflare.
3. **Keep process alive** — the `MWAKeepAliveService` foreground service (see Issue #7) prevents a secondary symptom where the Cocos process was itself killed while Solflare was foregrounded.

### Workaround Candidates (Not Implemented)
- Wrap the message bytes in an SPL Memo instruction and route via `signTransactions` instead. Matches the approach some dApps use for provable sign-in. Not done because React Native/Godot/Unity don't do this and the hackathon deliverable is "React Native parity."
- Detect Solflare package at connect time and pre-emptively block `signMessage`. Too aggressive — other Solflare methods work.

### References
- Same symptom documented in Unity SDK comments (commit `c8d68da: Fix Sign message on Solflare and Backpack`).
- Users have reported to Solflare team; fix pending upstream.
- RN equivalent: `@solana-mobile/mobile-wallet-adapter-protocol` issues referencing Solflare + `signMessages`.

---

## Issue #7: Cocos Process Killed While Wallet App is Foregrounded (Phantom silent failure)

**Status:** Fixed via `MWAKeepAliveService` foreground service.
**Severity:** Was Critical for Phantom (silent failure after user approved).
**Affects:** All wallets that hold the foreground long enough for Android LMK to reap Cocos — most reliably reproduced with Phantom on Seeker.

### Symptom (Before Fix)
Connect → Sign Message → Phantom opens → user taps Approve → **nothing happens** — Cocos does not return a signature, eventually user sees Cocos relaunched from the Landing screen with no cached auth.

Logcat evidence (Cocos process PID jumps from one line to the next):
```
00:12:14.625  D [MWASessionManager] signMessages | sending sign_messages RPC   ← PID 21561
(90-second gap — no MWA-related logs)
00:13:46.491  D [MWABridgePlugin]  init | START activity=AppActivity           ← NEW PID 22262
```
The gap is the Android Low-Memory Killer reaping the Cocos process because it's heavy (game engine + OpenGL) and fully backgrounded. Phantom delivers its signed response over the local WebSocket, but the peer is already dead.

### Why Godot/Unity Don't Hit It
Their game-engine footprints are lighter — LMK picks Cocos first. Godot's `SupervisorJob`-based fix in `MyComposable.kt:301-304` handles Compose `LaunchedEffect` cancellation on Activity destruction, a different scenario that doesn't protect against process death.

### Fix
`MWAKeepAliveService` (foreground Service, `native/engine/android/app/src/com/cocos/game/mwa/MWAKeepAliveService.java`) is started by `MWAIntentHelper.launchIntent()` immediately before dispatching every wallet intent, and stopped inside `MWASessionManager.closeScenario()` which runs in the `finally` of every MWA operation. The service displays a low-importance notification ("Wallet session active — Keeping app alive while your wallet is open") and bumps the process to `PROCESS_STATE_FOREGROUND_SERVICE` importance. Android's LMK does not reap processes at this tier under normal memory pressure.

Permissions added to `AndroidManifest.xml`:
- `FOREGROUND_SERVICE` (API 28+)
- `FOREGROUND_SERVICE_DATA_SYNC` (API 34+ — required by Android 14 enforcement of declared service type)
- `POST_NOTIFICATIONS` (API 33+)

Service declared with `android:foregroundServiceType="dataSync"` — the closest semantic match for maintaining an active network session with a remote peer (the wallet app). `exported="false"` keeps it internal.

### Limits
A foreground service is not a guarantee against every kill scenario — user force-stop, developer options "Don't keep activities," or extreme memory pressure can still kill the process. But under normal operation with Phantom + Seeker, it moves Cocos out of the reap-eligible tier.

---

## Issue #8: Disconnect / Reconnect (cached) Wrongly Opened the Wallet

**Status:** Fixed — both operations are now client-only (peer-SDK parity).
**Severity:** Was High (UX regression vs. Unity/Godot/React Native).

### Symptom (Before Fix)
- Tap **Disconnect** button → Backpack (or whichever wallet) opens and prompts for approval. Wallet intent launches, user has to approve, then the "Disconnected" toast appears. Bad UX.
- Tap **Reconnect (cached)** on the Landing panel after reopening the app → Backpack opens and prompts "Connect to Cocos MWA Example." User has to re-approve even though the cache already has a valid token and pubkey. Bad UX — the whole point of the cached reconnect is that it should be instant.

### Root Cause
`MWAManager.deauthorize()` previously called `this._bridge.sendCommand('deauthorize', …)`, which in turn called `MWASessionManager.deauthorize()` (Java) → created a new `LocalAssociationScenario` → launched the wallet intent → sent the protocol-level MWA `deauthorize` RPC. Comment in the code marked this as "Bug U1 Prevention" — intent was to be *more* protocol-correct than peer SDKs by actually invalidating the wallet's copy of the auth token. That design was **wrong at the UX layer**.

Same story for `reauthorize()` — it sent a `reauthorize` RPC via bridge, even though the cache already had everything needed for instant restore.

### Peer SDK Parity Table

| SDK | UI "Disconnect" | UI "Reconnect (cached)" |
|---|---|---|
| Godot | `clearStateFullReset()` — local-only, no RPC | Trust cached token, restore local state |
| Unity | `Logout()` — `PlayerPrefs.DeleteKey(...)`, no RPC | `Login()` — returns cached pubkey if exists |
| React Native | `useMobileWallet.disconnect()` — local-only | Account state hydrated from cache |
| Cocos (before fix) | **Sent MWA `deauthorize` RPC, opened wallet** ❌ | **Sent MWA `reauthorize` RPC, opened wallet** ❌ |
| Cocos (Pass 2) | Cleared state + wiped cache, no RPC | Restored state from cache, no RPC |
| Cocos (Pass 3, current) | Clears in-memory state, **keeps cache**, emits `MWA_DISCONNECTED` | Restores state from cache, emits `MWA_AUTHORIZED` |

### Fix
`MWAManager.ts` (`assets/solana-mwa/scripts/MWAManager.ts`):
- `deauthorize()` is now client-only — clears `isConnected`, `connectedPubkey`, `authToken`, `walletUriBase`, `connectedWalletPackage`, emits `MWA_DISCONNECTED`. Returns instantly. No bridge call. **Cache is retained** (Pass 3 correction): the Landing panel then shows BOTH "Connect" and "Reconnect (cached)" buttons so the user can either re-pick a wallet or restore from cache with one tap. Cache is only wiped explicitly by `deleteAccount()` or `deauthorizeRemote()`.
- `reauthorize()` is client-only — reads `_cache.getLatest()`, restores in-memory state, rejects deleted pubkeys, emits `MWA_AUTHORIZED`, returns the cached `AuthorizeResult`. Returns instantly. No bridge call. On cache miss, returns null (no silent fallback to full `authorize()` — the caller decides).
- Added `deauthorizeRemote()` for advanced consumers who explicitly want the protocol-level RPC behavior (still sends MWA `deauthorize` RPC + clears local state). Default UI "Disconnect" button maps to `deauthorize()`, not this method.

`MWASessionManager.java` Java methods `deauthorize()` and `reauthorize()` are intentionally **left intact** — they remain correct protocol-level implementations, just no longer called by the default UI flow. They're reachable via `deauthorizeRemote()` or for future protocol-level features.

### Trade-off
The wallet's copy of the auth token is now orphaned on disconnect (not explicitly invalidated). This is the industry-standard trade-off — Unity, Godot, React Native all do this. Users who want to fully revoke can either:
1. Open their wallet's "Connected Apps" / "Permissions" UI and remove the Cocos dApp manually, or
2. Call `MWAManager.instance.deauthorizeRemote()` programmatically (advanced).

The next signing operation after a fresh re-connect would use a new auth token anyway, so the orphaned token is effectively dead in practice.

### Verification
- Tap Disconnect → instant "Disconnected" toast, Landing appears with Reconnect button VISIBLE (Pass-3 correction — cache is retained). NO wallet intent. NO `[MWASessionManager]: deauthorize` log.
- Tap Reconnect → instant Home panel with previous pubkey. NO wallet intent. NO `[MWASessionManager]: reauthorize` log.
- Reconnect (cached) → sign message → wallet *does* open (expected — signing is privileged). Works end-to-end thanks to the `MWAKeepAliveService`.
- Delete Account → cache is wiped (this is the only path that clears the cache by default).

### Scene regeneration note (Home panel Reconnect button)
After editing `generate-scenes.js` you **must** run `node generate-scenes.js` to regenerate `assets/demo/scenes/Main.scene` — the editor does not rebuild it from the script automatically. Pass 3 dropped the `ReconnectHomeButton` from `generate-scenes.js` but the committed `Main.scene` still contained the node on a tester's branch. As belt-and-suspenders, `AppUI.start()` now queries `_homePanel.getChildByName('ReconnectHomeButton')` and sets `node.active = false` if found, so the button disappears at runtime even if the scene JSON is stale. Log line: `[AppUI] start | hid stale ReconnectHomeButton from scene (scene not yet regenerated)`.

---

## Issue #9: Backpack `sign_and_send_transactions` Crashes — Universal Sign+RPC Default

> **Pass 9 update:** routing is no longer "universal sign+RPC". `MWAManager.signAndSendTransactions` now routes `app.phantom` and `ag.jup.app` to native MWA `sign_and_send_transactions` when the user targets those wallets via the in-app wallet-list button (which populates `connectedWalletPackage`). Backpack (`app.backpack`) is explicitly force-routed to sign+RPC via the `_FORCE_SIGN_AND_RPC` static set in `MWAManager.ts` — see that file for the exact sets. OS-picker connections (empty `connectedWalletPackage`) still take the sign+RPC default, which remains the safe fallback when wallet identity is unknown. The Backpack crash described below is unchanged; the force-route is what keeps it benign.

**Status:** Fixed. Cocos routes Backpack through sign-via-MWA + broadcast-via-RPC; other wallets prefer native MWA `sign_and_send_transactions` when they advertise support and are targeted by package.
**Severity:** Was High for Backpack users.
**Affects:** Backpack Mobile (`app.backpack`) — its native MWA `sign_and_send_transactions` handler crashes with `JsonDecodingException`. `sign_transactions` works fine on Backpack.
**Reproduces on:** React Native, Unity, Godot, Cocos — independent of app engine. Unity's PR adding `sign_and_send_transactions` explicitly documents: "All tested wallets work except Backpack, which crashes due to a deserialization bug on their side."

### Symptom (Native MWA Path — now avoided by default)
```
signAndSendTransactions | STEP_5_REAUTHORIZED
signAndSendTransactions | STEP_6_RPC_SENDING tx_count=1 commitment=confirmed minContextSlot=…
(~19-second hang — Backpack's Kotlin process throws internally)
signAndSendTransactions | FAIL_EXCEPTION class=CancellationException msg=null elapsed_ms=19266
```
Internal Backpack error (visible in Backpack's own logs, not ours): `JsonDecodingException: Class discriminator was missing in SolanaMobileWalletAdapterWalletLibModule`. Backpack closes the WebSocket without a protocol reply; the MWA client surfaces this as a `CancellationException`.

### Why Pass-3 Detection-Based Fix Failed
The original fix branched on `connectedWalletPackage === 'app.backpack'`, which is only set when the user connects via the wallet-list UI's targeted intent. Via the OS wallet picker, `connectedWalletPackage` is empty — we cannot identify which wallet the user picked. Android provides no reliable API for post-hoc wallet-identity detection (`PackageManager.queryIntentActivities` only lists installed candidates; `ActivityManager.getRunningAppProcesses` is unreliable and restricted post-API-21; `UsageStatsManager` requires a sensitive permission). So detection-based branching cannot fix the OS-picker case.

### Fix — Default `signAndSendTransaction(s)` = sign via MWA + broadcast via Solana JSON-RPC
`MWAManager.signAndSendTransactions(txs, options)` (`assets/solana-mwa/scripts/MWAManager.ts`) always delegates to `_signAndBroadcastViaRpc(txs, options)`:

1. **Sign** — `this.signTransactions(txs)` via MWA. Backpack's `sign_transactions` handler is not affected by the bug. One wallet intent, one approval.
2. **Broadcast** — per signed tx, call `SolanaRpc.sendTransaction(signedBase64, { skipPreflight, preflightCommitment })` (`SolanaRpc.ts:115`, already existed). POSTs to `api.mainnet-beta.solana.com` (or devnet per `getAppIdentity().cluster`). Returns base58 signature.
3. **Emit** — `MWA_TRANSACTIONS_SENT` event; return signatures. Same contract as the native sign_and_send path.

Deterministic step logs (`STEP_0_ENTRY`, `STEP_1_MWA_SIGN_START/_DONE`, `STEP_2_DECODE[i]`, `STEP_3_RPC_SEND_START[i]/_DONE[i]`, `STEP_4_EMIT`, `DONE`) so any failure is locatable in logcat.

UX: one wallet approval, identical to native sign_and_send. RPC broadcast is server-to-server, no wallet interaction.

### Native MWA 2.0 Path Still Available (Advanced)
For callers who want to exercise MWA 2.0's native `sign_and_send_transactions` RPC directly:
- `MWAManager.signAndSendTransactionNative(tx)` / `signAndSendTransactionsNative(txs, options)`
- Will fail on Backpack (documented above).
- Not wired to any UI button — callable from code for spec-compliance demos.

### Pattern Source
This matches what Godot's `WalletAdapterAndroid` Node-level `signAndSendTransaction` has always done: sign via MWA, broadcast via the configured Solana RPC. The Godot community explicitly flagged a recent Kotlin-plugin-level `SignAndSendTransaction` native method as redundant precisely because the Node-level sign+RPC flow already works for all wallets.

### Files
- `assets/solana-mwa/scripts/MWAManager.ts` — `signAndSendTransactions` simplified to delegate universally; `signAndSendTransactionsNative` / `signAndSendTransactionNative` added for advanced use; `_signAndBroadcastViaRpc` enhanced with STEP logs; lazy `_rpc: SolanaRpc` + `_getRpc()` getter
- `assets/solana-mwa/scripts/SolanaRpc.ts` — `sendTransaction(signedTxBase64, {...})` at line 115 is the broadcast path, unchanged
- `native/engine/android/app/src/com/cocos/game/mwa/MWASessionManager.java` — `signAndSendTransactions` catch's `WALLET_HUNG` mapping still present (now only reachable via the Native method)
- `assets/demo/scripts/AppUI.ts` — `_onSignAndSend` uses the default path; WALLET_HUNG UI branch removed (unreachable in default flow), WALLET_CRASHED and RPC_BROADCAST_FAILED branches retained

### Sign+RPC Serialization Gotcha
The Pass-5 helper `_signAndBroadcastViaRpc` initially forwarded the signed-tx `Uint8Array` returned by `MWAManager.signTransactions()` directly into `SolanaRpc.sendTransaction(...)`. Solana's `sendTransaction` JSON-RPC expects the first param to be a **base64 string**, not bytes. Because JSON serializes a raw `Uint8Array` as a map (`{"0":1,"1":2,…}`), mainnet-beta responded with:

```
[SolanaRpc] _call | RPC_ERROR method=sendTransaction code=-32602 message="Invalid params: invalid type: map, expected a string."
[MWAManager] _signAndBroadcastViaRpc | STEP_3_RPC_SEND_FAIL[0] RPC returned empty signature rpc_elapsed_ms=76
```

The smoking-gun log was `STEP_2_DECODE[0] base64_len=203` — that was the raw-byte length of the signed tx; a real base64 string for a 203-byte tx would be ~272 chars.

**Fix (one-liner).** Encode to base64 before the RPC call:
```ts
// Before:
const signedBase64 = signed[i];                            // Uint8Array — wrong
// After:
const signedBase64 = this._uint8ArrayToBase64(signed[i]);  // base64 string — correct
```
The old `STEP_2_DECODE` log was renamed to `STEP_2_ENCODE` and now reports both `raw_bytes=` and `base64_len=` so the encoding is visibly correct in logcat (base64_len ≈ 4/3 × raw_bytes).

### Verification
- Any wallet via OS picker → Sign & Send → one approval → tx lands on-chain. Log sequence:
  ```
  signAndSendTransactions | START (default sign+RPC path)
  _signAndBroadcastViaRpc | STEP_0_ENTRY tx_count=1 …
  _signAndBroadcastViaRpc | STEP_1_MWA_SIGN_START
  signTransactions | SUCCESS signed_count=1
  _signAndBroadcastViaRpc | STEP_1_MWA_SIGN_DONE
  _signAndBroadcastViaRpc | STEP_2_ENCODE[0] raw_bytes=203 base64_len=272
  _signAndBroadcastViaRpc | STEP_3_RPC_SEND_START[0] rpc_url=https://api.mainnet-beta.solana.com …
  [SolanaRpc] sendTransaction | SUCCESS signature=…
  _signAndBroadcastViaRpc | STEP_3_RPC_SEND_DONE[0] sig_base58=…
  _signAndBroadcastViaRpc | DONE total_elapsed_ms=…
  ```
  UI toast: "Transaction Sent!"
- No `CancellationException`, no 19-second hang, no `RPC_ERROR code=-32602`.

---

## Issue #10: Phantom Blocks Phishing-Shaped Sign Messages (Blowfish) — Superseded by Issue #11

**Status:** Misdiagnosis. Pass 6 attributed Phantom's delete-hang to Blowfish content filtering and shipped a CAIP-122 SIWS-format signMessage gate. Pass-7 testing proved the real cause was simpler and worse: Phantom's MWA Android implementation doesn't declare `sign_messages` support at all (see Issue #11). Blowfish is real for web-based sign requests but was NOT what was blocking Cocos on Android — the wallet's `get_capabilities` response is the authoritative signal, and neither Phantom nor Solflare advertises sign_messages support, which is why the RPC silently hangs or the WebSocket closes. See Issue #11 for the definitive fix (route delete through `sign_transactions` with a memo-only throwaway tx; gate the Sign Message button on capabilities + a static known-bad wallet-package map).

The material below is retained for historical accuracy and because Blowfish IS a real mechanism that applies to other contexts (Phantom web/browser-extension flows), just not the Android MWA sign_messages path our SDK was hitting.

**Severity:** Was mistakenly High (feature unusable on Phantom); real cause is Issue #11.
**Affects:** Phantom Mobile Message-Simulation content filter for web/extension contexts. NOT the root cause of the observed Cocos/Godot/Unity sign_messages failures on Android — that's Issue #11.

### Symptom (Before Fix)
Connect Phantom → tap Delete Account → Phantom opens and shows an approve prompt → user taps Approve → **nothing happens on the dApp side**. The sign response never arrives. After ~90 s the MWA client's internal `JsonRpc20Client` times out with:
```
signAndDeauthorize | EXECUTION_ERROR cause=TimeoutException msg="Timed out waiting for response with id=2"
```
Where `id=2` is the `signMessagesDetached` RPC (following the `id=1` reauthorize).

### Why It Happens (Evidence-Backed)
Phantom's **Message Simulation** (powered by Blowfish, see [Phantom blog: Introducing Message Simulation](https://phantom.com/learn/blog/message-simulation)) decodes every sign-message request and **blocks messages deemed to be scams**. Quote from Phantom's blog: *"Warns you about messages with context about their severity BEFORE you sign. Blocks messages deemed to be scams by @blowfishxyz."*

The confirmation text we were sending (`"Confirm account deletion for <app>"`) is exactly the shape Blowfish flags: unsolicited sign request, scary account-loss language, and an app identity with no reputation (`example.com`/`MWA Example App`). When Blowfish blocks a request, the user may still see an approve UI but the response doesn't make it back to the dApp. Documented user reports of the same block-and-hang symptom:
- [Phantom discussion #331: "Request Blocked — We believe this transaction is malicious"](https://github.com/orgs/phantom/discussions/331)
- [Phantom discussion #426: "dApp Request Blocked - dApp May Be Malicious"](https://github.com/orgs/phantom/discussions/426)

Identical behavior observed across Cocos (`"Confirm account deletion for Cocos MWA Example"`), Godot (`sign_text_message("Confirm account deletion for MWA Example App")`), and Unity (`SignMessage("Confirm account deletion for MWA Example App")`). Not a compound/protocol issue — plain `signMessage` with benign content (e.g. `"Hello from Cocos MWA SDK!"`) works fine on Phantom in all three SDKs, and plain `signMessage` is also the path used by the Home screen Sign Message button in our own build.

The MWA spec (`solana-mobile/mobile-wallet-adapter/spec/spec.md`) explicitly permits multiple privileged requests per transact session and contains no wallet-specific rules — so the original Cocos `sign_and_deauthorize` compound was spec-compliant. Phantom's Blowfish layer is a wallet-UX policy layered on top, operating on **message content**, not protocol shape.

### Fix — Delete is Gated by `signMessage` with a SIWS-Format Benign Text
User requirement: delete must require real user intent (a wallet approval), not a client-only wipe. Pass 5 over-corrected to client-only; the correct solution is to route through the plain-signMessage path that already works on Phantom, with wording crafted to not trip Blowfish.

`MWAManager.deleteAccount()`:
1. Build a CAIP-122 SIWS-style confirmation message (`_buildDeleteConfirmationMessage(pubkey)`):
   ```
   <domain> wants you to sign in with your Solana account:
   <base58-pubkey>

   Confirm wallet ownership to remove cached session for <appName>.

   URI: <app_uri>
   Version: 1
   Nonce: <random 16 chars>
   Issued At: <ISO 8601>
   ```
   Statement deliberately avoids "delete/account/deletion" wording. "Confirm wallet ownership to remove cached session" is ownership-proof framing — which is the actual intent.
2. Call `this.signMessage(siwsText)` — the same, working signMessage path the Home screen uses.
3. If a signature returns (non-empty string) → proceed with local clear: `_deletedPubkeys.add(oldPubkey)`, null in-memory state, `_cache.clearAll()`, emit `MWA_DISCONNECTED`, status "Account deleted".
4. If sign returns empty (user cancel / `WALLET_CRASHED`) → status "Delete cancelled — confirmation required", state untouched. `lastError` preserved from `signMessage` so AppUI can still branch on `WALLET_CRASHED` and friends.

**No `deauthorize` RPC** — consistent with React Native `useMobileWallet.disconnect()`, Unity `Logout()`, and Godot `clearStateFullReset()`. The wallet-side auth_token is orphaned (standard practice across the ecosystem); the `_deletedPubkeys` set blocks cached reconnect to the deleted key in this process.

Java `signAndDeauthorize` is retained for advanced callers; the default delete flow no longer invokes it.

### Files
- `assets/solana-mwa/scripts/MWAManager.ts` — `deleteAccount()` rewritten to gate on `this.signMessage(siwsText)` and only clear local state on success. `_buildDeleteConfirmationMessage`, `_extractDomain`, `_generateNonce` helpers added.
- `native/engine/android/app/src/com/cocos/game/mwa/MWASessionManager.java` — `signAndDeauthorize` method intentionally retained for advanced callers; not invoked by the default delete flow.
- `assets/demo/scripts/AppUI.ts` — `_onDelete` unchanged. `deleteAccount()` now returns with `isConnected=false` on confirmed delete or `isConnected=true` on sign-cancel; existing toast branches cover both.

### Verification (historical — Pass 6)
The Pass-6 verification steps are no longer representative. See Issue #11 for the current `sign_transactions`-gated delete path and its verification.

---

## Issue #11: Phantom and Solflare Don't Implement `sign_messages` on Android MWA

**Status:** Fixed. Delete is now gated through `sign_transactions` (which every wallet we target implements) using a memo-only throwaway transaction. The Sign Message button is hidden on known-no-support wallets via a static package map. Java error-mapping gained a truthful `WALLET_HUNG` code for timeouts that used to be mislabeled `USER_REJECTED`.
**Severity:** Was High — delete feature hung on Phantom and Solflare. Sign Message button also hung or returned misleading "user rejected" toasts.
**Affects:** Phantom Mobile (`app.phantom`), Solflare Mobile (`com.solflare.mobile`). Likely the same for any wallet whose `get_capabilities` feature list omits a sign_messages variant. Backpack, Jupiter, Seed Vault behaviour depends on their individual capability declarations.

### Evidence — Wallet Capability Logs

**Phantom Mobile** via OS picker (04-18 03:41:33.958):
```
[MWASessionManager] getCapabilities | SUCCESS max_txs=10 max_msgs=1 versions=["legacy","0"] features=["supports_sign_and_send_transactions"]
```

**Solflare Mobile** via OS picker (04-18 03:38:28.993):
```
[MWASessionManager] getCapabilities | SUCCESS max_txs=20 max_msgs=20 versions=["legacy","0"] features=["solana:signTransactions"]
```

Neither wallet declares `solana:signMessages` (MWA 2.0 CAIP feature name) nor `supports_sign_messages` (MWA 1.x name). Per the MWA spec's `get_capabilities` contract, the `features[]` array is the authoritative list of implemented methods. `max_msgs` (e.g. Phantom's `1`, Solflare's `20`) is an advisory per-batch ceiling, not a support flag — it's meaningless for whether the handler exists.

### Symptoms (Before Fix)

**Phantom** — sign_messages RPC sent → wallet opens → user approves → one of two failure modes:
1. Full 90-second hang, then MWA client lib internal timeout surfaces as `ExecutionException(cause=TimeoutException)`:
   ```
   [MWASessionManager] signMessages | EXECUTION_ERROR cause=TimeoutException msg="Timed out waiting for response with id=2"
   [MWABridgePlugin] sendError | code=USER_REJECTED   ← WRONG mapping
   ```
   Pre-Pass-7 the Java catch ladder fell through to a generic `USER_REJECTED` branch on any non-null-cause ExecutionException, lying to the caller.
2. ~7-second WebSocket close without reply, surfaced as `CancellationException msg=null`:
   ```
   [MWASessionManager] signMessages | EXCEPTION class=CancellationException msg=null
   [MWABridgePlugin] sendError | code=WALLET_CRASHED
   ```

**Solflare** — same ~7-second `CancellationException msg=null` pattern. The wallet has no handler, so it closes the socket shortly after receiving the method.

### Fix

**A. Delete via `sign_transactions` (memo-only, no broadcast)** — `MWAManager.deleteAccount()` now fetches a fresh blockhash, calls `TransactionBuilder.buildMemoTransaction(pubkey, memoText, blockhash)` with ownership-proof wording (`"<appName>: wallet ownership proof, nonce=<16 chars>"`), and hands that to `signTransactions([memoTx])`. The wallet shows "This program will write a memo: <text>" in its preview UI; user approves; we proceed with local clear on success. **The signed tx is never broadcast** — we only want the signature as ownership proof, so no lamports are spent and no memo actually hits chain. Both Phantom and Solflare — and every other wallet we've tested — implement `sign_transactions` cleanly.

**B. Capability-gated Sign Message button** — `MWAManager.supportsSignMessages()` returns `false` when either:
1. A `_cachedCapabilities` response exists (from an explicit `getCapabilities()` call earlier in the session) and its `features[]` omits all sign_messages variants, OR
2. `connectedWalletPackage` is in the static `_KNOWN_NO_SIGN_MESSAGES` set (`app.phantom`, `com.solflare.mobile`).

Otherwise returns `true` optimistically — unknown wallets (including OS-picker connections with empty package) still see the button; if the call fails, they get a truthful `WALLET_HUNG` toast instead of a silent hang. `AppUI._showHome()` sets `SignMessageButton.active = false` when the gate returns false and logs the reason. `MWAManager.signMessage()` also does an early-return with `lastError.code = 'UNSUPPORTED'` as belt-and-suspenders for any direct SDK callers.

We deliberately DO NOT proactively call `get_capabilities` after authorize/reauthorize — doing so would open a second wallet intent, breaking the "cached reconnect = instant" UX contract without materially improving detection (the static package map already covers the two known-bad wallets).

**C. Java bounded timeouts + fixed error mapping** — new constant `SIGN_TIMEOUT_MS = 45_000L` (`MWASessionManager.java:47`). Applied to `.get()` on `client.signMessagesDetached`, `client.signTransactions`, `client.signAndSendTransactions`, and each method's preceding `client.reauthorize` call. Catch ladders updated:
- `TimeoutException` (from our bounded `.get()`) → `WALLET_HUNG` with a long, truthful toast message ("Wallet did not respond in time — this wallet may not support …").
- `ExecutionException` with `cause instanceof TimeoutException` (the MWA client lib's internal timeout, the actual symptom we saw in the 90-second hang) → `WALLET_HUNG`, NOT `USER_REJECTED` as before.
- `ExecutionException` with `cause instanceof CancellationException` or direct `CancellationException` → `WALLET_HUNG` (wallet closed socket).
- `ExecutionException` with `cause == null` → `WALLET_CRASHED` (unchanged; this is the Solflare-crash pattern).
- Generic `ExecutionException` with a real message → `WALLET_ERROR`, OR `USER_REJECTED` only when the message contains "reject", "declin", or "cancel". The prior unconditional `USER_REJECTED` fallback was the bug.

Heartbeat logs (`STEP_RPC_AWAIT_START timeout=…ms`, `STEP_RPC_AWAIT_DONE elapsed_ms=…`) now bracket each bounded `.get()` so logcat makes hang duration visible instead of a silent gap.

**D. AppUI toast branches** — `_onSignMessage`, `_onSignAndSend`, `_onDelete` each gained a `WALLET_HUNG` branch that shows a long-duration truthful toast ("Wallet didn't respond — may not support this operation. Try Backpack or Jupiter."). `_onSignMessage` also added an `UNSUPPORTED` branch (from the early-return in signMessage) for wallets flagged by the static known-bad map.

### Pass 10 cross-reference — SIWS fallback reuses `_KNOWN_NO_SIGN_MESSAGES`

Pass 10 wires `MWAManager.authorize()` through `authorizeSiws()` whenever `setSiwsIdentity({ domain, statement })` has been configured (DemoAppConfig enables this). The SIWS flow's `sign_messages` fallback — used by wallets that don't return a native `signInResult` — would hang on Phantom and Solflare for the full 45 s `SIGN_TIMEOUT_MS` without extra protection. Two guards are in place:

1. If `connectedWalletPackage` is populated and in `_KNOWN_NO_SIGN_MESSAGES` (the same set documented above — `app.phantom`, `com.solflare.mobile`), the fallback is short-circuited immediately with `SIWS_FALLBACK_SKIPPED reason=known_no_sign_messages`.
2. For OS-picker connections (where `connectedWalletPackage` is empty), the fallback is wrapped in a JS-level `Promise.race` timeout — `SIWS_FALLBACK_TIMEOUT_MS = 15_000` inside `authorizeSiws()`. Phantom/Solflare degrade gracefully to an authorize-only session inside ~15 s and the user sees a "Connected" toast instead of a hung app; Backpack never reaches this code path (native `signInResult` returned from authorize), and Jupiter / Seed Vault typically succeed within a few seconds.

This means the Sign Message button gating (hidden on known-no-sign_messages wallets), the Delete Account flow (routed through `sign_transactions` regardless), AND the SIWS fallback all consume the same `_KNOWN_NO_SIGN_MESSAGES` constant — one source of truth.

### Files

- `assets/solana-mwa/scripts/MWAManager.ts`
  - `deleteAccount()` — rewritten to build memo tx + call `signTransactions`; no broadcast.
  - `_cachedCapabilities` field, `supportsSignMessages()`, `_KNOWN_NO_SIGN_MESSAGES` static set.
  - `signMessage()` — early-return with `UNSUPPORTED` when gate says false.
  - Capability response stored into `_cachedCapabilities` inside `getCapabilities()`.
  - Pass-6 SIWS helpers (`_buildDeleteConfirmationMessage`, `_extractDomain`) removed; `_generateNonce` kept for memo nonce.
  - `authorize()` delegates to `authorizeSiws()` when `getSiwsIdentity().domain` is set (Pass 10).
  - `authorizeSiws()` SIWS fallback gated by `_KNOWN_NO_SIGN_MESSAGES` + 15 s JS-level timeout (Pass 10).
  - Imports `buildMemoTransaction` from `TransactionBuilder.ts`.
- `assets/demo/scripts/AppUI.ts`
  - `_showHome()` — hides `SignMessageButton` when gate returns false.
  - `_onSignMessage`, `_onSignAndSend`, `_onDelete` — added `WALLET_HUNG` (and `UNSUPPORTED` for sign message) toast branches.
  - `_onConnect` — branches toast on `signInResult` presence ("Signed in with Solana" vs "Connected") (Pass 10).
- `native/engine/android/app/src/com/cocos/game/mwa/MWASessionManager.java`
  - `SIGN_TIMEOUT_MS = 45_000L` constant.
  - `signMessages`, `signTransactions`, `signAndSendTransactions` — bounded `.get()` + heartbeat logs + fixed catch ladders.
- `KNOWN_ISSUES.md` — Issue #10 annotated as superseded; this Issue #11 documents the real cause and fix.

### Verification

1. **Phantom connect → Home** — `[AppUI] _showHome | hiding SignMessageButton — wallet doesn't declare sign_messages support (pkg="app.phantom")`. Sign Message button not visible.
2. **Phantom → Delete Account → approve sign_transactions** — logcat:
   ```
   deleteAccount | START (signTransactions-gated, memo-only)
   SolanaRpc getLatestBlockhash | SUCCESS blockhash=…
   deleteAccount | memo_tx_bytes=… memo="Cocos MWA Example: wallet ownership proof, nonce=…"
   signTransactions | STEP_RPC_AWAIT_START tx_count=1 timeout=45000ms
   signTransactions | STEP_RPC_AWAIT_DONE elapsed_ms=…
   signTransactions | SUCCESS signed_count=1
   deleteAccount | CONFIRMED signed_bytes=… — clearing local state (no broadcast)
   deleteAccount | DONE
   ```
   Toast: "Account deleted". Landing panel with cache cleared. The signed memo tx is never broadcast — no lamports spent.
3. **Phantom → Delete Account → reject** — `signTransactions` returns empty; delete stays cancelled with state intact; toast "Delete cancelled — confirmation required".
4. **Solflare** — Sign Message button hidden; Delete via `sign_transactions` works end-to-end.
5. **Unknown wallet via OS picker** — Sign Message button visible (optimistic). If sign_messages hangs, after 45s the bounded timeout fires and the UI shows the `WALLET_HUNG` toast, not a silent hang or a misleading "user rejected".
6. **Regression checks** — Sign Transaction / Sign & Send on Solflare, Backpack, Phantom all continue to work. Backpack sign+send RPC uses the Pass-6 base64 fix (`STEP_2_ENCODE[0] raw_bytes=… base64_len=…`).

> **Note on Phantom transaction warnings:** with the demo's default placeholder identity, Phantom's Blowfish may show "this app may be malicious" modals before the approve screen. That's a wallet-UX reputation gate on the dApp identity — not a problem with this flow. See Issue #12 for root cause and how to eliminate it.

---

## Issue #12: Phantom Shows Blowfish Transaction-Warning Modals on the Default Demo Identity

**Status:** Partially mitigated in the demo (identity now uses a real repo URL). Pass 8 briefly flipped the default cluster to devnet to lower Blowfish's risk threshold, but Pass 11 reverted that because Backpack's MWA implementation rejects devnet with a "network not supported" toast and never replies (90 s id=1 timeout inside the Kotlin client), and Jupiter's Seeker integration is mainnet-only. **The devnet-as-a-workaround approach is no longer recommended** — it trades Phantom warning modals (cosmetic) for Backpack + Jupiter Connect being entirely broken (blocking). Phantom warnings can only be fully eliminated by registering the dApp with Phantom's verification program.
**Severity:** Cosmetic for a demo; potentially User-facing for production dApps that haven't done Phantom dApp verification.
**Affects:** Phantom Mobile exclusively. Solflare, Backpack, Jupiter, Seed Vault do not run Blowfish-style reputation checks on incoming MWA transactions.

### Symptom

Connect Phantom → tap **Sign Transaction** (or **Sign & Send**, or the Pass-7 memo-tx **Delete Account**) → before the usual approve screen, Phantom displays one or more red/orange warning modals such as *"We believe this transaction is malicious"* or *"This app is unverified"*. The user has to tap past them before reaching Approve. Logcat shows the sign took dramatically longer than the same flow on Solflare:

```
[MWASessionManager] signTransactions | STEP_RPC_AWAIT_DONE elapsed_ms=54674     ← Phantom, user dismissing warnings
[MWASessionManager] signTransactions | STEP_RPC_AWAIT_DONE elapsed_ms=8154      ← Solflare, same tx, same user, same moment — no warnings
```

The memo content does not affect this — both the innocuous `"Hello from Cocos Creator MWA SDK!"` (unchanged since early builds) and the Pass-7 `"Cocos MWA SDK Demo: wallet ownership proof, nonce=…"` trigger the same warning cascade. Swapping transaction content does nothing.

### Root cause (evidence-backed)

Phantom runs [Blowfish](https://phantom.com/learn/blog/message-simulation) — an on-device + remote reputation / transaction-simulation layer — on every sign request. Before showing the approve screen it scores the originating dApp and the transaction payload. If the **dApp identity** doesn't pass the reputation threshold, Phantom stacks warning modals ahead of the approve screen regardless of how benign the actual payload is.

The demo's original identity triggered every heuristic:

| Signal | Original value | Why Blowfish flagged it |
|---|---|---|
| `appUri` | `https://example.com` | IANA-reserved placeholder domain, no dApp manifest, zero reputation |
| `appName` | `Cocos MWA Example` | Contains the word "Example" — reads like a template/scam-kit |
| `cluster` | `mainnet-beta` | Blowfish uses a stricter threshold on mainnet than on devnet. **Pass 8 tried devnet as a workaround → broke Backpack + Jupiter → Pass 11 reverted. Cluster is not a real lever here.** |
| Verification status | Unregistered | Not on Phantom's dApp allowlist |

Solflare doesn't run a reputation layer like Blowfish, so its approve screen is unconditional — hence the "works fine on Solflare, hostile on Phantom" asymmetry.

**Why did warnings not appear in earlier test runs of this same codebase?** Phantom progressively tightens Blowfish thresholds through app updates and remote rule changes, independent of our code. See [Phantom discussion #331](https://github.com/orgs/phantom/discussions/331), [#426](https://github.com/orgs/phantom/discussions/426), and the ongoing "transaction blocked" series in their discussions board. A build that previously passed can start warning after a Phantom-side rule update. This means you may see the warnings only on certain Phantom versions / regions / times.

### Fix in the Cocos demo (SDK-side mitigations)

Updated `assets/demo/scripts/DemoAppConfig.ts`:

```ts
const identity = {
    appName: 'Cocos MWA SDK Demo',                                       // was "Cocos MWA Example"
    appUri:  'https://github.com/mstevens843/Cocos-Solana-MWA-SDK',      // was "https://example.com"
    appIconPath: '/icon.png',
    cluster: 'mainnet-beta' as const,                                    // Pass 8 tried 'devnet'; Pass 11 reverted (see below)
};
```

- `github.com` has real domain reputation; not a flagged placeholder.
- Name reads as a developer tool, not a template.

**Pass 11 note — devnet is not a workaround.** Pass 8 tried flipping `cluster` to `'devnet'` to land Phantom's Blowfish at its lower risk threshold. Pass 11 reverted that because:
- **Backpack** returns "network not supported: devnet" and never replies, causing a 90 s internal timeout in the Kotlin client on every Connect attempt.
- **Jupiter's Seeker integration** is mainnet-only.

Both are blocking failures on their respective wallets. Phantom warning modals are cosmetic by comparison — the correct fix is dApp verification, not a cluster change.

**These identity changes reduce Phantom's warning cascade significantly but do not guarantee zero warnings.** Only Phantom-side dApp verification does that.

### For production SDK consumers

If you're shipping a game / dApp built on this SDK and want to eliminate Phantom's warning modals for your users:

1. **Set your own identity** at startup, BEFORE MWAManager is touched:
   ```ts
   import { setAppIdentity } from 'solana-mwa/AppIdentity';
   setAppIdentity({
       appName:   'Your App Name',                 // your real name
       appUri:    'https://your-real-domain.com',  // domain you actually own
       appIconPath: '/your-icon.png',
       cluster:   'mainnet-beta',                  // when you're ready for real money
   });
   ```
2. **Get your domain registered with Phantom's dApp verification program.** This is a wallet-side allowlist Phantom maintains for known-good dApps. Verified dApps skip the Blowfish warning cascade. See Phantom's developer docs for the current submission process (their instructions move — check [phantom.com/learn/developers](https://phantom.com/learn/developers) and [docs.phantom.com](https://docs.phantom.com)).
3. **Serve a dApp manifest** at your `appUri` root so wallet-side security systems can validate your identity. The format is evolving (Solana Mobile references a dApp manifest spec); check current Solana Mobile documentation at [docs.solanamobile.com](https://docs.solanamobile.com).

### Files

- `assets/demo/scripts/DemoAppConfig.ts` — updated placeholder identity to a real repo URL. Pass 8 flipped `cluster` to `'devnet'`; Pass 11 reverted to `'mainnet-beta'` because devnet broke Backpack + Jupiter Connect entirely.
- `KNOWN_ISSUES.md` — this Issue #12 (see also Issue #16 for the in-session SIWS fallback architecture that runs on mainnet).

### Verification

1. Rebuild TS only; reinstall.
2. Connect Phantom fresh. Authorize prompt should show "Cocos MWA SDK Demo" + the GitHub URL, not example.com.
3. Tap Sign Transaction. Expected: ≤1 lightweight advisory modal (or none) instead of the previous stacked warning cascade. `STEP_RPC_AWAIT_DONE elapsed_ms=` should be in the ~5-10s range, not ~54s.
4. Tap Delete Account. Same expectation.
5. Regression: Solflare, Backpack, Jupiter, Seed Vault continue to work exactly as they did pre-change — the identity shift doesn't affect wallets that don't run reputation gates.

---

## Issue #13: `InsufficientFundsForRent` on Sign & Send (Seed Vault / Phantom shared keypair)

**Status:** Not a code bug — funding issue. Pass 9 adds a pre-broadcast balance check and a specific `INSUFFICIENT_FUNDS_FOR_RENT` error code so the UI tells the user to fund the account instead of surfacing a generic "RPC rejected" toast.
**Severity:** Medium (user-confusing). The sign succeeded, the user saw the wallet approve, and then the transaction silently failed at RPC broadcast.
**Affects:** Any fee-payer with a balance below `rent_exempt_min + tx_fee + priority_fee_buffer` (~0.001 SOL). Particularly visible with Seed Vault because its Solflare-wrapper injects ComputeBudget priority-fee instructions that raise the required balance before the tx is sent for signing. Reproduces on Phantom when Phantom is using the Seed Vault secure element on Solana Seeker (same underlying keypair).

### Symptom

Connect Seed Vault (or Phantom, same Seeker keypair `7etjMSp87AUE135iW5dNeKridbW16rwSFVUN9ivfFm3w`) → tap Sign & Send → wallet opens, user approves → MWA returns a signed tx → RPC broadcast fails:

```
[SolanaRpc] _call | RPC_ERROR method=sendTransaction code=-32002
  message="Transaction simulation failed: Transaction results in an account (0) with insufficient funds for rent"
  data={"err":{"InsufficientFundsForRent":{"account_index":0}},...}
[MWAManager] _signAndBroadcastViaRpc | STEP_3_RPC_SEND_FAIL[0] RPC returned empty signature
Toast: "Sign succeeded but RPC broadcast was rejected"
```

Interestingly the signed tx returns larger than the unsigned tx we sent: unsigned `total_bytes=203`, signed `signedPayload[0] bytes=255` (+52 bytes). That's exactly one ComputeBudget `SetComputeUnitLimit` + one `SetComputeUnitPrice` instruction plus the extra program-id account reference — the wrapper injecting a priority fee before handing bytes to the secure element.

### Why it happens (evidence-backed)

- **Solana's rent-exempt minimum** for a zero-data System-owned account is `890,880 lamports` (~0.00089 SOL). A transaction that would drop the fee-payer below that threshold fails preflight with `InsufficientFundsForRent`. See [Solana accounts docs](https://solana.com/docs/core/accounts) and [QuickNode rent guide](https://www.quicknode.com/guides/solana-development/getting-started/understanding-rent-on-solana).
- **Seed Vault is not a full MWA wallet** — it's a signing-only secure element behind a Solflare-built wrapper. The Seed Vault blog post confirms this: ["Seed Vault Wallet is built on the Solflare wallet"](https://blog.solanamobile.com/post/seed-vault-wallet----solana-seekers-native-mobile-wallet). Its `get_capabilities` response correctly omits `solana:signAndSendTransaction` and lists only `solana:signTransactions` — the signing primitive.
- **The wrapper injects priority-fee instructions** before signing. Undocumented in the [seed-vault-sdk](https://github.com/solana-mobile/seed-vault-sdk) repo, but our empirical 52-byte signed-tx inflation is the fingerprint. Zero GitHub issues filed on this in the mobile-wallet-adapter or seed-vault-sdk repos.
- **The [MWA 2.0 spec](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html) is self-contradictory** on this point: `solana:signAndSendTransaction` is listed as a "mandatory feature" but the `sign_and_send_transactions` RPC method carries the note "*Implementation of this method by a wallet endpoint is optional.*" Wallets can claim the feature while implementing it as a wrapper around local signing + RPC broadcast. Seed Vault's capabilities reply is spec-compliant given this carve-out.
- **`skipPreflight: true` does NOT help** — Solana validators recheck rent at execution. The tx lands on-chain, fails at execution, and the fee is burned anyway. This is [explicitly discouraged](https://solana.com/docs/core/transactions#preflight) by Solana Mobile docs.

### Fix

Three changes in Pass 9, all in `assets/solana-mwa/scripts/MWAManager.ts` (+ the UI + the RPC client):

1. **`SolanaRpc.lastRpcError`** (`assets/solana-mwa/scripts/SolanaRpc.ts`) — new public field populated inside `_call` whenever the JSON-RPC endpoint returns an `error` object. Carries `{ code, message, data }` so callers can inspect the structured error payload without re-parsing log strings. Cleared at the start of every `_call`.
2. **Pre-broadcast balance check** in `_signAndBroadcastViaRpc` — call `rpc.getBalance(connectedPubkey)` before attempting the MWA sign. If `balance < 1_000_000 lamports` (covers rent + fee + priority-fee buffer), short-circuit with `lastError.code = 'INSUFFICIENT_FUNDS_FOR_RENT'` and return `[]`. No wallet intent opens, no confusing signed-but-rejected state. Log line: `STEP_PREFLIGHT_FAIL balance=<n> required=~1000000`.
3. **RPC error parse** at STEP_3 — if `rpc.sendTransaction` returns empty AND `rpc.lastRpcError.data.err` contains `InsufficientFundsForRent` (or `lastRpcError.message` mentions the same), map to `INSUFFICIENT_FUNDS_FOR_RENT` instead of the generic `RPC_BROADCAST_FAILED`. Catches the edge case where balance was JUST above the threshold at pre-check time but fell below after the wallet added priority fees.
4. **UI toast** — `AppUI._onSignAndSend` gains an `INSUFFICIENT_FUNDS_FOR_RENT` branch that shows a long-duration toast: "Fee-payer account underfunded — send ≥0.001 SOL and retry".

### Files

- `assets/solana-mwa/scripts/SolanaRpc.ts` — added `RpcLastError` interface, `lastRpcError` public field, populated inside `_call`.
- `assets/solana-mwa/scripts/MWAManager.ts` — `_signAndBroadcastViaRpc` pre-flight balance check + RPC error parse.
- `assets/demo/scripts/AppUI.ts` — `_onSignAndSend` toast branch.
- `KNOWN_ISSUES.md` — this Issue #13.

### Verification

1. **Underfunded account** — connect Phantom/Seed Vault with pubkey `7etj…Fm3w` at balance < 0.001 SOL. Tap Sign & Send. Expected: toast "Fee-payer account underfunded — send ≥0.001 SOL and retry" within ~1s. No wallet intent opens. Logcat: `STEP_PREFLIGHT_FAIL balance=<n> required=~1000000`.
2. **Fund the account** — send 0.01 SOL to `7etj…Fm3w` from a different wallet. Retry Sign & Send. Balance check passes, wallet opens, sign completes, tx lands on-chain.
3. **Regression: Backpack / Solflare / Jupiter** — with their funded test accounts (`EprBnDe9…`, `CT89vd7X…`, `5KsqXhGm…`), Sign & Send continues to work end-to-end on mainnet with no behaviour change.
4. **Edge-case: balance just above threshold, wallet adds priority fees that push it over** — rare, but covered by the Fix-B error-parse path. Toast message is the same; the pre-check log shows `STEP_PREFLIGHT_BALANCE_OK` but the post-RPC log shows `STEP_3_RPC_SEND_FAIL[0] INSUFFICIENT_FUNDS_FOR_RENT`.

---

## Issue #14: Jupiter Mobile `get_capabilities` Confirm Modal Renders Blank

**Status:** Wallet-side bug. No dApp-side fix. Documented so contributors don't waste cycles on it.
**Severity:** Cosmetic / Medium (user can still retrieve capabilities, but the UX is broken).
**Affects:** Jupiter Mobile wallet (`ag.jup.app`), `wallet_uri_base=https://jup.ag/solana-wallet-adapter`.

### Symptom

Connect Jupiter → tap Get Capabilities → Jupiter opens its own bottom-sheet confirm modal. The modal frame renders but the **content never loads** — no message, no Approve button, no Reject button. The user cannot interact with any button inside the modal. Tapping outside the modal dismisses it, and despite the missing UI, the RPC response still makes it back to the dApp correctly:

```
[MWASessionManager] getCapabilities | SUCCESS max_txs=5 max_msgs=1 versions=["legacy","0"]
  features=["solana:signTransactions","solana:signMessages","solana:signAndSendTransaction"]
[MWAManager] STATUS | Capabilities: max_txs=5 max_msgs=1
Toast: "Capabilities: max_txs=5"
```

### Why it happens (hypothesis)

Jupiter's native mobile wallet story is unusual. The public [TeamRaccoons/jup-mobile-adapter](https://github.com/TeamRaccoons/jup-mobile-adapter) is a WalletConnect/Reown *wrapper* — it bridges Jupiter's Reown-powered mobile UX to the MWA protocol. It's not a native-MWA-protocol wallet. That architectural mismatch likely explains the modal content failing to render — Jupiter's app code expects a different flow for read-only query RPCs than what MWA delivers. Per MWA spec, `get_capabilities` is a query that should not require user interaction at all, but Jupiter is showing a confirm modal anyway (and failing to populate it). Zero GitHub issues filed in `jup-ag/*` or `TeamRaccoons/*` mentioning this modal bug.

### Fix

None on our side. The RPC already returns data correctly, so the SDK surfaces the result to the caller regardless of the missing modal. Users workaround by tapping outside the modal — which is what they'd do anyway.

Filed under wallet-side tracking. If Jupiter ships a fix, this issue resolves automatically.

### Files

- `KNOWN_ISSUES.md` — this Issue #14. No code changes.

### Verification

Tap Get Capabilities on Jupiter → observe blank modal → tap outside to dismiss → observe toast `Capabilities: max_txs=5 max_msgs=1`. Same behaviour documented here — no dApp action required.

---

## Issue #15: Extensible Auth Cache — Cold-Start Auto-Sign-In

**Status:** New Pass-10 feature. `AppUI.start()` restores the user's signed-in session silently on cold start when `cache.hasAutoLoginAuth()` is true. Honours the Disconnect path by flipping the cached entry's `isAuthenticated` flag to `false`, so disconnect-then-kill-app lands the user on the Landing panel (same as today). No UI flow changes — just one more state transition on launch.
**Severity:** Feature. Not a bug.
**Affects:** All wallets. The auto-sign-in uses the same `reauthorize()` path as the Landing Reconnect button, so whatever worked there continues to work here.

### Behaviour matrix

| Scenario | After cold start | Toast |
|---|---|---|
| Fresh install, no cache | Landing, Connect only (no Reconnect button) | none |
| Connect → hard-close → relaunch | Home (auto-sign-in) | "Extensible auth cache — session restored" |
| Connect → Disconnect (stay in app) | Landing, Connect + Reconnect (cached) visible | "Disconnected" |
| Connect → Disconnect → hard-close → relaunch | Landing, Connect + Reconnect (cached) visible | none on launch |
| Connect → Delete Account | Landing, Connect only (cache wiped entirely) | "Account deleted" |
| Cold-start `reauthorize()` fails unexpectedly | Landing, Connect + Reconnect (cached) (cache still exists) | none on launch |

### Why (design)

- Before Pass 10 the cache kept `{ pubkey, authToken, walletUriBase, walletPackage, timestamp }` and `MWAManager.deauthorize()` cleared in-memory state without touching the cache. Cold-start decisions couldn't distinguish "hard-closed while signed in" from "disconnected then hard-closed" — both looked identical from the cache's perspective.
- Pass 10 adds `isAuthenticated: boolean` to `CachedAuth`. `AuthCache.set()` writes `true` on every successful authorize/reauthorize. `AuthCache.markDisconnected(pubkey)` flips the flag to `false` without deleting the entry so the Reconnect (cached) button continues to work. `AuthCache.hasAutoLoginAuth()` returns `true` iff the latest entry exists AND its `isAuthenticated !== false` (legacy `undefined` treated as `true` for pre-Pass-10 upgrade compatibility).
- `MWAManager.deauthorize()` now calls `this._cache.markDisconnected(oldPubkey)`. `MWAManager.reauthorize()` success path calls `this._cache.set(...)` again to flip the flag back to `true`.
- `AppUI.start()` checks `cache.hasAutoLoginAuth()`:
  - `true` → kick off `_attemptAutoSignIn()` which awaits `reauthorize()`; on success show Home + toast. On failure (null/exception) fall through to Landing.
  - `false` → existing Landing flow, unchanged.

### Files

- `assets/solana-mwa/scripts/MWATypes.ts` — `CachedAuth.isAuthenticated?: boolean`; `IMWAAuthCache.markDisconnected(pubkey)` + `hasAutoLoginAuth()` on the interface.
- `assets/solana-mwa/scripts/AuthCache.ts` — `set()` writes `isAuthenticated: true`; new `markDisconnected(pubkey)` + `hasAutoLoginAuth()` methods; legacy-entry tolerance in `hasAutoLoginAuth()`.
- `assets/solana-mwa/scripts/MWAManager.ts` — `deauthorize()` calls `markDisconnected`; `reauthorize()` re-writes cache on success.
- `assets/demo/scripts/AppUI.ts` — `start()` branches on `hasAutoLoginAuth()`; new `_attemptAutoSignIn()` helper.

### Verification

1. **Fresh install** — cold start → Landing, Connect only. Logcat: `start | AUTO_SIGN_IN_SKIP cache.hasAutoLoginAuth=false`.
2. **Connect → hard-close → relaunch** — force-stop from Settings → Apps → Force Stop (or Recents swipe). Relaunch: Home loads within 1-2 s. Logcat sequence: `AuthCache hasAutoLoginAuth | result=true`, `start | AUTO_SIGN_IN_CANDIDATE`, `reauthorize | SUCCESS (from cache)`, `_attemptAutoSignIn | SUCCESS`. Toast: "Extensible auth cache — session restored".
3. **Disconnect → hard-close → relaunch** — connect, Disconnect, verify Landing shows Connect + Reconnect, then force-stop and relaunch. Cold start lands on Landing with both buttons. Logcat: `AuthCache markDisconnected | DONE ... isAuthenticated=false` (from the disconnect), then on relaunch `AuthCache hasAutoLoginAuth | result=false isAuthenticated=false`, `start | AUTO_SIGN_IN_SKIP`. No auto-login.
4. **Reconnect from Landing** — from the post-Disconnect Landing, tap Reconnect. Logcat: `reauthorize | SUCCESS (from cache) cache_reauth_marked=true`. Hard-close + relaunch → auto-sign-in triggers (flag was flipped back).
5. **Delete Account** — auth cache wiped entirely via `clearAll()`. Cold start: Landing with Connect only, no Reconnect button.
6. **Backward compat** — pre-Pass-10 cache entries lack the `isAuthenticated` field. `hasAutoLoginAuth()` treats `undefined` as `true`, so users upgrading from a prior build are auto-signed-in on first cold start after upgrade. No one silently logs out.

> **Pass 11 note.** The demo default cluster is back on `mainnet-beta` (see Issue #12). Cold-start auto-sign-in now calls `reauthorize()` against a real mainnet wallet session rather than a devnet stub. Behaviour matrix above is unchanged; only the cluster the session is bound to changed.

---

## Issue #16: In-Session SIWS `sign_messages` Fallback (Single OS Wallet Picker)

**Status:** New Pass-11 architecture. Supersedes the Pass-10 JS-side SIWS fallback. `MWASessionManager.authorizeSiws()` on the Java side now performs **both** the `authorize` RPC and (when the wallet didn't return `sign_in_result` natively) the subsequent `sign_messages` RPC inside the **same** `LocalAssociationScenario`. Result: Android's OS wallet picker opens **once** regardless of whether the wallet supports MWA 2.0 `sign_in_payload` natively.
**Severity:** Feature + UX fix. The Pass-10 JS fallback worked functionally, but on Jupiter it produced a second OS wallet picker mid-flow because `signMessages()` opened a brand-new MWA scenario — unacceptable for a SIWS "straight-shot" UX.
**Affects:** Jupiter on every Connect. Any MWA 2.0 wallet that implements `authorize` + `sign_messages` but doesn't return `sign_in_result`. Transparent to Backpack / Seed Vault (native `sign_in_result`) and Phantom / Solflare (graceful-degrade path).

### Symptom (Pass 10 flow, now fixed)

Connect with Jupiter on Pass 10:

```
1. Tap Connect → OS wallet picker appears → tap Jupiter.
2. Jupiter's authorize screen → Approve → authorize succeeds (no sign_in_result in response).
3. JS fallback calls this.signMessages([messageBytes]) ← opens a NEW MWA scenario.
4. OS wallet picker appears AGAIN mid-Connect → user has to pick Jupiter a second time.
5. Jupiter's sign_messages screen → Approve → signature returned → toast "Signed in with Solana".
```

Two OS wallet pickers for a single SIWS Connect is jarring and breaks the "one tap, one flow" expectation that Unity/Godot set.

### Root cause

Pass 10 architecture split SIWS into two native bridge commands:
- `authorize_siws` → Java created `LocalAssociationScenario` #1, launched intent #1 (OS picker), ran `client.authorize(... signInPayload)`, closed the scenario.
- On a `signInResult == null` response, the JS layer in `MWAManager.authorizeSiws()` called `this.signMessages([caip122Bytes])` which invokes `sign_messages` → Java creates `LocalAssociationScenario` #2, launches intent #2 (OS picker), runs `client.signMessagesDetached(...)`.

Because each scenario is a distinct Android wallet-adapter association, Android opens a new wallet picker for the second intent. Unity and Godot avoid this by running both `authorize` and `sign_messages` inside a single scenario — Unity via `LocalAssociationScenario.StartAndExecute(List<Action>)` with two adapter actions (see `Runtime/codebase/SolanaMobileStack/SolanaMobileWalletAdapter.cs` `_Login`); Godot via the higher-level `walletAdapter.signIn(sender, payload)` convenience in `com.solanamobile:mobile-wallet-adapter-clientlib-ktx:2.0.3`.

### Fix — Pass 11

**Java** (`native/engine/android/app/src/com/cocos/game/mwa/MWASessionManager.java`):

- `authorizeSiws()` now handles the fallback inside the same `try`/`catch` that wraps `scenario.start()` + `client.authorize(...)`. When `authResult.signInResult == null` **and** a non-empty `siwsDomain` was supplied, it:
  1. Builds the CAIP-122 message inline using the real pubkey returned by `authorize` — nothing to pass down from JS (the Java side already has `siwsDomain`, `siwsStatement`, and `appUri`, and now also has the live `pubkey`).
  2. Calls `client.signMessagesDetached(new byte[][]{ messageBytes }, new byte[][]{ pubkeyBytes }).get(SIWS_FALLBACK_TIMEOUT_MS, TimeUnit.MILLISECONDS)` on the **same** `MobileWalletAdapterClient` handle.
  3. Extracts the 64-byte ed25519 signature from `signResult.messages[0].signatures[0]`, stamps the CAIP-122 bytes as `signedMessage`, and writes the `signInResult` JSON back into the response the bridge sends to TS.
- New constant `private static final long SIWS_FALLBACK_TIMEOUT_MS = 15_000L;` bounds the fallback `.get()` so wallets that don't implement `sign_messages` (Phantom, Solflare — KNOWN_ISSUES #11) degrade in ~15 s rather than hanging the full 45 s `SIGN_TIMEOUT_MS`.
- Timeout / cancellation / any other exception from `signMessagesDetached` is caught **inside** the transact scope and logged as `SIWS_FALLBACK_DEGRADED` — the authorize result is still returned, so the user ends up connected (authorize-only) with a valid auth token.
- Existing native path (wallet returned `sign_in_result`) is untouched.

**TypeScript** (`assets/solana-mwa/scripts/MWAManager.ts`):

- `authorizeSiws()` no longer implements the fallback in JS. The `STEP_5_SIWS_NULL` branch that built `messageBytes` and called `this.signMessages(...)` is removed, along with the `Promise.race` timeout and the `_KNOWN_NO_SIGN_MESSAGES` short-circuit.
- Connection state is committed **after** the authorize result is validated (the Pass-10 `STEP_4b_STATE_SET_PRE_FALLBACK` hack — needed so the JS fallback's `signMessages` call could see `isConnected=true` — is gone).
- TS now just reads `result.signInResult` from the bridge response; Java populates it in both the native and fallback cases, or omits it when the fallback degraded.

**Demo** (`assets/demo/scripts/DemoAppConfig.ts`):

- No SIWS changes here; still opts in via `setSiwsIdentity({ domain: 'github.com', statement: 'Sign in to Cocos MWA SDK Demo' })`. Pass 11 also reverted the `cluster` default to `'mainnet-beta'` — see Issue #12.

### Wallet expectations (after Pass 11)

| Wallet | authorize | sign_messages in-session | Result | OS pickers |
|---|---|---|---|---|
| Backpack | ✔ returns `sign_in_result` | (skipped) | Native SIWS signature | 1 |
| Seed Vault (Solflare-wrapper) | ✔ returns `sign_in_result` (when supported) OR no signInResult | in-session if needed | Native or fallback | 1 |
| Jupiter | ✔ authorize only | ✔ Jupiter signs `sign_messages` inside the same scenario | Fallback SIWS signature | **1** (was 2 pre-Pass-11) |
| Phantom | ✔ authorize only | ✘ no handler — 15 s Java timeout fires | Authorize-only session; no `signInResult` | 1 |
| Solflare | ✔ authorize only | ✘ no handler — 15 s Java timeout fires | Authorize-only session; no `signInResult` | 1 |

The "two wallet prompts" for Jupiter (one authorize approval, one sign_messages approval) remains — that's a wallet-UX issue, not an MWA scenario issue. What's fixed is the **second OS wallet picker** that used to appear between those two prompts.

### Pass 12 update — post-test matrix from real logs

A full five-wallet test pass (mainnet-beta, Seeker) on 2026-04-18 produced:

| Wallet | authorize time | signInResult | Fallback | Total | hasSiws | Outcome |
|---|---|---|---|---|---|---|
| Jupiter (`5Ksq…sDst`) | 5.5 s | null | `SIWS_FALLBACK_IN_SESSION_OK` sig=64 B, msg=191 B, 1.2 s | 6.7 s | yes | ✅ fallback signed |
| Backpack (`EprB…7hw4`) | 7.6 s | native (placeholder `publicKey=1111…111`) sig=64 B, msg=133 B | skipped | 7.6 s | yes | ✅ native |
| Seed Vault (`7etj…Fm3w`, `cofeelme.skr`) | 19.6 s | native sig=64 B, msg=133 B | skipped | 19.6 s | yes | ✅ native |
| Phantom (`7etj…Fm3w`, `phantom-wallet`) | 6.6 s | null | `SIWS_FALLBACK_DEGRADED reason=execution_error cause=c msg=-3/sign request declined elapsed_ms=3` | 6.6 s | no | ✅ graceful degrade |
| Solflare | — | — | — | 60 s JS bridge timeout → 98 s Java `TimeoutException` id=1 | — | ❌ **wallet app crashed on SIWS authorize** |

**Phantom's `-3/sign request declined` in 3 ms** is Phantom rejecting `sign_messages` at the RPC layer without prompting the user — faster than the full 15 s timeout would take. The graceful-degrade branch handles either outcome identically.

**Solflare can't do SIWS.** `authorize` with `signInPayload` hangs Solflare's MWA activity and never replies. Same wallet-side bug fingerprint as Issue #6 (`sign_messages` / `sign_and_deauthorize` crash). No client-side fix.

**Pass 12 disables SIWS on Connect in the demo by default.** A new `USE_SIWS_ON_CONNECT` flag in `assets/demo/scripts/DemoAppConfig.ts` (default `false`) gates the `setSiwsIdentity({ domain, statement })` call. With the flag off the demo calls plain `authorize` — works on all five wallets including Solflare. Flip to `true` to re-engage the Pass 11 SIWS path exactly as documented above. The SDK itself is unchanged; SDK consumers opt in by calling `setSiwsIdentity()` from their own app bootstrap.

### Known cosmetic log nits (non-blocking)

- Java `STEP_9_DONE` after a successful fallback prints `hasSiws=false` because the log evaluates `signInResult != null` (the native `authResult.signInResult` field) rather than the populated `sirJson`. The response JSON sent to TS is correct — JS logs `hasSiws=true` and the toast says "Signed in with Solana". Purely a native-log cosmetic.
- Backpack and Seed Vault (Solflare-wrapper) return `signInResult.publicKey=11111111111111111111111111111111` (all-zeros) in their native payload. The TS side uses the top-level `pubkey` for all state so this is harmless.

Both deferred — no rebuild planned until the next Java pass.

### Files

- `native/engine/android/app/src/com/cocos/game/mwa/MWASessionManager.java` — `authorizeSiws()` in-session fallback + `SIWS_FALLBACK_TIMEOUT_MS` constant (unchanged in Pass 12).
- `assets/solana-mwa/scripts/MWAManager.ts` — JS fallback block removed; state-set ordering cleaned up (unchanged in Pass 12).
- `assets/demo/scripts/DemoAppConfig.ts` — Pass 12 gates `setSiwsIdentity` behind `USE_SIWS_ON_CONNECT` flag (default `false`).

### Verification

1. **Rebuild native** — `rm -rf temp/ library/`, Cocos Creator Build → Make (Java changed).
2. **Backpack Connect (mainnet-beta)** — one OS picker → Backpack approve → toast "Signed in with Solana". Logcat: `authorizeSiws | STEP_7_SIWS_EXTRACTED`.
3. **Jupiter Connect** — one OS picker → Jupiter authorize → same scenario → Jupiter sign_messages → signature returned → toast "Signed in with Solana". Logcat: exactly one `STEP_1_SCENARIO_CREATED`, `SIWS_FALLBACK_IN_SESSION_START` + `SIWS_FALLBACK_IN_SESSION_OK`. No second `launchIntent | START`.
4. **Seed Vault Connect** — one OS picker → either native `signInResult` path (`STEP_7_SIWS_EXTRACTED`) or in-session fallback (`SIWS_FALLBACK_IN_SESSION_OK`). Either way, one OS picker.
5. **Phantom Connect** — one OS picker → Phantom authorize → in-session `signMessagesDetached` call → 15 s Java timeout → logcat `SIWS_FALLBACK_DEGRADED reason=timeout elapsed_ms≈15000` → scenario closes → authorize result returned → toast "Connected: …". No 90 s id=1 timeout.
6. **Solflare Connect** — same as Phantom: 15 s degrade inside the single scenario.
7. **Regression** — Sign Transaction / Sign & Send / Delete Account / Reauthorize / cold-start auto-sign-in (Issue #15) continue to work as Pass 7/9/10 documented.

### Exit criteria

- Jupiter Connect shows exactly **one** OS wallet picker.
- Backpack Connect succeeds on mainnet in < 10 s with a native SIWS signature.
- Phantom / Solflare Connect degrade to authorize-only in ≤ 20 s total (≤ 15 s Java timeout + ~5 s authorize), no hangs, one OS picker.
- All Pass 7/9/10 behaviours intact.

---

## Issue #17: Cached `authToken` + Empty `walletUriBase` + OS Picker = `-1/authorization request failed` on Privileged Operations

**Status:** **Pass 13 ships error classification** — the wrong-wallet case is now surfaced with a clear "Wrong wallet — use the wallet you connected with, or Disconnect and Connect again" toast on every privileged op (Sign Message / Sign Transaction / Sign & Send / Delete). Deep-link wallet targeting via cached `walletUriBase` remains deferred (see **Fix direction** below).
**Severity:** User-facing. Privileged ops (Sign Transaction, Sign & Send, Sign Message, Delete Account) fail opaquely when the user picks a different wallet from the one that issued the cached `authToken`.
**Affects:** Any Connect → Reconnect-from-cache → privileged-op sequence where the OS wallet picker is shown (no `walletUriBase` / no `targetPackage`) AND the user picks a wallet that isn't the original issuer.

### Symptom

Observed during the Pass-11 five-wallet SIWS test:

1. Connect **Phantom** → cache `{pubkey: 7etj…Fm3w, authToken: <Phantom 118-char>, walletPackage: (default), walletUriBase: (empty)}`.
2. Attempt Solflare SIWS Connect → Solflare's MWA activity crashed on approve (Issue #16 post-test note) → no new cache entry.
3. Tap **Reconnect (cached)** → `reauthorize()` restored Phantom's authToken into in-memory state (client-only cache restore, no wallet intent).
4. Tap **Delete Account** → `sign_transactions` bridge command → OS wallet picker opens (empty `walletUriBase`, so Android shows all installed wallets) → user picked **Solflare** → Solflare received Phantom's `authToken` on `reauthorize` → rejected:

```
[MWASessionManager] signTransactions | reauthorizing for privileged session token_len=118 timeout=45000ms
[MWASessionManager] signTransactions | EXECUTION_ERROR cause=c msg=-1/authorization request failed
[MWAManager] deleteAccount | CANCELLED signed_count=0 code=DELETE_CANCELLED message=User did not confirm — leaving state intact
[MWAManager] STATUS | Delete cancelled — confirmation required
```

The user-visible toast ("Delete cancelled — confirmation required") is misleading — the user DID confirm, but in the wrong wallet.

### Root cause

MWA auth tokens are wallet-specific. Spec-compliant wallets reject any `reauthorize` RPC carrying a token they didn't issue with JSON-RPC error code `-1` and message `authorization request failed`. The Cocos `AuthCache` persists `{ authToken, walletPackage, walletUriBase }` per-pubkey, but:

- On wallets that don't populate `walletUriBase` in their authorize response (Backpack, Phantom, Solflare, Seed Vault all return empty), there's no deep-link URI to feed back into the association intent. The association intent falls back to `solana-wallet:` — the generic OS wallet picker.
- `walletPackage` is only populated when the caller targets a wallet via one of the explicit `Connect <wallet>` buttons (empty on plain "Connect" which uses the OS picker).
- So the OS-picker path has no way to route the next intent back to the wallet that issued the token. The user picks, and if they pick wrong, the wallet correctly refuses.

This hits every privileged operation (`sign_transactions`, `sign_messages`, `sign_and_send_transactions`, deauthorize) — Delete is one instance of the class.

### Why it didn't surface pre-Pass-11

Before SIWS testing each Connect usually succeeded or failed cleanly: success wrote a cache entry for that wallet, failure wrote nothing. The user typically stayed on whichever wallet they just connected with. The Pass-11 test sequence specifically produced a state where:
- Phantom Connect succeeded (cache written)
- Solflare Connect crashed (cache NOT updated)
- User then tried Solflare again for Delete after a cache reconnect

That's the exact stale-token→wrong-wallet path.

### Not related to SIWS

The Delete flow is unchanged since Pass 7 — `MWAManager.deleteAccount()` builds a memo tx, calls `signTransactions([memoTx])` with the cached `authToken`, wipes the cache on success. No SIWS code runs. Flipping `USE_SIWS_ON_CONNECT = false` (Pass 12 default) does NOT fix this — it affects any Connect→Reconnect→pick-different-wallet sequence.

### Workarounds for users

- **Stay on the same wallet you connected with.** Connect Solflare → privileged ops pick Solflare in the picker.
- **Disconnect before switching wallets.** Disconnect clears in-memory state and flips `isAuthenticated=false`; next Connect issues a fresh `authToken` from the new wallet.
- **Delete Account after a fresh Connect, not after Reconnect (cached).** The fresh Connect's cache entry is guaranteed to match the wallet the user just picked.

### Fix direction

1. ~~**Detect `-1/authorization request failed` in the signTransactions / signMessages / signAndSend error handlers** and surface a user-facing toast~~ — **done in Pass 13**. Java classifies code=-1 as `WALLET_AUTH_MISMATCH`, TS maps it to a specific status message and toast in all four demo entry points (`_onSignMessage`, `_onSignTransaction`, `_onSignAndSend`, `_onDelete`).
2. **(Deferred) Persist every available targeting signal in the cache** (`walletUriBase` when returned, `walletPackage` when known) and prefer the deep-link path in `MWAIntentHelper.createAssociationIntent` whenever cache targeting is available. Wallets that return a `walletUriBase` (currently only Jupiter in our logs, `https://jup.ag/solana-wallet-adapter`) would get auto-routed without the OS picker showing at all — eliminating the wrong-wallet path entirely for that wallet. The other four wallets still rely on Pass 13's clear error toast.

### Pass 13 changelog

- `native/engine/android/app/src/com/cocos/game/mwa/MWASessionManager.java` — added `isAuthMismatch(Throwable)` + `AUTH_MISMATCH_MSG`; prepended a `WALLET_AUTH_MISMATCH` branch to the `ExecutionException` catches of `reauthorize`, `signAndDeauthorize`, `signMessages`, `signTransactions`, `signAndSendTransactions`. All other existing classifications preserved. Java rebuild required.
- `assets/solana-mwa/scripts/MWAManager.ts` — `signTransactions` now sets `this.lastError` so downstream `deleteAccount` can distinguish `WALLET_AUTH_MISMATCH` from the default `DELETE_CANCELLED`; all privileged-op catches branch status messages on the new code; `deleteAccount` surfaces the specific wrong-wallet message instead of "Delete cancelled — confirmation required".
- `assets/solana-mwa/scripts/MWATypes.ts` — `MWAError.code` jsdoc updated with the full set of canonical codes including `WALLET_AUTH_MISMATCH`.
- `assets/demo/scripts/AppUI.ts` — `_onSignMessage` / `_onSignTransaction` / `_onSignAndSend` / `_onDelete` each grew a `WALLET_AUTH_MISMATCH` branch firing the same "Wrong wallet — use the wallet you connected with, or Disconnect and Connect again" toast, then re-enables the Home buttons so the user can retry.

### Verification (post-Pass-13)

1. **Rebuild native** — `rm -rf temp/ library/`, Cocos Creator → Build → Make (Java changed).
2. **Repro with the new clear toast:**
   - Connect Phantom (any mode). Cache entry created.
   - Disconnect → Reconnect (cached). State restored in memory, wallet untouched.
   - Tap Delete (or Sign Transaction, or Sign Message). OS wallet picker opens.
   - Pick **Solflare** or **Backpack** (anything but Phantom).
   - Expected logcat: `signTransactions | EXECUTION_ERROR cause=c msg=-1/authorization request failed` **followed by** `signTransactions | WALLET_AUTH_MISMATCH wallet rejected cached token (code=-1)`.
   - Expected JS log: `MWAManager signTransactions | EXCEPTION code=WALLET_AUTH_MISMATCH …`.
   - Expected UI: "Wrong wallet — use the wallet you connected with, or Disconnect and Connect again" toast. Home buttons re-enabled.
3. **Workaround still works:** Disconnect → Connect fresh with Solflare → retry Delete. Succeeds (the new `authToken` was issued by Solflare).
4. **Happy-path regression:** Connect and act on the same wallet (no wallet-switch) — existing Sign / Delete flows unchanged.
