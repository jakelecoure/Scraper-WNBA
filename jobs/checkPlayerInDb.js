/**
 * Check one player (e.g. Katie Douglas) in the DB: player row, season count, stats sample.
 * Usage: DATABASE_URL=... node jobs/checkPlayerInDb.js "Katie Douglas"
 */

import 'dotenv/config';
import { pool } from '../db/db.js';

const searchName = process.argv[2] || 'Katie Douglas';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL required');
  }

  const namePattern = searchName.trim().replace(/\s+/g, '%');
  const players = await pool.query(
    `SELECT id, sr_player_id, full_name, position, height_cm, weight_kg, birth_date
     FROM players
     WHERE full_name ILIKE $1 OR sr_player_id ILIKE $2`,
    [`%${namePattern}%`, `%${searchName.replace(/\s/g, '').toLowerCase().slice(0, 8)}%`]
  );

  if (players.rows.length === 0) {
    console.log(`No player found matching "${searchName}".`);
    const bySr = await pool.query(
      `SELECT id, url, league, status, retry_count, error_message
       FROM player_scrape_jobs
       WHERE url ILIKE $1 OR url ILIKE $2`,
      ['%douglas%', '%douglaka%']
    );
    if (bySr.rows.length > 0) {
      console.log('Jobs mentioning douglas:', bySr.rows);
    } else {
      console.log('No scrape jobs found for Douglas.');
    }
    await pool.end();
    return;
  }

  for (const p of players.rows) {
    console.log('\n--- Player ---');
    console.log(p);
    const seasons = await pool.query(
      `SELECT ps.id, ps.games_played, s.year_start, s.year_end, t.abbreviation
       FROM player_seasons ps
       JOIN team_seasons ts ON ts.id = ps.team_season_id
       JOIN seasons s ON s.id = ts.season_id
       JOIN teams t ON t.id = ts.team_id
       WHERE ps.player_id = $1
       ORDER BY s.year_start`,
      [p.id]
    );
    console.log('\nplayer_seasons count:', seasons.rows.length);
    if (seasons.rows.length > 0) {
      console.log('First 3 seasons:', seasons.rows.slice(0, 3));
      console.log('Last 3 seasons:', seasons.rows.slice(-3));
    }
    const stats = await pool.query(
      `SELECT pss.* FROM player_season_stats pss
       JOIN player_seasons ps ON ps.id = pss.player_season_id
       WHERE ps.player_id = $1
       LIMIT 5`,
      [p.id]
    );
    console.log('\nplayer_season_stats sample:', stats.rows.length, 'rows');
    if (stats.rows.length > 0) console.log(stats.rows[0]);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
