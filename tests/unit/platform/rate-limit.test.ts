import { describe, expect, it } from "vitest";
import { decide, type RateLimitState } from "../../../src/domain/platform/rate-limit";

const policy = { limit: 3, windowMs: 60_000 };

function run(times: number[]): { allowed: boolean; retryAfterSeconds: number }[] {
  let state: RateLimitState | undefined;
  return times.map((t) => {
    const d = decide(state, t, policy);
    state = d.state;
    return { allowed: d.allowed, retryAfterSeconds: d.retryAfterSeconds };
  });
}

describe("decide (fixed window)", () => {
  it("allows up to the limit inside a window, then denies with a retry hint", () => {
    const r = run([0, 1000, 2000, 3000, 59_000]);
    expect(r.map((x) => x.allowed)).toEqual([true, true, true, false, false]);
    expect(r[3]?.retryAfterSeconds).toBe(57);
    expect(r[4]?.retryAfterSeconds).toBe(1);
  });

  it("starts a fresh window once the old one has elapsed", () => {
    const r = run([0, 1000, 2000, 3000, 60_000, 60_500]);
    expect(r.map((x) => x.allowed)).toEqual([true, true, true, false, true, true]);
  });

  it("does not count denied attempts toward a longer lockout", () => {
    const r = run([0, 0, 0, 10, 20, 30, 60_000]);
    expect(r[6]?.allowed).toBe(true);
  });

  it("reports zero retry delay when allowed", () => {
    expect(run([0])[0]?.retryAfterSeconds).toBe(0);
  });

  it("rejects nonsensical policies", () => {
    expect(() => decide(undefined, 0, { limit: 0, windowMs: 1000 })).toThrow();
    expect(() => decide(undefined, 0, { limit: 1, windowMs: 0 })).toThrow();
  });
});
