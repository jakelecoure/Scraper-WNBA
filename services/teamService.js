import { pool } from '../db/db.js';

// Basketball Reference team abbreviation -> { name, city }
const TEAM_MAP = {
  ATL: { name: 'Atlanta Hawks', city: 'Atlanta' },
  BOS: { name: 'Boston Celtics', city: 'Boston' },
  BRK: { name: 'Brooklyn Nets', city: 'Brooklyn' },
  BKN: { name: 'Brooklyn Nets', city: 'Brooklyn' },
  CHA: { name: 'Charlotte Hornets', city: 'Charlotte' },
  CHO: { name: 'Charlotte Hornets', city: 'Charlotte' },
  CHI: { name: 'Chicago Bulls', city: 'Chicago' },
  CLE: { name: 'Cleveland Cavaliers', city: 'Cleveland' },
  DAL: { name: 'Dallas Mavericks', city: 'Dallas' },
  DEN: { name: 'Denver Nuggets', city: 'Denver' },
  DET: { name: 'Detroit Pistons', city: 'Detroit' },
  GSW: { name: 'Golden State Warriors', city: 'Golden State' },
  HOU: { name: 'Houston Rockets', city: 'Houston' },
  IND: { name: 'Indiana Pacers', city: 'Indiana' },
  LAC: { name: 'Los Angeles Clippers', city: 'Los Angeles' },
  LAL: { name: 'Los Angeles Lakers', city: 'Los Angeles' },
  MEM: { name: 'Memphis Grizzlies', city: 'Memphis' },
  MIA: { name: 'Miami Heat', city: 'Miami' },
  MIL: { name: 'Milwaukee Bucks', city: 'Milwaukee' },
  MIN: { name: 'Minnesota Timberwolves', city: 'Minnesota' },
  NOP: { name: 'New Orleans Pelicans', city: 'New Orleans' },
  NOH: { name: 'New Orleans Pelicans', city: 'New Orleans' },
  NYK: { name: 'New York Knicks', city: 'New York' },
  OKC: { name: 'Oklahoma City Thunder', city: 'Oklahoma City' },
  ORL: { name: 'Orlando Magic', city: 'Orlando' },
  PHI: { name: 'Philadelphia 76ers', city: 'Philadelphia' },
  PHO: { name: 'Phoenix Suns', city: 'Phoenix' },
  POR: { name: 'Portland Trail Blazers', city: 'Portland' },
  SAC: { name: 'Sacramento Kings', city: 'Sacramento' },
  SAS: { name: 'San Antonio Spurs', city: 'San Antonio' },
  TOR: { name: 'Toronto Raptors', city: 'Toronto' },
  UTA: { name: 'Utah Jazz', city: 'Utah' },
  WAS: { name: 'Washington Wizards', city: 'Washington' },
  WSB: { name: 'Washington Wizards', city: 'Washington' },
};

export function getTeamInfo(abbrev) {
  const key = (abbrev || '').toUpperCase().trim();
  return TEAM_MAP[key] || { name: key, city: null };
}

export async function getOrCreateTeam(leagueId, abbreviation) {
  const key = (abbreviation || '').toUpperCase().trim();
  if (!key) return null;
  const r = await pool.query(
    `SELECT id FROM teams WHERE league_id = $1 AND abbreviation = $2`,
    [leagueId, key]
  );
  if (r.rows.length > 0) return r.rows[0].id;
  const info = getTeamInfo(key);
  const ins = await pool.query(
    `INSERT INTO teams (name, city, abbreviation, league_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [info.name, info.city, key, leagueId]
  );
  return ins.rows[0].id;
}

export async function getOrCreateTeamSeason(teamId, seasonId) {
  const r = await pool.query(
    `SELECT id FROM team_seasons WHERE team_id = $1 AND season_id = $2`,
    [teamId, seasonId]
  );
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pool.query(
    `INSERT INTO team_seasons (team_id, season_id) VALUES ($1, $2) RETURNING id`,
    [teamId, seasonId]
  );
  return ins.rows[0].id;
}

export default { getTeamInfo, getOrCreateTeam, getOrCreateTeamSeason };
