const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE_URL = 'https://www.basketball-reference.com';
const WNBA_PLAYERS_INDEX = `${BASE_URL}/wnba/players/`;
const OUTPUT_PATH = path.join(__dirname, 'data', 'wnba_players.json');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Slower delays to avoid 429 rate limits from Basketball-Reference (2–5 s between requests)
function getRandomDelay() {
  const min = 2000;
  const max = 5000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const MAX_FETCH_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = 45000; // wait 45 s on 429 before retry

async function fetchPage(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 30000,
      });
      return response.data;
    } catch (error) {
      lastError = error;
      const status = error.response && error.response.status;
      const is429 = status === 429;
      if (is429 && attempt < MAX_FETCH_RETRIES) {
        console.warn(`Rate limited (429) for ${url}, waiting ${RATE_LIMIT_BACKOFF_MS / 1000}s before retry ${attempt + 1}/${MAX_FETCH_RETRIES}...`);
        await delay(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      console.error(`Failed to fetch ${url}:`, error.message);
      throw error;
    }
  }
  console.error(`Failed to fetch ${url} after ${MAX_FETCH_RETRIES} attempts:`, lastError && lastError.message);
  throw lastError;
}

async function getLetterPageUrls() {
  const html = await fetchPage(WNBA_PLAYERS_INDEX);
  const $ = cheerio.load(html);
  const letterUrls = new Set();

  $('a[href^="/wnba/players/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && /^\/wnba\/players\/[a-z]\/$/i.test(href.trim())) {
      letterUrls.add(`${BASE_URL}${href.trim()}`);
    }
  });

  // Fallback: if we didn't find any letter links, just use the main index page.
  if (letterUrls.size === 0) {
    letterUrls.add(WNBA_PLAYERS_INDEX);
  }

  return Array.from(letterUrls).sort();
}

async function getAllPlayers() {
  const letterUrls = await getLetterPageUrls();
  const players = [];
  const seen = new Set();

  for (const letterUrl of letterUrls) {
    console.log(`Fetching players from: ${letterUrl}`);
    try {
      const html = await fetchPage(letterUrl);
      const $ = cheerio.load(html);

      $('a[href^="/wnba/players/"]').each((_, el) => {
        const href = $(el).attr('href');
        const name = $(el).text().trim();

        if (!href || !href.endsWith('.html')) {
          return;
        }

        const fullUrl = `${BASE_URL}${href}`;

        if (!name || seen.has(fullUrl)) {
          return;
        }

        seen.add(fullUrl);
        players.push({
          name,
          profile_url: fullUrl,
        });
      });
    } catch (error) {
      console.error(`Error processing letter page ${letterUrl}:`, error.message);
    }

    await delay(getRandomDelay());
  }

  console.log(`Discovered ${players.length} player profiles.`);
  return players;
}

function extractBasicInfo($) {
  const info = {
    name: '',
    height: '',
    weight: '',
    position: '',
    birthdate: '',
    college: '',
  };

  const infoSection = $('#info');

  // Name
  const nameEl = infoSection.find('h1[itemprop="name"]').first();
  if (nameEl.length) {
    info.name = nameEl.text().trim();
  } else {
    const fallbackName = infoSection.find('h1').first().text().trim();
    if (fallbackName) {
      info.name = fallbackName;
    }
  }

  // Position line
  const positionP = infoSection.find('p:contains("Position")').first();
  if (positionP.length) {
    const text = positionP.text();
    const match = text.match(/Position:\s*([^▪\n]+)/);
    if (match && match[1]) {
      info.position = match[1].trim();
    }
  }

  // Height / Weight line
  let heightWeightText = '';
  infoSection.find('p').each((_, el) => {
    const text = $(el).text().trim();
    if (!heightWeightText && /\d+-\d+/.test(text) && /lb/.test(text)) {
      heightWeightText = text;
    }
  });

  if (heightWeightText) {
    const heightMatch = heightWeightText.match(/(\d+-\d+)/);
    if (heightMatch) {
      info.height = heightMatch[1];
    }
    const weightMatch = heightWeightText.match(/(\d+)\s*lb/);
    if (weightMatch) {
      info.weight = weightMatch[1];
    }
  }

  // Birthdate
  const bornP = infoSection.find('p:contains("Born:")').first();
  if (bornP.length) {
    const text = bornP.text();
    const match = text.match(/Born:\s*([^(]+?)\s+in\s/i);
    if (match && match[1]) {
      info.birthdate = match[1].trim();
    } else {
      const altMatch = text.match(/Born:\s*(.+)/i);
      if (altMatch && altMatch[1]) {
        info.birthdate = altMatch[1].trim();
      }
    }
  }

  // College
  const collegeP = infoSection.find('p:contains("College:")').first();
  if (collegeP.length) {
    const text = collegeP.text();
    const match = text.match(/College:\s*(.+)/);
    if (match && match[1]) {
      info.college = match[1].trim();
    }
  }

  return info;
}

function normalizeText(value) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function extractTableRowData($, $row) {
  const data = {};

  // Basketball-Reference uses <th> for the row header (season) and <td> for stats.
  $row.find('th[data-stat], td[data-stat]').each((_, cell) => {
    const $cell = $(cell);
    const key = $cell.attr('data-stat');
    if (!key) return;
    data[key] = normalizeText($cell.text());
  });

  return data;
}

function upsertSeason(map, season, team) {
  const key = `${season}__${team || ''}`;
  if (!map.has(key)) {
    map.set(key, {
      season,
      team: team || '',
      gp: '',
      pts: '',
      reb: '',
      ast: '',
      // Store complete table rows under this field so you get "all stats"
      // without losing a simple top-level season object shape.
      stats: {},
    });
  }
  return map.get(key);
}

function extractStatsTable($, tableSelector, tableKey) {
  const rows = [];
  const table = $(tableSelector);

  if (!table.length) return rows;

  table.find('tbody tr').each((_, row) => {
    const $row = $(row);

    // Skip header separator rows that are sometimes embedded in tbody.
    if ($row.hasClass('thead')) return;

    const rowData = extractTableRowData($, $row);
    const season = normalizeText(rowData.season);

    if (!season || season.toLowerCase() === 'career') return;

    // Many BR tables include a "Did Not Play" row (no team/stats); skip those.
    const team = normalizeText(rowData.team_id || rowData.tm || rowData.team);
    const hasAnyStatCell = Object.keys(rowData).some((k) => k !== 'season' && rowData[k] !== '');
    if (!team && !hasAnyStatCell) return;

    rows.push({
      season,
      team,
      tableKey,
      rowData,
    });
  });

  return rows;
}

function extractSeasonStats($) {
  // Regular-season tables on player pages. We merge by (season, team).
  // This typically covers all WNBA seasons (1997–present) for that player.
  const tablesToExtract = [
    { selector: '#per_game', key: 'per_game' },
    { selector: '#totals', key: 'totals' },
    { selector: '#advanced', key: 'advanced' },
  ];

  const seasonMap = new Map();

  for (const t of tablesToExtract) {
    const rows = extractStatsTable($, t.selector, t.key);

    for (const r of rows) {
      const seasonObj = upsertSeason(seasonMap, r.season, r.team);
      seasonObj.stats[t.key] = r.rowData;

      // Keep the previously-requested quick fields populated from per_game when present.
      if (t.key === 'per_game') {
        seasonObj.gp = normalizeText(r.rowData.g);
        seasonObj.pts = normalizeText(r.rowData.pts_per_g);
        seasonObj.reb = normalizeText(r.rowData.trb_per_g);
        seasonObj.ast = normalizeText(r.rowData.ast_per_g);
      }
    }
  }

  const seasons = Array.from(seasonMap.values());
  seasons.sort((a, b) => {
    const ay = parseInt(a.season, 10);
    const by = parseInt(b.season, 10);
    if (Number.isFinite(ay) && Number.isFinite(by)) return ay - by;
    return String(a.season).localeCompare(String(b.season));
  });

  return seasons;
}

async function scrapePlayerStats(url) {
  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const basic = extractBasicInfo($);
    const seasons = extractSeasonStats($);

    return {
      ...basic,
      profile_url: url,
      seasons,
    };
  } catch (error) {
    console.error(`Error scraping player page ${url}:`, error.message);
    throw error;
  }
}

async function saveToJSON(data) {
  const outputDir = path.dirname(OUTPUT_PATH);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const payload = {
    players: data,
  };

  await fs.promises.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Saved ${data.length} players to ${OUTPUT_PATH}`);
}

// --- Postgres persistence (when DATABASE_URL is set) ---
function parseBirthDate(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  const m = trimmed.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const months = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
    const month = months[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month && day >= 1 && day <= 31 && year > 1900) return new Date(year, month - 1, day);
  }
  return null;
}

function heightToCm(heightStr) {
  if (!heightStr || typeof heightStr !== 'string') return null;
  const m = heightStr.trim().match(/^(\d+)-(\d+)$/);
  if (m) return Math.round((parseInt(m[1], 10) * 30.48 + parseInt(m[2], 10) * 2.54) * 100) / 100;
  return null;
}

function weightToKg(weightStr) {
  if (weightStr == null || weightStr === '') return null;
  const n = parseFloat(String(weightStr).replace(/\D/g, ''));
  return Number.isFinite(n) ? Math.round((n / 2.205) * 100) / 100 : null;
}

function srPlayerIdFromUrl(profileUrl) {
  if (!profileUrl) return null;
  const match = profileUrl.match(/\/([a-z0-9]+)\.html$/i);
  return match ? match[1] : null;
}

function splitName(fullName) {
  if (!fullName || typeof fullName !== 'string') return { first: null, last: null };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

async function getWnbaLeagueId(pool) {
  const r = await pool.query("SELECT id FROM leagues WHERE name = 'WNBA' LIMIT 1");
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pool.query("INSERT INTO leagues (name) VALUES ('WNBA') ON CONFLICT (name) DO NOTHING RETURNING id");
  if (ins.rows.length > 0) return ins.rows[0].id;
  const r2 = await pool.query("SELECT id FROM leagues WHERE name = 'WNBA' LIMIT 1");
  return r2.rows[0].id;
}

async function getOrCreateSeason(pool, leagueId, year) {
  const y = parseInt(String(year).replace(/\D/g, ''), 10);
  if (!Number.isFinite(y)) return null;
  let r = await pool.query('SELECT id FROM seasons WHERE league_id = $1 AND year_start = $2 LIMIT 1', [leagueId, y]);
  if (r.rows.length > 0) return r.rows[0].id;
  await pool.query('INSERT INTO seasons (league_id, year_start, year_end) VALUES ($1, $2, $2) ON CONFLICT (league_id, year_start) DO NOTHING', [leagueId, y, y]);
  r = await pool.query('SELECT id FROM seasons WHERE league_id = $1 AND year_start = $2 LIMIT 1', [leagueId, y]);
  return r.rows.length > 0 ? r.rows[0].id : null;
}

async function getOrCreateTeam(pool, leagueId, abbreviation) {
  const abbr = (abbreviation || '').trim().toUpperCase().slice(0, 10) || 'UNK';
  let r = await pool.query('SELECT id FROM teams WHERE league_id = $1 AND abbreviation = $2 LIMIT 1', [leagueId, abbr]);
  if (r.rows.length > 0) return r.rows[0].id;
  await pool.query(
    'INSERT INTO teams (name, city, abbreviation, league_id) VALUES ($1, $2, $3, $4) ON CONFLICT (league_id, abbreviation) DO NOTHING',
    [abbr, null, abbr, leagueId]
  );
  r = await pool.query('SELECT id FROM teams WHERE league_id = $1 AND abbreviation = $2 LIMIT 1', [leagueId, abbr]);
  return r.rows.length > 0 ? r.rows[0].id : null;
}

async function getOrCreateTeamSeason(pool, teamId, seasonId) {
  let r = await pool.query('SELECT id FROM team_seasons WHERE team_id = $1 AND season_id = $2 LIMIT 1', [teamId, seasonId]);
  if (r.rows.length > 0) return r.rows[0].id;
  await pool.query('INSERT INTO team_seasons (team_id, season_id) VALUES ($1, $2) ON CONFLICT (team_id, season_id) DO NOTHING', [teamId, seasonId]);
  r = await pool.query('SELECT id FROM team_seasons WHERE team_id = $1 AND season_id = $2 LIMIT 1', [teamId, seasonId]);
  return r.rows.length > 0 ? r.rows[0].id : null;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function persistPlayerToPostgres(pool, player) {
  const srPlayerId = srPlayerIdFromUrl(player.profile_url);
  if (!srPlayerId) return;
  const leagueId = await getWnbaLeagueId(pool);
  const birthDate = parseBirthDate(player.birthdate);
  const heightCm = heightToCm(player.height);
  const weightKg = weightToKg(player.weight);
  const { first: firstName, last: lastName } = splitName(player.name || '');

  const fullName = (player.name || '').trim() || 'Unknown';
  await pool.query(
    `INSERT INTO players (sr_player_id, full_name, first_name, last_name, birth_date, height_cm, weight_kg, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (sr_player_id) DO UPDATE SET
       full_name = EXCLUDED.full_name, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
       birth_date = EXCLUDED.birth_date, height_cm = EXCLUDED.height_cm, weight_kg = EXCLUDED.weight_kg, position = EXCLUDED.position`,
    [srPlayerId, fullName, firstName, lastName, birthDate, heightCm, weightKg, (player.position || '').trim().slice(0, 50) || null]
  );
  const playerIdRes = await pool.query('SELECT id FROM players WHERE sr_player_id = $1 LIMIT 1', [srPlayerId]);
  const playerId = playerIdRes.rows[0].id;

  await pool.query(
    `INSERT INTO player_external_ids (player_id, source, external_id) VALUES ($1, 'basketball_reference', $2) ON CONFLICT (player_id, source) DO NOTHING`,
    [playerId, srPlayerId]
  );

  for (const s of player.seasons || []) {
    const year = parseInt(String(s.season).replace(/\D/g, ''), 10);
    if (!Number.isFinite(year)) continue;
    const seasonId = await getOrCreateSeason(pool, leagueId, year);
    const teamId = await getOrCreateTeam(pool, leagueId, s.team);
    if (!seasonId || !teamId) continue;
    const teamSeasonId = await getOrCreateTeamSeason(pool, teamId, seasonId);

    const pgRes = await pool.query(
      'SELECT id FROM player_seasons WHERE player_id = $1 AND team_season_id = $2 LIMIT 1',
      [playerId, teamSeasonId]
    );
    let playerSeasonId;
    if (pgRes.rows.length > 0) {
      playerSeasonId = pgRes.rows[0].id;
    } else {
      const gp = num(s.gp) != null ? parseInt(String(s.gp), 10) : null;
      const ins = await pool.query(
        'INSERT INTO player_seasons (player_id, team_season_id, games_played) VALUES ($1, $2, $3) RETURNING id',
        [playerId, teamSeasonId, Number.isFinite(gp) ? gp : null]
      );
      playerSeasonId = ins.rows[0].id;
    }

    const tot = (s.stats && s.stats.totals) || {};
    const per = (s.stats && s.stats.per_game) || {};
    const games = num(tot.g || per.g || s.gp);
    const minutes = num(tot.mp || per.mp_per_g);
    const points = num(tot.pts || per.pts_per_g);
    const rebounds = num(tot.trb || per.trb_per_g);
    const assists = num(tot.ast || per.ast_per_g);
    const steals = num(tot.stl || per.stl_per_g);
    const blocks = num(tot.blk || per.blk_per_g);
    const fgPct = num(tot.fg_pct || per.fg_pct);
    const threePct = num(tot.fg3_pct || per.fg3_pct);
    const ftPct = num(tot.ft_pct || per.ft_pct);

    await pool.query(
      `INSERT INTO player_season_stats (player_season_id, games, minutes, points, rebounds, assists, steals, blocks, fg_pct, three_pct, ft_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (player_season_id) DO UPDATE SET
         games = EXCLUDED.games, minutes = EXCLUDED.minutes, points = EXCLUDED.points, rebounds = EXCLUDED.rebounds,
         assists = EXCLUDED.assists, steals = EXCLUDED.steals, blocks = EXCLUDED.blocks,
         fg_pct = EXCLUDED.fg_pct, three_pct = EXCLUDED.three_pct, ft_pct = EXCLUDED.ft_pct`,
      [playerSeasonId, games, minutes, points, rebounds, assists, steals, blocks, fgPct, threePct, ftPct]
    );
  }
}

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  let pool = null;
  if (databaseUrl) {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('rlwy.net') ? { rejectUnauthorized: false } : false,
      max: 10,
    });
    console.log('DATABASE_URL set — WNBA data will be written to Postgres.');
  }

  try {
    const playerIndex = await getAllPlayers();
    const results = [];

    for (const player of playerIndex) {
      const { name, profile_url } = player;
      console.log(`Scraping stats for: ${name} - ${profile_url}`);

      let playerData;
      try {
        playerData = await scrapePlayerStats(profile_url);
        results.push({
          name: playerData.name || name,
          profile_url: playerData.profile_url || profile_url,
          height: playerData.height || '',
          weight: playerData.weight || '',
          position: playerData.position || '',
          birthdate: playerData.birthdate || '',
          college: playerData.college || '',
          seasons: playerData.seasons || [],
        });
      } catch (err) {
        console.error(`Failed to fully scrape ${name}:`, err.message);
        playerData = {
          name,
          profile_url,
          height: '',
          weight: '',
          position: '',
          birthdate: '',
          college: '',
          seasons: [],
        };
        results.push(playerData);
      }

      if (pool && playerData && playerData.profile_url) {
        try {
          await persistPlayerToPostgres(pool, playerData);
        } catch (dbErr) {
          console.error(`Postgres persist failed for ${name}:`, dbErr.message);
        }
      }

      await delay(getRandomDelay());
    }

    await saveToJSON(results);
  } catch (error) {
    console.error('Fatal error running WNBA scraper:', error.message);
  } finally {
    if (pool) {
      await pool.end();
      console.log('Postgres pool closed.');
    }
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  getAllPlayers,
  scrapePlayerStats,
  saveToJSON,
  run,
};

