-- Migration: Remove views added for Hoop Central (player_info, player_stats).
-- Leaves only the original tables: players, player_seasons, player_season_stats, teams, seasons, team_seasons, leagues, player_external_ids, player_scrape_jobs.
--
-- Run once on the shared Postgres database (e.g. Railway).
-- Usage: psql $DATABASE_URL -f db/migrations/004_drop_player_info_and_player_stats_views.sql

DROP VIEW IF EXISTS "Player info";
DROP VIEW IF EXISTS player_stats;
DROP VIEW IF EXISTS player_info;
