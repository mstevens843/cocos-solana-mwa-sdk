# Wallet Adapters Implementation Plan

## Context

The Cocos MWA SDK currently connects via the generic `solana-wallet://` URI scheme, which triggers Android's default wallet picker. This works but provides no control over the UX. The goal is to build a polished wallet selection experience that:

1. **On Seeker/Saga devices:** Shows 2-tab Landing — "Connect via Seed Vault" (MWA default) and "Connect via Wallet" (individual wallet list)
2. **On non-Seeker devices:** Skips the tabs, goes directly to the wallet list showing installed wallets
3. Detects which wallets are installed (Phantom, Backpack, Solflare, Espresso Cash)
4. Lets users connect to a specific wallet by name, not through the generic OS picker

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│ TypeScript (AppUI.ts)                               │
│                                                     │
│  LandingPanel                                       │
│    ├── SeekerTabPanel (only on Seeker/Saga)         │
│    │     Tab 1: "Connect via Seed Vault"            │
│    │     Tab 2: "Connect via Wallet"                │
│    └── WalletListPanel                              │
│          ├── Phantom    [Connect]  (or [Install])   │
│          ├── Backpack   [Connect]  (or [Install])   │
│          ├── Solflare   [Connect]  (or [Install])   │
│          └── Espresso   [Connect]  (or [Install])   │
│                                                     │
│  ↕ MWABridge (JsbBridge)                            │
│                                                     │
│ Java (Native Android)                               │
│    ├── WalletDetector.java (NEW)                    │
│    │     - detectDevice() → {isSeeker, isSaga}      │
│    │     - detectWallets() → [{name, pkg, installed}]│
│    ├── MWABridgePlugin.java (MODIFY)                │
│    │     - New "detect_wallets" command              │
│    │     - New "detect_device" command               │
│    ├── MWAIntentHelper.java (MODIFY)                │
│    │     - Target specific wallet by package name    │
│    └── MWASessionManager.java (MODIFY)              │
│          - Accept targetPackage param on authorize   │
└─────────────────────────────────────────────────────┘
```

## Supported Wallets (MWA-Compatible)

All these wallets register for the `solana-wallet://` URI scheme and implement the MWA v1 protocol:

| Wallet | Android Package | Play Store ID | MWA | Deeplinks |
|--------|----------------|---------------|-----|-----------|
| Phantom | `app.phantom` | `app.phantom` | Yes | Yes |
| Backpack | `app.backpack` | `app.backpack` | Yes | Yes |
| Solflare | `com.solflare.mobile` | `com.solflare.mobile` | Yes | Yes |
| Espresso Cash | `com.pleasecrypto.flutter` | `com.pleasecrypto.flutter` | Yes | Unknown |

**NOT supported (no MWA):**
- Jupiter Mobile (`ag.jup.jupiter.android`) — Uses WalletConnect, not MWA. Would require a completely separate protocol implementation. Can be added later as an enhancement.

## Implementation Details

### Phase 1: Java — Wallet & Device Detection

#### File: `WalletDetector.java` (NEW)
**Path:** `native/engine/android/app/src/com/cocos/game/mwa/WalletDetector.java`

```java
package com.cocos.game.mwa;

/**
 * Detects installed Solana wallets and device type (Seeker/Saga vs generic Android).
 */
public class WalletDetector {

    // Known MWA-compatible wallets
    public static final String[][] KNOWN_WALLETS = {
        // {displayName, packageName, playStoreUrl}
        {"Phantom",       "app.phantom",               "https://play.google.com/store/apps/details?id=app.phantom"},
        {"Backpack",      "app.backpack",               "https://play.google.com/store/apps/details?id=app.backpack"},
        {"Solflare",      "com.solflare.mobile",        "https://play.google.com/store/apps/details?id=com.solflare.mobile"},
        {"Espresso Cash", "com.pleasecrypto.flutter",   "https://play.google.com/store/apps/details?id=com.pleasecrypto.flutter"},
    };

    /**
     * Detect which known wallets are installed.
     * Uses PackageManager.getPackageInfo() for each known wallet.
     *
     * @return JSONArray of {name, packageName, installed, storeUrl}
     */
    public static JSONArray detectInstalledWallets(Activity activity);

    /**
     * Detect if running on a Solana Mobile device (Seeker or Saga).
     * Checks Build.MANUFACTURER and Build.MODEL, plus whether the
     * Seed Vault service package is installed.
     *
     * Seeker: manufacturer="Solana Mobile", model contains "Seeker" or "Chapter2"
     * Saga: manufacturer="Solana Mobile", model contains "Saga"
     * Also check for: com.solanamobile.seedvault package
     *
     * @return JSONObject {isSeeker: bool, isSaga: bool, isSolanaMobile: bool, manufacturer: string, model: string}
     */
    public static JSONObject detectDevice();
}
```

**Device detection logic:**
```java
String manufacturer = Build.MANUFACTURER;  // "Solana Mobile" on Seeker/Saga
String model = Build.MODEL;               // Contains "Seeker", "Chapter2", or "Saga"

boolean isSolanaMobile = "Solana Mobile".equalsIgnoreCase(manufacturer);
boolean isSeedVaultInstalled = isPackageInstalled(activity, "com.solanamobile.seedvault");
boolean isSeeker = isSolanaMobile && (model.contains("Seeker") || model.contains("Chapter2"));
boolean isSaga = isSolanaMobile && model.contains("Saga");
```

**Wallet detection logic:**
```java
for (String[] wallet : KNOWN_WALLETS) {
    boolean installed = isPackageInstalled(activity, wallet[1]);
    // Add to results array
}

private static boolean isPackageInstalled(Activity activity, String packageName) {
    try {
        activity.getPackageManager().getPackageInfo(packageName, 0);
        return true;
    } catch (PackageManager.NameNotFoundException e) {
        return false;
    }
}
```

#### File: `MWABridgePlugin.java` (MODIFY)
Add two new commands to the switch statement in `handleCommand()`:

```java
case "detect_wallets":
    handleDetectWallets(requestId);
    break;

case "detect_device":
    handleDetectDevice(requestId);
    break;
```

Both are synchronous (no wallet interaction needed).

#### File: `MWAIntentHelper.java` (MODIFY)
Add method to target a specific wallet by package name:

```java
/**
 * Create MWA intent targeting a specific wallet app.
 * Uses Intent.setPackage() to bypass the OS wallet picker.
 */
public static Intent createTargetedAssociationIntent(
        LocalAssociationScenario scenario,
        String targetPackage) {
    Intent intent = createAssociationIntent(scenario, null);
    if (targetPackage != null && !targetPackage.isEmpty()) {
        intent.setPackage(targetPackage);
    }
    return intent;
}
```

#### File: `MWASessionManager.java` (MODIFY)
Update authorize methods to accept optional `targetPackage` parameter from params JSON:

```java
String targetPackage = params.optString("targetPackage", null);
// Use createTargetedAssociationIntent instead of createAssociationIntent when targetPackage is set
```

### Phase 2: TypeScript — Bridge Commands

#### File: `MWABridge.ts` (MODIFY — minor)
No structural changes needed — the existing `sendCommand()` method already supports arbitrary commands and params. The new `detect_wallets` and `detect_device` commands work through the existing protocol.

#### File: `MWAManager.ts` (MODIFY)
Add new public methods:

```typescript
/**
 * Detect which wallets are installed on the device.
 * @returns Array of {name, packageName, installed, storeUrl}
 */
async detectWallets(): Promise<WalletInfo[]> {
    const result = await this._bridge.sendCommand('detect_wallets', {});
    return result?.wallets ?? [];
}

/**
 * Detect if running on a Solana Mobile device (Seeker/Saga).
 * @returns {isSeeker, isSaga, isSolanaMobile, manufacturer, model}
 */
async detectDevice(): Promise<DeviceInfo> {
    const result = await this._bridge.sendCommand('detect_device', {});
    return result ?? { isSeeker: false, isSaga: false, isSolanaMobile: false };
}

/**
 * Authorize with a specific wallet (by package name).
 * @param targetPackage Android package name (e.g., "app.phantom")
 */
async authorizeWithWallet(targetPackage: string): Promise<AuthorizeResult | null> {
    // Same as authorize() but passes targetPackage in params
}
```

#### File: `MWATypes.ts` (MODIFY)
Add new types:

```typescript
export interface WalletInfo {
    name: string;
    packageName: string;
    installed: boolean;
    storeUrl: string;
}

export interface DeviceInfo {
    isSeeker: boolean;
    isSaga: boolean;
    isSolanaMobile: boolean;
    manufacturer: string;
    model: string;
}
```

### Phase 3: UI — Wallet Selection Flow

#### File: `AppUI.ts` (MODIFY)
The `start()` method needs to:
1. Call `detectDevice()` to determine if on Seeker/Saga
2. Call `detectWallets()` to get installed wallet list
3. Show appropriate UI:
   - **Seeker/Saga:** Show LandingPanel with 2 tabs (Seed Vault tab + Wallet tab)
   - **Non-Seeker:** Show LandingPanel with wallet list only (no tabs)

#### File: `generate-scenes.js` (MODIFY)
Update the Landing panel layout to include:

```
LandingPanel
├── TitleLabel ("Cocos MWA SDK")
├── SubtitleLabel ("Solana Mobile Wallet Adapter")
├── TabBar (hidden on non-Seeker)
│   ├── SeedVaultTab ("Seed Vault")
│   └── WalletTab ("Wallets")
├── SeedVaultPanel (shown when Seed Vault tab active)
│   ├── ConnectButton ("Connect via Seed Vault", blue)
│   ├── ReconnectButton ("Reconnect (Cached)", green)
│   └── StatusLabel
└── WalletListPanel (shown when Wallet tab active, or always on non-Seeker)
    ├── PhantomButton ("Phantom", purple #AB9FF2)
    ├── BackpackButton ("Backpack", coral #E33E3F)
    ├── SolflareButton ("Solflare", orange #FC9F22)
    ├── EspressoButton ("Espresso Cash", teal #2EC4B6)
    └── WalletStatusLabel
```

**Button states:**
- **Installed:** Full color button, tappable → fires `authorizeWithWallet(packageName)`
- **Not installed:** Dimmed button with "Install" text → opens Play Store URL via native intent

**Tab switching:** Same show/hide panel approach as Landing↔Home (avoids `director.loadScene`)

### Phase 4: Connection Flow per Wallet

When user taps a specific wallet button:
1. `AppUI` calls `MWAManager.authorizeWithWallet('app.phantom')` (or whichever wallet)
2. `MWAManager` sends `authorize_and_sign` command with `targetPackage: 'app.phantom'`
3. `MWABridgePlugin` dispatches to `MWASessionManager.authorizeAndSign(params, callback)`
4. `MWASessionManager` reads `targetPackage` from params
5. `MWAIntentHelper.createTargetedAssociationIntent(scenario, 'app.phantom')` creates intent with `intent.setPackage('app.phantom')`
6. Phantom opens directly (no OS picker), user approves
7. Authorization completes through existing MWA flow
8. `AppUI` switches to HomePanel

For Seed Vault tab: Uses existing flow (no `targetPackage` → OS picks Seed Vault on Seeker devices)

### Phase 5: Non-Seeker Flow

On non-Seeker devices:
1. `detectDevice()` returns `{isSeeker: false, isSaga: false, isSolanaMobile: false}`
2. `AppUI` hides the TabBar and SeedVaultPanel entirely
3. Shows WalletListPanel directly under the title/subtitle
4. User sees: Title → Subtitle → wallet buttons (Phantom, Backpack, Solflare, Espresso)
5. Only installed wallets are fully active; uninstalled show "Install" with Play Store link

### Phase 6: Play Store Install Flow

When user taps an uninstalled wallet:
1. Open the Play Store via Android intent:
   ```java
   Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(storeUrl));
   activity.startActivity(intent);
   ```
2. Add a new bridge command `open_url` or handle via `native.reflection.callStaticMethod`
3. After user returns from Play Store, the wallet list auto-refreshes on next `detectWallets()` call

## Files to Create

| File | Path | Purpose |
|------|------|---------|
| `WalletDetector.java` | `native/engine/android/app/src/com/cocos/game/mwa/` | Detect installed wallets + device type |

## Files to Modify

| File | Path | Changes |
|------|------|---------|
| `MWABridgePlugin.java` | `native/.../mwa/` | Add `detect_wallets`, `detect_device` commands |
| `MWAIntentHelper.java` | `native/.../mwa/` | Add `createTargetedAssociationIntent()` with package targeting |
| `MWASessionManager.java` | `native/.../mwa/` | Read `targetPackage` from params, use targeted intent |
| `MWAManager.ts` | `assets/solana-mwa/scripts/` | Add `detectWallets()`, `detectDevice()`, `authorizeWithWallet()` |
| `MWATypes.ts` | `assets/solana-mwa/scripts/` | Add `WalletInfo`, `DeviceInfo` types |
| `AppUI.ts` | `assets/demo/scripts/` | Tab switching logic, wallet list, device-based flow |
| `generate-scenes.js` | root | New TabBar, SeedVaultPanel, WalletListPanel nodes |

## Wallet Brand Colors (for buttons)

| Wallet | Primary Color | RGB |
|--------|--------------|-----|
| Phantom | Purple | (171, 159, 242) |
| Backpack | Coral Red | (227, 62, 63) |
| Solflare | Orange | (252, 159, 34) |
| Espresso Cash | Teal | (46, 196, 182) |
| Seed Vault (Seeker) | Green | (0, 210, 136) |

## Testing Checklist

### On Seeker/Saga Device
- [ ] App detects Seeker → shows 2-tab Landing
- [ ] "Seed Vault" tab → Connect button → Seed Vault opens (existing flow)
- [ ] "Wallets" tab → shows installed wallets with correct states
- [ ] Tapping installed wallet → that specific wallet opens (not OS picker)
- [ ] Tapping uninstalled wallet → Play Store opens
- [ ] After connecting via any wallet → HomePanel shows with full functionality
- [ ] All MWA operations work regardless of which wallet was used

### On Non-Seeker Android Device
- [ ] App detects non-Seeker → no tabs, direct wallet list
- [ ] Only installed wallets are active
- [ ] Tapping Phantom → Phantom opens directly via MWA
- [ ] Full authorize flow works through Phantom/Backpack/Solflare
- [ ] Reconnect/disconnect/delete work correctly

### Edge Cases
- [ ] No MWA wallets installed → all buttons show "Install", helpful message displayed
- [ ] Only Seed Vault installed (Seeker, no third-party) → Seed Vault tab works, wallet tab shows "Install" for all
- [ ] Multiple wallets installed → each button targets correct wallet
- [ ] Wallet installed after app launch → next `detectWallets()` picks it up

## Notes

- **Jupiter Mobile** is excluded because it does not support MWA. It uses WalletConnect which is a completely different protocol requiring a WebSocket relay server. Can be added as a future enhancement if there's demand.
- The deeplink protocol (Phantom/Backpack/Solflare `https://xxx.app/ul/v1/connect`) is NOT used. All connections go through MWA which provides a better UX (bidirectional session, no repeated app switches for multi-step operations). The deeplink protocol would be needed for iOS support in the future.
- All wallet detection happens through standard Android PackageManager APIs. The `<queries>` block in AndroidManifest.xml already declares the `solana-wallet` scheme, which is sufficient for MWA wallet detection. For per-package detection, individual package queries may need to be added to the manifest for Android 11+.

## AndroidManifest.xml Addition Required

For Android 11+ (API 30+) per-package wallet detection to work, add these queries:

```xml
<queries>
    <!-- Existing MWA scheme query -->
    <intent>
        <action android:name="android.intent.action.VIEW"/>
        <category android:name="android.intent.category.BROWSABLE"/>
        <data android:scheme="solana-wallet"/>
    </intent>
    <!-- Per-wallet package visibility (Android 11+) -->
    <package android:name="app.phantom" />
    <package android:name="app.backpack" />
    <package android:name="com.solflare.mobile" />
    <package android:name="com.pleasecrypto.flutter" />
    <package android:name="com.solanamobile.seedvault" />
</queries>
```

Without these `<package>` declarations, `PackageManager.getPackageInfo()` will throw `NameNotFoundException` on Android 11+ even if the wallet is installed.

---

# Implementation Status — COMPLETED

All code has been written and reviewed. Below documents what was implemented, what was fixed during review, and the full wallet compatibility research.

## Files Created (1)

### `WalletDetector.java` (NEW)
**Path:** `native/engine/android/app/src/com/cocos/game/mwa/WalletDetector.java`

Pure static utility class with no state:

- `static String[][] KNOWN_WALLETS` — 4 MWA-compatible wallets: `{displayName, packageName, playStoreUrl}`
- `static JSONArray detectInstalledWallets(Activity)` — iterates `KNOWN_WALLETS`, calls `PackageManager.getPackageInfo()` for each, returns `[{name, packageName, installed, storeUrl}]`
- `static JSONObject detectDevice()` — reads `Build.MANUFACTURER` / `Build.MODEL`, returns `{isSeeker, isSaga, isSolanaMobile, manufacturer, model}`
  - Seeker: `manufacturer="Solana Mobile"` + model contains `"Seeker"` or `"Chapter2"`
  - Saga: `manufacturer="Solana Mobile"` + model contains `"Saga"`
- `private static boolean isPackageInstalled(Activity, String)` — try/catch on `getPackageInfo`

## Files Modified (9)

### `MWAIntentHelper.java`
**Path:** `native/engine/android/app/src/com/cocos/game/mwa/MWAIntentHelper.java`

Added one method after `createAssociationIntent()`:

```java
public static Intent createTargetedAssociationIntent(
        LocalAssociationScenario scenario, String targetPackage) {
    Intent intent = createAssociationIntent(scenario, null);
    if (targetPackage != null && !targetPackage.isEmpty()) {
        intent.setPackage(targetPackage);
    }
    return intent;
}
```

This is the core mechanism — `Intent.setPackage()` bypasses the OS wallet picker and opens the specific wallet directly.

### `MWASessionManager.java`
**Path:** `native/engine/android/app/src/com/cocos/game/mwa/MWASessionManager.java`

Added a private helper method:

```java
private Intent createIntentForParams(LocalAssociationScenario scenario, JSONObject params) {
    String targetPackage = params.optString("targetPackage", null);
    if (targetPackage != null && !targetPackage.isEmpty()) {
        return MWAIntentHelper.createTargetedAssociationIntent(scenario, targetPackage);
    }
    return MWAIntentHelper.createAssociationIntent(scenario, null);
}
```

Replaced `MWAIntentHelper.createAssociationIntent(scenario, null)` with `createIntentForParams(scenario, params)` in **all 8 methods**:
1. `authorize()`
2. `authorizeAndSign()`
3. `reauthorize()`
4. `deauthorize()`
5. `signAndDeauthorize()`
6. `signMessages()`
7. `signAndSendTransactions()`
8. `getCapabilities()`

Safe: `params.optString("targetPackage", null)` returns `null` when the field is absent, falling back to the existing default-picker behavior.

### `MWABridgePlugin.java`
**Path:** `native/engine/android/app/src/com/cocos/game/mwa/MWABridgePlugin.java`

Added imports: `android.content.Intent`, `android.net.Uri`

Added 3 new cases to the `switch` in `handleCommand()`:

| Command | Handler | What it does |
|---------|---------|-------------|
| `detect_wallets` | `handleDetectWallets(id)` | Calls `WalletDetector.detectInstalledWallets(sActivity)`, wraps in `{wallets: [...]}` |
| `detect_device` | `handleDetectDevice(id)` | Calls `WalletDetector.detectDevice()`, returns device info JSON |
| `open_url` | `handleOpenUrl(id, params)` | Reads `url` from params, launches `Intent.ACTION_VIEW` (for Play Store links) |

All three are synchronous (no wallet interaction needed).

### `AndroidManifest.xml`
**Path:** `native/engine/android/app/AndroidManifest.xml`

Added 5 `<package>` entries inside existing `<queries>` block:

```xml
<package android:name="app.phantom" />
<package android:name="app.backpack" />
<package android:name="com.solflare.mobile" />
<package android:name="com.pleasecrypto.flutter" />
<package android:name="com.solanamobile.seedvault" />
```

Required for Android 11+ (API 30+) — without these, `PackageManager.getPackageInfo()` throws `NameNotFoundException` even when the wallet is installed.

### `MWATypes.ts`
**Path:** `assets/solana-mwa/scripts/MWATypes.ts`

Added two new interfaces:

```typescript
export interface WalletInfo {
    name: string;           // display name (e.g., "Phantom")
    packageName: string;    // Android package (e.g., "app.phantom")
    installed: boolean;     // whether installed on this device
    storeUrl: string;       // Play Store URL
}

export interface DeviceInfo {
    isSeeker: boolean;
    isSaga: boolean;
    isSolanaMobile: boolean;
    manufacturer: string;
    model: string;
}
```

Expanded `MWACommandName` union type with 5 new commands: `authorize_and_sign`, `sign_and_deauthorize`, `detect_wallets`, `detect_device`, `open_url`.

### `MWABridge.ts`
**Path:** `assets/solana-mwa/scripts/MWABridge.ts`

Added mock responses in `_mockResponse()` for editor testing:
- `detect_wallets` — returns 4 wallets (2 installed, 2 not)
- `detect_device` — returns non-Seeker device
- `open_url` — returns empty (no-op in editor)
- `authorize_and_sign` — returns mock pubkey + signature
- `sign_and_deauthorize` — returns mock signature

Updated fast command list for 100ms delay: `is_available`, `detect_wallets`, `detect_device`, `open_url`.

### `MWAManager.ts`
**Path:** `assets/solana-mwa/scripts/MWAManager.ts`

**New public field:**
```typescript
public connectedWalletPackage: string = '';
```

**New public methods (after `isAvailable()`):**

| Method | Returns | Description |
|--------|---------|-------------|
| `detectWallets()` | `Promise<WalletInfo[]>` | Sends `detect_wallets` command to native |
| `detectDevice()` | `Promise<DeviceInfo>` | Sends `detect_device` command to native |
| `authorizeWithWallet(targetPackage)` | `Promise<AuthorizeResult \| null>` | Calls `authorize(targetPackage)` |
| `openUrl(url)` | `Promise<void>` | Sends `open_url` command (for Play Store links) |

**Refactored `authorize()`:** Now accepts optional `targetPackage?: string`. When set, adds `targetPackage` to `compoundParams`. Backward-compatible — existing callers pass no argument.

**New private helper:**
```typescript
private _withTargetPackage(params: Record<string, any>): Record<string, any> {
    if (this.connectedWalletPackage) {
        return { ...params, targetPackage: this.connectedWalletPackage };
    }
    return params;
}
```

**`connectedWalletPackage` lifecycle:**
- Set in `authorize()` after successful connection
- Cleared in `deauthorize()` and `deleteAccount()`
- Injected via `_withTargetPackage()` into all 7 post-connect bridge commands:
  1. `reauthorize` — so reconnect opens the same wallet
  2. `deauthorize` — so disconnect targets the same wallet
  3. `sign_messages` (signMessage) — so signing opens the same wallet
  4. `sign_messages` (signMessages batch) — same
  5. `sign_and_send` — so transactions open the same wallet
  6. `get_capabilities` — so capability query opens the same wallet
  7. `sign_and_deauthorize` (deleteAccount) — so deletion opens the same wallet

This ensures that once a user connects via a specific wallet (e.g., Phantom), ALL subsequent operations target that wallet directly — no OS picker re-appears.

### `generate-scenes.js`
**Path:** `generate-scenes.js`

Restructured the LandingPanel section. Kept TitleLabel and SubtitleLabel. Added:

**TabBar** (Node, `_active: false` by default — AppUI enables on Seeker/Saga):
- `SeedVaultTab` button at x=-175, green (0,210,136), 320x70
- `WalletTab` button at x=175, grey (120,120,120), 320x70
- Positioned horizontally via `_lpos` patching after creation

**SeedVaultPanel** (Node, `_active: true` — default visible):
- `ConnectButton` — "Connect via Seed Vault", green (0,210,136), y=80
- `ReconnectButton` — "Reconnect (Cached)", green (77,179,102), y=-40
- `StatusLabel` — "Tap Connect to link your wallet", y=-200

**WalletListPanel** (Node, `_active: false` — shown by AppUI):
- `PhantomButton` — purple (171,159,242), y=100
- `BackpackButton` — coral (227,62,63), y=0
- `SolflareButton` — orange (252,159,34), y=-100
- `EspressoButton` — teal (46,196,182), y=-200
- `WalletStatusLabel` — "Detecting wallets...", y=-320

All use existing `mkBtn`/`mkLabel` helpers. No new helper functions needed.

### `AppUI.ts`
**Path:** `assets/demo/scripts/AppUI.ts`

**New imports:** `Sprite`, `Color` from `cc`; `WalletInfo`, `DeviceInfo` from `MWATypes`.

**New instance variables:**
- `_tabBar`, `_seedVaultTab`, `_walletTab` — tab bar elements
- `_seedVaultPanel`, `_walletListPanel` — sub-panels within Landing
- `_walletButtons: Map<string, Button>` — packageName → button ref
- `_walletStatusLabel` — wallet list status label
- `_wallets: WalletInfo[]`, `_deviceInfo: DeviceInfo` — detection results
- `_adapterReady: boolean` — guards `_showLanding` panel logic until detection completes

**`start()` flow:**
1. Find panels (LandingPanel, HomePanel) — unchanged
2. Find TabBar, wire tab buttons to `_onSeedVaultTab()` / `_onWalletTab()`
3. Find SeedVaultPanel, wire ConnectButton/ReconnectButton/StatusLabel
4. Find WalletListPanel, wire 4 wallet buttons using closure pattern:
   `btn.node.on(Click, () => this._onWalletTapped(pkg), this)`
5. Wire home buttons — unchanged
6. Call `_initWalletAdapter()` (async, after sync setup)

**`_initWalletAdapter()`:**
- Parallel: `Promise.all([detectDevice(), detectWallets()])`
- If Seeker/Saga: `tabBar.active = true`, show SeedVaultPanel by default
- If non-Seeker: `tabBar.active = false`, hide SeedVaultPanel, show WalletListPanel
- Call `_updateWalletButtons()`, set `_adapterReady = true`

**Tab switching:**
- `_onSeedVaultTab()` — shows SeedVaultPanel, hides WalletListPanel, updates tab colors
- `_onWalletTab()` — hides SeedVaultPanel, shows WalletListPanel, updates tab colors, calls `_refreshWallets()` (re-detects wallets to catch post-install)

**`_updateWalletButtons()`:**
- Iterates `_wallets` array, matches packageName to button via Map
- Installed: full color from `btn.normalColor`, label = wallet name
- Not installed: dimmed color (40% RGB, 160 alpha), label = "WalletName [Install]"
- Updates `_walletStatusLabel` with installed count or "No MWA wallets installed"

**`_onWalletTapped(packageName)`:**
- If installed: `authorizeWithWallet(packageName)` → on success: `_showHome()`
- If not installed: `openUrl(wallet.storeUrl)` → toast "Opening Play Store"

**`_showLanding()` update:**
- Only adjusts sub-panel visibility when `_adapterReady` is true
- Prevents brief WalletListPanel flash on Seeker devices at startup
- Scene defaults (SeedVaultPanel visible, TabBar hidden) serve as initial state

**`_setLandingEnabled()` update:**
- Also toggles wallet button interactability via `_walletButtons.values()` iteration

---

# Wallet MWA Compatibility Research

## Authoritative Source

The official Solana Mobile wallet directory at [wallets.solanamobile.com](https://wallets.solanamobile.com) lists exactly **4 MWA-compliant wallets**. Our implementation covers all 4.

## Full Analysis — All 16 Wallets from Seeker dApp Store

### MWA-Compatible — Implemented (4)

| Wallet | Package | Brand Color | Status |
|--------|---------|-------------|--------|
| Phantom | `app.phantom` | Purple (171,159,242) | Implemented |
| Backpack | `app.backpack` | Coral (227,62,63) | Implemented |
| Solflare | `com.solflare.mobile` | Orange (252,159,34) | Implemented |
| Espresso Cash | `com.pleasecrypto.flutter` | Teal (46,196,182) | Implemented |

### Not MWA-Compatible — Excluded (12)

| Wallet | Package | Protocol Used | Why Not MWA |
|--------|---------|---------------|-------------|
| Jupiter Mobile | `ag.jup.jupiter.android` | WalletConnect (Reown) | Completely different relay-server-based protocol |
| OKX Wallet | `com.okx.wallet` | OKX Connect (proprietary) | Their own SDK, not standard MWA. Designed for Telegram DApps |
| Gem Wallet | `com.gemwallet.android` | WalletConnect | Open-source, explicitly documents WalletConnect only |
| Orangefin | `ventures.orangefin.staking` | Unknown | SOL staking wallet. No MWA docs. Not on wallets.solanamobile.com |
| Moby | `com.assetdash.moby` | Unknown | Trading app (AssetDash). Uses Privy. No MWA docs |
| SollPay | `com.mercurylabs.sollpayhq` | Unknown | Focused on Solana Pay recurring payments. No MWA docs |
| OPINDEX | `com.opincur.opincur_app` | Unknown | CIO token ecosystem wallet. No MWA docs |
| Umbra Wallet | N/A (web-based) | Web | Privacy wallet at app.umbra.cash. Not a native Android app |
| Untaxed | N/A (Chrome extension) | Browser extension | Chrome extension only. Not a mobile app |
| Vultisig | `com.vultisig.wallet` | QR Code Pairing (TSS/MPC) | Multi-chain multisig. Uses QR pairing, not MWA |
| Xeno Wallet | N/A (iOS / Base L2) | NFC tap-to-pay | Stablecoin payments on Base L2, not Solana MWA |
| MEMO | Not found | Unknown | "Wallet for X1 and Solana" — no identifiable app found |

### Why Only 4 Wallets Support MWA

MWA is an open standard defined by Solana Mobile, but implementing it requires significant investment:

1. **Wallet-side library:** Must integrate `mobile-wallet-adapter-walletlib-ktx` (Android) for WebSocket server, ECDH key exchange, and JSON-RPC protocol
2. **Intent filter registration:** Must declare `solana-wallet://` scheme in AndroidManifest.xml
3. **Full RPC implementation:** authorize, reauthorize, deauthorize, sign_messages, sign_and_send_transactions, get_capabilities

Most other wallets use alternative approaches:
- **WalletConnect** (Jupiter, Gem) — relay-server protocol, works cross-platform
- **Proprietary SDKs** (OKX Connect) — vendor-specific, not interoperable
- **Not mobile apps** (Umbra, Untaxed) — web/extension only

### Future-Proofing

If any wallet adds MWA support in the future, adding it requires only:
1. One line in `WalletDetector.KNOWN_WALLETS`: `{"WalletName", "com.example.wallet", "https://play.google.com/store/apps/details?id=com.example.wallet"}`
2. One line in `AndroidManifest.xml`: `<package android:name="com.example.wallet" />`
3. One entry in `WALLET_BUTTONS` in `AppUI.ts`
4. One `mkBtn` call in `generate-scenes.js`
