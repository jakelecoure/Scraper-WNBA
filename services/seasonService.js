import { pool } from '../db/db.js';

const G_LEAGUE_NAME = 'G League';
let gLeagueId = null;

const LEAGUE_NAME_MAP = {
  wnba: 'WNBA',
  nba: 'NBA',
  gleague: 'G League',
};

/** Get league id by scraper league key (wnba, nba, gleague). Creates league if missing. */
export async function getLeagueId(leagueKey) {
  const name = LEAGUE_NAME_MAP[(leagueKey || '').toLowerCase()];
  if (!name) return null;
  if (name === G_LEAGUE_NAME) return getGLeagueId();
  const r = await pool.query('SELECT id FROM leagues WHERE name = $1', [name]);
  if (r.rows.length > 0) return r.rows[0].id;
  try {
    const ins = await pool.query(
      'INSERT INTO leagues (name) VALUES ($1) RETURNING id',
      [name]
    );
    return ins.rows[0].id;
  } catch (err) {
    if (err.code === '23505') {
      const again = await pool.query('SELECT id FROM leagues WHERE name = $1', [name]);
      if (again.rows.length > 0) return again.rows[0].id;
    }
    throw err;
  }
}

export async function getGLeagueId() {
  if (gLeagueId) return gLeagueId;
  let r = await pool.query(
    'SELECT id FROM leagues WHERE name = $1',
    [G_LEAGUE_NAME]
  );
  if (r.rows.length > 0) {
    gLeagueId = r.rows[0].id;
    await setGLeagueCountryUsa();
    return gLeagueId;
  }
  try {
    r = await pool.query(
      'INSERT INTO leagues (name) VALUES ($1) RETURNING id',
      [G_LEAGUE_NAME]
    );
    gLeagueId = r.rows[0].id;
    await setGLeagueCountryUsa();
    return gLeagueId;
  } catch (err) {
    if (err.code === '23505') {
      r = await pool.query(
        'SELECT id FROM leagues WHERE name = $1',
        [G_LEAGUE_NAME]
      );
      if (r.rows.length > 0) {
        gLeagueId = r.rows[0].id;
        await setGLeagueCountryUsa();
        return gLeagueId;
      }
    }
    throw err;
  }
}

async function setGLeagueCountryUsa() {
  try {
    await pool.query(
      "UPDATE leagues SET country = 'USA' WHERE name = $1",
      [G_LEAGUE_NAME]
    );
  } catch (_) {
    // Ignore if leagues.country column does not exist
  }
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

export default { getGLeagueId, getLeagueId, getOrCreateSeason };
