import { withRetry, type RetryDeps } from "../../app/platform/retry";
import type { Transcriber } from "../../ports/transcriber";

/** Retries transient provider failures (capped exponential backoff with jitter) per chunk. */
export function createRetryingTranscriber(inner: Transcriber, deps: RetryDeps): Transcriber {
  return {
    transcribe: (request) => withRetry(() => inner.transcribe(request), deps),
  };
}
