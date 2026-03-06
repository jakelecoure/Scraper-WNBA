import { pool } from '../db/db.js';

/**
 * Get or create player_season and insert player_season_stats.
 * playerId, teamSeasonId, jerseyNumber, gamesPlayed come from caller.
 * stats: { games, minutes, points, rebounds, assists, steals, blocks, fg_pct, three_pct, ft_pct }
 */
export async function upsertPlayerSeasonAndStats(playerId, teamSeasonId, jerseyNumber, gamesPlayed, stats) {
  let playerSeasonId;
  const r = await pool.query(
    `SELECT id FROM player_seasons WHERE player_id = $1 AND team_season_id = $2`,
    [playerId, teamSeasonId]
  );
  if (r.rows.length > 0) {
    playerSeasonId = r.rows[0].id;
    await pool.query(
      `UPDATE player_seasons SET jersey_number = $1, games_played = $2 WHERE id = $3`,
      [jerseyNumber ?? null, gamesPlayed ?? null, playerSeasonId]
    );
  } else {
    const ins = await pool.query(
      `INSERT INTO player_seasons (player_id, team_season_id, jersey_number, games_played)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [playerId, teamSeasonId, jerseyNumber ?? null, gamesPlayed ?? null]
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

  await pool.query(
    `INSERT INTO player_season_stats (
      player_season_id, games, minutes, points, rebounds, assists,
      steals, blocks, fg_pct, three_pct, ft_pct
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (player_season_id) DO UPDATE SET
      games = EXCLUDED.games,
      minutes = EXCLUDED.minutes,
      points = EXCLUDED.points,
      rebounds = EXCLUDED.rebounds,
      assists = EXCLUDED.assists,
      steals = EXCLUDED.steals,
      blocks = EXCLUDED.blocks,
      fg_pct = EXCLUDED.fg_pct,
      three_pct = EXCLUDED.three_pct,
      ft_pct = EXCLUDED.ft_pct`,
    [
      playerSeasonId,
      games ?? null,
      minutes ?? null,
      points ?? null,
      rebounds ?? null,
      assists ?? null,
      steals ?? null,
      blocks ?? null,
      fg_pct ?? null,
      three_pct ?? null,
      ft_pct ?? null,
    ]
  );
  return playerSeasonId;
}

export default { upsertPlayerSeasonAndStats };
