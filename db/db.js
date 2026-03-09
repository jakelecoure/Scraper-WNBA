import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('railway') || process.env.DATABASE_URL.includes('rlwy.net'))
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

/**
 * Test the connection on startup. Call once before running workers.
 * Logs "Connected to Railway Postgres" on success.
 */
export async function testConnection() {
  await pool.query('SELECT 1');
  console.log('Connected to Railway Postgres');
}

/**
 * Test connection with retries for Railway cold start (EAI_AGAIN on postgres.railway.internal).
 * Retries up to 5 times with 3s delay so internal DNS can become ready.
 */
export async function testConnectionWithRetry(maxAttempts = 5, delayMs = 3000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query('SELECT 1');
      console.log('Connected to Railway Postgres');
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        console.warn(`DB connection attempt ${attempt}/${maxAttempts} failed (${err.code || err.message}), retrying in ${delayMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

export async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export { pool };
export default { query, pool, testConnection, testConnectionWithRetry };
