# Wallet Compatibility Matrix

Per-wallet MWA 2.0 behaviour on **Solana Seeker (Android 15), mainnet-beta**, tested 2026-04-18 with the Cocos MWA SDK demo. Each section lists the SDK methods the wallet can and can't service, why, and what the SDK does to route around it.

Status shorthand:
- **YES** — works end-to-end as documented in the MWA 2.0 spec.
- **YES (workaround)** — the SDK has to do something non-obvious to make the call succeed.
- **NO** — wallet-side bug or missing handler; SDK can't fix. Use one of the listed alternatives.

## Quick reference

| Method | Backpack | Jupiter | Phantom | Seed Vault | Solflare |
|---|---|---|---|---|---|
| Connect (`authorize`) | YES | YES | YES | YES | YES |
| Connect with SIWS (`authorize` + `sign_in_payload`) | YES (native) | YES (fallback) | Partial — degrades to authorize-only | YES (native) | NO — wallet crashes |
| Reconnect (`reauthorize`) | YES | YES | YES | YES | YES |
| Sign Message (`sign_messages`) | YES | YES | NO | YES | NO |
| Sign Transaction (`sign_transactions`) | YES | YES | YES (with `minContextSlot`) | YES | YES |
| Sign & Send (native `sign_and_send_transactions`) | NO — wallet crashes | YES | YES | YES | YES |
| Sign & Send (SDK default: `signTransactions` + RPC) | YES | YES | YES | YES | YES |
| Get Capabilities (`get_capabilities`) | YES | YES (cosmetic UI bug) | YES | YES | YES |
| Disconnect (`deauthorize`) | YES | YES | YES | YES | YES |
| Delete Account (memo-gated `sign_transactions`) | YES | YES | YES | YES | YES |

> For all wallets, privileged ops (Sign / Send / Delete) after a Reconnect-cached session will fail with a **"Wrong wallet"** toast if the user picks a different wallet in the OS picker than the one that originally authorized. This is a wallet-protocol constraint (auth tokens are wallet-specific), not a per-wallet bug — classified as `WALLET_AUTH_MISMATCH` in Pass 13. See `KNOWN_ISSUES.md` #17.

---

## Backpack

- **Connect:** YES
- **Connect with SIWS:** YES — returns `sign_in_result` natively, single prompt.
- **Reconnect:** YES
- **Sign Message:** YES
- **Sign Transaction:** YES
- **Sign & Send (native):** **NO** — Backpack's own handler crashes.
- **Sign & Send (SDK default):** YES — the SDK uses `signTransactions` + local RPC broadcast.
- **Get Capabilities:** YES
- **Disconnect:** YES
- **Delete Account:** YES

**What's broken — native `sign_and_send_transactions`**

Call throws `JsonDecodingException: Class discriminator was missing` from inside Backpack's Kotlin layer (`SolanaMobileWalletAdapterWalletLibModule`). The request payload the SDK sends is byte-identical to what Jupiter and Solflare accept cleanly. No upstream fix, no known workaround.

**Blame:** Backpack. Kotlin deserialization bug in their MWA implementation.

**SDK workaround:** `MWAManager.signAndSendTransaction()` routes through the default Sign-then-Broadcast path (`signTransactions()` via MWA → raw JSON-RPC `sendTransaction` via `SolanaRpc`). One wallet prompt, same UX as native, and it's the only path that works on Backpack. The native handler is still exposed as `signAndSendTransactionsNative()` for consumers who want to try it.

> See `KNOWN_ISSUES.md` #9.

---

## Jupiter

- **Connect:** YES
- **Connect with SIWS:** YES (via fallback) — two wallet prompts (authorize + sign_messages), **one** OS wallet picker.
- **Reconnect:** YES
- **Sign Message:** YES
- **Sign Transaction:** YES
- **Sign & Send (native):** YES
- **Sign & Send (SDK default):** YES
- **Get Capabilities:** YES (but see cosmetic note below)
- **Disconnect:** YES
- **Delete Account:** YES

**SIWS detail.** Jupiter doesn't return `sign_in_result` on `authorize`. Pass 11 runs a follow-up `sign_messages` RPC inside the **same** `LocalAssociationScenario` so the user sees only one OS wallet picker; Jupiter signs the CAIP-122 message on the second prompt and the SDK assembles the SIWS proof.

**Cosmetic UI bug — Get Capabilities confirm modal**

Jupiter shows a blank confirmation sheet for `get_capabilities` where the message body never renders. Tapping outside the sheet (instead of a non-existent Confirm button) dismisses it, and the SDK receives a valid capabilities response. Functional, just visually weird.

**Blame:** Jupiter (confirm-screen rendering). Workaround: tap outside the sheet.

> See `KNOWN_ISSUES.md` #14.

---

## Phantom

- **Connect:** YES
- **Connect with SIWS:** **Partial** — authorize succeeds but no `sign_in_result`, and the Pass-11 fallback `sign_messages` is declined by Phantom instantly (`code=-3/sign request declined`, 3 ms, no user prompt). SDK degrades to an authorize-only session without hanging.
- **Reconnect:** YES
- **Sign Message (`sign_messages`):** **NO** — Phantom rejects the RPC (`code=-3`) without prompting the user.
- **Sign Transaction:** YES (previously blocked — fixed by auto-`minContextSlot` fetch, see below).
- **Sign & Send (native):** YES (unlocked by the same `minContextSlot` fix).
- **Sign & Send (SDK default):** YES
- **Get Capabilities:** YES
- **Disconnect:** YES
- **Delete Account:** YES

**What's broken — `sign_messages`**

Phantom doesn't implement the MWA 2.0 `sign_messages` method on Android. Calls return `-3/sign request declined` at the protocol layer; no UI prompt fires. SDK classifies this as `WALLET_HUNG` / `WALLET_AUTH_MISMATCH`-style pattern and surfaces "This wallet doesn't support sign_messages — try Backpack or Jupiter".

**Blame:** Phantom. Missing handler.

**What was fixed — Sign Transaction / Sign & Send hanging**

Before the SDK added automatic `minContextSlot` fetching, Phantom's MWA activity would open but never render an approval prompt — same symptom as upstream issue #1146 in `solana-mobile/mobile-wallet-adapter`. The SDK now fetches `getLatestBlockhash().context.slot` and passes it as `minContextSlot` on every `sign_and_send_transactions` call. Phantom now reliably shows the approve screen.

**Blame:** Phantom (arguably — Phantom's RPC preflight stalled without `minContextSlot`; the spec allows the field to be optional but Phantom treats it as required).

> See `KNOWN_ISSUES.md` #11.

---

## Seed Vault (Solflare wrapper on Seeker)

- **Connect:** YES
- **Connect with SIWS:** YES — returns `sign_in_result` natively through the Seed Vault layer, single prompt. Labeled with the Seed Vault account (e.g. `cofeelme.skr`).
- **Reconnect:** YES
- **Sign Message:** YES
- **Sign Transaction:** YES
- **Sign & Send (native):** YES
- **Sign & Send (SDK default):** YES
- **Get Capabilities:** YES
- **Disconnect:** YES
- **Delete Account:** YES

**Note on `walletUriBase`.** Seed Vault authorize responses carry an empty `walletUriBase`, same as Backpack / Phantom / Solflare. Reconnect-cached sessions therefore hit the OS picker for privileged ops (see top-of-file note on `WALLET_AUTH_MISMATCH`). This does **not** affect Seed Vault specifically — it's a universal wallet-UX artefact.

**Fee-payer gotcha.** The Seeker firmware's wrapper sometimes injects ComputeBudget priority-fee instructions that raise the tx's rent-exempt requirement above the fee-payer balance. Pre-broadcast the SDK checks balance via `SolanaRpc.getBalance` and surfaces `INSUFFICIENT_FUNDS_FOR_RENT` instead of a generic RPC rejection toast.

**Blame:** None — works as designed.

> See `KNOWN_ISSUES.md` #13.

---

## Solflare

- **Connect:** YES
- **Connect with SIWS:** **NO** — Solflare's own MWA activity crashes on `authorize` when `sign_in_payload` is attached. Flutter throws `Reply already submitted in onActivityResult`. The SDK's JS bridge times out at 60 s; Java times out at 98 s (`TimeoutException id=1`).
- **Reconnect:** YES (plain, no SIWS)
- **Sign Message (`sign_messages`):** **NO** — same Flutter crash class.
- **Sign Transaction:** YES
- **Sign & Send (native):** YES
- **Sign & Send (SDK default):** YES
- **Get Capabilities:** YES
- **Disconnect:** YES
- **Delete Account:** YES (uses `sign_transactions`, not `sign_messages`).

**What's broken — `sign_messages` and `authorize + sign_in_payload`**

Solflare's Flutter app throws `Reply already submitted in onActivityResult` and closes the MWA activity before sending a protocol-level reply. The MWA client library then sees a dead WebSocket and surfaces `CancellationException` / null-cause `ExecutionException`. The SDK classifies this as `WALLET_CRASHED` and suggests "try Backpack, Phantom, or Jupiter".

**Blame:** Solflare (Flutter plugin bug). Same underlying defect surfaces on both `sign_messages` and `authorize_siws`.

**SDK mitigation.**
- Pass 12's `USE_SIWS_ON_CONNECT` flag (default `false` in the demo) keeps the default Connect path Solflare-compatible. Flip to `true` to opt into SIWS; Solflare will be the only wallet that fails.
- Sign Message button gets a `UNSUPPORTED` status + toast when the wallet matches a known-no-`sign_messages` package, so the user gets a clear signal before the crash happens.

> See `KNOWN_ISSUES.md` #6, #11, #16.

---

## SDK-level gotchas (apply to every wallet)

1. **Wrong wallet after Reconnect (cached) → `WALLET_AUTH_MISMATCH` toast.** Auth tokens are wallet-specific. The cached token from Wallet A is rejected (`code=-1`) if the user picks Wallet B in the OS picker for a privileged op. Pass 13 classifies this and surfaces a clear "Wrong wallet — use the wallet you connected with, or Disconnect and Connect again" toast on Sign Message / Sign Transaction / Sign & Send / Delete. Deep-link targeting via cached `walletUriBase` is the next planned fix (only Jupiter returns a non-empty `walletUriBase`, so it's partial). See `KNOWN_ISSUES.md` #17.

2. **Phantom Blowfish warnings on unverified identity.** Phantom runs an on-device reputation check on every sign request. An unregistered dApp identity (i.e. this demo) will stack one or more "may be malicious" modals before the approve screen. The Pass-12 demo identity (`github.com/mstevens843/Cocos-Solana-MWA-SDK`) softens this but can't eliminate it — only Phantom-side dApp verification does. Unrelated to any wallet bug. See `KNOWN_ISSUES.md` #12.

3. **Cluster = `mainnet-beta`.** Backpack rejects `devnet` with a "network not supported" toast and never replies (90 s timeout). Jupiter's Seeker integration is also mainnet-only. Don't flip the demo's `setCluster('devnet')` expecting universal support.
