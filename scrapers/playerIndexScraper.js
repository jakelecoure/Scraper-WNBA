/**
 * Scrape Basketball Reference player index to collect all player profile URLs.
 * Index: https://www.basketball-reference.com/players/
 * Then each letter: /players/a/, /players/b/, ...
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { withRateLimit } from '../utils/rateLimiter.js';
import { retry } from '../utils/retry.js';

const BASE = 'https://www.basketball-reference.com';

export async function fetchPlayerUrlsFromIndex() {
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const allUrls = new Set();

  for (const letter of letters) {
    const url = `${BASE}/players/${letter}/`;
    await withRateLimit(async () => {
      const html = await retry(async () => {
        const res = await axios.get(url, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NBA-Scraper/1.0)',
            'Accept': 'text/html',
          },
          validateStatus: (s) => s === 200 || s === 429,
        });
        if (res.status === 429) {
          const err = new Error('Rate limited (429)');
          err.response = res;
          throw err;
        }
        return res.data;
      });
      const $ = cheerio.load(html);
      $('table a[href*="/players/"][href$=".html"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('/players/')) {
          const full = href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
          if (full.includes('/players/') && full.endsWith('.html')) allUrls.add(full);
        }
      });
    });
  }

  return Array.from(allUrls);
}

/**
 * Extract sr_player_id from URL like .../players/j/jamesle01.html
 */
export function srPlayerIdFromUrl(url) {
  const match = url.match(/\/players\/[a-z]\/([a-z0-9]+)\.html$/i);
  return match ? match[1].toLowerCase() : null;
}

export default { fetchPlayerUrlsFromIndex, srPlayerIdFromUrl };
