import { pool } from '../db/db.js';
import { TEAM_MAP, getAbbrevByTeamName as getAbbrevByTeamNameFromMap } from '../utils/teamMap.js';

export const getAbbrevByTeamName = getAbbrevByTeamNameFromMap;

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
