import { describe, expect, it } from "vitest";
import { formatElapsed } from "../../../src/scripts/capture/elapsed";
import { inputLevel } from "../../../src/scripts/capture/level";
import { clockTime } from "../../../src/scripts/capture/notes-autosave";

describe("clockTime (the 'Saved at' time)", () => {
  // Built from local fields, so the expectation does not depend on the machine's time zone.
  const afternoon = new Date(2026, 10, 4, 14, 5);

  it("uses the page locale, not the browser's: 24-hour time in English and in French", () => {
    expect(clockTime(afternoon, "en")).toBe("14:05");
    expect(clockTime(afternoon, "fr")).toBe("14:05");
  });
});

describe("formatElapsed", () => {
  it.each([
    [0, "00:00:00"],
    [999, "00:00:00"],
    [1_000, "00:00:01"],
    [61_000, "00:01:01"],
    [3_723_000, "01:02:03"],
    [100 * 3_600_000, "100:00:00"],
  ])("formats %i ms as %s", (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });

  it("never goes negative", () => {
    expect(formatElapsed(-5_000)).toBe("00:00:00");
  });
});

describe("inputLevel", () => {
  it("reads silence (all samples at the 128 midpoint) as 0", () => {
    expect(inputLevel(new Uint8Array(256).fill(128))).toBe(0);
  });

  it("reads a full-scale signal as 1", () => {
    const samples = new Uint8Array(256);
    samples.forEach((_, i) => {
      samples[i] = i % 2 === 0 ? 0 : 255;
    });
    expect(inputLevel(samples)).toBeCloseTo(1, 1);
  });

  it("is monotonic and bounded in [0, 1]", () => {
    const quiet = new Uint8Array(256).map((_, i) => (i % 2 === 0 ? 120 : 136));
    const loud = new Uint8Array(256).map((_, i) => (i % 2 === 0 ? 40 : 216));
    expect(inputLevel(quiet)).toBeGreaterThan(0);
    expect(inputLevel(loud)).toBeGreaterThan(inputLevel(quiet));
    expect(inputLevel(loud)).toBeLessThanOrEqual(1);
  });

  it("treats an empty buffer as silence", () => {
    expect(inputLevel(new Uint8Array(0))).toBe(0);
  });
});
