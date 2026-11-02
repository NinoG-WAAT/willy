import { describe, expect, it } from "vitest";
import { runCapture } from "../../../src/adapters/process/run-capture";

const node = process.execPath;
const base = { timeoutMs: 10_000, stdin: "", env: {}, maxOutputBytes: 1_000_000 };

describe("runCapture (real child processes, no shell)", () => {
  it("feeds stdin and returns stdout with the exit code", async () => {
    const outcome = await runCapture(node, ["-e", "process.stdin.pipe(process.stdout)"], {
      ...base,
      stdin: "héllo wörld",
    });
    expect(outcome).toEqual({ kind: "exited", code: 0, stdout: "héllo wörld" });
  });

  it("returns a non-zero exit code with whatever was printed", async () => {
    const outcome = await runCapture(
      node,
      ["-e", "process.stdout.write('x'); process.exit(3)"],
      base,
    );
    expect(outcome).toEqual({ kind: "exited", code: 3, stdout: "x" });
  });

  it("reports a missing binary as not_found", async () => {
    expect(await runCapture("/nonexistent/willy-no-such-binary", [], base)).toEqual({
      kind: "not_found",
    });
  });

  it("kills a process that outlives the timeout", async () => {
    const started = Date.now();
    const outcome = await runCapture(node, ["-e", "setInterval(() => {}, 1000)"], {
      ...base,
      timeoutMs: 300,
    });
    expect(outcome).toEqual({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("stops and kills a process whose output exceeds the limit, without buffering it all", async () => {
    const outcome = await runCapture(
      node,
      ["-e", "setInterval(() => process.stdout.write('x'.repeat(65536)), 1)"],
      { ...base, maxOutputBytes: 100_000 },
    );
    expect(outcome).toEqual({ kind: "output_too_large" });
  });

  it("survives a child that exits without reading its stdin", async () => {
    const outcome = await runCapture(node, ["-e", "process.exit(0)"], {
      ...base,
      stdin: "y".repeat(5_000_000),
    });
    expect(outcome.kind).toBe("exited");
  });

  it("reports death by an outside signal as failed, not as a timeout", async () => {
    expect(await runCapture(node, ["-e", "process.kill(process.pid, 'SIGKILL')"], base)).toEqual({
      kind: "failed",
    });
  });

  it("passes arguments verbatim: nothing is interpreted by a shell", async () => {
    const hostile = "$(touch /tmp/willy-pwned-81); `id` | cat";
    const outcome = await runCapture(
      node,
      ["-e", "process.stdout.write(process.argv[1])", hostile],
      base,
    );
    expect(outcome).toEqual({ kind: "exited", code: 0, stdout: hostile });
  });

  it("gives the child only the environment it is handed, never the parent's secrets", async () => {
    process.env["WILLY_TEST_SECRET_81"] = "s3cret";
    try {
      const outcome = await runCapture(
        node,
        ["-e", "process.stdout.write(JSON.stringify(process.env))"],
        { ...base, env: { ONLY_THIS: "1" } },
      );
      expect(outcome.kind).toBe("exited");
      const seen = JSON.parse(outcome.kind === "exited" ? outcome.stdout : "{}") as Record<
        string,
        string
      >;
      expect(seen["ONLY_THIS"]).toBe("1");
      // macOS adds __CF_USER_TEXT_ENCODING itself; what matters is that nothing was inherited.
      expect(Object.keys(seen).filter((k) => k !== "__CF_USER_TEXT_ENCODING")).toEqual([
        "ONLY_THIS",
      ]);
    } finally {
      delete process.env["WILLY_TEST_SECRET_81"];
    }
  });

  it("runs in the requested working directory", async () => {
    const outcome = await runCapture(node, ["-e", "process.stdout.write(process.cwd())"], {
      ...base,
      cwd: "/",
    });
    expect(outcome).toEqual({ kind: "exited", code: 0, stdout: "/" });
  });
});
