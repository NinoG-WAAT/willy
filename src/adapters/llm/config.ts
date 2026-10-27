import { err, ok, type Result } from "../../domain/platform/result";

export type LlmConfig =
  | { mode: "fake" }
  | {
      mode: "anthropic";
      apiKey: string;
      baseUrl: string;
      model: string;
      timeoutMs: number;
    };

export type EnvLike = Readonly<Record<string, string | undefined>>;

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const MODEL_ID = /^[A-Za-z0-9._:/-]{1,100}$/;

/**
 * Reads LLM settings. Defaults to the fake so a fresh checkout needs no secrets. Errors name
 * variables only, never their values (they may be secrets or contain credentials).
 */
export function readLlmConfig(env: EnvLike): Result<LlmConfig, string> {
  const provider = env["LLM_PROVIDER"] ?? "fake";
  if (provider === "fake") return ok({ mode: "fake" });
  if (provider !== "anthropic") return err("LLM_PROVIDER must be 'fake' or 'anthropic'");

  const apiKey = env["LLM_API_KEY"];
  if (!apiKey) return err("missing environment variable: LLM_API_KEY");

  let baseUrl = DEFAULT_BASE_URL;
  const rawBase = env["LLM_API_BASE_URL"];
  if (rawBase) {
    let parsed: URL;
    try {
      parsed = new URL(rawBase);
    } catch {
      return err("LLM_API_BASE_URL must be a valid https URL");
    }
    if (parsed.protocol !== "https:") return err("LLM_API_BASE_URL must use https");
    if (parsed.username !== "" || parsed.password !== "") {
      return err("LLM_API_BASE_URL must not contain credentials");
    }
    baseUrl = parsed.origin;
  }

  const model = env["LLM_MODEL"] ?? DEFAULT_MODEL;
  if (!MODEL_ID.test(model)) return err("LLM_MODEL is not a valid model identifier");

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  const rawTimeout = env["LLM_TIMEOUT_MS"];
  if (rawTimeout) {
    timeoutMs = Number(rawTimeout);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
      return err(
        `LLM_TIMEOUT_MS must be an integer between ${String(MIN_TIMEOUT_MS)} and ${String(MAX_TIMEOUT_MS)}`,
      );
    }
  }
  return ok({ mode: "anthropic", apiKey, baseUrl, model, timeoutMs });
}
