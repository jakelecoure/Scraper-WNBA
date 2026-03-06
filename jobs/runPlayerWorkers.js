/**
 * Worker: claim a pending job, scrape player, persist, mark complete/failed.
 * Run multiple processes with: npm run workers (each process is a worker).
 */

import 'dotenv/config';
import { pool } from '../db/db.js';
import { scrapeAndPersistPlayer } from '../scrapers/playerSeasonScraper.js';

const MAX_RETRIES = 3;
const POLL_MS = 3000;

async function claimJob() {
  const client = await pool.connect();
  try {
    const selectRes = await client.query(
      `SELECT id, url, retry_count FROM player_scrape_jobs
       WHERE status = 'pending' AND retry_count < max_retries
       ORDER BY id LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );
    const row = selectRes.rows[0];
    if (!row) return null;
    await client.query(
      `UPDATE player_scrape_jobs
       SET status = 'processing', started_at = COALESCE(started_at, NOW())
       WHERE id = $1`,
      [row.id]
    );
    return row;
  } finally {
    client.release();
  }
}

async function markComplete(jobId) {
  await pool.query(
    `UPDATE player_scrape_jobs SET status = 'complete', completed_at = NOW() WHERE id = $1`,
    [jobId]
  );
}

async function markFailed(jobId, errorMessage) {
  await pool.query(
    `UPDATE player_scrape_jobs
     SET status = CASE WHEN retry_count + 1 >= max_retries THEN 'failed' ELSE 'pending' END,
         retry_count = retry_count + 1,
         error_message = $2,
         completed_at = CASE WHEN retry_count + 1 >= max_retries THEN NOW() ELSE NULL END
     WHERE id = $1`,
    [jobId, errorMessage]
  );
}

async function processOneJob() {
  const job = await claimJob();
  if (!job) return false;

  const { id: jobId, url, retry_count } = job;
  console.log(`[Worker ${process.pid}] Job ${jobId} (attempt ${retry_count + 1}/${MAX_RETRIES}): ${url}`);

  try {
    const result = await scrapeAndPersistPlayer(url);
    if (result.ok) {
      console.log(`[Worker ${process.pid}] Job ${jobId} complete: ${result.sr_player_id} (${result.seasons_count} seasons)`);
      await markComplete(jobId);
    } else if (result.reason === 'not_found') {
      console.log(`[Worker ${process.pid}] Job ${jobId} skipped (missing page): ${url}`);
      await markComplete(jobId);
    } else {
      await markFailed(jobId, result.reason || 'scrape returned not ok');
    }
  } catch (err) {
    console.error(`[Worker ${process.pid}] Job ${jobId} error:`, err.message);
    if (err.response && err.response.status === 404) {
      console.log(`[Worker ${process.pid}] Job ${jobId} skipped (404): ${url}`);
      await markComplete(jobId);
    } else {
      await markFailed(jobId, err.message || String(err));
    }
  }
  return true;
}

async function runWorker() {
  console.log(`[Worker ${process.pid}] Started.`);
  while (true) {
    const hadJob = await processOneJob();
    if (!hadJob) {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

runWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});
