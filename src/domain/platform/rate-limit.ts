export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RateLimitState {
  count: number;
  windowStartMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window resets; 0 when allowed. */
  retryAfterSeconds: number;
  state: RateLimitState;
}

/** Fixed-window counter. Denied attempts are not counted, so they do not extend a lockout. */
export function decide(
  state: RateLimitState | undefined,
  nowMs: number,
  policy: RateLimitPolicy,
): RateLimitDecision {
  if (policy.limit < 1 || policy.windowMs < 1) throw new Error("Invalid rate limit policy");
  if (!state || nowMs >= state.windowStartMs + policy.windowMs) {
    return { allowed: true, retryAfterSeconds: 0, state: { count: 1, windowStartMs: nowMs } };
  }
  if (state.count < policy.limit) {
    return { allowed: true, retryAfterSeconds: 0, state: { ...state, count: state.count + 1 } };
  }
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((state.windowStartMs + policy.windowMs - nowMs) / 1000),
  );
  return { allowed: false, retryAfterSeconds, state };
}
