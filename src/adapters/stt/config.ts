import { err, ok, type Result } from "../../domain/platform/result";

export type SttConfig =
  { mode: "fake" } | { mode: "deepgram"; apiKey: string; baseUrl: string; timeoutMs: number };

export type EnvLike = Readonly<Record<string, string | undefined>>;

const DEFAULT_BASE_URL = "https://api.deepgram.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

/**
 * Reads speech-to-text settings. Defaults to the fake so a fresh checkout needs no secrets.
 * Errors name variables only, never their values (they may be secrets or contain credentials).
 */
export function readSttConfig(env: EnvLike): Result<SttConfig, string> {
  const provider = env["STT_PROVIDER"] ?? "fake";
  if (provider === "fake") return ok({ mode: "fake" });
  if (provider !== "deepgram") return err("STT_PROVIDER must be 'fake' or 'deepgram'");

  const apiKey = env["STT_API_KEY"];
  if (!apiKey) return err("missing environment variable: STT_API_KEY");

  let baseUrl = DEFAULT_BASE_URL;
  const rawBase = env["STT_API_BASE_URL"];
  if (rawBase) {
    let parsed: URL;
    try {
      parsed = new URL(rawBase);
    } catch {
      return err("STT_API_BASE_URL must be a valid https URL");
    }
    if (parsed.protocol !== "https:") return err("STT_API_BASE_URL must use https");
    if (parsed.username !== "" || parsed.password !== "") {
      return err("STT_API_BASE_URL must not contain credentials");
    }
    baseUrl = parsed.origin;
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  const rawTimeout = env["STT_TIMEOUT_MS"];
  if (rawTimeout) {
    timeoutMs = Number(rawTimeout);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
      return err(
        `STT_TIMEOUT_MS must be an integer between ${String(MIN_TIMEOUT_MS)} and ${String(MAX_TIMEOUT_MS)}`,
      );
    }
  }
  return ok({ mode: "deepgram", apiKey, baseUrl, timeoutMs });
}
