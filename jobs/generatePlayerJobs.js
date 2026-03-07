/**
 * Generate player scrape jobs: fetch all player URLs from Basketball Reference index
 * and insert into player_scrape_jobs with status 'pending' and league.
 * Set SCRAPER_LEAGUE=gleague (or nba for NBA repo). Uses player_url or url column depending on schema.
 */

import 'dotenv/config';
import { pool } from '../db/db.js';
import { fetchPlayerUrlsFromIndex } from '../scrapers/playerIndexScraper.js';

const VALID_LEAGUES = ['nba', 'gleague'];

function getJobLeague() {
  const raw = (process.env.SCRAPER_LEAGUE || 'gleague').toLowerCase().trim();
  if (VALID_LEAGUES.includes(raw)) return raw;
  console.error(`Invalid SCRAPER_LEAGUE "${process.env.SCRAPER_LEAGUE}". Must be one of: ${VALID_LEAGUES.join(', ')}`);
  process.exit(1);
}

async function generateJobs() {
  const league = getJobLeague();
  console.log(`Fetching player index from Basketball Reference (league=${league})...`);
  const urls = await fetchPlayerUrlsFromIndex();
  console.log(`Found ${urls.length} player URLs.`);

  let urlColumn = null;
  try {
    await pool.query('SELECT id, player_url, league FROM player_scrape_jobs LIMIT 1');
    urlColumn = 'player_url';
    console.log('Using column: player_url');
  } catch (err) {
    if (err.code === '42703') {
      try {
        await pool.query('SELECT id, url, league FROM player_scrape_jobs LIMIT 1');
        urlColumn = 'url';
        console.log('Using column: url');
      } catch (e) {
        if (e.code === '42703') {
          await pool.end();
          throw new Error('player_scrape_jobs must have league and a player_url or url column. Run the league migration.');
        }
        throw e;
      }
    } else {
      throw err;
    }
  }

  let inserted = 0;
  let skipped = 0;
  for (const url of urls) {
    try {
      await pool.query(
        `INSERT INTO player_scrape_jobs (${urlColumn}, league, status) VALUES ($1, $2, 'pending')`,
        [url, league]
      );
      inserted++;
    } catch (err) {
      if (err.code === '23505') {
        skipped++;
      } else if (err.code === '42703') {
        await pool.end();
        throw new Error(`player_scrape_jobs table must have a ${urlColumn} and league column.`);
      } else {
        throw err;
      }
    }
  }

  console.log(`Jobs: ${inserted} new, ${skipped} already existed (league=${league}).`);
  await pool.end();
}

generateJobs().catch((err) => {
  console.error(err);
  process.exit(1);
});
