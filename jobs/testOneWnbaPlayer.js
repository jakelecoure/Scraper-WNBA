/**
 * Test scraping and persisting ONE WNBA player to verify we get full profile,
 * all season stats, and correct DB storage (same as NBA scraper).
 *
 * Usage: DATABASE_URL=... node jobs/testOneWnbaPlayer.js
 *
 * Uses Skylar Diggins (digginsk01w) - she has many WNBA seasons.
 */

import 'dotenv/config';
import { scrapePlayerProfile } from '../scrapers/playerProfileScraper.js';
import { scrapeAndPersistPlayer } from '../scrapers/playerSeasonScraper.js';
import { pool } from '../db/db.js';

const TEST_URL = 'https://www.basketball-reference.com/wnba/players/d/digginsk01w.html';

async function testOnePlayer() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  // Avoid instant 429 if you just ran other scrapes
  console.log('Waiting 8s before first request...');
  await new Promise((r) => setTimeout(r, 8000));

  console.log('=== 1. Scrape only (no DB) ===');
  console.log('URL:', TEST_URL);
  const scraped = await scrapePlayerProfile(TEST_URL, 'wnba');
  const { sr_player_id, profile, seasons } = scraped;

  console.log('\nProfile:', {
    sr_player_id,
    full_name: profile?.full_name,
    position: profile?.position,
    height_cm: profile?.height_cm,
    weight_kg: profile?.weight_kg,
    birth_date: profile?.birth_date,
  });
  console.log('\nSeasons scraped:', seasons?.length ?? 0);
  if (seasons?.length) {
    console.log('First season:', seasons[0]);
    console.log('Last season:', seasons[seasons.length - 1]);
  }

  console.log('\n=== 2. Persist to DB (same as NBA scraper) ===');
  const result = await scrapeAndPersistPlayer(TEST_URL, 'wnba');
  if (!result.ok) {
    console.error('Persist failed:', result.reason || result);
    process.exit(1);
  }
  console.log('Result:', result);

  console.log('\n=== 3. Verify in database ===');
  const playerRow = await pool.query(
    'SELECT id, sr_player_id, full_name, position, height_cm, weight_kg, birth_date FROM players WHERE sr_player_id = $1',
    [sr_player_id]
  );
  if (playerRow.rows.length === 0) {
    console.error('Player not found in DB');
    process.exit(1);
  }
  console.log('players row:', playerRow.rows[0]);

  const seasonCount = await pool.query(
    `SELECT COUNT(*) AS n FROM player_seasons ps
     JOIN players p ON p.id = ps.player_id
     WHERE p.sr_player_id = $1`,
    [sr_player_id]
  );
  console.log('player_seasons count:', seasonCount.rows[0].n);

  const statsSample = await pool.query(
    `SELECT ps.id, ps.games_played, pss.points, pss.rebounds, pss.assists, pss.fg_pct
     FROM player_seasons ps
     JOIN players p ON p.id = ps.player_id
     LEFT JOIN player_season_stats pss ON pss.player_season_id = ps.id
     WHERE p.sr_player_id = $1
     ORDER BY ps.id
     LIMIT 5`,
    [sr_player_id]
  );
  console.log('Sample player_seasons + player_season_stats (first 5):', statsSample.rows);

  await pool.end();
  console.log('\n=== Test passed: profile + all seasons scraped and stored like NBA ===');
}

testOnePlayer().catch((err) => {
  console.error(err);
  process.exit(1);
});
