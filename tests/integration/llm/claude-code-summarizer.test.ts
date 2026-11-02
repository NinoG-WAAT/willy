import { describe, expect, it } from "vitest";
import { createClaudeCodeSummarizer } from "../../../src/adapters/llm/claude-code-summarizer";
import { MODEL_OUTPUT_JSON_SCHEMA } from "../../../src/adapters/llm/summary-schema";
import type {
  CaptureOptions,
  CaptureOutcome,
  CaptureRunner,
} from "../../../src/adapters/process/run-capture";
import { defined } from "../../support/assert";
import { goodOutput, sampleInput, summarizerContract } from "./summarizer.contract";

interface Call {
  file: string;
  args: readonly string[];
  options: CaptureOptions;
}

type Failure = "timeout" | "rate_limited" | "unavailable" | "rejected";

const result = (over: Record<string, unknown>): CaptureOutcome => ({
  kind: "exited",
  code: 0,
  stdout: JSON.stringify({ type: "result", is_error: false, ...over }),
});

/** Stand-in for the CLI: answers like `claude -p --output-format json` does. Never spawns anything. */
function createStubClaude() {
  const calls: Call[] = [];
  let output: unknown = goodOutput;
  let failure: Failure | null = null;
  let override: ((call: Call) => CaptureOutcome) | null = null;

  const run: CaptureRunner = (file, args, options) => {
    const call = { file, args, options };
    calls.push(call);
    if (failure) {
      const kind = failure;
      failure = null;
      if (kind === "timeout") return Promise.resolve({ kind: "timeout" });
      const status = { rate_limited: 429, unavailable: 529, rejected: 401 }[kind];
      return Promise.resolve(
        result({ is_error: true, api_error_status: status, result: "secret-detail" }),
      );
    }
    if (override) return Promise.resolve(override(call));
    return Promise.resolve(result({ structured_output: output }));
  };

  return {
    run,
    calls,
    modelReturns: (o: unknown) => {
      output = o;
    },
    failNext: (kind: Failure) => {
      failure = kind;
    },
    respond: (fn: (call: Call) => CaptureOutcome) => {
      override = fn;
    },
  };
}

function build(options: { model?: string | null; claudeBin?: string } = {}) {
  const stub = createStubClaude();
  const summarizer = createClaudeCodeSummarizer(
    {
      claudeBin: options.claudeBin ?? "claude",
      model: options.model === undefined ? null : options.model,
      timeoutMs: 5000,
    },
    { run: stub.run, env: { PATH: "/usr/bin", HOME: "/home/owner" } },
  );
  return { stub, summarizer };
}

summarizerContract("claude-code adapter against a stubbed CLI", () => {
  const { stub, summarizer } = build();
  return { summarizer, modelReturns: stub.modelReturns, failNext: stub.failNext };
});

describe("claude-code adapter specifics", () => {
  it("runs the CLI headless with a fixed argv: no tools, no saved session, no user settings or MCP", async () => {
    const { stub, summarizer } = build();
    await summarizer.summarize(sampleInput());
    const call = defined(stub.calls[0]);
    expect(call.file).toBe("claude");
    const args = [...call.args];
    expect(args).toContain("-p");
    const flag = (name: string): string | undefined => args[args.indexOf(name) + 1];
    expect(flag("--output-format")).toBe("json");
    expect(flag("--tools")).toBe("");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--strict-mcp-config");
    expect(flag("--setting-sources")).toBe("");
    expect(args).toContain("--disable-slash-commands");
    expect(JSON.parse(defined(flag("--json-schema")))).toEqual(MODEL_OUTPUT_JSON_SCHEMA);
    expect(args).not.toContain("--bare"); // --bare skips the keychain, where the login lives
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("puts the instructions in --system-prompt and the meeting only in stdin, as one JSON document", async () => {
    const { stub, summarizer } = build();
    await summarizer.summarize(sampleInput());
    const call = defined(stub.calls[0]);
    const args = [...call.args];
    const system = defined(args[args.indexOf("--system-prompt") + 1]);
    expect(system).toMatch(/untrusted/i);
    expect(system).toMatch(/structured output/i);
    expect(system).not.toMatch(/submit_summary/);
    expect(system).not.toContain("Ada Lovelace");
    expect(args.join(" ")).not.toContain("Ada Lovelace");
    expect(args.join(" ")).not.toContain("pricing deck");
    expect(JSON.parse(call.options.stdin)).toMatchObject({
      attendees: [
        { id: "a1", name: "Ada Lovelace" },
        { id: "a2", name: "Grace Hopper" },
      ],
    });
  });

  it("sends only attendee ids and names, never emails", async () => {
    const { stub, summarizer } = build();
    await summarizer.summarize(sampleInput());
    expect(defined(stub.calls[0]).options.stdin).not.toContain("@");
  });

  it("passes --model only when one is configured", async () => {
    const without = build();
    await without.summarizer.summarize(sampleInput());
    expect(defined(without.stub.calls[0]).args).not.toContain("--model");

    const withModel = build({ model: "sonnet" });
    await withModel.summarizer.summarize(sampleInput());
    const args = [...defined(withModel.stub.calls[0]).args];
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  });

  it("uses the configured executable", async () => {
    const { stub, summarizer } = build({ claudeBin: "/opt/claude/bin/claude" });
    await summarizer.summarize(sampleInput());
    expect(defined(stub.calls[0]).file).toBe("/opt/claude/bin/claude");
  });

  it("hands the child a small allowlisted environment and a private empty working directory", async () => {
    process.env["ENCRYPTION_KEYS"] = "key1:supersecret";
    process.env["ANTHROPIC_API_KEY"] = "sk-should-not-travel";
    try {
      const stub = createStubClaude();
      // No `env` dependency: the adapter builds its own from the real process environment.
      const summarizer = createClaudeCodeSummarizer(
        { claudeBin: "claude", model: null, timeoutMs: 5000 },
        { run: stub.run },
      );
      await summarizer.summarize(sampleInput());
      const { env, cwd } = defined(stub.calls[0]).options;
      expect(
        Object.keys(env).every((k) =>
          /^(PATH|HOME|USER|LOGNAME|TMPDIR|LANG|CLAUDE_CONFIG_DIR)$/.test(k),
        ),
      ).toBe(true);
      expect(JSON.stringify(env)).not.toMatch(/supersecret|sk-should-not-travel/);
      expect(env["HOME"]).toBe(process.env["HOME"]);
      expect(cwd).toBeTypeOf("string");
      expect(cwd).not.toBe(process.cwd());
    } finally {
      delete process.env["ENCRYPTION_KEYS"];
      delete process.env["ANTHROPIC_API_KEY"];
    }
  });

  it("removes the working directory after the call", async () => {
    const { stub, summarizer } = build();
    const { existsSync } = await import("node:fs");
    let seen: string | undefined;
    stub.respond((call) => {
      seen = call.options.cwd;
      expect(seen !== undefined && existsSync(seen)).toBe(true);
      return result({ structured_output: goodOutput });
    });
    await summarizer.summarize(sampleInput());
    expect(seen).toBeTypeOf("string");
    expect(existsSync(defined(seen))).toBe(false);
  });

  it("maps a missing CLI to a clear non-retryable error", async () => {
    const { stub, summarizer } = build();
    stub.respond(() => ({ kind: "not_found" }));
    const out = await summarizer.summarize(sampleInput());
    expect(out).toMatchObject({ ok: false, error: { kind: "rejected", retryable: false } });
    expect(JSON.stringify(out)).toMatch(/claude/i);
  });

  it("maps a CLI that was killed or printed too much to a retryable error", async () => {
    for (const outcome of [{ kind: "failed" }, { kind: "output_too_large" }] as const) {
      const { stub, summarizer } = build();
      stub.respond(() => outcome);
      expect(await summarizer.summarize(sampleInput())).toMatchObject({
        ok: false,
        error: { kind: "unavailable", retryable: true },
      });
    }
  });

  it.each([
    ["a non-zero exit", { kind: "exited", code: 1, stdout: "" }],
    ["output that is not JSON", { kind: "exited", code: 0, stdout: "Sure! Here you go" }],
    ["a JSON array", { kind: "exited", code: 0, stdout: "[]" }],
    ["an answer without structured output", result({ result: "plain text answer" })],
    ["structured output that is a string", result({ structured_output: "nope" })],
  ] as const)("fails retryably on %s", async (_name, outcome) => {
    const { stub, summarizer } = build();
    stub.respond(() => outcome);
    expect(await summarizer.summarize(sampleInput())).toMatchObject({
      ok: false,
      error: { kind: "unavailable", retryable: true },
    });
  });

  it("tells the owner to log in when the CLI says it is not authenticated, without echoing its text", async () => {
    const { stub, summarizer } = build();
    stub.respond(() =>
      result({
        is_error: true,
        api_error_status: 401,
        result: "Invalid API key · Please run /login",
      }),
    );
    const out = await summarizer.summarize(sampleInput());
    expect(out).toMatchObject({ ok: false, error: { kind: "rejected", retryable: false } });
    expect(JSON.stringify(out)).not.toContain("Invalid API key");
    expect(JSON.stringify(out)).toMatch(/log in|login/i);
  });

  it("refuses a transcript too long for one summary without starting the CLI", async () => {
    const { stub, summarizer } = build();
    const long = Array.from({ length: 200 }, (_v, i) => ({
      position: i,
      speaker: "S",
      text: "x".repeat(5000),
    }));
    expect(await summarizer.summarize(sampleInput({ segments: long }))).toMatchObject({
      ok: false,
      error: { kind: "rejected", retryable: false },
    });
    expect(stub.calls).toHaveLength(0);
  });

  it("never puts the CLI's own output in an error message", async () => {
    const { stub, summarizer } = build();
    stub.failNext("unavailable");
    expect(JSON.stringify(await summarizer.summarize(sampleInput()))).not.toContain(
      "secret-detail",
    );
  });
});
