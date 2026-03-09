-- Migration: Create player_info and player_stats views for Hoop Central.
-- Hoop Central expects these table names; Scraper-WNBA stores data in
-- players, player_seasons, player_season_stats. These views expose the
-- same data with the names Hoop Central queries.
--
-- Run once on the shared Postgres database (e.g. Railway).
-- Usage: psql $DATABASE_URL -f db/migrations/003_add_player_info_and_player_stats_views.sql

-- View: player_info (profile data) — maps to players table
CREATE OR REPLACE VIEW player_info AS
SELECT
  id,
  full_name,
  first_name,
  last_name,
  birth_date,
  birth_place,
  height_cm,
  weight_kg,
  position,
  nationality,
  sr_player_id,
  created_at
FROM players;

-- View for apps that use quoted "Player info" (e.g. Sequelize model name)
DROP VIEW IF EXISTS "Player info";
CREATE VIEW "Player info" AS SELECT * FROM player_info;

-- View: player_stats (season-level stats) — one row per player_season with stats
-- Uses same schema as NBA: player_seasons (player_id, season, team_id, league_id)
CREATE OR REPLACE VIEW player_stats AS
SELECT
  p.id AS player_id,
  p.sr_player_id,
  ps.season,
  t.abbreviation AS team,
  l.name AS league,
  ps.games_played AS gp,
  pss.games,
  pss.minutes,
  pss.points AS pts,
  pss.rebounds AS reb,
  pss.assists AS ast,
  pss.steals AS stl,
  pss.blocks AS blk,
  pss.fg_pct,
  pss.three_pct,
  pss.ft_pct,
  ps.id AS player_season_id
FROM players p
JOIN player_seasons ps ON ps.player_id = p.id
JOIN player_season_stats pss ON pss.player_season_id = ps.id
JOIN teams t ON t.id = ps.team_id
JOIN leagues l ON l.id = ps.league_id;
