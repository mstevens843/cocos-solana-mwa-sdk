-- Token Duel - User-collections persistence (DB Stage 9, ship-readiness pass)
-- Closes the cross-device gaps for squad presets, watchlist, and lifetime
-- paper-mode profit. See ~/.claude/plans/db-persistence-ship-ready.md.
-- Idempotent: safe to apply multiple times.

-- ── paper_xp.profit_lamports ─────────────────────────────────────
-- Lifetime PnL across paper + bot matches. Signed (BIGINT range
-- naturally allows negatives - losses subtract). Mirrors the
-- profitLamports field that Stats.ts has been writing to localStorage
-- since Phase III but never had a backend home.
ALTER TABLE paper_xp
    ADD COLUMN IF NOT EXISTS profit_lamports BIGINT NOT NULL DEFAULT 0;

-- ── squad_presets ────────────────────────────────────────────────
-- One row per pubkey holding the entire (≤5) preset list as JSONB.
-- Full-list replace via PUT - no per-row IDs survive server-side, so
-- there's no merge state to reconcile. Local conflict-resolution is
-- last-write-wins by updated_at.
--
-- presets shape:
--   [{ id, name, slots:[{mint,symbol,logoUri?}×3], savedAt, winCount }]
CREATE TABLE IF NOT EXISTS squad_presets (
    pubkey      TEXT PRIMARY KEY REFERENCES users(pubkey) ON DELETE CASCADE,
    presets     JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── user_watchlist ───────────────────────────────────────────────
-- Per-(pubkey, mint) watched tokens. Composite PK enables fast O(1)
-- "is this mint watched" checks server-side and a clean DELETE-by-mint
-- without an extra surrogate id. First-hydrate strategy is union-merge
-- (local ∪ server, dedup, take earlier added_at).
CREATE TABLE IF NOT EXISTS user_watchlist (
    pubkey       TEXT NOT NULL REFERENCES users(pubkey) ON DELETE CASCADE,
    mint         TEXT NOT NULL,
    base_symbol  TEXT NOT NULL DEFAULT '',
    base_name    TEXT NOT NULL DEFAULT '',
    logo_uri     TEXT NOT NULL DEFAULT '',
    added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (pubkey, mint)
);
CREATE INDEX IF NOT EXISTS user_watchlist_pubkey_added_idx
    ON user_watchlist (pubkey, added_at DESC);
