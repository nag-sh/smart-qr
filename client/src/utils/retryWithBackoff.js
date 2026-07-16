/**
 * Promise-based sleep that respects an AbortSignal.
 * @param {number} ms
 * @param {AbortSignal|null} signal
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    }
  });
}

/**
 * Determine whether an error warrants a retry.
 *
 * Returns FALSE for deterministic failures (API key misconfiguration).
 * Returns TRUE for transient failures (network / fetch / rate-limit / timeout)
 * and for indeterminate errors.
 *
 * @param {Error} error
 * @returns {boolean}
 */
export function isRetryableError(error) {
  const msg = String(error.message || '');

  // Non-retryable: API key errors (case-insensitive)
  if (/api[_\s]?key/i.test(msg)) return false;

  const text = `${msg} ${error.name || ''}`.toLowerCase();
  // Retryable: network, fetch, rate-limit, timeout, connection errors
  if (/(network|fetch|rate|timeout|econn|enotfound)/.test(text)) return true;

  // Indeterminate → retry by default
  return true;
}

/**
 * Retry an async function with a linear backoff delay.
 *
 * @param {() => Promise<T>} fn  Async function to call
 * @param {object}          [options]
 * @param {number}          [options.maxAttempts=3]   Max attempts (including first)
 * @param {number}          [options.delayMs=500]     Base delay in ms (multiplied by attempt number)
 * @param {(Error) => boolean} [options.shouldRetry]  Predicate; return true to retry, false to fail immediately
 * @param {AbortSignal|null} [options.signal=null]    AbortSignal; aborted → reject without retrying
 * @returns {Promise<T>}
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    delayMs = 500,
    shouldRetry = () => true,
    signal = null,
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (!shouldRetry(error)) throw error;
      if (attempt < maxAttempts) {
        await sleep(delayMs * attempt, signal);
      }
    }
  }
  throw lastError;
}
