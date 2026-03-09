/**
 * Rate limiter: enforces delay between requests and handles 429 with exponential backoff.
 * Conservative settings to avoid Basketball-Reference 429s (same site for NBA and WNBA).
 */

const MIN_DELAY_MS = 3500;
const MAX_DELAY_MS = 6000;
const BASE_BACKOFF_MS = 30000;

let lastRequestTime = 0;

/**
 * Delay between MIN_DELAY_MS and MAX_DELAY_MS (random) since last request.
 */
export function delayBetweenRequests() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  const wait = Math.max(0, delay - elapsed);
  lastRequestTime = now + wait;
  return new Promise((resolve) => setTimeout(resolve, wait));
}

/**
 * Sleep for backoff after 429. attemptNumber 0-based.
 */
export function backoffMs(attemptNumber) {
  return BASE_BACKOFF_MS * Math.pow(2, attemptNumber);
}

/**
 * Wraps a fetch so it waits for rate limit then executes.
 */
export async function withRateLimit(fn) {
  await delayBetweenRequests();
  return fn();
}

export default { delayBetweenRequests, backoffMs, withRateLimit };
