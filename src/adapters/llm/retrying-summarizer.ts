import { withRetry, type RetryDeps } from "../../app/platform/retry";
import type { Summarizer } from "../../ports/summarizer";

/** Retries transient provider failures and unusable model answers with capped, jittered backoff. */
export function createRetryingSummarizer(inner: Summarizer, deps: RetryDeps): Summarizer {
  return {
    summarize: (input) => withRetry(() => inner.summarize(input), deps),
  };
}
