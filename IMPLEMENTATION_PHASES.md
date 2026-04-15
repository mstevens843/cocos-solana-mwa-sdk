# Cocos MWA — Implementation Phases for Full Parity

## Goal
Bring the Cocos Solana MWA example app to **exact feature parity** with the Godot and Unity MWA example apps, covering all MWA 2.0 API methods, all wallet types, and all user flows.

---

## What's Already Done (Parity Achieved)

| Feature | Status | Notes |
|---------|--------|-------|
| authorize (OS picker) | Done | Seed Vault compound `authorize_and_sign` |
| authorize (targeted wallet) | Done | `Intent.setPackage(targetPackage)` bypasses OS picker |
| reauthorize | Done | Sends actual MWA reauthorize RPC (better than Godot/Unity cache-only) |
| deauthorize | Done | Sends MWA deauthorize to wallet + clears local state |
| signMessage / signMessages | Done | UTF-8 encode, base64 payload, Ed25519 signature return |
| signAndSendTransaction(s) | Done | Wallet signs + broadcasts, returns base58 signatures |
| getCapabilities | Done | Returns max_txs, max_msgs, supported_versions, features |
| deleteAccount | Done | Compound `sign_and_deauthorize` in single MWA session |
| Auth caching | Done | localStorage-backed, survives app restarts |
| Multi-wallet (Phantom, Backpack, Solflare, Espresso) | Done | 4 wallets with install detection |
| Device detection (Seeker/Saga) | Done | Tab bar layout switching |
| Toast notifications | Done | Native Android toasts |
| Status display | Done | Real-time operation feedback |

---

## What's Missing (Gap Analysis)

### Gap 1: `sign_transactions` (sign without broadcast) — CRITICAL
- **Godot**: `sign_transaction()` + SignTxButton — calls `sign_message(tx_bytes, 0)`
- **Unity**: `SignTransaction()` + SignTxButton — calls `Web3.Wallet.SignTransaction(tx)`
- **Cocos**: **MISSING** — no Java method, no bridge command, no TS method, no UI button
- **Impact**: Cannot demonstrate the full MWA 2.0 method set

### Gap 2: Jupiter wallet — HIGH
- **Godot/Unity**: Jupiter button, tested working on Seeker hardware
- **Cocos**: Not in WalletDetector, no button in scene
- **Impact**: Missing 1 of 5 wallets that competitors support

### Gap 3: Wallet name on Home screen — MEDIUM
- **Godot/Unity**: Shows "7etj...Fm3w (Phantom)" — pubkey + wallet name
- **Cocos**: Shows "7xKX...4bNr" only — no wallet name
- **Impact**: Users can't tell which wallet they're connected to

### Gap 4: Deleted pubkeys tracking — LOW-MEDIUM
- **Godot/Unity**: `_deleted_keys` / `_deletedPubkeys` prevents reconnect to deleted account
- **Cocos**: No tracking — could reconnect to deleted account via cache
- **Impact**: Edge case, but could cause confusion

### Gap 5: Solflare delete routing — CONDITIONAL
- **Godot/Unity**: Solflare uses re-auth for delete (signMessage broken in separate sessions)
- **Cocos**: Uses compound `sign_and_deauthorize` — single session, might work for Solflare
- **Impact**: Needs hardware testing before deciding

---

## Phase 1: sign_transactions (Full Stack)
**Priority**: Critical | **Effort**: Medium | **Type**: SDK + App

### Files to Modify

#### `native/.../MWASessionManager.java`
Add `signTransactions(JSONObject params, ResultCallback callback)`:
- Parse `payloads` (base64 tx array) from params
- Create LocalAssociationScenario, launch intent with targetPackage support
- Reauthorize with authToken for privileged session
- Call `client.signTransactions(transactions).get()`
- Return `{ "signedPayloads": ["base64_signed_tx", ...] }`

#### `native/.../MWABridgePlugin.java`
Add case between `sign_messages` and `sign_and_send`:
```java
case "sign_transactions":
    sSessionManager.signTransactions(params, callback);
    break;
```

#### `assets/solana-mwa/scripts/MWAManager.ts`
Add after `signMessages()`, before `signAndSendTransaction()`:
- `signTransaction(tx: Uint8Array): Promise<Uint8Array>` — single tx convenience
- `signTransactions(txs: Uint8Array[]): Promise<Uint8Array[]>` — sends `sign_transactions`, decodes base64 response

#### `assets/solana-mwa/scripts/MWABridge.ts`
Add `sign_transactions` mock response for editor testing.

### Verification
- Editor: mock mode returns fake signed payloads
- Hardware: Sign memo tx with Seed Vault, Phantom, Solflare — verify signed bytes returned without broadcast

---

## Phase 2: Sign Transaction UI Button
**Priority**: High | **Effort**: Low | **Type**: App only

### Files to Modify

#### `generate-scenes.js`
- Uncomment SignTxButton (line 162)
- Shift remaining buttons down by 110px
- Add to HomePanel children array

#### `assets/demo/scripts/AppUI.ts`
- Add `'SignTxButton'` to `homeBtnNames` array
- Add `_onSignTransaction` handler: fetch blockhash → build memo tx → `MWAManager.signTransaction(tx)` → show success/failure

### Verification
- Button visible on Home panel between "Sign Message" and "Sign & Send"
- Tapping signs transaction without broadcasting

---

## Phase 3: Jupiter Wallet Support
**Priority**: High | **Effort**: Low | **Type**: SDK + App

### Files to Modify

#### `native/.../WalletDetector.java`
Add to `KNOWN_WALLETS`:
```java
{"Jupiter", "ag.jup.app", "https://play.google.com/store/apps/details?id=ag.jup.app"}
```
> Note: Package name `ag.jup.app` needs hardware verification. If incorrect, only this string changes.

#### `generate-scenes.js`
Add JupiterButton to WalletListPanel (green-orange brand color).

#### `assets/demo/scripts/AppUI.ts`
Add `{ nodeName: 'JupiterButton', pkg: 'ag.jup.app' }` to `WALLET_BUTTONS`.

#### `assets/solana-mwa/scripts/MWABridge.ts`
Add Jupiter to mock wallet detection list.

### Verification
- Jupiter button visible on wallet list
- If installed: tapping connects to Jupiter wallet
- If not installed: tapping opens Play Store

---

## Phase 4: Wallet Name Display
**Priority**: Medium | **Effort**: Low | **Type**: SDK + App

### Files to Modify

#### `assets/solana-mwa/scripts/MWAManager.ts`
Add `walletDisplayName(pkg?: string): string`:
```typescript
"app.phantom" → "Phantom"
"app.backpack" → "Backpack"
"com.solflare.mobile" → "Solflare"
"com.pleasecrypto.flutter" → "Espresso Cash"
"ag.jup.app" → "Jupiter"
"" → "Seed Vault"
```

#### `assets/demo/scripts/AppUI.ts`
Modify `_showHome()` to show `"7xKX...4bNr (Phantom)"` using `walletDisplayName()`.

### Verification
- Connect via each wallet → Home shows correct wallet name next to pubkey

---

## Phase 5: Deleted Pubkeys Tracking
**Priority**: Low-Medium | **Effort**: Low | **Type**: SDK

### Files to Modify

#### `assets/solana-mwa/scripts/MWAManager.ts`
- Add `private _deletedPubkeys: Set<string> = new Set()`
- `authorize()`: Clear set at start (fresh connect = clean slate)
- `deleteAccount()`: Add pubkey to set before clearing state
- `reauthorize()`: Reject if result pubkey is in deleted set → fall back to `authorize()`

### Verification
- Delete account → tap Reconnect → should NOT reconnect to deleted pubkey
- Delete account → tap Connect → should open fresh OS picker

---

## Phase 6: Solflare Delete Routing (Conditional)
**Priority**: Conditional | **Effort**: Low | **Type**: App

### Decision Required
Test compound `sign_and_deauthorize` with Solflare on Seeker hardware:
- **If it works**: No changes needed (Cocos compound approach is superior)
- **If it fails**: Add wallet-specific routing in `deleteAccount()` — Solflare uses `reauthorize()` for confirmation

### Files to Modify (only if needed)

#### `assets/solana-mwa/scripts/MWAManager.ts`
Add Solflare check at top of `deleteAccount()`:
```typescript
if (this.connectedWalletPackage === 'com.solflare.mobile') {
    // Solflare: reauthorize for confirmation (signMessage broken in separate sessions)
    const reauth = await this.reauthorize();
    if (!reauth) return;
    await this.deauthorize();
    this._cache.clearAll();
    this.node.emit(MWA_DISCONNECTED);
    return;
}
```

---

## Implementation Order

```
Phase 1 + 2 (together) → sign_transactions + UI button
     ↓
Phase 3 → Jupiter wallet
     ↓
Phase 4 → Wallet name display
     ↓
Phase 5 → Deleted pubkeys tracking
     ↓
Phase 6 → Solflare routing (only if hardware test reveals issue)
```

Phases 1+2 must be done together (button needs the method).
Phases 3, 4, 5 are independent and can be done in any order.
Phase 6 depends on hardware testing results.

---

## Build & Test Checklist

After all phases:
1. `node generate-scenes.js` — regenerate scene
2. Delete `library/` and `temp/` directories
3. Open in Cocos Creator, verify no errors
4. Build Android APK (ARM64, API 25+)
5. Install on Solana Seeker

### Test Matrix

| Wallet | Connect | Sign Msg | Sign Tx | Sign&Send | Capabilities | Disconnect | Reconnect | Delete |
|--------|---------|----------|---------|-----------|-------------|------------|-----------|--------|
| Seed Vault | | | | | | | | |
| Phantom | | | | | | | | |
| Solflare | | | | | | | | |
| Backpack | | | | | | | | |
| Jupiter | | | | | | | | |

### Flow Tests
- [ ] Connect → Disconnect → Connect (fresh, OS picker should appear)
- [ ] Connect → Disconnect → Reconnect (cached, instant)
- [ ] Connect → Delete → Connect (cache cleared, fresh connect)
- [ ] Connect → Delete → Reconnect (should fail, cache cleared)
- [ ] Wallet name shows correctly for each wallet type
