/**
 * NBA team abbreviation <-> name map. No DB dependency so scrapers can use it without loading db.
 */

export const TEAM_MAP = {
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

/** Return NBA abbreviation for a team name (e.g. "Cleveland Cavaliers" -> "CLE"). */
export function getAbbrevByTeamName(teamName) {
  if (!teamName || typeof teamName !== 'string') return null;
  const normalized = teamName.trim();
  for (const [abbrev, info] of Object.entries(TEAM_MAP)) {
    if (info.name === normalized || info.name.includes(normalized) || normalized.includes(info.name)) {
      return abbrev;
    }
  }
  return null;
}
