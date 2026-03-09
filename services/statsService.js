import { pool } from '../db/db.js';

/**
 * Always create player_seasons row first, then insert/update player_season_stats.
 * Uses only (player_id, team_season_id) — no season column. Same pipeline as NBA.
 *
 * 1. INSERT into player_seasons (player_id, team_season_id, jersey_number, games_played) ON CONFLICT DO NOTHING RETURNING id
 * 2. If no row returned, SELECT id FROM player_seasons WHERE player_id = $1 AND team_season_id = $2
 * 3. Use that id as player_season_id when inserting/updating player_season_stats
 *
 * @param {number} playerId - players.id
 * @param {string} _seasonLabel - unused; kept for API compatibility (e.g. "2023-24")
 * @param {number} teamSeasonId - team_seasons.id (must exist)
 * @param {string|null} jerseyNumber
 * @param {number|null} gamesPlayed
 * @param {object} stats - { games, minutes, points, rebounds, assists, steals, blocks, fg_pct, three_pct, ft_pct }
 * @returns {Promise<number>} player_seasons.id
 */
export async function upsertPlayerSeasonAndStats(
  playerId,
  _seasonLabel,
  teamSeasonId,
  jerseyNumber,
  gamesPlayed,
  stats
) {
  const gamesPlayedInt = gamesPlayed != null ? Math.round(Number(gamesPlayed)) : null;
  if (teamSeasonId == null) throw new Error('team_season_id is required');

  const res = await pool.query(
    `INSERT INTO player_seasons (player_id, team_season_id, jersey_number, games_played)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (player_id, team_season_id) DO NOTHING
     RETURNING id`,
    [playerId, teamSeasonId, jerseyNumber ?? null, gamesPlayedInt]
  );
  let playerSeasonId;
  if (res.rows.length > 0) {
    playerSeasonId = res.rows[0].id;
  } else {
    const existing = await pool.query(
      `SELECT id FROM player_seasons WHERE player_id = $1 AND team_season_id = $2`,
      [playerId, teamSeasonId]
    );
    if (existing.rows.length === 0) throw new Error(`player_seasons row not found for player_id=${playerId} team_season_id=${teamSeasonId}`);
    playerSeasonId = existing.rows[0].id;
    await pool.query(
      `UPDATE player_seasons SET jersey_number = $1, games_played = $2 WHERE id = $3`,
      [jerseyNumber ?? null, gamesPlayedInt, playerSeasonId]
    );
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
