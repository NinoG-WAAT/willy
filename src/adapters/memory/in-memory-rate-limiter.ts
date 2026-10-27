import {
  decide,
  type RateLimitPolicy,
  type RateLimitState,
} from "../../domain/platform/rate-limit";
import type { Clock } from "../../ports/clock";
import type { RateLimiter, RateLimitResult } from "../../ports/rate-limiter";

const MAX_KEYS = 10_000;

/**
 * Per-process limiter (local dev, tests, single Node server). On Workers it is per isolate, so
 * production should back this port with Durable Objects or the Rate Limiting binding.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly states = new Map<string, RateLimitState>();

  constructor(private readonly clock: Clock) {}

  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const now = this.clock.now().getTime();
    const decision = decide(this.states.get(key), now, policy);
    if (decision.allowed) {
      if (this.states.size >= MAX_KEYS) this.evictExpired(now, policy.windowMs);
      this.states.set(key, decision.state);
    }
    return Promise.resolve({
      allowed: decision.allowed,
      retryAfterSeconds: decision.retryAfterSeconds,
    });
  }

  reset(key: string): Promise<void> {
    this.states.delete(key);
    return Promise.resolve();
  }

  private evictExpired(now: number, windowMs: number): void {
    for (const [key, state] of this.states) {
      if (now >= state.windowStartMs + windowMs) this.states.delete(key);
    }
    // Bounded memory even under a flood of distinct keys: drop the oldest entries.
    for (const key of this.states.keys()) {
      if (this.states.size < MAX_KEYS) break;
      this.states.delete(key);
    }
  }
}
