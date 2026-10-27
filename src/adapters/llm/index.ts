import type { Summarizer } from "../../ports/summarizer";
import { createAnthropicSummarizer } from "./anthropic-summarizer";
import type { LlmConfig } from "./config";
import { createFakeSummarizer } from "./fake-summarizer";

/** Chooses the adapter for the configuration: the deterministic fake or the real provider. */
export function createSummarizer(config: LlmConfig, doFetch: typeof fetch): Summarizer {
  if (config.mode === "fake") return createFakeSummarizer();
  return createAnthropicSummarizer({
    fetch: doFetch,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
  });
}
