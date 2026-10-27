import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "../../../src/domain/platform/zoned-time";

describe("zonedLocalToUtc", () => {
  it("converts winter and summer wall time using the zone's own offset", () => {
    expect(zonedLocalToUtc("2026-11-03", "09:00", "Europe/Paris")).toEqual({
      ok: true,
      value: "2026-11-03T08:00:00.000Z",
    });
    expect(zonedLocalToUtc("2026-07-03", "09:00", "Europe/Paris")).toEqual({
      ok: true,
      value: "2026-07-03T07:00:00.000Z",
    });
  });

  it("handles zones behind UTC, half-hour zones and UTC itself", () => {
    expect(zonedLocalToUtc("2026-11-03", "09:00", "America/New_York")).toEqual({
      ok: true,
      value: "2026-11-03T14:00:00.000Z",
    });
    expect(zonedLocalToUtc("2026-11-03", "09:00", "Asia/Kolkata")).toEqual({
      ok: true,
      value: "2026-11-03T03:30:00.000Z",
    });
    expect(zonedLocalToUtc("2026-11-03", "09:00", "UTC")).toEqual({
      ok: true,
      value: "2026-11-03T09:00:00.000Z",
    });
  });

  it("rejects a wall time that does not exist because clocks jump forward", () => {
    expect(zonedLocalToUtc("2026-03-08", "02:30", "America/New_York")).toEqual({
      ok: false,
      error: "nonexistent_time",
    });
  });

  it("picks the first occurrence of a wall time that happens twice when clocks go back", () => {
    expect(zonedLocalToUtc("2026-11-01", "01:30", "America/New_York")).toEqual({
      ok: true,
      value: "2026-11-01T05:30:00.000Z",
    });
  });

  it.each([
    ["2026-13-01", "09:00", "UTC", "invalid_date"],
    ["2026-02-30", "09:00", "UTC", "invalid_date"],
    ["tomorrow", "09:00", "UTC", "invalid_date"],
    ["2026-11-03", "25:00", "UTC", "invalid_time"],
    ["2026-11-03", "9am", "UTC", "invalid_time"],
    ["2026-11-03", "09:00", "Mars/Olympus", "invalid_timezone"],
  ])("rejects %s %s %s", (date, time, zone, error) => {
    expect(zonedLocalToUtc(date, time, zone)).toEqual({ ok: false, error });
  });
});
