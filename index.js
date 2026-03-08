const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.basketball-reference.com';
const WNBA_PLAYERS_INDEX = `${BASE_URL}/wnba/players/`;
const OUTPUT_PATH = path.join(__dirname, 'data', 'wnba_players.json');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomDelay() {
  const min = 500;
  const max = 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function fetchPage(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; HoopCentralScraper/1.0; +https://www.basketball-reference.com/wnba/players/)',
      },
    });
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error.message);
    throw error;
  }
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

async function run() {
  try {
    const playerIndex = await getAllPlayers();
    const results = [];

    for (const player of playerIndex) {
      const { name, profile_url } = player;
      console.log(`Scraping stats for: ${name} - ${profile_url}`);

      try {
        const playerData = await scrapePlayerStats(profile_url);
        // Ensure we keep original name/profile_url from index if basic info is missing.
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
        results.push({
          name,
          profile_url,
          height: '',
          weight: '',
          position: '',
          birthdate: '',
          college: '',
          seasons: [],
        });
      }

      await delay(getRandomDelay());
    }

    await saveToJSON(results);
  } catch (error) {
    console.error('Fatal error running WNBA scraper:', error.message);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  getAllPlayers,
  scrapePlayerStats,
  saveToJSON,
};

