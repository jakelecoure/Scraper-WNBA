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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
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
  // WNBA / alternate format: "6-4 (193cm)" or "6-4 (193cm), 88kg" without "lb" in same phrase
  if (height_cm == null) {
    const altHeight = p.match(/(\d)-(\d+)\s*\((\d+)\s*cm\)/i) || p.match(/(\d-\d+)\s*\((\d+)\s*cm\)/i);
    if (altHeight) {
      if (altHeight[3]) height_cm = parseFloat(altHeight[3]); // cm value is reliable
      if (height_cm == null && altHeight[1] !== undefined) {
        const feetInch = altHeight[2] !== undefined ? `${altHeight[1]}-${altHeight[2]}` : altHeight[1];
        height_cm = heightToCm(feetInch);
      }
    }
  }
  if (weight_kg == null && p.match(/(\d+)\s*kg/i)) {
    const kgMatch = p.match(/(\d+(?:\.\d+)?)\s*kg/i);
    if (kgMatch) weight_kg = parseFloat(kgMatch[1]);
  }

  const bornMatch = p.match(/Born:\s*([^▪]+?)(?:\s+in\s+([^▪]+?))?(?:\s+([a-z]{2})\s*$|$)/im);
  if (bornMatch) {
    birth_date = parseBirthDate(bornMatch[1].trim());
    birth_place = bornMatch[2] ? bornMatch[2].trim() : null;
    nationality = bornMatch[3] ? bornMatch[3].trim().toLowerCase() : null;
  }
  if (!birth_place && /Born:[\s\S]*?\s+in\s+([^▪\n]+?)(?:\s+[a-z]{2}\s*$|\n|▪)/im.test(p)) {
    const placeMatch = p.match(/Born:[\s\S]*?\s+in\s+([^▪\n]+?)(?:\s+[a-z]{2}\s*$|\n|▪)/im);
    if (placeMatch) birth_place = placeMatch[1].trim();
  }
  if (!birth_date && /Born:[\s\S]*?([A-Za-z]+\s+\d{1,2},?\s*\d{4})/im.test(p)) {
    const dateMatch = p.match(/Born:[\s\S]*?([A-Za-z]+\s+\d{1,2},?\s*\d{4})/im);
    if (dateMatch) birth_date = parseBirthDate(dateMatch[1].replace(/\s+/g, ' ').trim());
  }

  const posMatch = p.match(/Position:\s*([^▪\n]+?)(?=\s*\d-\d+|\s*\d+\s*cm|Born:|College:|High School:|$|\n)/i)
    || p.match(/Position:\s*([^▪]+)/i);
  if (posMatch) {
    let pos = posMatch[1].replace(/\s+/g, ' ').trim();
    // Strip trailing height/weight/bio that was captured (e.g. "Center 6-4 (193cm) Born...")
    pos = pos.replace(/\s*\d-\d+.*$/i, '').trim();
    pos = pos.split(/\n/)[0].trim();
    if (pos.length > 0 && pos.length < 80) position = pos || null;
    else if (pos.length >= 80) position = null; // likely captured wrong content
  }

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
 * We try the known "Per Game" wrapper first, then only accept results from other comments
 * when at least one row has games_played > 1 (so we don't use a wrong table with g=1).
 */
function parseSeasonRowsFromComments(rawHtml, league) {
  const tryComment = (commentContent, requireFullSeasons = false) => {
    if (!commentContent || commentContent.length < 300) return [];
    try {
      const $ = cheerio.load(commentContent);
      const rows = parseSeasonRowsFromTable($, league);
      const hasFullSeasons = rows.some((r) => (r.games_played || 0) > 1);
      if (rows.length === 0) return [];
      if (requireFullSeasons && !hasFullSeasons) return [];
      return rows;
    } catch (_) {
      return [];
    }
  };

  // Known wrapper IDs: accept table even without hasFullSeasons so we get full career
  // (BR often shows ~4 rows in visible table and full table in comment).
  const patterns = [
    /<div[^>]*id="all_per_game"[^>]*>\s*<!--\s*([\s\S]*?)-->/i,
    /<div[^>]*id="all_per_game_stats"[^>]*>\s*<!--\s*([\s\S]*?)-->/i,
    /<div[^>]*id="all_wnba_per_game"[^>]*>\s*<!--\s*([\s\S]*?)-->/i,
    /<div[^>]*id="all_wnba_per_game_stats"[^>]*>\s*<!--\s*([\s\S]*?)-->/i,
    // Some pages use a single comment for the full table; match div that contains wnba + per_game
    /<div[^>]*id="[^"]*wnba[^"]*per_game[^"]*"[^>]*>[\s\S]*?<!--\s*([\s\S]*?)-->/i,
  ];
  for (const re of patterns) {
    const m = rawHtml.match(re);
    if (m && m[1]) {
      const rows = tryComment(m[1], false);
      if (rows.length > 0) return rows;
    }
  }

  const commentRegex = /<!--([\s\S]*?)-->/g;
  let match;
  while ((match = commentRegex.exec(rawHtml)) !== null) {
    const commentContent = match[1];
    if (commentContent.length < 300) continue;
    if (!commentContent.includes('season') && !commentContent.includes('pts_per_g') && !commentContent.includes('team_id') && !commentContent.includes('per_game') && !commentContent.includes('year_id') && !commentContent.includes('data-stat="tm"') && !commentContent.includes('data-stat="team"')) continue;
    const rows = tryComment(commentContent, true);
    if (rows.length > 0) return rows;
  }
  return [];
}

function parseSeasonRowsFromTable($, league) {
  const rows = [];
  let $table = $('table#per_game').first();
  if (!$table.length) $table = $('table#per_game_stats').first();
  if (!$table.length) $table = $('table#wnba_per_game').first();
  if (!$table.length) $table = $('table#wnba_per_game_stats').first();
  if (!$table.length) {
    $('table').each((_, table) => {
      if (rows.length > 0) return;
      const $t = $(table);
      const hasSeason = $t.find('tbody tr th[data-stat="season"]').length + $t.find('tbody tr th[data-stat="Season"]').length + $t.find('tbody tr th[data-stat="year_id"]').length;
      const hasTeam = $t.find('tbody tr td[data-stat="team_id"]').length + $t.find('tbody tr td[data-stat="team_name_abbr"]').length + $t.find('tbody tr td[data-stat="team"]').length;
      const hasPts = $t.find('tbody tr td[data-stat="pts_per_g"]').length;
      if ((hasSeason || hasTeam) && (hasPts || hasTeam)) {
        const r = extractSeasonRowsFromTable($, $t, league);
        if (r.length > 0) rows.push(...r);
      }
    });
    return rows;
  }
  const extracted = extractSeasonRowsFromTable($, $table, league);
  rows.push(...extracted);
  return rows;
}

/**
 * Parse jersey numbers from div.uni_holder links (data-tip: "Team Name, Year(s)").
 * Returns only G League teams. Year can be "2010" or "2015-2018".
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

function extractSeasonRowsFromTable($, $table, league) {
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
    if (!season && $tr.find('th[data-stat="year_id"]').length) {
      const yc = $tr.find('th[data-stat="year_id"]');
      season = (yc.find('a').length ? yc.find('a') : yc).text().trim();
    }
    // Accept "2009-10" or "2009" (single year, common on some BR pages)
    if (!season) return;
    const seasonMatch = season.match(/^(\d{4})-(\d{2})$/) || season.match(/^(\d{4})$/);
    if (!seasonMatch) return;
    const yStart = parseInt(seasonMatch[1], 10);
    const yEnd = seasonMatch[2] != null ? (parseInt(seasonMatch[2], 10) < 50 ? 2000 + parseInt(seasonMatch[2], 10) : 1900 + parseInt(seasonMatch[2], 10)) : yStart + 1;
    const seasonLabel = seasonMatch[2] != null ? season : `${yStart}-${String(yEnd).slice(-2)}`;
    let teamAbbrev = null;
    const $teamLink = $tr.find('td[data-stat="team_id"] a, [data-stat="team_id"] a').first();
    let teamLink = $teamLink.attr('href') || '';
    if (!teamLink) {
      $tr.find('a[href*="teams"]').each((_, el) => {
        if (!teamAbbrev) {
          const href = $(el).attr('href') || '';
          const m = href.match(/\/teams\/([A-Za-z0-9]+)\//i) || href.match(/teams\/([A-Za-z0-9]+)\//i);
          if (m) teamAbbrev = m[1].toUpperCase();
        }
      });
    } else {
      const match = teamLink.match(/\/teams\/([A-Za-z0-9]+)\//i) || teamLink.match(/teams\/([A-Za-z0-9]+)\//i);
      if (match) teamAbbrev = match[1].toUpperCase();
    }
    if (!teamAbbrev) {
      const text = ($tr.find('td[data-stat="team_id"]').text() || $tr.find('td[data-stat="tm"]').text() || $tr.find('td[data-stat="team"]').text() || '').trim();
      if (text && /^[A-Za-z]{2,5}$/.test(text)) teamAbbrev = text.toUpperCase();
    }
    const lg = ($tr.find('td[data-stat="lg_id"]').text() || $tr.find('td[data-stat="comp_name_abbr"]').text() || '').trim();
    // Skip NBA rows when we are persisting G-League (keep G-League rows). For WNBA we keep WNBA rows (lg !== 'NBA').
    if (lg === 'NBA') return;

    const g = parseCellNum($tr, 'g') ?? parseCellNum($tr, 'games');
    const gs = parseCellNum($tr, 'gs') ?? parseCellNum($tr, 'games_started');
    const mp = parseCellNum($tr, 'mp') ?? parseCellNum($tr, 'mp_per_g');
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

    const games = g != null ? Math.round(Number(g)) : null;
    const minutes = g != null && mp != null ? Math.round(g * mp * 100) / 100 : (parseCellNum($tr, 'mp') ?? null);
    const points = g != null && ptsPerG != null ? Math.round(g * ptsPerG) : (ptsTotal ?? null);
    const rebounds = g != null && trbPerG != null ? Math.round(g * trbPerG * 100) / 100 : (trbTotal ?? null);
    const assists = g != null && astPerG != null ? Math.round(g * astPerG * 100) / 100 : (astTotal ?? null);
    const steals = g != null && stlPerG != null ? Math.round(g * stlPerG * 100) / 100 : (stlTotal ?? null);
    const blocks = g != null && blkPerG != null ? Math.round(g * blkPerG * 100) / 100 : (blkTotal ?? null);

    rows.push({
      seasonLabel,
      year_start: yStart,
      year_end: yEnd,
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
 * @param {string} url - Player profile URL (NBA or WNBA).
 * @param {string} [league] - 'wnba' | 'nba' | 'gleague' for league-specific parsing (e.g. season filter).
 */
export async function scrapePlayerProfile(url, league) {
  const srPlayerId = srPlayerIdFromUrl(url);
  if (!srPlayerId) return { sr_player_id: null, profile: null, seasons: [], url };

  const html = await fetchPlayerProfileHtml(url);
  const $ = cheerio.load(html);

  const profile = parseProfile($);
  // Try main doc first, then comments. Use whichever has MORE rows (BR often shows
  // only ~4 rows in the visible table and puts the full table in a comment).
  let seasons = parseSeasonRowsFromTable($, league);
  const fromComments = parseSeasonRowsFromComments(html, league);
  if (fromComments.length > seasons.length) {
    seasons = fromComments;
  }
  const jerseys = parseJerseyNumbers($);
  applyJerseyNumbersToSeasons(seasons, jerseys);

  return { sr_player_id: srPlayerId, profile, seasons, url };
}

export default { fetchPlayerProfileHtml, scrapePlayerProfile, parseProfile, parseSeasonRowsFromTable, parseSeasonRowsFromComments };
