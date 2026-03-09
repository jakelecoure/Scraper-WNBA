import { pool } from '../db/db.js';

/**
 * Insert or update player_seasons by (player_id, season, team_id, league_id), then upsert player_season_stats.
 * Same flow as NBA scraper: players → player_seasons (player_id, season, team_id, league_id) → player_season_stats.
 * No new tables; uses existing players, player_seasons, player_season_stats, teams, seasons.
 *
 * @param {number} playerId - players.id
 * @param {string} season - e.g. "2023-24"
 * @param {number} teamId - teams.id
 * @param {number} leagueId - leagues.id
 * @param {string|null} jerseyNumber
 * @param {number|null} gamesPlayed
 * @param {object} stats - { games, minutes, points, rebounds, assists, steals, blocks, fg_pct, three_pct, ft_pct }
 * @returns {Promise<number>} player_seasons.id
 */
export async function upsertPlayerSeasonAndStats(
  playerId,
  season,
  teamId,
  leagueId,
  jerseyNumber,
  gamesPlayed,
  stats
) {
  const gamesPlayedInt = gamesPlayed != null ? Math.round(Number(gamesPlayed)) : null;
  const seasonVal = season != null ? String(season) : null;
  if (!seasonVal) throw new Error('season is required');

  let playerSeasonId;
  try {
    const res = await pool.query(
      `INSERT INTO player_seasons (player_id, season, team_id, league_id, jersey_number, games_played)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (player_id, season)
       DO UPDATE SET team_id = EXCLUDED.team_id, league_id = EXCLUDED.league_id, jersey_number = EXCLUDED.jersey_number, games_played = EXCLUDED.games_played
       RETURNING id`,
      [playerId, seasonVal, teamId, leagueId, jerseyNumber ?? null, gamesPlayedInt]
    );
    playerSeasonId = res.rows[0].id;
  } catch (err) {
    if (err.code === '42703' || err.code === '42P01') {
      const r = await pool.query(
        `SELECT id FROM player_seasons WHERE player_id = $1 AND season = $2`,
        [playerId, seasonVal]
      );
      if (r.rows.length > 0) {
        playerSeasonId = r.rows[0].id;
        await pool.query(
          `UPDATE player_seasons SET team_id = $1, league_id = $2, jersey_number = $3, games_played = $4 WHERE id = $5`,
          [teamId, leagueId, jerseyNumber ?? null, gamesPlayedInt, playerSeasonId]
        );
      } else {
        const ins = await pool.query(
          `INSERT INTO player_seasons (player_id, season, team_id, league_id, jersey_number, games_played)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [playerId, seasonVal, teamId, leagueId, jerseyNumber ?? null, gamesPlayedInt]
        );
        playerSeasonId = ins.rows[0].id;
      }
    } else throw err;
  }

  const {
    games,
    minutes,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    fg_pct,
    three_pct,
    ft_pct,
  } = stats || {};

  const gamesInt = games != null ? Math.round(Number(games)) : null;
  const toInt = (v) => (v != null && !Number.isNaN(Number(v)) ? Math.round(Number(v)) : null);
  const minutesVal = toInt(minutes);
  const pointsVal = toInt(points);
  const reboundsVal = toInt(rebounds);
  const assistsVal = toInt(assists);
  const stealsVal = toInt(steals);
  const blocksVal = toInt(blocks);

  const statRow = await pool.query(
    'SELECT id FROM player_season_stats WHERE player_season_id = $1',
    [playerSeasonId]
  );
  if (statRow.rows.length > 0) {
    await pool.query(
      `UPDATE player_season_stats SET
        games = $2, minutes = $3, points = $4, rebounds = $5, assists = $6,
        steals = $7, blocks = $8, fg_pct = $9, three_pct = $10, ft_pct = $11
       WHERE player_season_id = $1`,
      [
        playerSeasonId,
        gamesInt,
        minutesVal ?? null,
        pointsVal ?? null,
        reboundsVal ?? null,
        assistsVal ?? null,
        stealsVal ?? null,
        blocksVal ?? null,
        fg_pct ?? null,
        three_pct ?? null,
        ft_pct ?? null,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO player_season_stats (
        player_season_id, games, minutes, points, rebounds, assists,
        steals, blocks, fg_pct, three_pct, ft_pct
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        playerSeasonId,
        gamesInt,
        minutesVal ?? null,
        pointsVal ?? null,
        reboundsVal ?? null,
        assistsVal ?? null,
        stealsVal ?? null,
        blocksVal ?? null,
        fg_pct ?? null,
        three_pct ?? null,
        ft_pct ?? null,
      ]
    );
  }
  return playerSeasonId;
}

export default { upsertPlayerSeasonAndStats };
