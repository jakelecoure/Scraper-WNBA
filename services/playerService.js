import { query } from '../db/db.js';

const SOURCE_BR = 'basketball_reference';

/**
 * Get player id by Basketball Reference sr_player_id. Returns null if not found.
 */
export async function getPlayerBySrId(srPlayerId) {
  try {
    const r = await query(
      'SELECT id FROM players WHERE sr_player_id = $1',
      [srPlayerId]
    );
    return r.rows.length > 0 ? r.rows[0].id : null;
  } catch (err) {
    console.error('[playerService] getPlayerBySrId error:', err.message);
    throw err;
  }
}

/**
 * Insert player into players table. Uses ON CONFLICT (sr_player_id) DO NOTHING
 * so the same player is never inserted twice. Returns player id (new or existing).
 */
export async function insertPlayer(data) {
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

  if (!sr_player_id) {
    console.error('[playerService] insertPlayer: sr_player_id is required');
    return null;
  }

  try {
    const ins = await query(
      `INSERT INTO players (
        full_name, first_name, last_name, birth_date, birth_place,
        height_cm, weight_kg, position, nationality, sr_player_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (sr_player_id) DO NOTHING
      RETURNING id`,
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

    let playerId;
    if (ins.rows.length > 0) {
      playerId = ins.rows[0].id;
    } else {
      const existing = await query('SELECT id FROM players WHERE sr_player_id = $1', [sr_player_id]);
      playerId = existing.rows.length > 0 ? existing.rows[0].id : null;
    }

    if (playerId) {
      await query(
        `INSERT INTO player_external_ids (player_id, source, external_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (player_id, source) DO UPDATE SET external_id = $3`,
        [playerId, SOURCE_BR, sr_player_id]
      );
    }

    return playerId;
  } catch (err) {
    console.error('[playerService] insertPlayer error:', err.message);
    throw err;
  }
}

/**
 * Ensure external_id row exists for existing player.
 */
export async function upsertExternalId(playerId, srPlayerId) {
  try {
    await query(
      `INSERT INTO player_external_ids (player_id, source, external_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (player_id, source) DO UPDATE SET external_id = $3`,
      [playerId, SOURCE_BR, srPlayerId]
    );
  } catch (err) {
    console.error('[playerService] upsertExternalId error:', err.message);
    throw err;
  }
}

export default { getPlayerBySrId, insertPlayer, upsertExternalId };
