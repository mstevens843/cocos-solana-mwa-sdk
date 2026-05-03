-- Token Duel - Paper / bot finished match history (DB Stage 8)
-- Per-match record of every paper / bot match a signed-in user finishes.
-- Mirrors `match_history` but for off-chain matches (no PDA, no wager, no
-- payouts). Powers a future "Match History" UI. Guests skip - synthetic ids
-- would break the FK.
CREATE TABLE IF NOT EXISTS paper_match_history (
    id                 TEXT PRIMARY KEY,            -- same synthetic id used in paper_match_active
    pubkey             TEXT NOT NULL REFERENCES users(pubkey) ON DELETE CASCADE,
    mode_u8            SMALLINT NOT NULL,           -- 0=1v1, 1=Trio, 2=4p, 3=8p
    time_window        SMALLINT NOT NULL,           -- 0=30s..5=7d
    required_players   SMALLINT NOT NULL,
    track              TEXT NOT NULL,               -- 'bot' | 'paper-real'
    players            TEXT[] NOT NULL,             -- me + bot pseudo-pubkeys
    heights            INT[] NOT NULL,              -- encoded deltas, final
    my_height          INT NOT NULL,
    winner_pubkey      TEXT,                        -- NULL on tie / forfeit-to-zero
    placement          SMALLINT NOT NULL,           -- 0-based rank
    total_players      SMALLINT NOT NULL,
    won                BOOLEAN NOT NULL,
    xp_gained          INT NOT NULL DEFAULT 0,
    started_at         TIMESTAMPTZ NOT NULL,
    settled_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_match_history_pubkey_settled_idx
    ON paper_match_history (pubkey, settled_at DESC);
CREATE INDEX IF NOT EXISTS paper_match_history_track_idx
    ON paper_match_history (pubkey, track, settled_at DESC);
