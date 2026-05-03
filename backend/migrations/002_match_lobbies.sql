-- Token Duel - Open lobby projection (DB Stage 6)
-- One row per Match PDA at the moment a host commits the create tx.
-- On-chain Match account remains the source of truth for live state; this
-- table exists for funnel analytics ("how many lobbies were opened?",
-- "abandoned vs filled?") and future operator dashboards. Mirrored from
-- the client right after `join_match_create` confirms.
CREATE TABLE IF NOT EXISTS match_lobbies (
    match_pda          TEXT PRIMARY KEY,
    creator_pubkey     TEXT NOT NULL,
    mode_u8            SMALLINT NOT NULL,    -- 0=1v1, 1=Trio, 2=4p, 3=8p
    wager_tier         SMALLINT NOT NULL,
    wager_lamports     BIGINT NOT NULL,
    time_window        SMALLINT NOT NULL,
    required_players   SMALLINT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at         TIMESTAMPTZ,
    cancelled_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS match_lobbies_open_idx
    ON match_lobbies (created_at DESC)
    WHERE started_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS match_lobbies_creator_idx
    ON match_lobbies (creator_pubkey);
