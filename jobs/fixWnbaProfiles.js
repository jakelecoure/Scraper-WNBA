/**
 * Fix WNBA player profiles that were scraped with wrong parsing (e.g. position
 * containing "Center 6-4 (193cm) Born..." or missing height/weight).
 * Re-fetches each WNBA player's profile and updates the players table.
 *
 * Usage: DATABASE_URL=... node jobs/fixWnbaProfiles.js
 */

import 'dotenv/config';
import { pool } from '../db/db.js';
import { scrapePlayerProfile } from '../scrapers/playerProfileScraper.js';

const BASE = 'https://www.basketball-reference.com';

async function getWnbaPlayerIds() {
  // WNBA players: Basketball-Reference uses sr_player_id ending in 'w' (e.g. whitake01w)
  const r = await pool.query(
    `SELECT id, sr_player_id, full_name, position
     FROM players
     WHERE sr_player_id LIKE '%w'
     AND LENGTH(sr_player_id) >= 4
     ORDER BY id`
  );
  return r.rows;
}

function wnbaProfileUrl(srPlayerId) {
  if (!srPlayerId || typeof srPlayerId !== 'string') return null;
  const letter = srPlayerId.charAt(0).toLowerCase();
  return `${BASE}/wnba/players/${letter}/${srPlayerId}.html`;
}

async function fixWnbaProfiles() {
  console.log('Connecting to database...');
  await pool.query('SELECT 1');
  console.log('Fetching WNBA player list...');
  const players = await getWnbaPlayerIds();
  console.log(`Found ${players.length} WNBA players to fix.`);

  let updated = 0;
  let errors = 0;

  for (const row of players) {
    const { id: playerId, sr_player_id, full_name, position } = row;
    const url = wnbaProfileUrl(sr_player_id);
    if (!url) {
      console.warn(`Skip ${sr_player_id}: no URL`);
      continue;
    }

    try {
      const { profile } = await scrapePlayerProfile(url, 'wnba');
      if (!profile) {
        console.warn(`Skip ${sr_player_id}: no profile returned`);
        continue;
      }

      await pool.query(
        `UPDATE players SET
          full_name = COALESCE($2, full_name),
          first_name = COALESCE($3, first_name),
          last_name = COALESCE($4, last_name),
          birth_date = COALESCE($5, birth_date),
          birth_place = COALESCE($6, birth_place),
          height_cm = COALESCE($7, height_cm),
          weight_kg = COALESCE($8, weight_kg),
          position = COALESCE($9, position),
          nationality = COALESCE($10, nationality)
         WHERE id = $1`,
        [
          playerId,
          profile.full_name ?? null,
          profile.first_name ?? null,
          profile.last_name ?? null,
          profile.birth_date ?? null,
          profile.birth_place ?? null,
          profile.height_cm ?? null,
          profile.weight_kg ?? null,
          profile.position ?? null,
          profile.nationality ?? null,
        ]
      );

      const changed = position !== (profile.position || null) ||
        profile.height_cm != null || profile.weight_kg != null;
      if (changed) {
        console.log(`Updated ${sr_player_id} (${profile.full_name || full_name}) -> position: ${profile.position ?? '(unchanged)'}`);
        updated++;
      }
    } catch (err) {
      console.error(`Error ${sr_player_id} (${full_name}):`, err.message);
      errors++;
    }

    // Rate limit: ~2s between requests
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`Done. Updated: ${updated}, errors: ${errors}`);
  await pool.end();
}

fixWnbaProfiles().catch((err) => {
  console.error(err);
  process.exit(1);
});
