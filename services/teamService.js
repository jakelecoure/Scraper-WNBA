import { pool } from '../db/db.js';

/** Resolve team id by league and Basketball Reference abbreviation (e.g. WAS). Create team if missing. */
export async function getOrCreateTeam(leagueId, abbreviation) {
  const abbr = (abbreviation || '').trim().toUpperCase().slice(0, 10) || 'UNK';
  const r = await pool.query(
    'SELECT id FROM teams WHERE league_id = $1 AND abbreviation = $2',
    [leagueId, abbr]
  );
  if (r.rows.length > 0) return r.rows[0].id;
  try {
    await pool.query(
      `INSERT INTO teams (name, city, abbreviation, league_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (league_id, abbreviation) DO NOTHING`,
      [abbr, null, abbr, leagueId]
    );
  } catch (err) {
    if (err.code !== '23505') throw err;
  }
  const again = await pool.query(
    'SELECT id FROM teams WHERE league_id = $1 AND abbreviation = $2',
    [leagueId, abbr]
  );
  return again.rows.length > 0 ? again.rows[0].id : null;
}

/**
 * Get or create team_seasons row by (team_id, season_id). Never skip - create if missing.
 * Then used for player_seasons lookup.
 */
export async function getOrCreateTeamSeason(teamId, seasonId) {
  const r = await pool.query(
    `SELECT id FROM team_seasons WHERE team_id = $1 AND season_id = $2`,
    [teamId, seasonId]
  );
  if (r.rows.length > 0) return r.rows[0].id;
  try {
    const ins = await pool.query(
      `INSERT INTO team_seasons (team_id, season_id) VALUES ($1, $2)
       ON CONFLICT (team_id, season_id) DO NOTHING
       RETURNING id`,
      [teamId, seasonId]
    );
    if (ins.rows.length > 0) return ins.rows[0].id;
  } catch (err) {
    if (err.code !== '23505') throw err;
  }
  const again = await pool.query(
    `SELECT id FROM team_seasons WHERE team_id = $1 AND season_id = $2`,
    [teamId, seasonId]
  );
  if (again.rows.length > 0) return again.rows[0].id;
  try {
    const ins2 = await pool.query(
      `INSERT INTO team_seasons (team_id, season_id) VALUES ($1, $2) RETURNING id`,
      [teamId, seasonId]
    );
    return ins2.rows[0].id;
  } catch (err) {
    if (err.code !== '23505') throw err;
    const final = await pool.query(
      `SELECT id FROM team_seasons WHERE team_id = $1 AND season_id = $2`,
      [teamId, seasonId]
    );
    if (final.rows.length > 0) return final.rows[0].id;
    throw err;
  }
}
