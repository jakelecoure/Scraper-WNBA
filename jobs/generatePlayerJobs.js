/**
 * Generate player scrape jobs: fetch all player URLs from Basketball Reference index
 * and insert into player_scrape_jobs with status 'pending'.
 * Uses SCRAPER_LEAGUE (wnba, nba, gleague) to choose index and set job league.
 * For a full reset (clear + refill), use: npm run regenerate-jobs
 */

import 'dotenv/config';
import { pool } from '../db/db.js';
import { fetchPlayerUrlsFromIndex, fetchWnbaPlayerUrlsFromIndex } from '../scrapers/playerIndexScraper.js';

const BATCH_SIZE = 300;
const LEAGUE = (process.env.SCRAPER_LEAGUE || 'wnba').toLowerCase().trim();

async function generateJobs() {
  if (!['wnba', 'nba', 'gleague'].includes(LEAGUE)) {
    throw new Error(`Invalid SCRAPER_LEAGUE=${LEAGUE}. Use wnba, nba, or gleague.`);
  }

  console.log(`Fetching player index for league=${LEAGUE}...`);
  const urls = LEAGUE === 'wnba'
    ? await fetchWnbaPlayerUrlsFromIndex()
    : await fetchPlayerUrlsFromIndex();
  console.log(`Found ${urls.length} player URLs.`);

  let urlColumn = 'url';
  try {
    await pool.query('SELECT id, player_url FROM player_scrape_jobs LIMIT 1');
    urlColumn = 'player_url';
    console.log('Using column: player_url');
  } catch (err) {
    if (err.code === '42703') {
      await pool.query('SELECT id, url, league FROM player_scrape_jobs LIMIT 1');
      urlColumn = 'url';
      console.log('Using column: url');
    } else {
      throw err;
    }
  }

  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const values = batch.map((_, j) => `($${j + 1}, $${batch.length + 1}, 'pending')`).join(', ');
    const params = [...batch, LEAGUE];
    try {
      const res = await pool.query(
        `INSERT INTO player_scrape_jobs (${urlColumn}, league, status) VALUES ${values}
         ON CONFLICT (${urlColumn}) DO NOTHING`,
        params
      );
      inserted += (res.rowCount ?? 0);
    } catch (err) {
      if (err.code === '42703') {
        await pool.end();
        throw new Error(`player_scrape_jobs table must have ${urlColumn} and league.`);
      }
      throw err;
    }
  }
  skipped = urls.length - inserted;

  console.log(`Jobs: ${inserted} new, ${skipped} already existed (league=${LEAGUE}).`);
  await pool.end();
}

generateJobs().catch((err) => {
  console.error(err);
  process.exit(1);
});
