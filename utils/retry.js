/**
 * Retry a function with exponential backoff on failure or 429.
 */

import { backoffMs } from './rateLimiter.js';

const DEFAULT_MAX_ATTEMPTS = 3;

export async function retry(fn, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const isRetryable = options.isRetryable ?? ((err) => err.response?.status !== 404);
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const shouldRetry = status === 429 || (isRetryable(err) && attempt < maxAttempts - 1);
      if (!shouldRetry) throw err;
      const wait = backoffMs(attempt);
      console.warn(`Retry ${attempt + 1}/${maxAttempts} after ${wait}ms (status=${status || 'error'}): ${err.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastError;
}

export default retry;
