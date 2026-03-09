/**
 * Re-scrape one WNBA player by sr_player_id to backfill seasons/stats (e.g. Katie Douglas).
 * Use when a player exists in DB but has 0 player_seasons (parser had returned 0 rows).
 * Usage: DATABASE_URL=... node jobs/backfillOneWnbaPlayer.js douglka01w
 */

import 'dotenv/config';
import { pool } from '../db/db.js';
import { scrapeAndPersistPlayer } from '../scrapers/playerSeasonScraper.js';

const srPlayerId = (process.argv[2] || '').toLowerCase().trim();
if (!srPlayerId || !srPlayerId.endsWith('w')) {
  console.error('Usage: node jobs/backfillOneWnbaPlayer.js <sr_player_id>');
  console.error('Example: node jobs/backfillOneWnbaPlayer.js douglka01w');
  process.exit(1);
}

const BASE = 'https://www.basketball-reference.com/wnba/players';
const letter = srPlayerId[0];
const url = `${BASE}/${letter}/${srPlayerId}.html`;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL required');
  }
  console.log('Re-scraping', url);
  const result = await scrapeAndPersistPlayer(url, 'wnba');
  console.log('Result:', result);
  if (result.ok) {
    const count = await pool.query(
      `SELECT COUNT(*) AS n FROM player_seasons ps
       JOIN players p ON p.id = ps.player_id
       WHERE p.sr_player_id = $1`,
      [srPlayerId]
    );
    console.log('player_seasons now:', count.rows[0].n);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
