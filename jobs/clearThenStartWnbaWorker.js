/**
 * Clear all WNBA players and reset jobs, then start the WNBA worker.
 * Run once with: DATABASE_URL=... node jobs/clearThenStartWnbaWorker.js
 */

import { execSync } from 'child_process';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

process.env.SCRAPER_LEAGUE = 'wnba';

console.log('Step 1: Clearing WNBA players and resetting jobs...');
execSync('node jobs/clearWnbaAndReset.js', { stdio: 'inherit', env: process.env });

console.log('\nStep 2: Starting WNBA worker (all players, full stats)...');
execSync('node jobs/runPlayerWorkers.js', { stdio: 'inherit', env: process.env });
