import { backoffDelayMs } from "../platform/backoff";

/** How the pages poll job status (docs/PLAN.md, "Live updates"). */
export const POLL = {
  /** First delay; the page was just rendered with the current state, so no hurry. */
  baseMs: 4_000,
  capMs: 30_000,
  /** Consecutive failed polls before giving up and leaving the "Check again" link to the person. */
  maxConsecutiveErrors: 5,
  /** A job that has not settled in this long is not worth a tab polling forever. */
  maxTotalMs: 30 * 60_000,
  /** A server asking for more than this is treated as asking for this. */
  maxRetryAfterMs: 5 * 60_000,
} as const;

/**
 * Delay before the next poll. `streak` counts consecutive polls that brought no news (unchanged
 * or failed); a change resets it to 0. Same capped, jittered backoff as the job retries.
 * `retryAfterSeconds` is the server's 429 hint and only ever lengthens the wait.
 */
export function nextPollDelayMs(
  streak: number,
  retryAfterSeconds: number | null,
  random01: number,
): number {
  const delay = backoffDelayMs(
    streak + 1,
    { maxAttempts: Number.POSITIVE_INFINITY, baseMs: POLL.baseMs, capMs: POLL.capMs },
    random01,
  );
  if (retryAfterSeconds === null || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return delay;
  }
  return Math.max(delay, Math.min(retryAfterSeconds * 1000, POLL.maxRetryAfterMs));
}
