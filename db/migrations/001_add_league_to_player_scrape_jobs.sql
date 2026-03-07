-- Migration: add league column to player_scrape_jobs so NBA and G-League workers
-- can process only their own jobs. Run once on the shared Postgres database.
--
-- Valid league values: 'nba', 'gleague'

-- Add the league column (nullable until backfilled)
ALTER TABLE player_scrape_jobs ADD COLUMN IF NOT EXISTS league TEXT;

-- Set existing rows to 'nba' so existing NBA workers can still process them
UPDATE player_scrape_jobs SET league = 'nba' WHERE league IS NULL;

-- Optional: enforce valid values (uncomment if desired)
-- ALTER TABLE player_scrape_jobs ADD CONSTRAINT chk_league
--   CHECK (league IN ('nba', 'gleague'));

-- Index for worker query: WHERE status = 'pending' AND league = $1
CREATE INDEX IF NOT EXISTS idx_player_scrape_jobs_status_league
  ON player_scrape_jobs (status, league)
  WHERE status = 'pending';
