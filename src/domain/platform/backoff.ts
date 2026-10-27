export interface BackoffPolicy {
  /** Total tries including the first one. */
  maxAttempts: number;
  baseMs: number;
  capMs: number;
}

/**
 * Capped exponential backoff with "equal jitter": half the delay is fixed, half is random, so
 * concurrent retries spread out but never collapse to zero. `random01` is injected in [0, 1).
 * `retryNumber` is 1 for the first retry.
 */
export function backoffDelayMs(
  retryNumber: number,
  policy: BackoffPolicy,
  random01: number,
): number {
  const exponential = Math.min(policy.capMs, policy.baseMs * 2 ** (retryNumber - 1));
  const half = exponential / 2;
  return Math.floor(half + random01 * half);
}
