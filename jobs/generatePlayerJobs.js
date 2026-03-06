/**
 * Generate player scrape jobs: fetch all player URLs from Basketball Reference index
 * and insert into player_scrape_jobs with status 'pending'.
 */

import 'dotenv/config';
import { pool } from '../db/db.js';
import { fetchPlayerUrlsFromIndex } from '../scrapers/playerIndexScraper.js';

async function generateJobs() {
  console.log('Fetching player index from Basketball Reference...');
  const urls = await fetchPlayerUrlsFromIndex();
  console.log(`Found ${urls.length} player URLs.`);

  let inserted = 0;
  let skipped = 0;
  for (const url of urls) {
    const r = await pool.query(
      `INSERT INTO player_scrape_jobs (url, status) VALUES ($1, 'pending')
       ON CONFLICT (url) DO NOTHING RETURNING id`,
      [url]
    );
    if (r.rowCount > 0) inserted++;
    else skipped++;
  }

  console.log(`Jobs: ${inserted} new, ${skipped} already existed.`);
  await pool.end();
}

generateJobs().catch((err) => {
  console.error(err);
  process.exit(1);
});
