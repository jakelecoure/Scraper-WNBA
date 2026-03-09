/**
 * Clear all WNBA players from the database and reset WNBA scrape jobs to pending
 * so the worker can re-scrape them from scratch.
 *
 * - Deletes players where sr_player_id LIKE '%w' (WNBA suffix).
 *   CASCADE removes their player_seasons, player_season_stats, player_external_ids.
 * - Resets player_scrape_jobs for league='wnba' to status='pending'.
 *
 * Usage: DATABASE_URL=... node jobs/clearWnbaAndReset.js
 */

import 'dotenv/config';
import { pool } from '../db/db.js';

async function clearWnbaAndReset() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  console.log('Connecting...');
  await pool.query('SELECT 1');

  // Delete WNBA players (sr_player_id ends with 'w')
  const del = await pool.query(
    `DELETE FROM players WHERE sr_player_id LIKE '%w' AND LENGTH(sr_player_id) >= 4`
  );
  const playerCount = del.rowCount ?? 0;
  console.log(`Deleted ${playerCount} WNBA players (and their seasons/stats via CASCADE).`);

  // Reset WNBA jobs to pending
  try {
    const upd = await pool.query(
      `UPDATE player_scrape_jobs
       SET status = 'pending', attempts = 0, last_error = NULL, updated_at = NOW()
       WHERE league = 'wnba'`
    );
    console.log(`Reset ${upd.rowCount ?? 0} WNBA scrape jobs to pending.`);
  } catch (e) {
    if (e.code === '42703') {
      await pool.query(
        `UPDATE player_scrape_jobs
         SET status = 'pending', retry_count = 0, error_message = NULL
         WHERE league = 'wnba'`
      );
      console.log('Reset WNBA scrape jobs to pending (alternate schema).');
    } else throw e;
  }

  await pool.end();
  console.log('Done. Start the worker (npm start with SCRAPER_LEAGUE=wnba) to re-scrape.');
}

clearWnbaAndReset().catch((err) => {
  console.error(err);
  process.exit(1);
});
