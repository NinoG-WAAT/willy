import { describe, expect, it } from "vitest";
import { readLlmConfig } from "../../../src/adapters/llm/config";

describe("readLlmConfig", () => {
  it("defaults to the fake so a fresh checkout needs no secrets", () => {
    expect(readLlmConfig({})).toEqual({ ok: true, value: { mode: "fake" } });
    expect(readLlmConfig({ LLM_PROVIDER: "fake" })).toEqual({ ok: true, value: { mode: "fake" } });
  });

  it("reads Anthropic settings with defaults for host, model and timeout", () => {
    const result = readLlmConfig({ LLM_PROVIDER: "anthropic", LLM_API_KEY: "k" });
    expect(result).toEqual({
      ok: true,
      value: {
        mode: "anthropic",
        apiKey: "k",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-5-5",
        timeoutMs: 60000,
      },
    });
  });

  it("accepts a custom https host, model and bounded timeout", () => {
    const result = readLlmConfig({
      LLM_PROVIDER: "anthropic",
      LLM_API_KEY: "k",
      LLM_API_BASE_URL: "https://llm.example.com/",
      LLM_MODEL: "some-model",
      LLM_TIMEOUT_MS: "20000",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { baseUrl: "https://llm.example.com", model: "some-model", timeoutMs: 20000 },
    });
  });

  it.each([
    [{ LLM_PROVIDER: "gpt" }, /LLM_PROVIDER/],
    [{ LLM_PROVIDER: "anthropic" }, /LLM_API_KEY/],
    [{ LLM_PROVIDER: "anthropic", LLM_API_KEY: "k", LLM_API_BASE_URL: "http://x.test" }, /https/],
    [
      { LLM_PROVIDER: "anthropic", LLM_API_KEY: "k", LLM_API_BASE_URL: "https://u:p@x.test" },
      /LLM_API_BASE_URL/,
    ],
    [{ LLM_PROVIDER: "anthropic", LLM_API_KEY: "k", LLM_API_BASE_URL: "nope" }, /LLM_API_BASE_URL/],
    [{ LLM_PROVIDER: "anthropic", LLM_API_KEY: "k", LLM_MODEL: "bad model!" }, /LLM_MODEL/],
    [{ LLM_PROVIDER: "anthropic", LLM_API_KEY: "k", LLM_TIMEOUT_MS: "5" }, /LLM_TIMEOUT_MS/],
  ])("rejects bad settings %j naming the variable, never its value", (env, pattern) => {
    const result = readLlmConfig(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(pattern);
      expect(result.error).not.toContain("u:p");
      expect(result.error).not.toContain("bad model!");
    }
  });
});
