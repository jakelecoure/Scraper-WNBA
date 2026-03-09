import { pool } from '../db/db.js';

/**
 * Always create player_seasons row first, then insert/update player_season_stats.
 * Same pipeline as NBA: players.id → player_seasons.player_id → player_season_stats.player_season_id
 *
 * 1. Insert or skip (ON CONFLICT DO NOTHING) into player_seasons (player_id, season, team_season_id, jersey_number, games_played)
 * 2. If no row returned, fetch existing: SELECT id FROM player_seasons WHERE player_id = $1 AND season = $2
 * 3. Use that player_seasons.id as player_season_id when inserting into player_season_stats
 *
 * @param {number} playerId - players.id
 * @param {string} season - e.g. "2023-24"
 * @param {number} teamSeasonId - team_seasons.id
 * @param {string|null} jerseyNumber
 * @param {number|null} gamesPlayed
 * @param {object} stats - { games, minutes, points, rebounds, assists, steals, blocks, fg_pct, three_pct, ft_pct }
 * @returns {Promise<number>} player_seasons.id
 */
export async function upsertPlayerSeasonAndStats(
  playerId,
  season,
  teamSeasonId,
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
      `INSERT INTO player_seasons (player_id, season, team_season_id, jersey_number, games_played)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (player_id, season) DO NOTHING
       RETURNING id`,
      [playerId, seasonVal, teamSeasonId, jerseyNumber ?? null, gamesPlayedInt]
    );
    if (res.rows.length > 0) {
      playerSeasonId = res.rows[0].id;
    } else {
      const existing = await pool.query(
        `SELECT id FROM player_seasons WHERE player_id = $1 AND season = $2`,
        [playerId, seasonVal]
      );
      if (existing.rows.length === 0) throw new Error(`player_seasons row not found for player_id=${playerId} season=${seasonVal}`);
      playerSeasonId = existing.rows[0].id;
      await pool.query(
        `UPDATE player_seasons SET team_season_id = $1, jersey_number = $2, games_played = $3 WHERE id = $4`,
        [teamSeasonId, jerseyNumber ?? null, gamesPlayedInt, playerSeasonId]
      );
    }
  } catch (err) {
    if (err.code === '42703' && err.message && err.message.includes('season')) {
      const res = await pool.query(
        `INSERT INTO player_seasons (player_id, team_season_id, jersey_number, games_played)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (player_id, team_season_id) DO NOTHING
         RETURNING id`,
        [playerId, teamSeasonId, jerseyNumber ?? null, gamesPlayedInt]
      );
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
