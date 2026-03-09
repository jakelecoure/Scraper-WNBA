/**
 * Clear this league's job queue and regenerate all player scrape jobs from Basketball Reference.
 * Uses SCRAPER_LEAGUE (wnba, nba, gleague). Run once after deploy or when rosters are incomplete.
 *
 * Usage: SCRAPER_LEAGUE=wnba node jobs/regeneratePlayerJobs.js
 */

import 'dotenv/config';
import { pool } from '../db/db.js';
import { fetchPlayerUrlsFromIndex, fetchWnbaPlayerUrlsFromIndex } from '../scrapers/playerIndexScraper.js';

const BATCH_SIZE = 300;
const LEAGUE = (process.env.SCRAPER_LEAGUE || 'wnba').toLowerCase().trim();

async function regenerateJobs() {
  if (!['wnba', 'nba', 'gleague'].includes(LEAGUE)) {
    throw new Error(`Invalid SCRAPER_LEAGUE=${LEAGUE}. Use wnba, nba, or gleague.`);
  }

  console.log(`Regenerating player scrape jobs for league=${LEAGUE}...`);

  let urlColumn = 'url';
  try {
    await pool.query('SELECT id, player_url FROM player_scrape_jobs LIMIT 1');
    urlColumn = 'player_url';
  } catch (e) {
    if (e.code === '42703') {
      await pool.query('SELECT id, url, league FROM player_scrape_jobs LIMIT 1');
      urlColumn = 'url';
    } else if (e.code === '42P01') {
      await pool.end();
      throw new Error('player_scrape_jobs table does not exist. Run migrate first.');
    } else {
      throw e;
    }
  }

  console.log(`Clearing existing jobs for league=${LEAGUE}...`);
  await pool.query('DELETE FROM player_scrape_jobs WHERE league = $1', [LEAGUE]);

  console.log(`Fetching full player index for ${LEAGUE}...`);
  const urls = LEAGUE === 'wnba'
    ? await fetchWnbaPlayerUrlsFromIndex()
    : await fetchPlayerUrlsFromIndex();
  console.log(`Found ${urls.length} player URLs. Inserting in batches of ${BATCH_SIZE}...`);

  let inserted = 0;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const values = batch.map((_, j) => `($${j + 1}, $${batch.length + 1}, 'pending')`).join(', ');
    const params = [...batch, LEAGUE];
    await pool.query(
      `INSERT INTO player_scrape_jobs (${urlColumn}, league, status) VALUES ${values}`,
      params
    );
    inserted += batch.length;
    if ((i + BATCH_SIZE) % 1500 === 0 || i + BATCH_SIZE >= urls.length) {
      console.log(`  inserted ${Math.min(i + BATCH_SIZE, urls.length)} / ${urls.length}`);
    }
  }

  console.log(`Done. ${inserted} jobs enqueued for league=${LEAGUE}. Start workers (npm start or npm run workers).`);
  await pool.end();
}

regenerateJobs().catch((err) => {
  console.error(err);
  process.exit(1);
});
