import { describe, expect, it } from "vitest";
import { endOfLocalDayUtc } from "../../../src/domain/platform/time";

describe("endOfLocalDayUtc (a due date means the end of that day where the owner is)", () => {
  it.each([
    ["2026-11-05", "UTC", "2026-11-05T23:59:59.000Z"],
    ["2026-11-05", "Europe/Paris", "2026-11-05T22:59:59.000Z"],
    ["2026-07-10", "Europe/Paris", "2026-07-10T21:59:59.000Z"],
    ["2026-11-05", "America/New_York", "2026-11-06T04:59:59.000Z"],
    ["2026-11-05", "Asia/Kolkata", "2026-11-05T18:29:59.000Z"],
    ["2026-11-05", "Asia/Tokyo", "2026-11-05T14:59:59.000Z"],
  ])("%s in %s ends at %s", (date, zone, expected) => {
    expect(endOfLocalDayUtc(date, zone)).toBe(expected);
  });

  it("uses the offset in force at the end of the day on daylight-saving change days", () => {
    // Paris springs forward on 2026-03-29 (CEST, +2 by the end of the day) and falls back on 2026-10-25 (CET, +1).
    expect(endOfLocalDayUtc("2026-03-29", "Europe/Paris")).toBe("2026-03-29T21:59:59.000Z");
    expect(endOfLocalDayUtc("2026-10-25", "Europe/Paris")).toBe("2026-10-25T22:59:59.000Z");
    // Auckland springs forward on 2026-09-27 (NZDT, +13).
    expect(endOfLocalDayUtc("2026-09-27", "Pacific/Auckland")).toBe("2026-09-27T10:59:59.000Z");
    // New York falls back on 2026-11-01 (EST, -5).
    expect(endOfLocalDayUtc("2026-11-01", "America/New_York")).toBe("2026-11-02T04:59:59.000Z");
  });

  it("handles month, year and leap-day boundaries", () => {
    expect(endOfLocalDayUtc("2026-12-31", "Asia/Tokyo")).toBe("2026-12-31T14:59:59.000Z");
    expect(endOfLocalDayUtc("2028-02-29", "UTC")).toBe("2028-02-29T23:59:59.000Z");
  });

  it.each(["2026-02-30", "2026-13-01", "2026-1-1", "tomorrow", "", "2026-11-05T10:00:00Z"])(
    "returns null for the invalid date %j",
    (date) => {
      expect(endOfLocalDayUtc(date, "UTC")).toBeNull();
    },
  );

  it.each(["Mars/Base", "", "Europe/Atlantis", "not a zone"])(
    "returns null for the invalid time zone %j",
    (zone) => {
      expect(endOfLocalDayUtc("2026-11-05", zone)).toBeNull();
    },
  );
});
