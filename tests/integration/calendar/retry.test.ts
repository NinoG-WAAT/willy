import { describe, expect, it } from "vitest";
import { providerError, type ProviderError } from "../../../src/domain/platform/provider-error";
import { err, ok, type Result } from "../../../src/domain/platform/result";
import { withRetry } from "../../../src/app/platform/retry";

const policy = { maxAttempts: 3, baseMs: 100, capMs: 1000 };

function scripted(results: Result<string, ProviderError>[]) {
  let calls = 0;
  const sleeps: number[] = [];
  return {
    get calls() {
      return calls;
    },
    sleeps,
    run: () =>
      withRetry(() => Promise.resolve(results[calls++] ?? results[results.length - 1]!), {
        policy,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
        random: () => 0,
      }),
  };
}

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const s = scripted([ok("done")]);
    expect(await s.run()).toEqual(ok("done"));
    expect(s.calls).toBe(1);
    expect(s.sleeps).toEqual([]);
  });

  it("retries transient failures with backoff and then succeeds", async () => {
    const s = scripted([err(providerError("unavailable", "x")), err(providerError("timeout", "x")), ok("done")]);
    expect(await s.run()).toEqual(ok("done"));
    expect(s.calls).toBe(3);
    expect(s.sleeps).toEqual([50, 100]);
  });

  it("does not retry a rejection", async () => {
    const rejected = err(providerError("rejected", "no", 403));
    const s = scripted([rejected, ok("never")]);
    expect(await s.run()).toEqual(rejected);
    expect(s.calls).toBe(1);
  });

  it("gives up after maxAttempts and returns the last error", async () => {
    const s = scripted([err(providerError("unavailable", "down"))]);
    const result = await s.run();
    expect(!result.ok && result.error.kind).toBe("unavailable");
    expect(s.calls).toBe(3);
    expect(s.sleeps).toHaveLength(2);
  });
});
