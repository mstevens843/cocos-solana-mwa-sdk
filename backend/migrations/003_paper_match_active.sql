-- Token Duel - In-flight paper / bot matches (DB Stage 7)
-- Signed-in users persist their currently-running paper matches here so MIP
-- shows them cross-device. Guest matches stay in-memory client-side only.
-- Rows are removed on race end (settle / forfeit / natural finish), and any
-- stale rows past their start_at + duration_ms are pruned at GET time.
CREATE TABLE IF NOT EXISTS paper_match_active (
    id                 TEXT PRIMARY KEY,            -- synthetic id (matches client's syntheticPda)
    pubkey             TEXT NOT NULL REFERENCES users(pubkey) ON DELETE CASCADE,
    mode_u8            SMALLINT NOT NULL,           -- 0=1v1, 1=Trio, 2=4p, 3=8p
    time_window        SMALLINT NOT NULL,           -- 0=30s..5=7d
    required_players   SMALLINT NOT NULL,
    track              TEXT NOT NULL,               -- 'bot' | 'paper-real'
    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms        BIGINT NOT NULL,
    last_height        INT NOT NULL DEFAULT 0,      -- encoded delta (player)
    last_bot_heights   INT[] NOT NULL DEFAULT '{}', -- encoded deltas (bots, ordered)
    last_updated       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_match_active_pubkey_idx ON paper_match_active (pubkey);
