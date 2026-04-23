# Token Duel — Hosted Tournaments (Part 14)

## What is a tournament?

A **tournament** is a BattleRoyale (10-player) match seeded by a dedicated
backend keypair called the **tournament host**. Every N minutes (15 on
devnet, 60 on mainnet), the host cron signs `join_match_create` and takes
slot 0. Real players fill slots 1–9. The host never submits a height —
after the 5-minute force-settle timeout, the host's slot is forfeit and
its 0.001 SOL stake goes to the top-3 real players as a **prize-pool
subsidy**.

Tournaments are surfaced in the client as:
- A purple `HomeTournamentBadge` on the Home panel with countdown text.
- A dedicated `TournamentPanel` with 10-slot roster + 🥇🥈🥉 medals on
  settlement.
- A special ticker format (`⚔ TOURNAMENT · N/10 joined · ...`).

## Why a host keypair instead of a new Rust ix?

Shipping zero Rust changes means no program redeploy + no program
upgrade-auth review cycle. The host's ~0.001 SOL per tournament is a
feature for the pitch — "the protocol seeds every tournament pot, so
small matches are still worth winning."

## Operator setup — step by step

### 1. Generate a host keypair

```bash
solana-keygen new --outfile /opt/token-duel/host.json --no-bip39-passphrase
```

Keep this keypair file readable only by the backend user. Do **not**
reuse the admin keypair — the host is hot-wallet-equivalent (always on,
always signing) while admin should stay cold.

### 2. Fund the host

Devnet: `solana airdrop 0.5 $(solana-keygen pubkey /opt/token-duel/host.json) --url devnet`

Mainnet: transfer ≥0.1 SOL from treasury. At 0.001 SOL/tournament and a
1-hour cadence, 0.1 SOL supports ~100 tournaments (4 days of
continuous operation).

### 3. Initialize the host's UserStats PDA

```bash
cd scripts
npm run init-tournament-host -- --keypair /opt/token-duel/host.json
```

The `settle_match` final path requires all players' UserStats PDAs in
`remaining_accounts`. Without this one-shot init, the first tournament's
settle will fail.

### 4. Export the host's secret to base58 + set env vars

```bash
cat /opt/token-duel/host.json | \
  node -e "const kp=JSON.parse(require('fs').readFileSync(0));console.log(require('bs58').encode(Buffer.from(kp)))"
```

Copy that string into `backend/.env.local`:

```
TOURNAMENT_HOST_SECRET=<base58 output>
TOURNAMENT_CRON_ENABLED=true
TOURNAMENT_CADENCE_MS=900000
TOURNAMENT_STAKE_TIER=5
```

### 5. Restart the backend

```bash
systemctl restart token-duel-backend
# or on Fly/Railway: push a no-op commit to trigger redeploy
```

Backend logs should show:

```
[tournament-host] ctor | host=XXX... cadence=900000ms tier=5 window=1
[tournament-host] start | scheduler armed cadence=900000ms next_tick=+10s
[tournament-host] tick | OK match=YYY... sig=ZZZ... https://explorer.solana.com/...
```

## Monitoring

### Admin dashboard
- `/admin` shows a dedicated "⚔ Tournaments today" card.
- Sub-text reads `seeded · N/M completed all-time`.

### Programmatic
```bash
curl https://backend/admin/snapshot | jq '.tournamentsSeededToday, .tournamentsSeededAllTime, .tournamentsCompletedAllTime'
curl https://backend/tournaments/host          # returns { host, cadenceMs }
```

### Client
- Home panel's `HomeTournamentBadge` appears purple when a tournament is
  Waiting.
- Ticker line shows `⚔ TOURNAMENT` prefix when the current match is a
  tournament.

## Failure modes + recovery

### Host runs out of SOL
`tournament-host | tick | FAIL insufficient funds` appears in backend
logs. Refund the host and restart; no tournament state on-chain is
corrupted (the cron just skips a tick).

### No one joins within 2 min
The match is cancelable by the host via `cancel_match`. The host's
stake is refunded. Backend does **not** currently auto-cancel empty
tournaments — this is acceptable for devnet (free SOL) but should be
added for mainnet (deferred to Part 15).

### Match fills but no one submits heights
After 5 minutes Active, anyone (including the host) can call
`force_settle`, which fills all u32::MAX heights with 0 and settles
normally. The host's height stays 0 (it never submitted), so the host
places last and forfeits its stake to the top-3 real players.

### RPC outage during tick
The `RakeListener` + `TournamentHost` both wrap their Solana calls in
try/catch and log warnings. Next tick retries. The `getLatestBlockhash`
failure is common on devnet and is handled by the retry loop in
`tournament_host.ts::createTournamentMatch`.

## Decommissioning

To stop tournaments without redeploying:

```bash
# Set in backend env:
TOURNAMENT_CRON_ENABLED=false
# Restart backend.
```

To reclaim remaining SOL from the host:

```bash
solana transfer <admin pubkey> ALL \
  --from /opt/token-duel/host.json \
  --url mainnet-beta \
  --fee-payer <admin pubkey>
```

Leave the host keypair around — tournaments use a deterministic pubkey
that's hard-coded into the ticker's `isTournament` check via the
`/tournaments/host` endpoint lookup.

## Future work (Part 15+)

- Multi-round bracket tournaments (quarter → semi → final)
- Auto-cancel empty tournaments after 2 min timeout
- Variable prize structures for different tier tournaments
- Tournament leaderboard PDA tracking all-time tournament wins
- Whale-tier scheduled tournaments (0.1 SOL buy-in, 4-hr cadence)
