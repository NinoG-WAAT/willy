import { spawn } from "node:child_process";

export type CommandOutcome =
  | { kind: "exited"; code: number }
  | { kind: "timeout" }
  /** The executable does not exist or cannot be started. */
  | { kind: "not_found" }
  /** Killed by a signal we did not send, or any other spawn failure. */
  | { kind: "failed" };

export interface CommandOptions {
  timeoutMs: number;
  /** Replaces the default minimal environment. Never inherits the parent's secrets. */
  env?: Readonly<Record<string, string>>;
}

export type CommandRunner = (
  file: string,
  args: readonly string[],
  options: CommandOptions,
) => Promise<CommandOutcome>;

/** Only what a media tool needs to find its libraries and temp space; no tokens or API keys. */
function minimalEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ["PATH", "TMPDIR", "LANG"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/**
 * Runs one local executable (CLAUDE.md A03/A10 for processes): the argv is an array handed to the
 * OS directly, never a shell string, so no argument is ever interpreted. Output is discarded
 * (never buffered, never logged: it can contain transcript text), the environment is minimal, and
 * a process that outlives `timeoutMs` is killed. Callers pass only fixed flags and paths they made.
 */
export const runCommand: CommandRunner = (file, args, options) =>
  new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const settle = (outcome: CommandOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const child = spawn(file, [...args], {
      shell: false,
      stdio: "ignore",
      env: options.env ?? minimalEnv(),
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.once("error", (error: NodeJS.ErrnoException) => {
      settle(
        error.code === "ENOENT" || error.code === "EACCES" || error.code === "ENOEXEC"
          ? { kind: "not_found" }
          : { kind: "failed" },
      );
    });
    child.once("close", (code) => {
      if (timedOut) settle({ kind: "timeout" });
      else if (code === null) settle({ kind: "failed" });
      else settle({ kind: "exited", code });
    });
  });
