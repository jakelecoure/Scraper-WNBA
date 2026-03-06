/**
 * Orchestrate scraping a player and persisting to DB (player, external_id, player_seasons, player_season_stats).
 * Uses playerProfileScraper + seasonService, teamService, playerService, statsService.
 */

import { getPlayerBySrId, createPlayer, upsertExternalId } from '../services/playerService.js';
import { getNbaLeagueId, getOrCreateSeason } from '../services/seasonService.js';
import { getOrCreateTeam, getOrCreateTeamSeason } from '../services/teamService.js';
import { upsertPlayerSeasonAndStats } from '../services/statsService.js';
import { scrapePlayerProfile } from './playerProfileScraper.js';

export async function scrapeAndPersistPlayer(url) {
  const result = await scrapePlayerProfile(url);
  const { sr_player_id, profile, seasons } = result;
  if (!sr_player_id || !profile) {
    return { ok: false, reason: 'no_sr_id_or_profile', url };
  }

  let playerId = await getPlayerBySrId(sr_player_id);
  if (playerId) {
    await upsertExternalId(playerId, sr_player_id);
  } else {
    playerId = await createPlayer({
      ...profile,
      sr_player_id,
    });
  }

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
      console.warn(`Skip season ${row.seasonLabel} for ${sr_player_id}:`, err.message);
    }
  }

  return { ok: true, player_id: playerId, sr_player_id, seasons_count: seasons.length };
}

export default { scrapeAndPersistPlayer };
