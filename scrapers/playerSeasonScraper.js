/**
 * Orchestrate scraping a player and persisting to DB.
 * Same pipeline as NBA: always create player_seasons row first, then player_season_stats.
 * Uses: players, player_seasons (player_id, season, team_season_id), player_season_stats, teams, seasons, team_seasons.
 */

import { insertPlayer } from '../services/playerService.js';
import { getLeagueId, getOrCreateSeason } from '../services/seasonService.js';
import { getOrCreateTeam, getOrCreateTeamSeason } from '../services/teamService.js';
import { upsertPlayerSeasonAndStats } from '../services/statsService.js';
import { scrapePlayerProfile } from './playerProfileScraper.js';

export async function scrapeAndPersistPlayer(url, league = 'gleague') {
  let result;
  try {
    result = await scrapePlayerProfile(url, league);
  } catch (err) {
    console.error('[scraper] scrapePlayerProfile error:', err.message);
    throw err;
  }

  const { sr_player_id, profile, seasons } = result;
  if (!sr_player_id || !profile) {
    return { ok: false, reason: 'no_sr_id_or_profile', url };
  }

  let playerId;
  try {
    playerId = await insertPlayer({ ...profile, sr_player_id });
  } catch (err) {
    console.error('[scraper] insertPlayer error, skipping row:', err.message);
    return { ok: false, reason: 'insert_failed', url };
  }

  if (!playerId) {
    return { ok: false, reason: 'insert_returned_null', url };
  }

  const leagueId = await getLeagueId(league);
  if (!leagueId) {
    console.warn(`[scraper] No league id for league=${league}, skipping seasons`);
    return { ok: true, player_id: playerId, sr_player_id, seasons_count: 0 };
  }

  try {
    for (const row of seasons) {
      try {
        const raw = (row.team_abbrev && row.team_abbrev.trim()) ? row.team_abbrev.trim() : '';
        const teamAbbrev = raw ? raw.toUpperCase() : '';
        if (league === 'wnba' && teamAbbrev === 'TOT') continue;
        if (league === 'wnba' && !teamAbbrev) {
          console.warn(`[scraper] WNBA row missing team_abbrev, skipping:`, { sr_player_id, seasonLabel: row.seasonLabel, year_start: row.year_start });
          continue;
        }
        const abbrev = teamAbbrev || (league === 'wnba' ? null : 'TOT');
        if (league === 'wnba' && !abbrev) continue;
        const seasonId = await getOrCreateSeason(leagueId, row.year_start, row.year_end);
        const teamId = await getOrCreateTeam(leagueId, abbrev);
        if (!teamId) continue;
        const teamSeasonId = await getOrCreateTeamSeason(teamId, seasonId);
        const seasonLabel = row.seasonLabel || `${row.year_start}-${String(row.year_end).slice(-2)}`;
        await upsertPlayerSeasonAndStats(
          playerId,
          seasonLabel,
          teamSeasonId,
          row.jersey_number,
          row.games_played,
          row.stats
        );
      } catch (err) {
        console.warn(`[scraper] Skip season ${row.seasonLabel} for ${sr_player_id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[scraper] Error persisting seasons, player already saved:', err.message);
  }

  return { ok: true, player_id: playerId, sr_player_id, seasons_count: seasons.length };
}

export default { scrapeAndPersistPlayer };
