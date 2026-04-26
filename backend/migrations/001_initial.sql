-- Token Duel — Initial DB schema (DB Integration Stage 1)
-- See docs/BACKEND_DB.md for runbook + per-table rationale.
-- Idempotent: safe to apply multiple times.

-- ── users ────────────────────────────────────────────────────────
-- One row per wallet pubkey ever seen. Auto-created on first backend
-- interaction (publishSquad, paper_xp post, etc).
CREATE TABLE IF NOT EXISTS users (
    pubkey         TEXT PRIMARY KEY,
    username       TEXT UNIQUE,
    joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));

-- ── paper_xp ─────────────────────────────────────────────────────
-- Cross-device paper + bot training XP (per-track breakdown for analytics).
-- Real-mode XP stays on-chain (UserStats.xp PDA) — DO NOT duplicate it here.
CREATE TABLE IF NOT EXISTS paper_xp (
    pubkey          TEXT PRIMARY KEY REFERENCES users(pubkey) ON DELETE CASCADE,
    total_xp        BIGINT NOT NULL DEFAULT 0,
    bot_xp          BIGINT NOT NULL DEFAULT 0,
    paper_real_xp   BIGINT NOT NULL DEFAULT 0,
    games_played    INT NOT NULL DEFAULT 0,
    wins            INT NOT NULL DEFAULT 0,
    losses          INT NOT NULL DEFAULT 0,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── match_history ────────────────────────────────────────────────
-- Denormalized projection of settled MatchAccount PDAs. Source: rake_listener.
-- On-chain accounts remain authoritative; this table exists for fast
-- per-player queries that would otherwise require getProgramAccounts scans.
CREATE TABLE IF NOT EXISTS match_history (
    match_pda          TEXT PRIMARY KEY,
    mode_u8            SMALLINT NOT NULL,    -- 0=1v1, 1=Trio, 2=4p, 3=8p (post-Stage 3)
    wager_tier         SMALLINT NOT NULL,
    wager_lamports     BIGINT NOT NULL,
    time_window        SMALLINT NOT NULL,
    players            TEXT[] NOT NULL,
    heights            INT[] NOT NULL,
    winner_pubkey      TEXT,
    payouts_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
    rake_lamports      BIGINT NOT NULL DEFAULT 0,
    status             SMALLINT NOT NULL,    -- 2=Settled, 3=Cancelled
    created_at         TIMESTAMPTZ NOT NULL,
    started_at         TIMESTAMPTZ,
    settled_at         TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS match_history_winner_idx     ON match_history (winner_pubkey);
CREATE INDEX IF NOT EXISTS match_history_settled_at_idx ON match_history (settled_at DESC);
CREATE INDEX IF NOT EXISTS match_history_players_gin    ON match_history USING gin (players);

-- ── token_winrates ───────────────────────────────────────────────
-- Per-mint win/match per ISO-week. Replaces TokenStatsBucket Sunday-reset.
-- Composite PK lets us aggregate across weeks for all-time stats while
-- keeping per-week buckets for trend reporting.
CREATE TABLE IF NOT EXISTS token_winrates (
    mint            TEXT NOT NULL,
    iso_week        TEXT NOT NULL,            -- "2026-W17" format
    matches         INT NOT NULL DEFAULT 0,
    wins            INT NOT NULL DEFAULT 0,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (mint, iso_week)
);
CREATE INDEX IF NOT EXISTS token_winrates_week_idx ON token_winrates (iso_week);

-- ── notifications ────────────────────────────────────────────────
-- Persistent notification feed. Replaces in-memory NotificationStore.
-- `id` reuses the existing dedupe key from NotificationStore so client
-- read-state survives the migration unchanged.
CREATE TABLE IF NOT EXISTS notifications (
    id              TEXT PRIMARY KEY,
    pubkey          TEXT NOT NULL REFERENCES users(pubkey) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at         TIMESTAMPTZ,
    dismissed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notifications_pubkey_created_idx
    ON notifications (pubkey, created_at DESC);
