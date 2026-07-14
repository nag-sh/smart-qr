import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff, isRetryableError } from '../retryWithBackoff';

describe('retryWithBackoff', () => {
  it('succeeds on first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    await expect(retryWithBackoff(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fails once then succeeds on retry — call count === 2', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce('ok');

    await expect(retryWithBackoff(fn, { delayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exhausts attempts and rejects with the last error', async () => {
    const lastError = new Error('Permanent failure');
    const fn = vi.fn().mockRejectedValue(lastError);

    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, delayMs: 1 }),
    ).rejects.toThrow('Permanent failure');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('non-retryable error rejects immediately without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Missing API key'));

    await expect(
      retryWithBackoff(fn, { shouldRetry: isRetryableError }),
    ).rejects.toThrow('Missing API key');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('AbortSignal aborts before a retry — fn called once, no second call', async () => {
    const ac = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = retryWithBackoff(fn, { signal: ac.signal });

    // Abort synchronously — before the microtask that enters the catch handler.
    // The catch handler will see signal.aborted and reject without retrying.
    ac.abort();

    await expect(promise).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('isRetryableError', () => {
  it('returns false for API key errors', () => {
    expect(isRetryableError(new Error('Missing API key'))).toBe(false);
    expect(isRetryableError(new Error('Invalid API_KEY'))).toBe(false);
    expect(isRetryableError(new Error('API key is not configured'))).toBe(false);
  });

  it('returns true for network / fetch / rate-limit / timeout errors', () => {
    expect(isRetryableError(new Error('Network error'))).toBe(true);
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
    expect(isRetryableError(new Error('timeout'))).toBe(true);
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryableError(new Error('ENOTFOUND'))).toBe(true);
  });

  it('returns true for indeterminate errors', () => {
    expect(isRetryableError(new Error('Something went wrong'))).toBe(true);
    expect(isRetryableError(new Error('Unknown error'))).toBe(true);
  });
});
