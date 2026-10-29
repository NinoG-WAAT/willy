import { afterEach, describe, expect, it } from "vitest";
import { getDiagnosticsDeps, getProviderStatusDeps } from "../../../src/composition";

const KEYS = [
  "STT_PROVIDER",
  "STT_WHISPER_MODEL",
  "STT_WHISPER_BIN",
  "STT_WHISPER_LANGUAGE",
  "STT_API_KEY",
] as const;

afterEach(() => {
  for (const key of KEYS) Reflect.deleteProperty(process.env, key);
});

describe("speech-to-text mode in /diagnostics and the settings screen", () => {
  it("reports whisper honestly when it is configured", () => {
    process.env["STT_PROVIDER"] = "whisper";
    process.env["STT_WHISPER_MODEL"] = "/models/ggml-base.bin";
    expect(getDiagnosticsDeps().providers.speechToText).toBe("whisper");
    expect(getProviderStatusDeps().modes.speech_to_text).toBe("whisper");
  });

  it("reports misconfigured (never whisper) when a variable is missing or invalid", () => {
    process.env["STT_PROVIDER"] = "whisper";
    expect(getDiagnosticsDeps().providers.speechToText).toBe("misconfigured");

    process.env["STT_WHISPER_MODEL"] = "/models/ggml-base.bin";
    process.env["STT_WHISPER_LANGUAGE"] = "not a language";
    expect(getDiagnosticsDeps().providers.speechToText).toBe("misconfigured");
  });

  it("still defaults to the fake", () => {
    expect(getDiagnosticsDeps().providers.speechToText).toBe("fake");
  });
});
