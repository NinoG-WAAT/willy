import { describe, expect, it } from "vitest";
import { POLL, nextPollDelayMs } from "../../../src/domain/progress/poll-schedule";

describe("nextPollDelayMs", () => {
  it("starts at a few seconds and never collapses to zero", () => {
    expect(nextPollDelayMs(0, null, 0)).toBe(POLL.baseMs / 2);
    expect(nextPollDelayMs(0, null, 0.999)).toBeLessThan(POLL.baseMs);
  });

  it("backs off while nothing changes, up to the cap", () => {
    const delays = [0, 1, 2, 3, 4, 5, 10, 50].map((n) => nextPollDelayMs(n, null, 0.5));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1] ?? 0);
    }
    expect(delays.at(-1)).toBeLessThanOrEqual(POLL.capMs);
    expect(delays.at(-1)).toBeGreaterThan(POLL.capMs / 2);
  });

  it("spreads concurrent pollers with jitter", () => {
    expect(nextPollDelayMs(3, null, 0)).toBeLessThan(nextPollDelayMs(3, null, 0.99));
  });

  it("honours Retry-After when it is longer than the backoff, within a ceiling", () => {
    expect(nextPollDelayMs(0, 45, 0)).toBe(45_000);
    expect(nextPollDelayMs(5, 1, 0)).toBe(nextPollDelayMs(5, null, 0));
    expect(nextPollDelayMs(0, 100_000, 0)).toBe(POLL.maxRetryAfterMs);
  });

  it("ignores a Retry-After that is not a positive number", () => {
    expect(nextPollDelayMs(0, Number.NaN, 0)).toBe(nextPollDelayMs(0, null, 0));
    expect(nextPollDelayMs(0, -3, 0)).toBe(nextPollDelayMs(0, null, 0));
  });
});
