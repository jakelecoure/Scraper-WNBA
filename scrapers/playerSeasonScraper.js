/**
 * Orchestrate scraping a player and persisting to DB (player, external_id, player_seasons, player_season_stats).
 * Uses playerProfileScraper + seasonService, teamService, playerService, statsService.
 */

import { insertPlayer } from '../services/playerService.js';
import { getNbaLeagueId, getOrCreateSeason } from '../services/seasonService.js';
import { getOrCreateTeam, getOrCreateTeamSeason } from '../services/teamService.js';
import { upsertPlayerSeasonAndStats } from '../services/statsService.js';
import { scrapePlayerProfile } from './playerProfileScraper.js';

export async function scrapeAndPersistPlayer(url) {
  let result;
  try {
    result = await scrapePlayerProfile(url);
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

  try {
    const leagueId = await getNbaLeagueId();
    for (const row of seasons) {
      try {
        const seasonId = await getOrCreateSeason(leagueId, row.year_start, row.year_end);
        const teamId = await getOrCreateTeam(leagueId, row.team_abbrev);
        if (!teamId) continue;
        const teamSeasonId = await getOrCreateTeamSeason(teamId, seasonId);
        await upsertPlayerSeasonAndStats(
          playerId,
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
