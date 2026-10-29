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

  describe("whisper (local, audio never leaves the machine)", () => {
    const base = { STT_PROVIDER: "whisper", STT_WHISPER_MODEL: "/models/ggml-base.bin" };

    it("needs only the model path and defaults everything else", () => {
      expect(readSttConfig(base)).toEqual({
        ok: true,
        value: {
          mode: "whisper",
          whisperBin: "whisper-cli",
          ffmpegBin: "ffmpeg",
          modelPath: "/models/ggml-base.bin",
          language: "auto",
          timeoutMs: 60000,
          maxConcurrency: 1,
        },
      });
    });

    it("reads explicit binaries, language, timeout and concurrency", () => {
      const result = readSttConfig({
        ...base,
        STT_WHISPER_BIN: "/opt/homebrew/bin/whisper-cli",
        STT_FFMPEG_BIN: "/opt/homebrew/bin/ffmpeg",
        STT_WHISPER_LANGUAGE: "fr",
        STT_TIMEOUT_MS: "90000",
        STT_WHISPER_MAX_CONCURRENCY: "2",
      });
      expect(result).toEqual({
        ok: true,
        value: {
          mode: "whisper",
          whisperBin: "/opt/homebrew/bin/whisper-cli",
          ffmpegBin: "/opt/homebrew/bin/ffmpeg",
          modelPath: "/models/ggml-base.bin",
          language: "fr",
          timeoutMs: 90000,
          maxConcurrency: 2,
        },
      });
    });

    it("requires the model path", () => {
      const result = readSttConfig({ STT_PROVIDER: "whisper" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/STT_WHISPER_MODEL/);
    });

    it.each([
      [{ STT_WHISPER_MODEL: "ggml-base.bin" }, /STT_WHISPER_MODEL/],
      [{ STT_WHISPER_MODEL: "-m/x" }, /STT_WHISPER_MODEL/],
      [{ STT_WHISPER_MODEL: "/models/a\nb.bin" }, /STT_WHISPER_MODEL/],
      [{ STT_WHISPER_BIN: "-evil" }, /STT_WHISPER_BIN/],
      [{ STT_WHISPER_BIN: "whisper cli; rm -rf /" }, /STT_WHISPER_BIN/],
      [{ STT_WHISPER_BIN: "../whisper-cli" }, /STT_WHISPER_BIN/],
      [{ STT_FFMPEG_BIN: "ffmpeg && id" }, /STT_FFMPEG_BIN/],
      [{ STT_WHISPER_LANGUAGE: "english" }, /STT_WHISPER_LANGUAGE/],
      [{ STT_WHISPER_LANGUAGE: "--help" }, /STT_WHISPER_LANGUAGE/],
      [{ STT_TIMEOUT_MS: "5" }, /STT_TIMEOUT_MS/],
      [{ STT_TIMEOUT_MS: "999999" }, /STT_TIMEOUT_MS/],
      [{ STT_TIMEOUT_MS: "abc" }, /STT_TIMEOUT_MS/],
      [{ STT_WHISPER_MAX_CONCURRENCY: "0" }, /STT_WHISPER_MAX_CONCURRENCY/],
      [{ STT_WHISPER_MAX_CONCURRENCY: "9" }, /STT_WHISPER_MAX_CONCURRENCY/],
      [{ STT_WHISPER_MAX_CONCURRENCY: "x" }, /STT_WHISPER_MAX_CONCURRENCY/],
    ])("rejects %j naming the variable, never its value", (extra, pattern) => {
      const result = readSttConfig({ ...base, ...extra });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(pattern);
        for (const value of Object.values(extra)) expect(result.error).not.toContain(value);
      }
    });

    it("ignores Deepgram variables and Deepgram requires none of the whisper ones", () => {
      expect(readSttConfig({ ...base, STT_API_KEY: "k", STT_API_BASE_URL: "http://x" }).ok).toBe(
        true,
      );
      expect(readSttConfig({ STT_PROVIDER: "deepgram", STT_API_KEY: "k" }).ok).toBe(true);
    });
  });
});
