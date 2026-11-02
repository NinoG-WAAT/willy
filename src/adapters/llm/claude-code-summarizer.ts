import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerError, type ProviderError } from "../../domain/platform/provider-error";
import { err } from "../../domain/platform/result";
import type { Summarizer } from "../../ports/summarizer";
import { runCapture, type CaptureOutcome, type CaptureRunner } from "../process/run-capture";
import { checkInput, finalizeModelOutput } from "./finalize";
import { buildSummaryPrompt, REPLY_BY_STRUCTURED_OUTPUT } from "./prompt";
import { MODEL_OUTPUT_JSON_SCHEMA } from "./summary-schema";

export interface ClaudeCodeConfig {
  /** Executable name (looked up on PATH) or absolute path of the Claude Code CLI. */
  claudeBin: string;
  /** Passed to `--model` when set; null keeps the CLI's own default. */
  model: string | null;
  timeoutMs: number;
}

export interface ClaudeCodeDeps {
  /** Injected so tests never start a real CLI. */
  run?: CaptureRunner;
  /** The environment handed to the CLI. Defaults to an allowlist taken from this process. */
  env?: Readonly<Record<string, string>>;
}

/** A summary is a few KB; anything near this is not one. */
const MAX_OUTPUT_BYTES = 4_194_304;

/**
 * Only what the CLI needs to find its login (HOME holds ~/.claude, the keychain lookup needs the
 * user name) and a temp dir. The app's own secrets (ENCRYPTION_KEYS, provider keys) and any
 * ANTHROPIC_* variable stay behind: the owner's login is the only credential this adapter uses.
 */
const FORWARDED_ENV = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "CLAUDE_CONFIG_DIR"];

function allowlistedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of FORWARDED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const unusable = (): ProviderError =>
  providerError("unavailable", "claude returned no usable summary");

/** Fixed texts only: the CLI's own message can echo prompt content, so it is never copied. */
function failureOf(outcome: Exclude<CaptureOutcome, { kind: "exited" }>): ProviderError {
  switch (outcome.kind) {
    case "timeout":
      return providerError("timeout", "claude exceeded the time limit");
    case "not_found":
      return providerError(
        "rejected",
        "the claude command is not installed or not executable (see LLM_CLAUDE_BIN)",
      );
    case "output_too_large":
      return providerError("unavailable", "claude returned unexpectedly large output");
    case "failed":
      return providerError("unavailable", "claude was interrupted");
  }
}

/** The CLI reports API failures inside its JSON result, with the HTTP status when it has one. */
function errorFromReport(report: Json): ProviderError {
  const status = report["api_error_status"];
  if (status === 401 || status === 403) {
    return providerError("rejected", "claude is not logged in: run `claude` once and log in");
  }
  if (status === 429) return providerError("rate_limited", "claude usage limit reached");
  if (status === 408) return providerError("timeout", "claude request timed out");
  return providerError("unavailable", "claude reported an error");
}

/**
 * Summaries through the owner's own Claude Code CLI, so a work licence works without an API key.
 * The CLI runs headless with no tools (the transcript can never run or read anything), no saved
 * session, and none of the owner's settings, hooks or MCP servers; it starts in a private empty
 * directory so no project files are picked up. The instructions go in `--system-prompt`, the
 * meeting only in stdin as one JSON document. The answer is untrusted and passes through the same
 * schema and grounding checks as every provider. Local Node only, and one person's login: do not
 * point a shared server at it.
 */
export function createClaudeCodeSummarizer(
  config: ClaudeCodeConfig,
  deps: ClaudeCodeDeps = {},
): Summarizer {
  const run = deps.run ?? runCapture;

  return {
    async summarize(input) {
      const rejected = checkInput(input);
      if (rejected) return err(rejected);

      const { system, user } = buildSummaryPrompt(input, REPLY_BY_STRUCTURED_OUTPUT);
      const args = [
        "-p",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(MODEL_OUTPUT_JSON_SCHEMA),
        "--tools",
        "",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--disable-slash-commands",
        "--system-prompt",
        system,
        ...(config.model === null ? [] : ["--model", config.model]),
      ];

      let outcome: CaptureOutcome;
      let cwd: string;
      try {
        cwd = await mkdtemp(join(tmpdir(), "willy-claude-"));
      } catch {
        return err(providerError("unavailable", "could not prepare a working directory"));
      }
      try {
        outcome = await run(config.claudeBin, args, {
          timeoutMs: config.timeoutMs,
          stdin: user,
          env: deps.env ?? allowlistedEnv(),
          maxOutputBytes: MAX_OUTPUT_BYTES,
          cwd,
        });
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
      if (outcome.kind !== "exited") return err(failureOf(outcome));

      let report: unknown;
      try {
        report = JSON.parse(outcome.stdout);
      } catch {
        return err(unusable());
      }
      if (!isObject(report)) return err(unusable());
      if (report["is_error"] === true) return err(errorFromReport(report));
      if (outcome.code !== 0 || !isObject(report["structured_output"])) return err(unusable());

      return finalizeModelOutput(input, report["structured_output"]);
    },
  };
}
