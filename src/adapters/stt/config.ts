import { isAbsolute } from "node:path";
import { err, ok, type Result } from "../../domain/platform/result";

export type WhisperSttConfig = {
  mode: "whisper";
  /** Executable name (looked up on PATH) or absolute path of whisper.cpp's `whisper-cli`. */
  whisperBin: string;
  /** Executable name or absolute path of `ffmpeg` (browser audio -> 16 kHz mono WAV). */
  ffmpegBin: string;
  /** Absolute path of a ggml model file. */
  modelPath: string;
  /** Spoken language code, or "auto". */
  language: string;
  timeoutMs: number;
  /** Most Whisper runs allowed at once (a laptop CPU is the bottleneck). */
  maxConcurrency: number;
};

export type SttConfig =
  | { mode: "fake" }
  | { mode: "deepgram"; apiKey: string; baseUrl: string; timeoutMs: number }
  | WhisperSttConfig;

export type EnvLike = Readonly<Record<string, string | undefined>>;

const DEFAULT_BASE_URL = "https://api.deepgram.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_WHISPER_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_WHISPER_CONCURRENCY = 4;

/** A bare command name (no path separators, never starts with "-" or ".") or an absolute path. */
const BARE_COMMAND = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const LANGUAGE = /^(auto|[a-z]{2,3})$/;

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function readTimeout(env: EnvLike, fallback: number): Result<number, string> {
  const raw = env["STT_TIMEOUT_MS"];
  if (!raw) return ok(fallback);
  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    return err(
      `STT_TIMEOUT_MS must be an integer between ${String(MIN_TIMEOUT_MS)} and ${String(MAX_TIMEOUT_MS)}`,
    );
  }
  return ok(timeoutMs);
}

/** Executables never go through a shell, but a value that looks like a flag is refused anyway. */
function readCommand(env: EnvLike, name: string, fallback: string): Result<string, string> {
  const raw = env[name];
  if (raw === undefined || raw === "") return ok(fallback);
  const valid = isAbsolute(raw) ? !hasControlCharacters(raw) : BARE_COMMAND.test(raw);
  return valid ? ok(raw) : err(`${name} must be a command name or an absolute path`);
}

function readWhisperConfig(env: EnvLike): Result<WhisperSttConfig, string> {
  const modelPath = env["STT_WHISPER_MODEL"];
  if (!modelPath) return err("missing environment variable: STT_WHISPER_MODEL");
  if (!isAbsolute(modelPath) || hasControlCharacters(modelPath)) {
    return err("STT_WHISPER_MODEL must be an absolute path to a ggml model file");
  }

  const whisperBin = readCommand(env, "STT_WHISPER_BIN", "whisper-cli");
  if (!whisperBin.ok) return whisperBin;
  const ffmpegBin = readCommand(env, "STT_FFMPEG_BIN", "ffmpeg");
  if (!ffmpegBin.ok) return ffmpegBin;

  const language = env["STT_WHISPER_LANGUAGE"] || "auto";
  if (!LANGUAGE.test(language)) {
    return err("STT_WHISPER_LANGUAGE must be 'auto' or a language code such as 'en' or 'fr'");
  }

  const timeout = readTimeout(env, DEFAULT_WHISPER_TIMEOUT_MS);
  if (!timeout.ok) return timeout;

  let maxConcurrency = 1;
  const rawConcurrency = env["STT_WHISPER_MAX_CONCURRENCY"];
  if (rawConcurrency) {
    maxConcurrency = Number(rawConcurrency);
    if (
      !Number.isInteger(maxConcurrency) ||
      maxConcurrency < 1 ||
      maxConcurrency > MAX_WHISPER_CONCURRENCY
    ) {
      return err(
        `STT_WHISPER_MAX_CONCURRENCY must be an integer between 1 and ${String(MAX_WHISPER_CONCURRENCY)}`,
      );
    }
  }

  return ok({
    mode: "whisper",
    whisperBin: whisperBin.value,
    ffmpegBin: ffmpegBin.value,
    modelPath,
    language,
    timeoutMs: timeout.value,
    maxConcurrency,
  });
}

/**
 * Reads speech-to-text settings. Defaults to the fake so a fresh checkout needs no secrets.
 * Errors name variables only, never their values (they may be secrets or contain credentials).
 */
export function readSttConfig(env: EnvLike): Result<SttConfig, string> {
  const provider = env["STT_PROVIDER"] ?? "fake";
  if (provider === "fake") return ok({ mode: "fake" });
  if (provider === "whisper") return readWhisperConfig(env);
  if (provider !== "deepgram") return err("STT_PROVIDER must be 'fake', 'deepgram' or 'whisper'");

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

  const timeout = readTimeout(env, DEFAULT_TIMEOUT_MS);
  if (!timeout.ok) return timeout;
  return ok({ mode: "deepgram", apiKey, baseUrl, timeoutMs: timeout.value });
}
