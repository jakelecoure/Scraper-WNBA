/**
 * Reset scrape jobs to pending for WNBA players who have 0 player_seasons.
 * Worker will re-scrape them and backfill seasons/stats (parser fix now returns full table).
 * Usage: DATABASE_URL=... node jobs/resetZeroSeasonWnbaJobs.js
 */

import 'dotenv/config';
import { pool } from '../db/db.js';

const BASE = 'https://www.basketball-reference.com/wnba/players';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL required');
  }
  await pool.query('SELECT 1');

  const zeroSeason = await pool.query(
    `SELECT p.sr_player_id
     FROM players p
     WHERE p.sr_player_id LIKE '%w'
     AND (SELECT COUNT(*) FROM player_seasons ps WHERE ps.player_id = p.id) = 0`
  );
  if (zeroSeason.rows.length === 0) {
    console.log('No WNBA players with 0 seasons.');
    await pool.end();
    return;
  }

  const urls = zeroSeason.rows.map((r) => {
    const letter = r.sr_player_id[0];
    return `${BASE}/${letter}/${r.sr_player_id}.html`;
  });

  let urlCol = 'url';
  try {
    await pool.query('SELECT url FROM player_scrape_jobs LIMIT 1');
  } catch (e) {
    if (e.code === '42703') urlCol = 'player_url';
  }

  const placeholders = urls.map((_, i) => `$${i + 1}`).join(', ');
  try {
    const updated = await pool.query(
      `UPDATE player_scrape_jobs
       SET status = 'pending', retry_count = 0, error_message = NULL
       WHERE league = 'wnba' AND ${urlCol} IN (${placeholders})`,
      urls
    );
    console.log(`Reset ${updated.rowCount} jobs to pending (WNBA players with 0 seasons).`);
  } catch (e) {
    if (e.code === '42703') {
      const updated = await pool.query(
        `UPDATE player_scrape_jobs
         SET status = 'pending', attempts = 0, last_error = NULL
         WHERE league = 'wnba' AND ${urlCol} IN (${placeholders})`,
        urls
      );
      console.log(`Reset ${updated.rowCount} jobs to pending (WNBA players with 0 seasons).`);
    } else throw e;
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
