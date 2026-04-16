# Cocos Creator MWA SDK for Solana

A complete Solana Mobile Wallet Adapter (MWA) 2.0 SDK for Cocos Creator 3.8+ — bringing full MWA API parity to the dominant mobile game engine in Asia (1.7M+ developers, zero prior Solana integration).

Built and tested on Solana Seeker hardware with Phantom, Solflare, Backpack, Jupiter, and Seed Vault.

## Features

| Method | Description | Status |
|--------|-------------|--------|
| `authorize` | Connect wallet via OS picker or targeted package | Verified |
| `authorizeSiws` | MWA 2.0 Sign In With Solana (one-shot connect + prove ownership) | Verified |
| `reauthorize` | Silent reconnect with cached auth token | Verified |
| `deauthorize` | Disconnect wallet session (sends MWA RPC, not just local clear) | Verified |
| `signMessages` | Sign arbitrary messages with Ed25519 | Verified |
| `signTransactions` | Sign transactions without broadcast | Verified |
| `signAndSendTransactions` | Sign + broadcast to Solana, returns tx signature | Verified |
| `getCapabilities` | Non-privileged query for wallet limits and features | Verified |
| `deleteAccount` | Wallet-confirmed account deletion with biometric | Verified |

### Additional Capabilities

- **Auth Caching** — Persistent token storage via `sys.localStorage` for silent reconnection across app restarts
- **Multi-Wallet Support** — Seed Vault (biometric), Phantom, Solflare, Backpack, Jupiter
- **Wallet Detection** — Detect installed MWA-compatible wallets by package name
- **Device Detection** — Identify Solana Mobile devices (Seeker, Saga)
- **Compound Commands** — `authorize_and_sign` (single-session biometric) and `sign_and_deauthorize` (delete flow)
- **Transaction Builder** — Zero-dependency binary serializer for memo, SOL transfer, and SPL token transfer
- **Deterministic Logging** — Every operation logs entry, parameters, results, and exit at both Java and TypeScript layers

## Architecture

```
TypeScript (Cocos Creator)          Java (Android Native)
─────────────────────────           ──────────────────────
MWAManager.ts                       MWABridgePlugin.java
  │ async/await API                   │ JsbBridge command router
  ▼                                   ▼
MWABridge.ts                        MWASessionManager.java
  │ JSON protocol over JsbBridge      │ LocalAssociationScenario
  ▼                                   ▼
native.bridge.sendToNative()        clientlib-ktx 2.0.3
                                      │ WebSocket + ECDH + AES-GCM
                                      ▼
                                    Wallet App (Phantom, Seed Vault, etc.)
```

Each MWA operation creates a fresh `LocalAssociationScenario` on a random ephemeral port (49152-65535), encrypted via ECDH key exchange. The JsbBridge protocol uses JSON commands with automatic request ID correlation and 60-second timeouts.

## Quick Start

### 1. Install Cocos Creator 3.8+

Download from [cocos.com/en/creator-download](https://www.cocos.com/en/creator-download).

### 2. Copy the SDK into your project

```
your-project/
  assets/
    solana-mwa/          <-- copy this directory
      scripts/
        MWAManager.ts
        MWABridge.ts
        MWATypes.ts
        AuthCache.ts
        AppIdentity.ts
        TransactionBuilder.ts
        SolanaRpc.ts
        Base58.ts
        MWAEvents.ts
```

### 3. Build for Android once

Project -> Build -> Android -> Build. This generates the `native/` directory.

### 4. Copy Java native layer

Copy the Java files into your native Android source:

```
native/engine/android/app/src/com/cocos/game/mwa/
  MWABridgePlugin.java
  MWASessionManager.java
  MWAIntentHelper.java
  WalletDetector.java
  AndroidToastHelper.java
```

### 5. Add dependencies

Add to `native/engine/android/app/build.gradle`:

```groovy
dependencies {
    implementation 'com.solanamobile:mobile-wallet-adapter-clientlib-ktx:2.0.3'
}
```

Add the Solana Mobile Maven repository:

```groovy
repositories {
    maven { url 'https://maven.solanamobile.com/releases' }
}
```

### 6. Patch AndroidManifest.xml

Add inside `<manifest>`:

```xml
<queries>
    <intent>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="solana-wallet" />
    </intent>
</queries>
```

### 7. Initialize the bridge

In your `AppActivity.java` `onCreate()`:

```java
import com.cocos.game.mwa.MWABridgePlugin;

@Override
protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    MWABridgePlugin.init(this);
}
```

### 8. Use the SDK

```typescript
import { MWAManager } from './solana-mwa/scripts/MWAManager';

// Connect
const result = await MWAManager.instance.authorize();

// Connect with SIWS (MWA 2.0)
const siwsResult = await MWAManager.instance.authorizeSiws('myapp.com', 'Sign in to MyApp');

// Sign a message
const sig = await MWAManager.instance.signMessage('Hello Solana!');

// Sign and send a transaction
const txSigs = await MWAManager.instance.signAndSendTransactions([serializedTx]);

// Get wallet capabilities
const caps = await MWAManager.instance.getCapabilities();

// Disconnect
await MWAManager.instance.deauthorize();
```

## Wallet Support

| Wallet | Connect | Sign | Sign & Send | Delete | Notes |
|--------|---------|------|-------------|--------|-------|
| Phantom | Yes | Yes | Yes | Yes | Full parity |
| Solflare | Yes | Yes | Yes | Yes | signMessage has known MWA bug |
| Backpack | Yes | Yes | Yes | Yes | Full parity |
| Jupiter | Yes | Yes | Yes | Yes | Full parity |
| Seed Vault | Yes | Yes | Yes | Yes | Biometric flow via compound commands |

## Debugging

All operations produce deterministic logs viewable via `adb logcat`:

```
adb logcat -s cocos-mwa MWAManager MWABridge MWASessionManager
```

Log format: `[TAG] method | PHASE key=value key2=value2`

Example flow:
```
[MWAManager] authorize | START is_connected=false authorizing=false
[MWASessionManager] authorize | START app=MyApp cluster=devnet
[MWASessionManager] authorize | scenario created port=52341
[MWASessionManager] authorize | client connected
[MWASessionManager] authorize | SUCCESS pubkey=7xKX...4bNr auth_token_len=87
[MWAManager] authorize | STATE_SET pubkey=7xKX...4bNr authToken_len=87 isConnected=true
[MWAManager] authorize | DONE connected=true — emitted MWA_AUTHORIZED
```

## Sister Projects

- [godot-solana-mwa-example](https://github.com/mstevens843/godot-solana-mwa-example) — Godot 4.x MWA example app
- [godot-solana-sdk](https://github.com/mstevens843/godot-solana-sdk) — Godot SDK fork with MWA 2.0 Kotlin plugin
- [Solana.Unity-SDK](https://github.com/mstevens843/Solana.Unity-SDK) — Unity SDK fork with MWA 2.0 C# implementation

## License

MIT
