import { describe, expect, it } from "vitest";
import { backoffDelayMs, type BackoffPolicy } from "../../../src/domain/platform/backoff";

const policy: BackoffPolicy = { maxAttempts: 5, baseMs: 100, capMs: 1000 };

describe("backoffDelayMs (capped exponential with equal jitter)", () => {
  it("grows exponentially with the retry number", () => {
    expect(backoffDelayMs(1, policy, 0)).toBe(50);
    expect(backoffDelayMs(2, policy, 0)).toBe(100);
    expect(backoffDelayMs(3, policy, 0)).toBe(200);
  });

  it("adds up to the other half as jitter", () => {
    expect(backoffDelayMs(1, policy, 0.999999)).toBeLessThanOrEqual(100);
    expect(backoffDelayMs(1, policy, 0.5)).toBe(75);
  });

  it("never exceeds the cap", () => {
    expect(backoffDelayMs(30, policy, 0.999999)).toBeLessThanOrEqual(1000);
    expect(backoffDelayMs(30, policy, 0)).toBe(500);
  });
});
