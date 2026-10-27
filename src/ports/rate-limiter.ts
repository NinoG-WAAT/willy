import type { RateLimitPolicy } from "../domain/platform/rate-limit";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Counts one attempt for `key` and says whether it may proceed. */
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}
