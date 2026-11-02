import type { Summarizer } from "../../ports/summarizer";
import { createAnthropicSummarizer } from "./anthropic-summarizer";
import { createClaudeCodeSummarizer } from "./claude-code-summarizer";
import type { LlmConfig } from "./config";
import { createFakeSummarizer } from "./fake-summarizer";

/**
 * Chooses the adapter for the configuration: the deterministic fake, the Anthropic API, or the
 * owner's local Claude Code CLI (which makes no network call from this process).
 */
export function createSummarizer(config: LlmConfig, doFetch: typeof fetch): Summarizer {
  if (config.mode === "fake") return createFakeSummarizer();
  if (config.mode === "claude-code") {
    return createClaudeCodeSummarizer({
      claudeBin: config.claudeBin,
      model: config.model,
      timeoutMs: config.timeoutMs,
    });
  }
  return createAnthropicSummarizer({
    fetch: doFetch,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
  });
}
