import { describe, expect, it } from "vitest";
import { formatInstant } from "../../src/components/format-instant";
import { inLocale } from "../support/locale";

describe("formatInstant", () => {
  it("formats in UTC and says so", () => {
    expect(formatInstant("2026-10-27T10:05:00.000Z")).toBe("27 Oct 2026, 10:05 UTC");
  });

  it("does not throw on garbage", () => {
    expect(formatInstant("not a date")).toBe("unknown time");
  });

  it("follows the locale: French day, month and 24-hour time, still labelled UTC", () => {
    const text = inLocale("fr", () => formatInstant("2026-10-27T10:05:00.000Z"));
    expect(text).toMatch(/^27 oct\.? 2026.* 10:05 UTC$/);
  });

  it("says the time is unknown in French too", () => {
    expect(inLocale("fr", () => formatInstant("not a date"))).toBe("heure inconnue");
  });

  it("an explicit locale wins over the request's", () => {
    expect(formatInstant("2026-10-27T10:05:00.000Z", "en")).toBe("27 Oct 2026, 10:05 UTC");
  });
});
