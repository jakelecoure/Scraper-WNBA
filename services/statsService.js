import { pool } from '../db/db.js';

/**
 * Get or create player_season by (player_id, team_season_id), then upsert player_season_stats.
 * Uses the actual schema: player_seasons has player_id + team_season_id (no season/team/league columns).
 * Link: players.id → player_seasons.player_id, player_season_stats.player_season_id = player_seasons.id.
 *
 * @param {number} playerId - players.id
 * @param {number} teamSeasonId - team_seasons.id
 * @param {string|null} jerseyNumber
 * @param {number|null} gamesPlayed
 * @param {object} stats - { games, minutes, points, rebounds, assists, steals, blocks, fg_pct, three_pct, ft_pct }
 * @returns {Promise<number>} player_seasons.id
 */
export async function upsertPlayerSeasonAndStats(
  playerId,
  teamSeasonId,
  jerseyNumber,
  gamesPlayed,
  stats
) {
  const gamesPlayedInt = gamesPlayed != null ? Math.round(Number(gamesPlayed)) : null;

  let playerSeasonId;
  const r = await pool.query(
    `SELECT id FROM player_seasons WHERE player_id = $1 AND team_season_id = $2`,
    [playerId, teamSeasonId]
  );
  if (r.rows.length > 0) {
    playerSeasonId = r.rows[0].id;
    await pool.query(
      `UPDATE player_seasons SET jersey_number = $1, games_played = $2 WHERE id = $3`,
      [jerseyNumber ?? null, gamesPlayedInt, playerSeasonId]
    );
  } else {
    const ins = await pool.query(
      `INSERT INTO player_seasons (player_id, team_season_id, jersey_number, games_played)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [playerId, teamSeasonId, jerseyNumber ?? null, gamesPlayedInt]
    );
    playerSeasonId = ins.rows[0].id;
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
  // Coerce to integer so we never send decimals to INTEGER columns (production DB may use INTEGER for minutes/stats)
  const toInt = (v) => (v != null && !Number.isNaN(Number(v)) ? Math.round(Number(v)) : null);
  const minutesSafe = toInt(minutes);
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
        minutesSafe ?? null,
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
        minutesSafe ?? null,
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
