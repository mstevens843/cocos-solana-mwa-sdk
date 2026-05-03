-- 006_match_history_wager_mint.sql
-- Adds the wager_mint column so the Portfolio Real card can compute
-- per-currency P/L (SOL vs SKR). Pre-existing rows default to '' and
-- will be excluded from both currency aggregates (the Portfolio query
-- requires an exact mint match).

ALTER TABLE match_history
    ADD COLUMN IF NOT EXISTS wager_mint TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS match_history_wager_mint_idx
    ON match_history (wager_mint);
