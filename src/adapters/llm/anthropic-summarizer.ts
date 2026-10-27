import { providerError, type ProviderError } from "../../domain/platform/provider-error";
import { err } from "../../domain/platform/result";
import type { Summarizer } from "../../ports/summarizer";
import { guardedFetchJson } from "../http/guarded-fetch";
import { checkInput, finalizeModelOutput } from "./finalize";
import { buildSummaryPrompt } from "./prompt";
import { MODEL_OUTPUT_JSON_SCHEMA } from "./summary-schema";

export interface AnthropicConfig {
  fetch: typeof fetch;
  /** Server-side secret: sent in the x-api-key header only, never logged or put in URLs. */
  apiKey: string;
  /** https origin of the provider; the only host this adapter may contact. */
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

const TOOL_NAME = "submit_summary";
const MAX_OUTPUT_TOKENS = 8192;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const unusable = (): ProviderError =>
  providerError("unavailable", "model response had no usable summary");

/**
 * Summaries through the Anthropic Messages API with one forced tool call, so the answer is
 * structured data. The answer is still untrusted: it goes through the same schema and grounding
 * checks as the fake's. Transcript text is data inside one JSON document (see prompt.ts), and
 * nothing the model returns is executed, fetched or used to pick tools, URLs or permissions.
 */
export function createAnthropicSummarizer(config: AnthropicConfig): Summarizer {
  return {
    async summarize(input) {
      const rejected = checkInput(input);
      if (rejected) return err(rejected);

      let url: URL;
      try {
        url = new URL("/v1/messages", config.baseUrl);
      } catch {
        return err(providerError("rejected", "invalid provider URL"));
      }

      const { system, user } = buildSummaryPrompt(input);
      const body = await guardedFetchJson(
        config.fetch,
        url.toString(),
        {
          method: "POST",
          headers: {
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: MAX_OUTPUT_TOKENS,
            temperature: 0,
            system,
            messages: [{ role: "user", content: user }],
            tools: [
              {
                name: TOOL_NAME,
                description: "Submit the grounded draft summary of the meeting.",
                input_schema: MODEL_OUTPUT_JSON_SCHEMA,
              },
            ],
            tool_choice: { type: "tool", name: TOOL_NAME },
          }),
        },
        { timeoutMs: config.timeoutMs, allowedHosts: [url.hostname] },
      );
      if (!body.ok) return err(body.error);

      const message = body.value;
      if (!isObject(message) || message["stop_reason"] === "max_tokens") return err(unusable());
      const content: unknown = message["content"];
      const call = Array.isArray(content)
        ? (content as unknown[]).find(
            (block) =>
              isObject(block) && block["type"] === "tool_use" && block["name"] === TOOL_NAME,
          )
        : undefined;
      if (!isObject(call)) return err(unusable());

      return finalizeModelOutput(input, call["input"]);
    },
  };
}
