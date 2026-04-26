# Token Duel — Backend DB Runbook

This is the operations doc for the Postgres database that powers the
backend's persistent state. Schema lives in
`backend/migrations/001_initial.sql`. Helpers in `backend/src/db.ts`.

Last updated: 2026-04-25 (DB Stage 1–6 ship).

---

## What lives in the DB

| Table | Purpose | Source |
|---|---|---|
| `users` | Profile + display name (cross-device) | Auto-created on first backend interaction |
| `paper_xp` | Paper/Bot XP totals (cross-device) | Client POSTs delta after settle |
| `match_history` | Denormalized settled-match log | Client POSTs after settle (idempotent on `match_pda`) |
| `token_winrates` | Per-mint per-week win/match counters | Bumped server-side on first match_history INSERT |
| `notifications` | Persistent notification feed | Push from `notification_listener.ts` |
| `schema_migrations` | Migration audit | Auto-managed by `migrate.ts` |

What's **NOT** in the DB (intentional):
- **On-chain UserStats.xp / level / streak** — authoritative on-chain. DB does NOT mirror; client reads chain directly.
- **MatchAccount PDA data** — on-chain audit trail. `match_history` is a denormalized projection for fast queries, not a duplicate.
- **Sound / haptics / per-device prefs** — stay in localStorage.
- **Live match ticker** — RPC-sourced, ephemeral.

---

## Local dev setup

One-shot script:

```bash
bash scripts/setup-local-db.sh
```

This installs Homebrew Postgres 16, creates `token_duel_dev`, runs migrations, and prints the local `DATABASE_URL` to paste into `backend/.env.local`.

After setup, your `backend/.env.local` should include:

```
DATABASE_URL=postgresql://YOUR_USER@localhost:5432/token_duel_dev
DB_SSL=false
DB_POOL_MAX=5
```

Verify:

```bash
cd backend && npm run dev
curl http://localhost:3000/health/db
# → { "ok": true, "latencyMs": 5 }
```

---

## Render production setup

1. Create a Render Postgres instance (Starter or Free tier).
2. From Render dashboard → Database → Connection, copy the **External Database URL**.
3. In your backend service's Render → Environment panel, add:
   - `DATABASE_URL` = (paste the connection string)
   - `DB_SSL` = `true`
   - `DB_POOL_MAX` = `10`
4. Redeploy. Backend auto-runs `migrate.ts` on startup; `/health/db` returns `{ "ok": true }`.

To rotate the password (e.g., if it leaked):
- Render → Database → Connection → **Reset Credentials**
- Update `DATABASE_URL` env in the backend service
- Redeploy

---

## Migrations

Adding a new migration:

1. Create `backend/migrations/00N_<short_description>.sql`.
2. Use `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF NOT EXISTS` so reruns are safe.
3. Run `npm run migrate:dry` to preview, then `npm run migrate` to apply.
4. Production migrations run automatically on startup (server.ts).

The runner records each applied migration in `schema_migrations` so each file applies exactly once.

---

## Common queries

**Top 10 most-active users this week:**
```sql
SELECT u.pubkey, u.username, p.games_played, p.wins, p.total_xp
FROM users u
JOIN paper_xp p ON p.pubkey = u.pubkey
ORDER BY p.last_updated DESC
LIMIT 10;
```

**Per-player match history (last 20):**
```sql
SELECT match_pda, mode_u8, wager_lamports, winner_pubkey, settled_at
FROM match_history
WHERE 'PLAYER_PUBKEY' = ANY(players)
ORDER BY settled_at DESC
LIMIT 20;
```

**Best mints by winrate this week:**
```sql
SELECT mint, matches, wins, ROUND((wins::float / matches)::numeric, 3) AS rate
FROM token_winrates
WHERE iso_week = '2026-W17' AND matches >= 3
ORDER BY rate DESC, matches DESC
LIMIT 10;
```

**Notification volume per kind:**
```sql
SELECT kind, COUNT(*), MAX(created_at) AS latest
FROM notifications
GROUP BY kind
ORDER BY COUNT(*) DESC;
```

---

## Endpoints (server.ts)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | overall up + sessions + dbConfigured flag |
| GET | `/health/db` | DB ping with latencyMs |
| GET | `/users/:pubkey` | profile lookup |
| POST | `/users/:pubkey/username` | set username (3–20 chars, unique, alphanumeric+_-) |
| GET | `/paper-xp/:pubkey` | paper/bot XP totals |
| POST | `/paper-xp/:pubkey` | bump after settle (`{xp, track, won}`) |
| GET | `/matches/history?player=:pk&limit=20` | per-player history |
| POST | `/matches/history` | persist a settled match (idempotent) |
| GET | `/admin/tokens?limit=10&week=2026-W17` | top mints by winrate (DB → memory fallback) |
| GET | `/notifications/:pubkey?since=ts` | catchup + WS-equivalent feed |
| WS | `/notifications/:pubkey/stream` | live push |

---

## Trust + security model

- **Username endpoint trusts the client to own the pubkey.** Production should require a signed-message proof. Acceptable for hackathon scope because (a) lying about a username at most squats it cosmetically, and (b) the username field doesn't affect on-chain payouts.
- **match_history POST trusts client-reported heights/winner.** On-chain MatchAccount remains the audit; DB is a display layer. Production would verify via Solana RPC fetch.
- **Connection string contains credentials.** Store only in env files (`backend/.env`, `backend/.env.local` — both gitignored) and Render's env panel. Never commit. Rotate if leaked.

---

## Operational notes

- **Pool size**: `DB_POOL_MAX=10` per replica. Render Free tier supports ~95 total connections — fine for 4-5 replicas.
- **Slow queries**: anything >200ms logs `[db] slow_query`. Watch for these in Render logs after deploy.
- **Idempotency**: all writes use `ON CONFLICT DO NOTHING` or `DO UPDATE`. Safe to retry from the client.
- **Backfills**: notifications hydrate from DB on first `getRecent` per pubkey after restart. Other tables have no in-memory cache — DB is read-on-demand.

---

## Future migrations (not yet in 001_initial.sql)

When time allows or scale demands:
- `squad_presets` — cross-device preset sync (currently per-device localStorage)
- `watchlist` — cross-device token follows
- `daily_aggregates` — pre-computed admin rollups
- `audit_log` — settlement + rake audit trail (currently in-memory `StatsBucket`)
