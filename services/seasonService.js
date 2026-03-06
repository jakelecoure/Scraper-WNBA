import { pool } from '../db/db.js';

const NBA_LEAGUE_NAME = 'NBA';
let nbaLeagueId = null;

export async function getNbaLeagueId() {
  if (nbaLeagueId) return nbaLeagueId;
  let r = await pool.query(
    'SELECT id FROM leagues WHERE name = $1',
    [NBA_LEAGUE_NAME]
  );
  if (r.rows.length > 0) {
    nbaLeagueId = r.rows[0].id;
    await setNbaCountryUsa();
    return nbaLeagueId;
  }
  try {
    r = await pool.query(
      'INSERT INTO leagues (name) VALUES ($1) RETURNING id',
      [NBA_LEAGUE_NAME]
    );
    nbaLeagueId = r.rows[0].id;
    await setNbaCountryUsa();
    return nbaLeagueId;
  } catch (err) {
    if (err.code === '23505') {
      r = await pool.query(
        'SELECT id FROM leagues WHERE name = $1',
        [NBA_LEAGUE_NAME]
      );
      if (r.rows.length > 0) {
        nbaLeagueId = r.rows[0].id;
        await setNbaCountryUsa();
        return nbaLeagueId;
      }
    }
    throw err;
  }
}

async function setNbaCountryUsa() {
  try {
    await pool.query(
      "UPDATE leagues SET country = 'USA' WHERE name = $1",
      [NBA_LEAGUE_NAME]
    );
  } catch (_) {
    // Ignore if leagues.country column does not exist
  }

export async function getOrCreateSeason(leagueId, yearStart, yearEnd) {
  const r = await pool.query(
    `SELECT id FROM seasons WHERE league_id = $1 AND year_start = $2 AND year_end = $3`,
    [leagueId, yearStart, yearEnd]
  );
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pool.query(
    `INSERT INTO seasons (league_id, year_start, year_end) VALUES ($1, $2, $3) RETURNING id`,
    [leagueId, yearStart, yearEnd]
  );
  return ins.rows[0].id;
}

export default { getNbaLeagueId, getOrCreateSeason };
