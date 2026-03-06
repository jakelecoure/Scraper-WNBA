import { pool } from '../db/db.js';

const SOURCE_BR = 'basketball_reference';

/**
 * Get player id by Basketball Reference sr_player_id. Returns null if not found.
 */
export async function getPlayerBySrId(srPlayerId) {
  const r = await pool.query(
    `SELECT id FROM players WHERE sr_player_id = $1`,
    [srPlayerId]
  );
  return r.rows.length > 0 ? r.rows[0].id : null;
}

/**
 * Insert player and optional external_id. Returns player id.
 * Caller must ensure sr_player_id is not already present (check getPlayerBySrId first).
 */
export async function createPlayer(data) {
  const {
    full_name,
    first_name,
    last_name,
    birth_date,
    birth_place,
    height_cm,
    weight_kg,
    position,
    nationality,
    sr_player_id,
  } = data;
  const ins = await pool.query(
    `INSERT INTO players (
      full_name, first_name, last_name, birth_date, birth_place,
      height_cm, weight_kg, position, nationality, sr_player_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      full_name ?? null,
      first_name ?? null,
      last_name ?? null,
      birth_date ?? null,
      birth_place ?? null,
      height_cm ?? null,
      weight_kg ?? null,
      position ?? null,
      nationality ?? null,
      sr_player_id,
    ]
  );
  const playerId = ins.rows[0].id;
  await pool.query(
    `INSERT INTO player_external_ids (player_id, source, external_id)
     VALUES ($1, $2, $3) ON CONFLICT (player_id, source) DO NOTHING`,
    [playerId, SOURCE_BR, sr_player_id]
  );
  return playerId;
}

/**
 * Ensure external_id row exists for existing player.
 */
export async function upsertExternalId(playerId, srPlayerId) {
  await pool.query(
    `INSERT INTO player_external_ids (player_id, source, external_id)
     VALUES ($1, $2, $3) ON CONFLICT (player_id, source) DO UPDATE SET external_id = $3`,
    [playerId, SOURCE_BR, srPlayerId]
  );
}

export default { getPlayerBySrId, createPlayer, upsertExternalId };
