/**
 * Scrape a single player profile page and return profile data + season rows.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { withRateLimit } from '../utils/rateLimiter.js';
import { retry } from '../utils/retry.js';
import { heightToCm, weightToKg, parseBirthDate } from '../utils/conversions.js';
import { srPlayerIdFromUrl } from './playerIndexScraper.js';
import { getAbbrevByTeamName } from '../utils/teamMap.js';

export async function fetchPlayerProfileHtml(url) {
  return withRateLimit(async () => {
    return retry(async () => {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NBA-Scraper/1.0)',
          'Accept': 'text/html',
        },
        validateStatus: (s) => s === 200 || s === 429 || s === 404,
      });
      if (res.status === 404) {
        const err = new Error('Page not found (404)');
        err.response = res;
        err.status = 404;
        throw err;
      }
      if (res.status === 429) {
        const err = new Error('Rate limited (429)');
        err.response = res;
        throw err;
      }
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      return res.data;
    });
  });
}

/**
 * Parse profile section: name, birth date, birth place, height, weight, position, nationality.
 */
function parseProfile($) {
  const fullName = $('h1[itemprop="name"]').first().text().trim()
    || $('h1').first().text().trim()
    || $('title').text().replace(/\s*\|\s*Basketball-Reference\.com.*$/i, '').trim()
    || null;
  const parts = fullName ? fullName.split(/\s+/) : [];
  const first_name = parts.length ? parts[0] : null;
  const last_name = parts.length > 1 ? parts.slice(1).join(' ') : null;

  let birth_date = null;
  let birth_place = null;
  let height_cm = null;
  let weight_kg = null;
  let position = null;
  let nationality = null;

  const p = $('div#info').text() || $('div[itemtype="https://schema.org/Person"]').text() || $('body').text();
  const heightMatch = p.match(/(\d-\d+)\s*,\s*(\d+)\s*lb\s*\((\d+)\s*cm\s*,\s*(\d+)\s*kg\)/i)
    || p.match(/(\d-\d+)\s*,\s*(\d+)\s*lb/i);
  if (heightMatch) {
    height_cm = heightToCm(heightMatch[1]);
    if (!height_cm && heightMatch[3]) height_cm = parseFloat(heightMatch[3]);
    weight_kg = weightToKg(heightMatch[2] + 'lb') || (heightMatch[4] ? parseFloat(heightMatch[4]) : null);
  }

  const bornMatch = p.match(/Born:\s*([^▪]+?)(?:\s+in\s+([^▪]+?))?(?:\s+([a-z]{2})\s*$|$)/im);
  if (bornMatch) {
    birth_date = parseBirthDate(bornMatch[1].trim());
    birth_place = bornMatch[2] ? bornMatch[2].trim() : null;
    nationality = bornMatch[3] ? bornMatch[3].trim().toLowerCase() : null;
  }

  const posMatch = p.match(/Position:\s*([^▪]+)/i);
  if (posMatch) position = posMatch[1].replace(/\s+/g, ' ').trim() || null;

  return {
    full_name: fullName,
    first_name: first_name,
    last_name: last_name,
    birth_date,
    birth_place,
    height_cm,
    weight_kg,
    position,
    nationality,
  };
}

/**
 * Parse per_game table (Regular Season only) into season rows.
 * Basketball-Reference often puts the table inside an HTML comment; parseSeasonRowsFromTable
 * runs on the main doc, and parseSeasonRowsFromComments extracts from <!-- ... --> if needed.
 */
function parseSeasonRowsFromComments(rawHtml) {
  const commentRegex = /<!--([\s\S]*?)-->/g;
  let match;
  while ((match = commentRegex.exec(rawHtml)) !== null) {
    const commentContent = match[1];
    if (commentContent.length < 300) continue;
    if (!commentContent.includes('season') && !commentContent.includes('pts_per_g') && !commentContent.includes('team_id') && !commentContent.includes('per_game')) continue;
    try {
      const $ = cheerio.load(commentContent);
      const rows = parseSeasonRowsFromTable($);
      if (rows.length > 0) return rows;
    } catch (_) {}
  }
  const allPerGameMatch = rawHtml.match(/<div[^>]*id="all_per_game"[^>]*>\s*<!--\s*([\s\S]*?)-->/i);
  if (allPerGameMatch) {
    try {
      const $ = cheerio.load(allPerGameMatch[1]);
      const rows = parseSeasonRowsFromTable($);
      if (rows.length > 0) return rows;
    } catch (_) {}
  }
  return [];
}

function parseSeasonRowsFromTable($) {
  const rows = [];
  let $table = $('table#per_game').first();
  if (!$table.length) {
    $('table').each((_, table) => {
      if (rows.length > 0) return;
      const $t = $(table);
      const hasSeason = $t.find('tbody tr th[data-stat="season"]').length + $t.find('tbody tr th[data-stat="Season"]').length;
      const hasTeam = $t.find('tbody tr td[data-stat="team_id"]').length;
      const hasPts = $t.find('tbody tr td[data-stat="pts_per_g"]').length;
      if ((hasSeason || hasTeam) && (hasPts || hasTeam)) {
        const r = extractSeasonRowsFromTable($, $t);
        if (r.length > 0) rows.push(...r);
      }
    });
    return rows;
  }
  const extracted = extractSeasonRowsFromTable($, $table);
  rows.push(...extracted);
  return rows;
}

/**
 * Parse jersey numbers from div.uni_holder links (data-tip: "Team Name, Year(s)").
 * Returns only NBA teams. Year can be "2010" or "2015-2018".
 */
function parseJerseyNumbers($) {
  const entries = [];
  $('div.uni_holder a[href*="numbers.cgi?number="]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const numMatch = href.match(/number=(\d+)/);
    const tip = ($a.attr('data-tip') || '').trim();
    if (!numMatch || !tip) return;
    const number = numMatch[1];
    const commaIdx = tip.lastIndexOf(',');
    if (commaIdx === -1) return;
    const teamName = tip.slice(0, commaIdx).trim();
    const yearPart = tip.slice(commaIdx + 1).trim();
    if (!getAbbrevByTeamName(teamName)) return;
    const yearRange = yearPart.match(/^(\d{4})-(\d{4})$/);
    const yearSingle = yearPart.match(/^(\d{4})$/);
    let yearStart, yearEnd;
    if (yearRange) {
      yearStart = parseInt(yearRange[1], 10);
      yearEnd = parseInt(yearRange[2], 10);
    } else if (yearSingle) {
      yearStart = yearEnd = parseInt(yearSingle[1], 10);
    } else return;
    entries.push({ number, teamName, yearStart, yearEnd });
  });
  return entries;
}

function applyJerseyNumbersToSeasons(seasons, jerseys) {
  for (const row of seasons) {
    const abbrev = (row.team_abbrev || '').toUpperCase();
    const yearStart = row.year_start;
    for (const j of jerseys) {
      if (getAbbrevByTeamName(j.teamName) !== abbrev) continue;
      if (yearStart >= j.yearStart && yearStart <= j.yearEnd) {
        row.jersey_number = j.number;
        break;
      }
    }
  }
}

function extractSeasonRowsFromTable($, $table) {
  const rows = [];
  $table.find('tbody tr').each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass('thead')) return;
    const seasonCell = $tr.find('th[data-stat="season"]');
    let season = (seasonCell.find('a').length ? seasonCell.find('a') : seasonCell).text().trim();
    if (!season && $tr.find('th[data-stat="Season"]').length) {
      const sc = $tr.find('th[data-stat="Season"]');
      season = (sc.find('a').length ? sc.find('a') : sc).text().trim();
    }
    if (!season || !/^\d{4}-\d{2}$/.test(season)) return;
    const teamAbbrev = $tr.find('td[data-stat="team_id"] a').text().trim()
      || $tr.find('td[data-stat="team_id"]').text().trim();
    const lg = ($tr.find('td[data-stat="lg_id"]').text() || '').trim();
    if (lg && lg !== 'NBA') return;

    const g = parseCellNum($tr, 'g');
    const gs = parseCellNum($tr, 'gs');
    const mp = parseCellNum($tr, 'mp');
    const ptsPerG = parseCellNum($tr, 'pts_per_g');
    const trbPerG = parseCellNum($tr, 'trb_per_g');
    const astPerG = parseCellNum($tr, 'ast_per_g');
    const stlPerG = parseCellNum($tr, 'stl_per_g');
    const blkPerG = parseCellNum($tr, 'blk_per_g');
    const fgPct = parseCellPct($tr, 'fg_pct');
    const fg3Pct = parseCellPct($tr, 'fg3_pct');
    const ftPct = parseCellPct($tr, 'ft_pct');

    // Totals columns (used when per-game columns are missing, e.g. in some comment tables)
    const ptsTotal = parseCellNum($tr, 'pts');
    const trbTotal = parseCellNum($tr, 'trb');
    const astTotal = parseCellNum($tr, 'ast');
    const stlTotal = parseCellNum($tr, 'stl');
    const blkTotal = parseCellNum($tr, 'blk');

    const games = g;
    const minutes = g != null && mp != null ? Math.round(g * mp * 100) / 100 : (parseCellNum($tr, 'mp') ?? null);
    const points = g != null && ptsPerG != null ? Math.round(g * ptsPerG) : (ptsTotal ?? null);
    const rebounds = g != null && trbPerG != null ? Math.round(g * trbPerG * 100) / 100 : (trbTotal ?? null);
    const assists = g != null && astPerG != null ? Math.round(g * astPerG * 100) / 100 : (astTotal ?? null);
    const steals = g != null && stlPerG != null ? Math.round(g * stlPerG * 100) / 100 : (stlTotal ?? null);
    const blocks = g != null && blkPerG != null ? Math.round(g * blkPerG * 100) / 100 : (blkTotal ?? null);

    const [yStart, yEnd] = season.split('-').map((x) => parseInt(x, 10));
    const yearEnd = yEnd < 50 ? 2000 + yEnd : 1900 + yEnd;

    rows.push({
      seasonLabel: season,
      year_start: yStart,
      year_end: yearEnd,
      team_abbrev: teamAbbrev || null,
      jersey_number: null,
      games_played: games,
      stats: {
        games,
        minutes,
        points,
        rebounds,
        assists,
        steals,
        blocks,
        fg_pct: fgPct,
        three_pct: fg3Pct,
        ft_pct: ftPct,
      },
    });
  });

  return rows;
}

function parseCellNum($tr, dataStat) {
  const v = $tr.find(`td[data-stat="${dataStat}"]`).text().trim();
  if (v === '') return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

function parseCellPct($tr, dataStat) {
  const v = $tr.find(`td[data-stat="${dataStat}"]`).text().trim();
  if (v === '') return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

/**
 * Fetch URL, parse HTML, return { sr_player_id, profile, seasons }.
 */
export async function scrapePlayerProfile(url) {
  const srPlayerId = srPlayerIdFromUrl(url);
  if (!srPlayerId) return { sr_player_id: null, profile: null, seasons: [], url };

  const html = await fetchPlayerProfileHtml(url);
  const $ = cheerio.load(html);

  const profile = parseProfile($);
  let seasons = parseSeasonRowsFromTable($);
  if (seasons.length === 0) {
    seasons = parseSeasonRowsFromComments(html);
  }
  const jerseys = parseJerseyNumbers($);
  applyJerseyNumbersToSeasons(seasons, jerseys);

  return { sr_player_id: srPlayerId, profile, seasons, url };
}

export default { fetchPlayerProfileHtml, scrapePlayerProfile, parseProfile, parseSeasonRowsFromTable, parseSeasonRowsFromComments };
