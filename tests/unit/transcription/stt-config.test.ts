import { describe, expect, it } from "vitest";
import { readSttConfig } from "../../../src/adapters/stt/config";

describe("readSttConfig", () => {
  it("defaults to the fake so a fresh checkout needs no secrets", () => {
    expect(readSttConfig({})).toEqual({ ok: true, value: { mode: "fake" } });
    expect(readSttConfig({ STT_PROVIDER: "fake" })).toEqual({ ok: true, value: { mode: "fake" } });
  });

  it("reads Deepgram settings with defaults for host and timeout", () => {
    const result = readSttConfig({ STT_PROVIDER: "deepgram", STT_API_KEY: "k" });
    expect(result).toEqual({
      ok: true,
      value: {
        mode: "deepgram",
        apiKey: "k",
        baseUrl: "https://api.deepgram.com",
        timeoutMs: 30000,
      },
    });
  });

  it("accepts a custom https host and a bounded timeout", () => {
    const result = readSttConfig({
      STT_PROVIDER: "deepgram",
      STT_API_KEY: "k",
      STT_API_BASE_URL: "https://stt.example.com/",
      STT_TIMEOUT_MS: "5000",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { baseUrl: "https://stt.example.com", timeoutMs: 5000 },
    });
  });

  it.each([
    [{ STT_PROVIDER: "unknown" }, /STT_PROVIDER/],
    [{ STT_PROVIDER: "deepgram" }, /STT_API_KEY/],
    [{ STT_PROVIDER: "deepgram", STT_API_KEY: "k", STT_API_BASE_URL: "http://x.test" }, /https/],
    [
      { STT_PROVIDER: "deepgram", STT_API_KEY: "k", STT_API_BASE_URL: "https://u:p@x.test" },
      /STT_API_BASE_URL/,
    ],
    [
      { STT_PROVIDER: "deepgram", STT_API_KEY: "k", STT_API_BASE_URL: "not a url" },
      /STT_API_BASE_URL/,
    ],
    [{ STT_PROVIDER: "deepgram", STT_API_KEY: "k", STT_TIMEOUT_MS: "5" }, /STT_TIMEOUT_MS/],
    [{ STT_PROVIDER: "deepgram", STT_API_KEY: "k", STT_TIMEOUT_MS: "abc" }, /STT_TIMEOUT_MS/],
  ])("rejects bad settings %j naming the variable, never its value", (env, pattern) => {
    const result = readSttConfig(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(pattern);
      expect(result.error).not.toContain("u:p");
    }
  });
});
