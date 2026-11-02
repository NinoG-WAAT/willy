import { isAbsolute } from "node:path";
import { err, ok, type Result } from "../../domain/platform/result";

export type LlmConfig =
  | { mode: "fake" }
  | {
      mode: "claude-code";
      /** Executable name (looked up on PATH) or absolute path of the Claude Code CLI. */
      claudeBin: string;
      /** Passed to `--model` when set; null keeps the CLI's own default. */
      model: string | null;
      timeoutMs: number;
    }
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
// A long meeting is one big request through a CLI, so the default is longer than for the API.
const DEFAULT_CLAUDE_CODE_TIMEOUT_MS = 180_000;
/** A bare command name (never starts with "-" or ".") or an absolute path; never a shell string. */
const BARE_COMMAND = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const MODEL_ID = /^[A-Za-z0-9._:/-]{1,100}$/;

/**
 * Reads LLM settings. Defaults to the fake so a fresh checkout needs no secrets. Errors name
 * variables only, never their values (they may be secrets or contain credentials).
 */
export function readLlmConfig(env: EnvLike): Result<LlmConfig, string> {
  const provider = env["LLM_PROVIDER"] ?? "fake";
  if (provider === "fake") return ok({ mode: "fake" });
  if (provider === "claude-code") return readClaudeCodeConfig(env);
  if (provider !== "anthropic") {
    return err("LLM_PROVIDER must be 'fake', 'anthropic' or 'claude-code'");
  }

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

  const timeoutMs = readTimeout(env, DEFAULT_TIMEOUT_MS);
  if (!timeoutMs.ok) return err(timeoutMs.error);
  return ok({ mode: "anthropic", apiKey, baseUrl, model, timeoutMs: timeoutMs.value });
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function readTimeout(env: EnvLike, fallback: number): Result<number, string> {
  const raw = env["LLM_TIMEOUT_MS"];
  if (!raw) return ok(fallback);
  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    return err(
      `LLM_TIMEOUT_MS must be an integer between ${String(MIN_TIMEOUT_MS)} and ${String(MAX_TIMEOUT_MS)}`,
    );
  }
  return ok(timeoutMs);
}

/**
 * The CLI uses the login of whoever runs the app, so no key is read (LLM_API_KEY is ignored on
 * purpose). The executable never goes through a shell, but a flag-like or relative value is refused.
 */
function readClaudeCodeConfig(env: EnvLike): Result<LlmConfig, string> {
  const rawBin = env["LLM_CLAUDE_BIN"];
  const claudeBin = rawBin === undefined || rawBin === "" ? "claude" : rawBin;
  const acceptable =
    BARE_COMMAND.test(claudeBin) || (isAbsolute(claudeBin) && !hasControlCharacters(claudeBin));
  if (!acceptable) return err("LLM_CLAUDE_BIN must be a command name or an absolute path");

  const rawModel = env["LLM_MODEL"];
  const model = rawModel === undefined || rawModel === "" ? null : rawModel;
  if (model !== null && !MODEL_ID.test(model)) {
    return err("LLM_MODEL is not a valid model identifier");
  }

  const timeoutMs = readTimeout(env, DEFAULT_CLAUDE_CODE_TIMEOUT_MS);
  if (!timeoutMs.ok) return err(timeoutMs.error);
  return ok({ mode: "claude-code", claudeBin, model, timeoutMs: timeoutMs.value });
}
