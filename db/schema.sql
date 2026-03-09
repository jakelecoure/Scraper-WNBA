-- Schema for G League scraper (run with: node db/migrate.js or apply manually)
-- Uses IF NOT EXISTS so existing DB is not overwritten.

CREATE TABLE IF NOT EXISTS leagues (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seasons (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  year_start INTEGER NOT NULL,
  year_end INTEGER NOT NULL,
  UNIQUE(league_id, year_start)
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  city VARCHAR(100),
  abbreviation VARCHAR(10) NOT NULL,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, abbreviation)
);

CREATE TABLE IF NOT EXISTS team_seasons (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, season_id)
);

CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(200) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  birth_date DATE,
  birth_place VARCHAR(200),
  height_cm NUMERIC(5,2),
  weight_kg NUMERIC(5,2),
  position VARCHAR(50),
  nationality VARCHAR(10),
  sr_player_id VARCHAR(20) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_external_ids (
  id SERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL,
  external_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, source)
);

CREATE TABLE IF NOT EXISTS player_seasons (
  id SERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_season_id INTEGER NOT NULL REFERENCES team_seasons(id),
  jersey_number VARCHAR(10),
  games_played INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, team_season_id)
);

CREATE TABLE IF NOT EXISTS player_season_stats (
  id SERIAL PRIMARY KEY,
  player_season_id INTEGER NOT NULL REFERENCES player_seasons(id) ON DELETE CASCADE,
  games INTEGER,
  minutes NUMERIC(8,2),
  points NUMERIC(8,2),
  rebounds NUMERIC(8,2),
  assists NUMERIC(8,2),
  steals NUMERIC(8,2),
  blocks NUMERIC(8,2),
  fg_pct NUMERIC(5,4),
  three_pct NUMERIC(5,4),
  ft_pct NUMERIC(5,4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_season_id)
);

CREATE TABLE IF NOT EXISTS player_scrape_jobs (
  id SERIAL PRIMARY KEY,
  url VARCHAR(500) NOT NULL UNIQUE,
  league TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_scrape_jobs_status ON player_scrape_jobs(status);
CREATE INDEX IF NOT EXISTS idx_player_scrape_jobs_status_league ON player_scrape_jobs (status, league) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_players_sr_player_id ON players(sr_player_id);

INSERT INTO leagues (name) VALUES ('NBA') ON CONFLICT (name) DO NOTHING;
INSERT INTO leagues (name) VALUES ('G League') ON CONFLICT (name) DO NOTHING;
INSERT INTO leagues (name) VALUES ('WNBA') ON CONFLICT (name) DO NOTHING;
