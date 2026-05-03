# Token Duel Backend - Receipt Signer (Part 10 Bundle 1)

Tiny Node service that observes Token Duel gameplay over WebSocket, validates
each block drop against physics rules, and signs an Ed25519 receipt at game
over. The Solana program (`settle_match_verified` instruction) verifies that
receipt via the native Ed25519 precompile before settling. A modified APK can
submit any u32 height it wants to the *legacy* `settle_match` path - but it
cannot forge a server signature. On mainnet, disable the legacy fallback and
the cheat loophole is fully closed.

**Stack:** Node 20 · TypeScript · Express · ws · tweetnacl · @solana/web3.js · 148 total deps.

---

## Local development

```bash
cd backend
npm install
npm run test:physics    # physics validator unit tests
npm run test:receipt    # sign + verify a receipt end-to-end
npm run dev             # tsx watch src/server.ts (hot reload)
```

Without `RECEIPT_SIGNER_SECRET`, the signer derives a **deterministic dev keypair** from the seed `"token-duel-receipt-signer-devnet-v1"` - pubkey `EiAotb9jwAbGjAWZ54bgHsS4QmUGQdETZL1Zmey4qRVA`. This exact pubkey is hard-coded as `RECEIPT_SIGNER_PUBKEY` in `programs/token-duel/src/state.rs`, so local dev works without any key management.

```bash
curl http://localhost:3000/health
curl http://localhost:3000/pubkey
```

---

## Wire protocol

### `POST /session/start`
Request:
```json
{
  "matchPda": "<base58>",
  "playerPubkey": "<base58>",
  "squadMints": ["<mint>", "<mint>", "<mint>"],
  "timeWindow": "1h" | "1d" | "3d" | "7d"
}
```
Response:
```json
{
  "sessionId": "<uuid>",
  "serverPubkey": "<base58>",
  "wsUrl": "wss://backend/session/<uuid>/stream",
  "expectedWidths": { "<mint>": 220, ... },
  "startedAt": 1713912345678
}
```

### `WS /session/:sessionId/stream`
Client → server:
```json
{ "kind": "drop", "blockIdx": 0, "tsMs": 1713912346500, "xPos": 12.4, "width": 220, "outcome": "ok" }
{ "kind": "finalize", "finalHeight": 17 }
```
Server → client:
```json
{ "kind": "ack", "blockIdx": 0 }
{ "kind": "reject", "blockIdx": 1, "reason": "width 280px diverges from expected 220px (diff 60)" }
{ "kind": "receipt", "ed25519IxDataB64": "<base64>", "signedAt": 1713912360, "height": 17 }
{ "kind": "fatal", "reason": "blacklisted" }
```

After receiving `{ kind: 'receipt' }`, the client builds a transaction with two instructions:
1. Ed25519 precompile ix (raw data = `ed25519IxDataB64`)
2. `settle_match_verified(height, signedAt)` Anchor ix

Signs via MWA and sends. The Solana program verifies the signed message matches `(match_pda || player || height || signed_at)` exactly, rejects if the signer isn't the expected server pubkey, then runs the same payout logic as legacy `settle_match`.

---

## Production deploy

### Option 1: Railway (recommended)

Free tier comfortably handles ~50 concurrent players; Pro ($5/month) scales to 500+.

```bash
# 1. Generate production keypair (run locally, NEVER commit output)
cd scripts
npm run keygen-receipt-signer
#   → prints PUBKEY + SECRET

# 2. Update the program constant
#   Paste PUBKEY into programs/token-duel/src/state.rs as RECEIPT_SIGNER_PUBKEY
anchor build && anchor deploy --provider.cluster mainnet-beta

# 3. Deploy backend
cd ../backend
railway login
railway init
railway link       # link to Token Duel project
railway up         # uploads Dockerfile + builds

# 4. Set env vars (via Railway dashboard OR CLI)
railway variables set RECEIPT_SIGNER_SECRET="<secret from step 1>"
railway variables set BIRDEYE_API_KEY="<your Birdeye premium key>"
railway variables set RPC_URL="https://api.mainnet-beta.solana.com"

# 5. Sanity check
curl https://<your-project>.up.railway.app/pubkey
# Must return exact pubkey that's in state.rs.
```

Update the client's `RECEIPT_BACKEND_URL` in `assets/token-duel/scripts/constants.ts` to point at the Railway URL.

### Option 2: Fly.io

```bash
fly launch --copy-config --no-deploy
fly secrets set RECEIPT_SIGNER_SECRET="..." BIRDEYE_API_KEY="..." RPC_URL="..."
fly deploy
```

### Option 3: docker run (self-hosted VM)

```bash
docker build -t td-backend .
docker run -d -p 3000:3000 \
  -e RECEIPT_SIGNER_SECRET="..." \
  -e BIRDEYE_API_KEY="..." \
  -e RPC_URL="..." \
  --name td-backend td-backend
```

---

## Key rotation

To rotate the signer keypair (e.g. after a leak or for mainnet launch):

1. Generate new keypair: `cd scripts && npm run keygen-receipt-signer`.
2. Update `RECEIPT_SIGNER_PUBKEY` in `programs/token-duel/src/state.rs`.
3. `anchor build && anchor deploy` - this is a program upgrade.
4. Rolling deploy: set new `RECEIPT_SIGNER_SECRET` in backend env, redeploy.
5. All in-flight receipts signed with the old key become invalid - players mid-match will get `InvalidReceiptSigner` and have to replay. Acceptable for a rare rotation.

For zero-downtime rotation, accept **two** signer pubkeys in Rust for a transition window (not implemented in v1 - add if rotation becomes routine).

---

## Monitoring

- `/health` returns `{ ok, sessions: { sessionsAlive, blacklisted }, uptimeSec }`. Hit from Railway / Fly healthcheck + your uptime monitor of choice.
- Logs: everything goes to stdout, structured with `[tag]` prefixes. Stream from Railway dashboard or `fly logs`.
- **Tune capacity**: `MAX_CONCURRENT_SESSIONS` gates at the backend level. Beyond this, `/session/start` returns 503 and the client falls back to legacy `settle_match`.

---

## Cheat detection

Each rejected drop increments `session.rejectedCount`. After 3 rejects, the player's pubkey is blacklisted for 1 hour - no new sessions, no signatures. Blacklist is in-memory; it evaporates on restart. For persistent blacklist, wire up a tiny SQLite layer (TODO Part 11).

The physics validator catches:
- Superhuman tap timing (< 150ms between drops)
- Wrong block widths (squad-delta mismatch)
- Out-of-order block indices
- Post-miss drops
- Stall bots (> 8s gap)
- Session timeouts (> 3 min)

It does **not** catch AI-assisted perfect-timing bots yet - they'd pass physics but achieve superhuman heights. Mitigation for v2: add a macro-detection heuristic (too-perfect x-position centering) or require per-match random seeds that force different optimal paths.

---

## Fallback behavior

If the backend is unreachable (network error, 5xx, or the client skips `/session/start`), the client falls back to legacy `settle_match`. The match still settles; the player just doesn't get a verified receipt. On the PostMatch panel they see a yellow "⚠ Unverified" badge. This keeps the game playable even when the backend is down, at the cost of cheat-resistance for that round.

For **mainnet launch**: disable the fallback path entirely - require verified receipts for all real matches. Set `TD_REQUIRE_VERIFIED = true` in the client build and the legacy ix dispatcher can be removed from the program (future breaking upgrade).
