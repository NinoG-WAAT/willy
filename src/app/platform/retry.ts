import { backoffDelayMs, type BackoffPolicy } from "../../domain/platform/backoff";
import type { ProviderError } from "../../domain/platform/provider-error";
import type { Result } from "../../domain/platform/result";

export interface RetryDeps {
  policy: BackoffPolicy;
  sleep: (ms: number) => Promise<void>;
  /** In [0, 1); injected so tests are deterministic. */
  random: () => number;
}

/** Retries an adapter call while its error is retryable, up to policy.maxAttempts. Never swallows the final error. */
export async function withRetry<T>(
  operation: () => Promise<Result<T, ProviderError>>,
  deps: RetryDeps,
): Promise<Result<T, ProviderError>> {
  let attempt = 1;
  for (;;) {
    const result = await operation();
    if (result.ok || !result.error.retryable || attempt >= deps.policy.maxAttempts) return result;
    await deps.sleep(backoffDelayMs(attempt, deps.policy, deps.random()));
    attempt += 1;
  }
}
