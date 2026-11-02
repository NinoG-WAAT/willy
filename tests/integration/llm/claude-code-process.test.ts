import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSummarizer } from "../../../src/adapters/llm";
import { readLlmConfig } from "../../../src/adapters/llm/config";
import { goodOutput, sampleInput } from "./summarizer.contract";

/**
 * The same adapter through the real process runner and a tiny script that imitates the CLI's
 * command line and JSON answer. It proves the wiring (argv, stdin, stdout, exit codes, timeout,
 * cleanup) without needing Claude Code installed or logged in. It does NOT prove that the real
 * CLI accepts these flags: that is the manual smoke test in the README.
 */
describe.skipIf(process.platform === "win32")("claude-code summarizer via a real process", () => {
  let root: string;
  let record: string;

  async function fakeClaude(body: string): Promise<string> {
    const path = join(root, "claude");
    await writeFile(path, `#!${process.execPath}\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  }

  function summarizerFor(bin: string, timeout = "10000") {
    const config = readLlmConfig({
      LLM_PROVIDER: "claude-code",
      LLM_CLAUDE_BIN: bin,
      LLM_TIMEOUT_MS: timeout,
    });
    if (!config.ok) throw new Error(config.error);
    return createSummarizer(config.value, () => {
      throw new Error("claude-code must not use fetch");
    });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "willy-claude-proc-"));
    record = join(root, "record.json");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("sends the meeting on stdin and turns the CLI's JSON into a grounded draft", async () => {
    const bin = await fakeClaude(`
      const fs = require("node:fs");
      const stdin = fs.readFileSync(0, "utf8");
      fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd() }));
      process.stdout.write(JSON.stringify({ type: "result", is_error: false, structured_output: ${JSON.stringify(goodOutput)} }));
    `);
    const result = await summarizerFor(bin).summarize(sampleInput());
    expect(result.ok && result.value.decisions.map((d) => d.text)).toEqual([
      "Ship the beta in November",
    ]);

    const seen = JSON.parse(await readFile(record, "utf8")) as {
      argv: string[];
      stdin: string;
      cwd: string;
    };
    expect(seen.argv).toContain("-p");
    expect(seen.argv).toContain("--no-session-persistence");
    expect(JSON.parse(seen.stdin)).toMatchObject({ agenda: "Roadmap" });
    expect(seen.argv.join(" ")).not.toContain("Roadmap");
  });

  it("reports a CLI that never answers as a timeout", async () => {
    const bin = await fakeClaude("setInterval(() => {}, 1000);");
    const started = Date.now();
    const result = await summarizerFor(bin, "1000").summarize(sampleInput());
    expect(result).toMatchObject({ ok: false, error: { kind: "timeout", retryable: true } });
    expect(Date.now() - started).toBeLessThan(8000);
  });

  it("reports a CLI that is not installed as a clear, non-retryable error", async () => {
    const result = await summarizerFor(join(root, "no-such-claude")).summarize(sampleInput());
    expect(result).toMatchObject({ ok: false, error: { kind: "rejected", retryable: false } });
  });

  it("copes with a CLI that exits without reading the transcript", async () => {
    const bin = await fakeClaude("process.exit(1);");
    const result = await summarizerFor(bin).summarize(
      sampleInput({
        segments: Array.from({ length: 50 }, (_v, i) => ({
          position: i,
          speaker: "S",
          text: "x".repeat(5000),
        })),
      }),
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "unavailable", retryable: true } });
  });
});
