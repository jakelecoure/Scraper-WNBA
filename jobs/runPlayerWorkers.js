/**
 * Worker: claim a pending job for this league, scrape player, persist, mark complete/failed.
 * Run with: npm start (Railway) or npm run workers.
 * Set SCRAPER_LEAGUE=nba, SCRAPER_LEAGUE=gleague, or SCRAPER_LEAGUE=wnba.
 * For wnba: runs the standalone WNBA scraper (index.js) and exits.
 * For nba/gleague: uses Postgres job queue and worker loop.
 * Auto-detects schema: uses player_url or url for the URL column.
 */

import 'dotenv/config';
import { createRequire } from 'module';

const VALID_LEAGUES = ['nba', 'gleague', 'wnba'];

function getScraperLeague() {
  // Default to wnba for this repo so Railway/deploys work without setting the env var
  const raw = (process.env.SCRAPER_LEAGUE || 'wnba').toLowerCase().trim();
  if (VALID_LEAGUES.includes(raw)) return raw;
  console.error(`Invalid or missing SCRAPER_LEAGUE. Must be one of: ${VALID_LEAGUES.join(', ')}`);
  process.exit(1);
}

const scraperLeague = getScraperLeague();

/** When SCRAPER_LEAGUE=wnba, run the standalone WNBA scraper and exit. */
async function runWnbaScraper() {
  const require = createRequire(import.meta.url);
  const { run } = require('../index.js');
  await run();
}

async function main() {
  if (scraperLeague === 'wnba') {
    console.log('SCRAPER_LEAGUE=wnba — running standalone WNBA scraper.');
    await runWnbaScraper();
    process.exit(0);
    return;
  }

  const { pool, testConnection } = await import('../db/db.js');
  const { scrapeAndPersistPlayer } = await import('../scrapers/playerSeasonScraper.js');

  const MAX_RETRIES = 3;
  const POLL_MS = 3000;

  let jobsTableValid = false;
  /** Column name for the player URL: 'player_url' or 'url' */
  let urlColumnName = 'player_url';

  async function checkJobsTableSchema() {
    try {
      await pool.query('SELECT id, player_url, league FROM player_scrape_jobs LIMIT 1');
      urlColumnName = 'player_url';
      console.log('Using column: player_url');
      return true;
    } catch (err) {
      if (err.code === '42703') {
        try {
          await pool.query('SELECT id, url, league FROM player_scrape_jobs LIMIT 1');
          urlColumnName = 'url';
          console.log('Using column: url');
          return true;
        } catch (e) {
          if (e.code === '42703') {
            console.error(
              "Database table player_scrape_jobs needs 'league' and either 'player_url' or 'url'. Run the league migration."
            );
            return false;
          }
          throw e;
        }
      }
      if (err.code === '42P01') {
        console.error("Database table player_scrape_jobs does not exist.");
        return false;
      }
      throw err;
    }
  }

  async function claimJob() {
    if (!jobsTableValid) return null;
    const client = await pool.connect();
    try {
      const selectRes = await client.query(
        `SELECT id, ${urlColumnName}
         FROM player_scrape_jobs
         WHERE status = 'pending'
         AND league = $1
         ORDER BY id
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [scraperLeague]
      );
      const row = selectRes.rows[0];
      if (!row) return null;
      const playerUrl = row[urlColumnName];
      try {
        await client.query(
          `UPDATE player_scrape_jobs
           SET status = 'processing', updated_at = NOW()
           WHERE id = $1`,
          [row.id]
        );
      } catch (updateErr) {
        if (updateErr.code === '42703') {
          await client.query(
            `UPDATE player_scrape_jobs SET status = 'processing' WHERE id = $1`,
            [row.id]
          );
        } else {
          throw updateErr;
        }
      }
      return { id: row.id, player_url: playerUrl };
    } finally {
      client.release();
    }
  }

  async function markComplete(jobId) {
    try {
      await pool.query(
        `UPDATE player_scrape_jobs SET status = 'complete', updated_at = NOW() WHERE id = $1`,
        [jobId]
      );
    } catch (err) {
      if (err.code === '42703') {
        await pool.query(
          `UPDATE player_scrape_jobs SET status = 'complete' WHERE id = $1`,
          [jobId]
        );
      } else {
        throw err;
      }
    }
  }

  async function markFailed(jobId, errorMessage) {
    try {
      await pool.query(
        `UPDATE player_scrape_jobs
         SET status = CASE WHEN attempts + 1 >= $2 THEN 'failed' ELSE 'pending' END,
             attempts = attempts + 1,
             last_error = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [jobId, MAX_RETRIES, errorMessage]
      );
    } catch (err) {
      if (err.code === '42703') {
        try {
          await pool.query(
            `UPDATE player_scrape_jobs
             SET status = CASE WHEN retry_count + 1 >= $2 THEN 'failed' ELSE 'pending' END,
                 retry_count = retry_count + 1,
                 error_message = $3
             WHERE id = $1`,
            [jobId, MAX_RETRIES, errorMessage]
          );
        } catch (e2) {
          if (e2.code === '42703') {
            await pool.query(
              `UPDATE player_scrape_jobs SET status = 'failed' WHERE id = $1`,
              [jobId]
            );
          } else {
            throw e2;
          }
        }
      } else {
        throw err;
      }
    }
  }

  async function processOneJob() {
    const job = await claimJob();
    if (!job) return false;

    const { id: jobId, player_url } = job;
    console.log(`[Worker ${process.pid}] Job ${jobId}: ${player_url}`);

    try {
      const result = await scrapeAndPersistPlayer(player_url);
      if (result.ok) {
        console.log(`[Worker ${process.pid}] Job ${jobId} complete: ${result.sr_player_id} (${result.seasons_count} seasons)`);
        await markComplete(jobId);
      } else if (result.reason === 'not_found') {
        console.log(`[Worker ${process.pid}] Job ${jobId} skipped (missing page): ${player_url}`);
        await markComplete(jobId);
      } else {
        await markFailed(jobId, result.reason || 'scrape returned not ok');
      }
    } catch (err) {
      console.error(`[Worker ${process.pid}] Job ${jobId} error:`, err.message);
      if (err.response && err.response.status === 404) {
        console.log(`[Worker ${process.pid}] Job ${jobId} skipped (404): ${player_url}`);
        await markComplete(jobId);
      } else {
        await markFailed(jobId, err.message || String(err));
      }
    }
    return true;
  }

  console.log(`Starting scraper workers (league=${scraperLeague})...`);
  await testConnection();
  console.log('Connected to Railway Postgres');
  console.log('Worker pool initialized');
  jobsTableValid = await checkJobsTableSchema();
  if (!jobsTableValid) {
    console.log('Worker will stay up. Add player_scrape_jobs table with league and url/player_url, then restart.');
    while (true) {
      await new Promise((r) => setTimeout(r, 60000));
      console.log('Waiting for player_scrape_jobs table (league, url or player_url column).');
    }
  }
  console.log(`[Worker ${process.pid}] Started (league=${scraperLeague}).`);
  while (true) {
    const hadJob = await processOneJob();
    if (!hadJob) {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
