import { describe, expect, it } from "vitest";
import { runCommand } from "../../../src/adapters/process/run-command";

const node = process.execPath;

describe("runCommand (real child processes, no shell)", () => {
  it("reports a clean exit and the exit code", async () => {
    expect(await runCommand(node, ["-e", "process.exit(0)"], { timeoutMs: 10_000 })).toEqual({
      kind: "exited",
      code: 0,
    });
    expect(await runCommand(node, ["-e", "process.exit(3)"], { timeoutMs: 10_000 })).toEqual({
      kind: "exited",
      code: 3,
    });
  });

  it("reports a missing binary as not_found", async () => {
    const outcome = await runCommand("/nonexistent/willy-no-such-binary", [], {
      timeoutMs: 10_000,
    });
    expect(outcome).toEqual({ kind: "not_found" });
  });

  it("kills a process that outlives the timeout", async () => {
    const started = Date.now();
    const outcome = await runCommand(node, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMs: 300,
    });
    expect(outcome).toEqual({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("reports death by an outside signal as failed, not as a timeout", async () => {
    const outcome = await runCommand(node, ["-e", "process.kill(process.pid, 'SIGKILL')"], {
      timeoutMs: 10_000,
    });
    expect(outcome).toEqual({ kind: "failed" });
  });

  it("passes arguments verbatim: nothing is interpreted by a shell", async () => {
    const hostile = "$(touch /tmp/willy-pwned-56); `id` | cat";
    const outcome = await runCommand(
      node,
      ["-e", "process.exit(process.argv[1] === process.env.EXPECT ? 0 : 9)", hostile],
      { timeoutMs: 10_000, env: { EXPECT: hostile } },
    );
    expect(outcome).toEqual({ kind: "exited", code: 0 });
  });

  it("does not leak the parent's environment (secrets) to the child", async () => {
    process.env["WILLY_TEST_SECRET_56"] = "s3cret";
    try {
      const outcome = await runCommand(
        node,
        ["-e", "process.exit(process.env.WILLY_TEST_SECRET_56 === undefined ? 0 : 9)"],
        { timeoutMs: 10_000 },
      );
      expect(outcome).toEqual({ kind: "exited", code: 0 });
    } finally {
      delete process.env["WILLY_TEST_SECRET_56"];
    }
  });

  it("does not hang on a child that fills stdout and stderr (output is discarded)", async () => {
    const outcome = await runCommand(
      node,
      ["-e", "process.stdout.write('x'.repeat(5e6)); process.stderr.write('y'.repeat(5e6));"],
      { timeoutMs: 10_000 },
    );
    expect(outcome).toEqual({ kind: "exited", code: 0 });
  });
});
