import { spawn } from "node:child_process";

export type CaptureOutcome =
  | { kind: "exited"; code: number; stdout: string }
  | { kind: "timeout" }
  /** The executable does not exist or cannot be started. */
  | { kind: "not_found" }
  /** Killed by a signal we did not send, or any other spawn failure. */
  | { kind: "failed" }
  /** Printed more than `maxOutputBytes`: the process was killed and nothing is returned. */
  | { kind: "output_too_large" };

export interface CaptureOptions {
  timeoutMs: number;
  /** Written to the child's stdin, then closed. */
  stdin: string;
  /** The whole environment of the child. Nothing is inherited from the parent. */
  env: Readonly<Record<string, string>>;
  maxOutputBytes: number;
  cwd?: string;
}

export type CaptureRunner = (
  file: string,
  args: readonly string[],
  options: CaptureOptions,
) => Promise<CaptureOutcome>;

/**
 * Runs one local executable and returns its stdout (CLAUDE.md A03/A10 for processes). Same rules
 * as `runCommand`: argv array handed to the OS, no shell, a killed timeout. On top of that the
 * caller feeds stdin and gets stdout back, so output is bounded while it streams and stderr is
 * discarded. Callers must treat stdout as sensitive (it can hold transcript text): never log it.
 */
export const runCapture: CaptureRunner = (file, args, options) =>
  new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let tooLarge = false;
    let size = 0;
    const chunks: Buffer[] = [];
    const settle = (outcome: CaptureOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const child = spawn(file, [...args], {
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...options.env },
      cwd: options.cwd,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxOutputBytes) {
        tooLarge = true;
        chunks.length = 0;
        child.kill("SIGKILL");
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    // A child that exits before reading all of stdin makes the write fail with EPIPE; the exit
    // code and stdout still tell the story, so that error is not a failure of its own.
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.stdin);

    child.once("error", (error: NodeJS.ErrnoException) => {
      settle(
        error.code === "ENOENT" || error.code === "EACCES" || error.code === "ENOEXEC"
          ? { kind: "not_found" }
          : { kind: "failed" },
      );
    });
    child.once("close", (code) => {
      if (timedOut) settle({ kind: "timeout" });
      else if (tooLarge) settle({ kind: "output_too_large" });
      else if (code === null) settle({ kind: "failed" });
      else settle({ kind: "exited", code, stdout: Buffer.concat(chunks).toString("utf8") });
    });
  });
