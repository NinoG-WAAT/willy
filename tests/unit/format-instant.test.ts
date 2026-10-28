import { describe, expect, it } from "vitest";
import { formatInstant } from "../../src/components/format-instant";

describe("formatInstant", () => {
  it("formats in UTC and says so", () => {
    expect(formatInstant("2026-10-27T10:05:00.000Z")).toBe("27 Oct 2026, 10:05 UTC");
  });

  it("does not throw on garbage", () => {
    expect(formatInstant("not a date")).toBe("unknown time");
  });
});
