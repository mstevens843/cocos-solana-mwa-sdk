# MWA Implementations — Cocos Creator Solana Mobile SDK

Complete implementation documentation for all MWA 2.0 SDK methods. Every method uses the Godot-style
architecture: delegate to the official Solana Mobile Kotlin library via JsbBridge.

At full parity with the Godot and Unity MWA grants, plus extras (wallet detection, device detection,
batch sign_messages, compound commands) that exceed both.

---

## Architecture (All Methods)

```
TypeScript (MWAManager.ts)
  | authorize() / signMessage() / signAndSend() / etc.
  | JSON params via Promise
  v
MWABridge.ts
  | native.bridge.sendToNative('mwa', json)
  | waits for response via Promise correlation (request ID)
  v
MWABridgePlugin.java (GL thread)
  | JsbBridge.setCallback() receives JSON
  | parses cmd + params, dispatches to MWASessionManager
  v
MWASessionManager.java (background executor thread)
  | Creates LocalAssociationScenario (random WebSocket port)
  | Launches wallet intent (solana-wallet:// URI)
  | Wallet connects via WebSocket, ECDH handshake, encrypted session
  | Calls clientlib API: client.authorize() / client.signAndSendTransactions() / etc.
  | Result → callback.onResult(JSON)
  v
MWABridgePlugin.java (GL thread via CocosHelper.runOnGameThread)
  | JsbBridge.sendToScript('mwa', responseJSON)
  v
MWABridge.ts
  | _onNativeResponse() correlates response.id → pending Promise
  | resolves Promise with result
  v
MWAManager.ts
  | validates result, updates state, emits events
```

---

## Feature Parity

| Feature | Cocos | Godot | Unity |
|---------|:-----:|:-----:|:-----:|
| authorize (basic) | Done | Done | Done |
| authorize + SIWS (Auth 2.0) | Done | Partial | Done |
| authorize + biometric (compound) | Done | -- | -- |
| reauthorize (cached token) | Done | Done | Done |
| deauthorize (RPC to wallet) | Done | Partial | Done |
| sign_messages (single + batch) | Done | Single only | Single only |
| sign_transactions (sign-only) | Done | Done | Partial |
| sign_and_send_transactions | Done | Done | Done |
| get_capabilities | Done | Done | Done |
| delete_account (compound) | Done | Done | Done |
| multi-wallet (targeted package) | Done | Done | Done |
| auth cache (persistent) | Done | Done | Done |
| wallet detection | Done | -- | -- |
| device detection (Seeker/Saga) | Done | -- | -- |

---

## Cross-SDK parity notes — Unity-triggered audits

Periodic audits confirm the Cocos SDK has feature surfaces the Unity SDK has
since added. No code changes needed — logged here so future reviewers can
skip redundant parity work.

### 2026-04-17 audit vs Unity PRs #274 + `feat/expose-mwa-auth-token`

| Feature | Unity change | Cocos status |
|---|---|---|
| `signMessage(string)` convenience | Unity PR #274 adds string overload to `WalletBase.cs` + `IWalletBase.cs`. | **Already present.** `MWAManager.ts:634` `async signMessage(message: string): Promise<string>`. UTF-8 encodes internally at line 648. Bytes variant lives separately as `signMessages(Uint8Array[])` at line 692. |
| Public MWA auth token | Unity `feat/expose-mwa-auth-token` adds `public string AuthToken` getter on `SolanaMobileWalletAdapter` + `SolanaWalletAdapter`. | **Already present.** `MWAManager.ts:77` `public authToken: string = ''`. Readable as `MWAManager.instance.authToken`. No getter wrapper — TS uses plain public fields. |

No code changes applied to the Cocos SDK as a result of this audit.

---

## Implementation 1: Authorize (Basic)

### What It Does

Standard MWA authorization. Opens the OS wallet picker (or targets a specific wallet), user approves,
returns pubkey + authToken. For Seed Vault: chains a SIWS sign-in for biometric confirmation in
the same session (`authorize_and_sign` compound command).

### Files

| Layer | File | Method |
|-------|------|--------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `authorize()` / `authorizeWithWallet()` |
| Java Router | `native/.../mwa/MWABridgePlugin.java` | `case "authorize":` / `case "authorize_and_sign":` |
| Java Session | `native/.../mwa/MWASessionManager.java` | `authorize()` / `authorizeAndSign()` |
| Kotlin Lib | `clientlib-ktx:2.0.3` | `client.authorize()` |

### Data Flow

**Input:** `{ cmd: "authorize", params: { appName, appUri, appIconPath, cluster, targetPackage? } }`

**Output:** `{ pubkey, authToken, walletUriBase }`

For Seed Vault compound: `{ cmd: "authorize_and_sign", params: { ...identity, signInMessage } }` returns `{ pubkey, authToken, walletUriBase, signInSignature }`.

### Key Details

- **Third-party wallets** (Phantom, Solflare): plain `authorize` command — no sign chaining
- **Seed Vault**: `authorize_and_sign` compound — authorize + SIWS in single session for biometric
- **Pubkey validation**: Bug G5 prevention — rejects pubkeys < 20 chars
- **Auth token warning**: Bug U3 prevention — logs warning if authToken is empty
- **Guard**: `_authorizing` flag prevents concurrent authorize calls
- **Deleted keys cleared**: Fresh connect clears `_deletedPubkeys` set

### Log Pattern

```
[MWAManager] authorize | START is_connected=false authorizing=false targetPackage=(none)
[MWASessionManager] authorize | START app=Cocos MWA Example cluster=devnet
[MWASessionManager] authorize | scenario created port=51234
[MWASessionManager] authorize | client connected
[MWASessionManager] authorize | SUCCESS pubkey=7xKX...4bNr auth_token_len=44
[MWAManager] authorize | STATE_SET pubkey=7xKX...4bNr authToken_len=44 isConnected=true
[MWAManager] authorize | CACHED pubkey=7xKX...4bNr
[MWAManager] authorize | DONE connected=true pubkey=7xKX...4bNr
```

---

## Implementation 2: Reauthorize (Cached Token)

### What It Does

Silent reconnect using a cached authToken from a previous session. No wallet picker, no user
interaction. Falls back to full `authorize()` if reauthorize fails.

### Files

| Layer | File | Method |
|-------|------|--------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `reauthorize()` |
| Java Session | `native/.../mwa/MWASessionManager.java` | `reauthorize()` |
| Cache | `assets/solana-mwa/scripts/AuthCache.ts` | `getLatest()` |

### Data Flow

**Input:** `{ cmd: "reauthorize", params: { appName, appUri, appIconPath, cluster, authToken } }`

**Output:** `{ pubkey, authToken (refreshed), walletUriBase }`

### Key Details

- **Cache-first**: Loads `(pubkey, authToken, walletPackage)` from `AuthCache.getLatest()`
- **Empty token guard**: Rejects immediately if cached authToken is empty (Bug U3)
- **Deleted key rejection**: If cached pubkey is in `_deletedPubkeys`, falls back to full authorize
- **Fallback**: Any error → calls `authorize()` as recovery
- **Wallet targeting**: Restores `connectedWalletPackage` from cache for same-wallet targeting

### Log Pattern

```
[MWAManager] reauthorize | START
[AuthCache] getLatest | latest_pubkey=7xKX...4bNr
[MWAManager] reauthorize | cached_pubkey=7xKX...4bNr cached_token_len=44 age_seconds=120
[MWASessionManager] reauthorize | START auth_token_len=44
[MWASessionManager] reauthorize | SUCCESS pubkey=7xKX...4bNr new_token_len=44
[MWAManager] reauthorize | SUCCESS pubkey=7xKX...4bNr auth_token_len=44
```

---

## Implementation 3: Deauthorize (RPC to Wallet)

### What It Does

Disconnects the wallet session. Sends the MWA `deauthorize` RPC to the wallet to invalidate
the auth token server-side, then clears all local state.

### Files

| Layer | File | Method |
|-------|------|--------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `deauthorize()` |
| Java Session | `native/.../mwa/MWASessionManager.java` | `deauthorize()` |

### Key Details

- **Bug U1 prevention**: Actually sends `client.deauthorize(authToken)` RPC to the wallet — not just local state clear
- **Non-fatal failure**: If the deauthorize RPC fails (timeout, wallet crashed), local state is still cleared
- **Emits `MWA_DISCONNECTED`**: UI listens and navigates back to landing page
- **No cache clear**: Keeps AuthCache intact — `reauthorize()` may still work with a fresh token

### Log Pattern

```
[MWAManager] deauthorize | START pubkey=7xKX...4bNr is_connected=true auth_token_len=44
[MWASessionManager] deauthorize | START auth_token_len=44
[MWASessionManager] deauthorize | sending deauthorize RPC
[MWASessionManager] deauthorize | DONE session invalidated with wallet
[MWAManager] deauthorize | DONE old_pubkey=7xKX...4bNr isConnected=false
```

---

## Implementation 4: Sign Messages (Single + Batch)

### What It Does

Sign arbitrary messages using the wallet's private key. Returns 64-byte Ed25519 signatures.
Supports both single message (`signMessage()`) and batch (`signMessages()`).

### Files

| Layer | File | Method |
|-------|------|--------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `signMessage()` / `signMessages()` |
| Java Session | `native/.../mwa/MWASessionManager.java` | `signMessages()` |
| Kotlin Lib | `clientlib-ktx:2.0.3` | `client.signMessagesDetached()` |

### Data Flow

**Input:** `{ cmd: "sign_messages", params: { payloads: [base64], addresses: [base58], authToken } }`

**Output:** `{ signatures: [base64] }`

### Key Details

- **Reauthorize in-session**: Opens new scenario, reauthorizes with cached authToken, then signs — all in one wallet session
- **Detached signatures**: Uses `signMessagesDetached()` — returns only the 64-byte signature, not the full message
- **Batch support**: Cocos supports signing multiple messages in one call — Godot and Unity only support single
- **UTF-8 encoding**: `signMessage(string)` encodes to UTF-8 bytes then base64 before sending
- **Emits `MWA_MESSAGE_SIGNED`** with the base64 signature

### Log Pattern

```
[MWAManager] signMessage | START message_len=32 is_connected=true
[MWASessionManager] signMessages | START
[MWASessionManager] signMessages | payload[0] decoded_bytes=32
[MWASessionManager] signMessages | reauthorizing for privileged session token_len=44
[MWASessionManager] signMessages | sending sign_messages RPC
[MWASessionManager] signMessages | sig[0] bytes=64 base64_len=88
[MWASessionManager] signMessages | SUCCESS signature_count=1
[MWAManager] signMessage | SUCCESS sig_len=88 sig=a1b2c3d4e5f6...
```

---

## Implementation 5: Sign Transactions (Sign-Only)

### What It Does

Sign serialized transactions without broadcasting. The wallet injects its signature into each
transaction and returns the full signed transaction bytes. The caller can inspect, broadcast
later, or discard.

### Files

| Layer | File | Method |
|-------|------|--------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `signTransaction()` / `signTransactions()` |
| Java Session | `native/.../mwa/MWASessionManager.java` | `signTransactions()` |
| Kotlin Lib | `clientlib-ktx:2.0.3` | `client.signTransactions()` |

### Data Flow

**Input:** `{ cmd: "sign_transactions", params: { payloads: [base64 unsigned tx], authToken } }`

**Output:** `{ signedPayloads: [base64 signed tx] }`

### Key Details

- **Returns full signed transaction**: Unlike `sign_and_send` which returns only the 64-byte signature
- **Reauthorize in-session**: Same pattern as signMessages — reauth + sign in one wallet session
- **Batch support**: Array of transactions signed in a single wallet prompt
- **Emits `MWA_TRANSACTION_SIGNED`** with array of `Uint8Array` signed transactions

### Log Pattern

```
[MWAManager] signTransactions | START tx_count=1 is_connected=true
[MWASessionManager] signTransactions | payload[0] decoded_bytes=170
[MWASessionManager] signTransactions | reauthorizing for privileged session
[MWASessionManager] signTransactions | sending sign_transactions RPC tx_count=1
[MWASessionManager] signTransactions | signedPayload[0] bytes=234
[MWASessionManager] signTransactions | SUCCESS signed_count=1
[MWAManager] signTransactions | SUCCESS signed_count=1
```

---

## Implementation 6: Get Capabilities

### What It Does

Query the connected wallet's MWA capabilities — max transactions per request, max messages,
supported transaction versions, and optional features.

### Files

| Layer | File | Method |
|-------|------|--------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `getCapabilities()` |
| Java Session | `native/.../mwa/MWASessionManager.java` | `getCapabilities()` |
| Kotlin Lib | `clientlib-ktx:2.0.3` | `client.getCapabilities()` |

### Data Flow

**Input:** `{ cmd: "get_capabilities", params: {} }`

**Output:** `{ maxTransactionsPerRequest, maxMessagesPerRequest, supportedTransactionVersions, features }`

### Key Details

- **Non-privileged**: No auth needed — any app can query capabilities
- **Typical Phantom response**: `max_txs=10, max_msgs=1, versions=["legacy","0"]`
- **Field normalization**: TypeScript normalizes both camelCase and snake_case field names from Java
- **Emits `MWA_CAPABILITIES_RECEIVED`**

### Log Pattern

```
[MWAManager] getCapabilities | START is_connected=true
[MWASessionManager] getCapabilities | sending get_capabilities RPC
[MWASessionManager] getCapabilities | SUCCESS max_txs=10 max_msgs=1 versions=["legacy","0"]
[MWAManager] getCapabilities | SUCCESS max_txs=10 max_msgs=1 versions=[legacy,0]
```

---

## Implementation 7: Delete Account (Compound Sign + Deauthorize)

### What It Does

Biometric-confirmed account deletion. Signs a confirmation message and deauthorizes the wallet
in a single MWA session — one wallet prompt for both operations. Then clears all local cached data.

### Files

| Layer | File | Method |
|-------|------|--------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `deleteAccount()` |
| Java Session | `native/.../mwa/MWASessionManager.java` | `signAndDeauthorize()` |
| Java Router | `native/.../mwa/MWABridgePlugin.java` | `case "sign_and_deauthorize":` |

### Data Flow

**Input:** `{ cmd: "sign_and_deauthorize", params: { authToken, appName, appUri, appIconPath, message, pubkey, targetPackage? } }`

**Output:** `{ signatures: [base64 confirmation signature] }`

### Key Details

- **Compound command**: reauthorize + signMessagesDetached + deauthorize in ONE MWA session — single wallet prompt
- **Bug G10 prevention**: Requires wallet confirmation via sign before delete — prevents unauthorized deletion on stolen phone
- **Records deleted key**: Adds pubkey to `_deletedPubkeys` set — prevents reconnect to deleted account via `reauthorize()`
- **Clears everything**: `isConnected=false`, all state vars reset, `_cache.clearAll()`
- **Emits `MWA_DISCONNECTED`**
- **Non-fatal deauthorize**: If the deauthorize RPC fails within the session, the signed confirmation is still accepted

### Log Pattern

```
[MWAManager] deleteAccount | START pubkey=7xKX...4bNr is_connected=true
[MWASessionManager] signAndDeauthorize | START pubkey=7xKX...4bNr message="Confirm account deletion"
[MWASessionManager] signAndDeauthorize | reauthorizing for privileged session
[MWASessionManager] signAndDeauthorize | sending sign_messages RPC
[MWASessionManager] signAndDeauthorize | sign SUCCESS sig_len=88
[MWASessionManager] signAndDeauthorize | sending deauthorize RPC
[MWASessionManager] signAndDeauthorize | deauthorized successfully
[MWAManager] deleteAccount | CONFIRMED sig=a1b2c3d4...
[MWAManager] deleteAccount | recorded deleted key=7xKX...4bNr total_deleted=1
[MWAManager] deleteAccount | DONE cache cleared, session destroyed
```

---

## Implementation 8: Auth Cache (Persistent Token Storage)

### What It Does

Stores authorization data across app restarts using Cocos Creator's `sys.localStorage`
(backed by SQLite on Android). Enables instant reconnection without wallet interaction.

### Files

| Layer | File |
|-------|------|
| TypeScript | `assets/solana-mwa/scripts/AuthCache.ts` |
| Types | `assets/solana-mwa/scripts/MWATypes.ts` (`CachedAuth` interface) |

### Stored Data

```typescript
interface CachedAuth {
    pubkey: string;         // base58 public key
    authToken: string;      // MWA auth token for reauthorize()
    walletUriBase: string;  // wallet URI base (optional)
    walletPackage: string;  // Android package name (e.g., "app.phantom")
    timestamp: number;      // Unix seconds when cached
}
```

### Key Details

- **Storage backend**: `sys.localStorage` → Android SharedPreferences → SQLite
- **Key scheme**: `mwa_auth_{pubkey}` per entry, `mwa_auth_latest` for most recent, `mwa_auth_all_keys` for tracking
- **Multi-pubkey**: Supports caching multiple wallets — keyed by pubkey
- **Bug G5 prevention**: Validates pubkey with `isValidBase58Pubkey()` before storing
- **Bug U3 prevention**: Logs `auth_token_len` on every `set()` — empty tokens immediately visible
- **Used by**: `reauthorize()` reads `getLatest()`, `deleteAccount()` calls `clearAll()`

### Log Pattern

```
[AuthCache] set | START pubkey=7xKX...4bNr auth_token_len=44 wallet_package=app.phantom
[AuthCache] set | DONE pubkey=7xKX...4bNr timestamp=1713200000 is_new_entry=true total_cached=1
[AuthCache] getLatest | latest_pubkey=7xKX...4bNr
[AuthCache] get | FOUND pubkey=7xKX...4bNr auth_token_len=44 age_seconds=120
```

---

## Implementation 9: Multi-Wallet Support (Targeted by Package)

### What It Does

Bypass the Android OS wallet picker and target a specific wallet app directly using
`Intent.setPackage()`. All subsequent operations (sign, send, capabilities) automatically
target the same wallet via `_withTargetPackage()`.

### Files

| Layer | File | Method |
|-------|------|--------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `authorizeWithWallet()` / `_withTargetPackage()` |
| Java | `native/.../mwa/MWAIntentHelper.java` | `createTargetedAssociationIntent()` |
| Java | `native/.../mwa/MWASessionManager.java` | `createIntentForParams()` |

### Supported Wallets

| Wallet | Package Name |
|--------|-------------|
| Phantom | `app.phantom` |
| Backpack | `app.backpack` |
| Solflare | `com.solflare.mobile` |
| Espresso Cash | `com.pleasecrypto.flutter` |
| Jupiter | `ag.jup.app` |
| Seed Vault | (default — no package, uses OS picker) |

### Key Details

- **Intent targeting**: `intent.setPackage(targetPackage)` — opens specific wallet directly
- **Session persistence**: `connectedWalletPackage` stored in state + AuthCache — survives app restart
- **Auto-injection**: `_withTargetPackage()` adds `targetPackage` to ALL bridge command params
- **Display names**: `walletDisplayName()` maps package names to human-readable names
- **Cache restoration**: `reauthorize()` restores `connectedWalletPackage` from cache

### Log Pattern

```
[MWAManager] authorizeWithWallet | START targetPackage=app.phantom
[MWAManager] _withTargetPackage | INJECTING targetPackage="app.phantom" into params
[MWAIntentHelper] createTargetedAssociationIntent | DONE targeting package=app.phantom
```

---

## Implementation 10: Wallet Detection

### What It Does

Detects which MWA-compatible wallets are installed on the device using Android PackageManager.
Returns name, package, installed status, and Play Store URL for each known wallet.

### Files

| Layer | File | Method |
|-------|------|--------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `detectWallets()` |
| Java | `native/.../mwa/WalletDetector.java` | `detectInstalledWallets()` |
| Java Router | `native/.../mwa/MWABridgePlugin.java` | `case "detect_wallets":` |

### Data Flow

**Output:** `{ wallets: [{ name, packageName, installed, storeUrl }] }`

### Key Details

- **Synchronous**: Uses PackageManager directly — no MWA session needed
- **5 known wallets**: Phantom, Backpack, Solflare, Espresso Cash, Jupiter
- **AndroidManifest queries**: Requires `<queries><package>` declarations for Android 11+ visibility
- **Play Store links**: Each wallet includes `storeUrl` for install prompts
- **Exceeds Godot/Unity**: Neither Godot nor Unity SDK has wallet detection

### Log Pattern

```
[MWAManager] detectWallets | START
[WalletDetector] detectInstalledWallets | Phantom (app.phantom) installed=true
[WalletDetector] detectInstalledWallets | Backpack (app.backpack) installed=false
[WalletDetector] detectInstalledWallets | DONE total=5 installed=2
[MWAManager] detectWallets | DONE total=5 installed=2 not_installed=3
```

---

## Implementation 11: Device Detection (Seeker/Saga)

### What It Does

Detects if running on a Solana Mobile device (Seeker or Saga) using Android `Build` properties.
Returns device type, manufacturer, and model.

### Files

| Layer | File | Method |
|-------|------|--------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `detectDevice()` |
| Java | `native/.../mwa/WalletDetector.java` | `detectDevice()` |
| Java Router | `native/.../mwa/MWABridgePlugin.java` | `case "detect_device":` |

### Data Flow

**Output:** `{ isSeeker, isSaga, isSolanaMobile, manufacturer, model }`

### Key Details

- **Synchronous**: Reads `Build.MANUFACTURER` and `Build.MODEL` — no MWA session needed
- **Seeker detection**: `manufacturer="Solana Mobile"` AND (`model contains "Seeker"` OR `"Chapter2"`)
- **Saga detection**: `manufacturer="Solana Mobile"` AND `model contains "Saga"`
- **Exceeds Godot/Unity**: Neither Godot nor Unity SDK has device detection

### Log Pattern

```
[MWAManager] detectDevice | START
[WalletDetector] detectDevice | RAW manufacturer="Solana Mobile" model="Seeker" product="seeker"
[WalletDetector] detectDevice | RESULT isSolanaMobile=true isSeeker=true isSaga=false
[MWAManager] detectDevice | DONE isSeeker=true isSaga=false manufacturer=Solana Mobile model=Seeker
```

---

## Implementation 12: Auth 2.0 — Sign In With Solana (SIWS)

### What It Does

MWA 2.0 combined authorization + proof-of-ownership. The wallet signs a SIWS message
proving the user owns the account — authorize and sign-in in a single wallet prompt.

### Files

| Layer | File | Method | Lines |
|-------|------|--------|-------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `authorizeSiws()` | 379-463 |
| Bridge | `assets/solana-mwa/scripts/MWABridge.ts` | `sendCommand('authorize_siws')` | 103-152 |
| Java Router | `native/.../mwa/MWABridgePlugin.java` | `case "authorize_siws":` | 133 |
| Java Session | `native/.../mwa/MWASessionManager.java` | `authorizeSiws()` | 197-336 |
| Kotlin Lib | `com.solanamobile:mobile-wallet-adapter-clientlib-ktx:2.0.3` | `client.authorize(..., signInPayload)` | — |

### Data Flow

**Input (TypeScript → Java):**
```json
{
  "id": "req_001",
  "cmd": "authorize_siws",
  "params": {
    "appName": "Cocos MWA Example",
    "appUri": "https://example.com",
    "appIconPath": "/icon.png",
    "cluster": "devnet",
    "siwsDomain": "example.com",
    "siwsStatement": "Sign in to Cocos MWA Example"
  }
}
```

**Java Processing:**
1. Creates `SignInWithSolana.Payload(domain, statement)`
2. Calls `client.authorize(identityUri, iconUri, appName, chain, null, null, null, signInPayload)`
3. Wallet shows single approve screen: "Sign in with example.com"
4. Extracts `authResult.signInResult` (signature, signedMessage, address, signatureType)
5. Extracts `authResult.accounts[0]` (publicKey, accountLabel, chains, features)

**Output (Java → TypeScript):**
```json
{
  "id": "req_001",
  "result": {
    "pubkey": "7xKX...4bNr",
    "authToken": "...",
    "walletUriBase": "",
    "signInResult": {
      "address": "7xKX...4bNr",
      "signature": "<base64 64-byte Ed25519 signature>",
      "signedMessage": "<base64 SIWS message bytes>",
      "signatureType": "ed25519"
    },
    "accountLabel": "Phantom Wallet",
    "accountChains": "solana:mainnet,solana:devnet",
    "accountFeatures": "solana:signMessages"
  }
}
```

### Deterministic Log Output (adb logcat)

```
[MWAManager] authorizeSiws | START domain=example.com statement=Sign in to Cocos MWA Example targetPackage=(none) is_connected=false authorizing=false
[MWAManager] authorizeSiws | STEP_1_PARAMS_BUILT app="Cocos MWA Example" cluster=devnet domain=example.com statement=Sign in to Cocos MWA Example elapsed_ms=0
[MWAManager] authorizeSiws | STEP_2_BRIDGE_SENDING cmd=authorize_siws elapsed_ms=1
[MWABridge] sendCommand | START cmd=authorize_siws id=req_001 params_keys=[appName,appUri,appIconPath,cluster,siwsDomain,siwsStatement] timeout_ms=60000
[MWABridge] sendCommand | SENDING id=req_001 json_len=245 pending_count=1
[MWABridge] sendCommand | SENT id=req_001 cmd=authorize_siws
[MWABridgePlugin] onScript | RECEIVED namespace=mwa payload_len=245
[MWABridgePlugin] handleCommand | PARSED id=req_001 cmd=authorize_siws params_keys=[appName,appUri,appIconPath,cluster,siwsDomain,siwsStatement]
[MWABridgePlugin] handleCommand | DISPATCHING cmd=authorize_siws id=req_001
[MWASessionManager] authorizeSiws | START app=Cocos MWA Example cluster=devnet domain=example.com statement=Sign in to Cocos MWA Example
[MWASessionManager] authorizeSiws | STEP_1_SCENARIO_CREATED port=51234 elapsed_ms=12
[MWASessionManager] authorizeSiws | STEP_2_INTENT_LAUNCHED intent_data=solana-wallet://v1/associate/local?association=... elapsed_ms=15
[MWASessionManager] authorizeSiws | STEP_3_AWAITING_CONNECTION timeout=60000ms
  ... (user sees wallet picker, taps Phantom, approves) ...
[MWASessionManager] authorizeSiws | STEP_3_CLIENT_CONNECTED elapsed_ms=4200
[MWASessionManager] authorizeSiws | STEP_4_SIWS_PAYLOAD_BUILT chain=solana:devnet domain=example.com statement=Sign in to Cocos MWA Example elapsed_ms=4201
[MWASessionManager] authorizeSiws | STEP_5_AUTHORIZE_RPC_SENDING identityUri=https://example.com iconUri=/icon.png appName=Cocos MWA Example chain=solana:devnet
[MWASessionManager] authorizeSiws | STEP_5_AUTHORIZE_RPC_RETURNED elapsed_ms=6800
[MWASessionManager] authorizeSiws | STEP_6_RESULT_RECEIVED pubkey=7xKX...4bNr auth_token_len=44 wallet_uri_base=(empty) accounts_count=1 elapsed_ms=6801
[MWASessionManager] authorizeSiws | STEP_7_SIWS_EXTRACTED address=7xKX...4bNr sig_bytes=64 sig_hex_preview=a1b2c3d4e5f6... signedMsg_bytes=128 sigType=ed25519 elapsed_ms=6802
[MWASessionManager] authorizeSiws | STEP_8_ACCOUNT_META label=Phantom Wallet chains=solana:mainnet,solana:devnet features=solana:signMessages elapsed_ms=6803
[MWASessionManager] authorizeSiws | STEP_9_DONE pubkey=7xKX...4bNr hasSiws=true total_elapsed_ms=6804
[MWABridgePlugin] sendResponse | id=req_001 success=true result_len=412
[MWABridgePlugin] sendResponse | SENT id=req_001 via JsbBridge.sendToScript
[MWABridge] onNative | RECEIVED namespace=mwa payload_len=412
[MWABridge] onNative | PARSED id=req_001 has_result=true has_error=false
[MWABridge] onNative | SUCCESS id=req_001 cmd=authorize_siws result_keys=[pubkey,authToken,walletUriBase,signInResult,accountLabel,accountChains,accountFeatures] elapsed_ms=6810
[MWABridge] onNative | RESOLVING id=req_001 pending_count=0
[MWAManager] authorizeSiws | STEP_3_RESULT_RECEIVED has_result=true has_pubkey=true elapsed_ms=6812
[MWAManager] authorizeSiws | STEP_4_PUBKEY_VALID pubkey=7xKX...4bNr elapsed_ms=6812
[MWAManager] authorizeSiws | STEP_5_SIWS_EXTRACTED address=7xKX...4bNr sig_len=88 sig_preview=a1b2c3d4e5f6a7b8... signedMsg_len=172 sigType=ed25519 elapsed_ms=6813
[MWAManager] authorizeSiws | STEP_5_ACCOUNT_META label="Phantom Wallet" chains="solana:mainnet,solana:devnet" features="solana:signMessages" elapsed_ms=6813
[MWAManager] authorizeSiws | STEP_6_STATE_SET pubkey=7xKX...4bNr authToken_len=44 isConnected=true elapsed_ms=6813
[MWAManager] authorizeSiws | STEP_7_CACHED pubkey=7xKX...4bNr authToken_len=44 elapsed_ms=6814
[MWAManager] authorizeSiws | STEP_8_DONE pubkey=7xKX...4bNr hasSiws=true total_elapsed_ms=6815
```

### Key Implementation Details

- **Single wallet prompt**: `client.authorize(..., signInPayload)` combines authorization + SIWS
- **SIWS payload**: `SignInWithSolana.Payload(domain, statement)` — domain must match app URI host
- **signInResult may be null**: Wallet may not support SIWS — logged as `STEP_7_SIWS_NULL`
- **Account metadata**: chains/features extracted from `authResult.accounts[0]`
- **Auth token cached**: Stored in `AuthCache` for `reauthorize()` reconnection
- **Thread safety**: MWA runs on background executor, results marshaled to GL thread via `CocosHelper.runOnGameThread()`

---

## Implementation 13: Sign & Send Transaction

### What It Does

MWA 2.0 sign-and-broadcast. The wallet signs the transaction AND submits it to the Solana
network, returning only the 64-byte transaction signature. The app never touches the signed bytes.

### Files

| Layer | File | Method | Lines |
|-------|------|--------|-------|
| TypeScript | `assets/solana-mwa/scripts/MWAManager.ts` | `signAndSendTransaction()` / `signAndSendTransactions()` | 807-869 |
| Tx Builder | `assets/solana-mwa/scripts/TransactionBuilder.ts` | `buildMemoTransaction()` / `buildSolTransfer()` | 78-162 |
| Bridge | `assets/solana-mwa/scripts/MWABridge.ts` | `sendCommand('sign_and_send')` | 103-152 |
| Java Router | `native/.../mwa/MWABridgePlugin.java` | `case "sign_and_send":` | 149 |
| Java Session | `native/.../mwa/MWASessionManager.java` | `signAndSendTransactions()` | 887-974 |
| Kotlin Lib | `com.solanamobile:mobile-wallet-adapter-clientlib-ktx:2.0.3` | `client.signAndSendTransactions()` | — |

### Data Flow

**Pre-step: Build Transaction (TypeScript)**

The demo uses `TransactionBuilder.ts` to build unsigned transactions manually (zero npm dependencies):
1. `getLatestBlockhash()` via `SolanaRpc.ts` fetch call
2. `buildMemoTransaction(pubkey, memoText, blockhash)` → serialized unsigned tx bytes
3. Transaction is a standard Solana legacy transaction with compact-u16 encoding

**Input (TypeScript → Java):**
```json
{
  "id": "req_003",
  "cmd": "sign_and_send",
  "params": {
    "payloads": ["<base64 unsigned transaction bytes>"],
    "authToken": "..."
  }
}
```

**Java Processing:**
1. Decodes base64 payloads → `byte[][]` transactions
2. Creates `LocalAssociationScenario` (random WebSocket port)
3. Launches wallet intent, awaits WebSocket connection
4. Reauthorizes with cached `authToken` for privileged session
5. Calls `client.signAndSendTransactions(transactions, null, "confirmed", null, null, null)`
6. Wallet signs transaction, broadcasts to Solana network
7. Returns `byte[][]` signatures → encoded as base58 strings

**Output (Java → TypeScript):**
```json
{
  "id": "req_003",
  "result": {
    "signatures": ["5tK8z...base58..."]
  }
}
```

### Deterministic Log Output (adb logcat)

```
[HomeUI] onSignAndSend | START
[SolanaRpc] getLatestBlockhash | START commitment=confirmed
[SolanaRpc] _call | POST url=https://api.devnet.solana.com method=getLatestBlockhash id=1 body_len=68
[SolanaRpc] _call | SUCCESS method=getLatestBlockhash id=1 has_result=true
[SolanaRpc] getLatestBlockhash | SUCCESS blockhash=GHtX...abc lastValidBlockHeight=312456789
[TransactionBuilder] buildMemoTransaction | START fee_payer=7xKX...4bNr memo_len=32 blockhash=GHtX...abc
[TransactionBuilder] buildMemoTransaction | decoded fee_payer_bytes=32 blockhash_bytes=32
[TransactionBuilder] buildMemoTransaction | memo_data_bytes=32 memo_text="Hello from Cocos Creator MWA SDK!"
[TransactionBuilder] serializeTransaction | accounts=2 signers=1 readonly_signed=0 readonly_unsigned=1 instructions=1 message_bytes=103 total_bytes=170
[TransactionBuilder] buildMemoTransaction | DONE tx_bytes=170 accounts=2 instructions=1
[MWAManager] signAndSendTransaction | START tx_bytes=170 is_connected=true
[MWAManager] signAndSendTransactions | START tx_count=1 is_connected=true
[MWAManager] signAndSendTransactions | STEP_1_PAYLOAD_ENCODED [0] bytes=170 base64_len=228
[MWAManager] signAndSendTransactions | STEP_1_PAYLOADS_ENCODED count=1 elapsed_ms=1
[MWAManager] signAndSendTransactions | STEP_2_BRIDGE_SENDING cmd=sign_and_send authToken_len=44 elapsed_ms=1
[MWABridge] sendCommand | START cmd=sign_and_send id=req_003 params_keys=[payloads,authToken] timeout_ms=60000
[MWABridge] sendCommand | SENDING id=req_003 json_len=290 pending_count=1
[MWABridge] sendCommand | SENT id=req_003 cmd=sign_and_send
[MWABridgePlugin] onScript | RECEIVED namespace=mwa payload_len=290
[MWABridgePlugin] handleCommand | PARSED id=req_003 cmd=sign_and_send params_keys=[payloads,authToken]
[MWABridgePlugin] handleCommand | DISPATCHING cmd=sign_and_send id=req_003
[MWASessionManager] signAndSendTransactions | START
[MWASessionManager] signAndSendTransactions | STEP_1_PAYLOAD_DECODED [0] bytes=170
[MWASessionManager] signAndSendTransactions | STEP_1_PAYLOADS_DECODED tx_count=1 elapsed_ms=2
[MWASessionManager] signAndSendTransactions | STEP_2_SCENARIO_CREATED port=52891 elapsed_ms=8
[MWASessionManager] signAndSendTransactions | STEP_3_INTENT_LAUNCHED intent_data=solana-wallet://v1/associate/local?association=... elapsed_ms=10
[MWASessionManager] signAndSendTransactions | STEP_4_AWAITING_CONNECTION timeout=60000ms
  ... (wallet opens, user approves transaction) ...
[MWASessionManager] signAndSendTransactions | STEP_4_CLIENT_CONNECTED elapsed_ms=3500
[MWASessionManager] signAndSendTransactions | STEP_5_REAUTHORIZING token_len=44
[MWASessionManager] signAndSendTransactions | STEP_5_REAUTHORIZED elapsed_ms=4200
[MWASessionManager] signAndSendTransactions | STEP_6_RPC_SENDING tx_count=1 commitment=confirmed skipPreflight=null maxRetries=null
  ... (wallet signs tx, broadcasts to Solana network, waits for confirmation) ...
[MWASessionManager] signAndSendTransactions | STEP_6_RPC_RETURNED elapsed_ms=8900
[MWASessionManager] signAndSendTransactions | STEP_7_SIG[0] base58=5tK8zYmRqWbNeN... sig_bytes=64
[MWASessionManager] signAndSendTransactions | STEP_7_SIGNATURES_EXTRACTED count=1 elapsed_ms=8901
[MWASessionManager] signAndSendTransactions | STEP_8_DONE sig_count=1 total_elapsed_ms=8902
[MWABridgePlugin] sendResponse | id=req_003 success=true result_len=112
[MWABridgePlugin] sendResponse | SENT id=req_003 via JsbBridge.sendToScript
[MWABridge] onNative | RECEIVED namespace=mwa payload_len=112
[MWABridge] onNative | PARSED id=req_003 has_result=true has_error=false
[MWABridge] onNative | SUCCESS id=req_003 cmd=sign_and_send result_keys=[signatures] elapsed_ms=8910
[MWABridge] onNative | RESOLVING id=req_003 pending_count=0
[MWAManager] signAndSendTransactions | STEP_3_RESULT_RECEIVED has_result=true has_signatures=true elapsed_ms=8912
[MWAManager] signAndSendTransactions | STEP_4_SIG[0] base58=5tK8zYmRqWbNeN... sig_len=88
[MWAManager] signAndSendTransactions | STEP_4_SIGNATURES_EXTRACTED count=1 elapsed_ms=8912
[MWAManager] signAndSendTransactions | STEP_5_DONE sig_count=1 first_sig=5tK8zYmRqWbNeNhJ... total_elapsed_ms=8913
[HomeUI] onSignAndSend | SUCCESS sig=5tK8zYmRqWbNeN...
```

### Key Implementation Details

- **Reauthorize before sign**: Uses cached `authToken` to reauthorize in same session (no second wallet prompt)
- **Commitment level**: Hardcoded to `"confirmed"` — wallet waits for network confirmation before returning
- **Signature format**: Wallet returns raw 64 bytes → Java encodes as base58 → TypeScript receives string
- **Transaction builder**: Zero-dependency manual serializer in `TransactionBuilder.ts` — supports memo, SOL transfer, SPL token transfer
- **Multiple transactions**: `signAndSendTransactions()` accepts an array — wallet signs and sends all in one session
- **Error codes**: `NOT_SUBMITTED` (signed but failed to broadcast), `INVALID_PAYLOADS` (malformed tx), `USER_REJECTED`, `TIMEOUT`

---

## Dependencies

```gradle
// native/engine/android/app/build.gradle
implementation 'com.solanamobile:mobile-wallet-adapter-clientlib-ktx:2.0.3'
```

The entire MWA protocol (WebSocket, P-256 ECDH, AES-128-GCM encryption, JSON-RPC 2.0, session negotiation)
is handled by this single Kotlin library. Zero custom crypto code.

## Testing Checklist

### 1. Authorize (Basic)
- [ ] OS wallet picker opens on fresh connect
- [ ] Pubkey returned is valid base58 (32-44 chars)
- [ ] authToken is non-empty
- [ ] AuthCache stores pubkey + token

### 2. Reauthorize (Cached Token)
- [ ] Instant reconnect — no wallet picker
- [ ] Uses cached authToken from previous session
- [ ] Falls back to full authorize on failure
- [ ] Rejected if pubkey was deleted

### 3. Deauthorize (RPC to Wallet)
- [ ] Sends deauthorize RPC to wallet (not just local clear)
- [ ] Local state cleared (isConnected=false)
- [ ] MWA_DISCONNECTED event emitted
- [ ] Non-fatal if deauthorize RPC fails

### 4. Sign Messages
- [ ] Single message: returns 64-byte Ed25519 signature (88 chars base64)
- [ ] Batch: multiple payloads return multiple signatures
- [ ] Reauthorizes in same session (no second wallet prompt)

### 5. Sign Transactions
- [ ] Returns full signed transaction bytes (not just signature)
- [ ] Signed bytes are larger than unsigned (signature injected)
- [ ] Reauthorizes in same session

### 6. Get Capabilities
- [ ] Returns max_txs, max_msgs, versions, features
- [ ] Phantom: max_msgs=1 (not 10)
- [ ] No auth needed (non-privileged)

### 7. Delete Account
- [ ] Single wallet prompt for sign + deauthorize
- [ ] Confirmation signature returned
- [ ] Cache cleared, pubkey recorded as deleted
- [ ] Subsequent reauthorize rejected for deleted pubkey

### 8. Auth Cache
- [ ] Survives app restart (check after kill + relaunch)
- [ ] Reconnect button appears when cache exists
- [ ] clearAll removes all entries

### 9. Multi-Wallet
- [ ] authorizeWithWallet("app.phantom") opens Phantom directly (no OS picker)
- [ ] Subsequent operations target same wallet

### 10. Wallet Detection
- [ ] Returns correct installed status for each known wallet
- [ ] Works without MWA session

### 11. Device Detection
- [ ] isSeeker=true on Seeker hardware
- [ ] isSolanaMobile=true on Solana Mobile devices
- [ ] Returns manufacturer + model strings

### 12. Auth 2.0 (SIWS)
- [ ] STEP_1 through STEP_9 appear in Java logcat
- [ ] STEP_1 through STEP_8 appear in TS logcat
- [ ] elapsed_ms values are reasonable (scenario <100ms, wallet connection <60s, RPC <5s)
- [ ] pubkey matches between Java STEP_6 and TS STEP_4
- [ ] signInResult is non-null (Phantom supports SIWS)
- [ ] sig_bytes=64 (Ed25519 signature)
- [ ] authToken is non-empty (needed for subsequent operations)

### 13. Sign & Send Transaction
- [ ] STEP_1 through STEP_8 appear in Java logcat
- [ ] STEP_1 through STEP_5 appear in TS logcat
- [ ] STEP_5_REAUTHORIZED succeeds (uses authToken from authorize)
- [ ] Transaction signature is valid base58 (check on Solana Explorer)
- [ ] No NOT_SUBMITTED or INVALID_PAYLOADS errors
- [ ] elapsed_ms for STEP_6 (RPC) includes network confirmation time

---

## Extensible Auth Cache Layer

### Interface: `IMWAAuthCache`

Defined in `MWATypes.ts`. Developers implement this to provide custom storage backends.

```typescript
export interface IMWAAuthCache {
    get(pubkey: string): CachedAuth | null;
    getLatest(): CachedAuth | null;
    set(pubkey: string, authToken: string, walletUriBase?: string, walletPackage?: string): void;
    clear(pubkey: string): void;
    clearAll(): void;
    hasCachedAuth(): boolean;
}
```

### Default: `AuthCache` (sys.localStorage)

`AuthCache` implements `IMWAAuthCache` using Cocos Creator's `sys.localStorage` (backed by SQLite on
Android). Persists auth tokens across app restarts. Includes:
- Pubkey validation (Bug #5 prevention)
- Empty token warnings (Bug U3 prevention)
- Cache age logging for debugging
- Multi-pubkey tracking via `mwa_auth_all_keys`

### Custom Cache Injection

```typescript
// Use default (sys.localStorage):
// No code needed — AuthCache is created automatically in onLoad().

// Use custom encrypted cache:
class MyEncryptedCache implements IMWAAuthCache {
    get(pubkey: string): CachedAuth | null { /* ... */ }
    getLatest(): CachedAuth | null { /* ... */ }
    set(pubkey: string, authToken: string, walletUriBase?: string, walletPackage?: string): void { /* ... */ }
    clear(pubkey: string): void { /* ... */ }
    clearAll(): void { /* ... */ }
    hasCachedAuth(): boolean { /* ... */ }
}

// Inject before first authorize:
MWAManager.instance.setCache(new MyEncryptedCache());
```

### Deterministic Logging

Every cache operation logs with `[AuthCache]` prefix:
- `set | START pubkey=... auth_token_len=... wallet_package=...`
- `get | FOUND pubkey=... age_seconds=...` or `get | NOT_FOUND`
- `getLatest | latest_pubkey=... found=true/false`
- `clear | START pubkey=... existed=true/false`
- `clearAll | START count=... removed_count=...`
- `hasCachedAuth | result=true/false`

### Cache Flow

1. **authorize()** → on success, calls `cache.set(pubkey, authToken, walletUriBase, walletPackage)`
2. **reauthorize()** → calls `cache.getLatest()`, sends cached token to wallet for silent re-auth
3. **deauthorize()** → cache NOT cleared (user can reconnect later with cached token)
4. **deleteAccount()** → calls `cache.clearAll()` (permanent removal, prevents reconnect)
