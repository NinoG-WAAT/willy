import { describe, expect, it } from "vitest";
import { formatDay, formatSchedule } from "../../../src/components/format-schedule";

describe("formatSchedule", () => {
  it("shows the wall time in the meeting's own time zone with its abbreviation", () => {
    const text = formatSchedule("2026-11-03T08:00:00.000Z", "Europe/Paris");
    expect(text).toMatch(/3 Nov/);
    expect(text).toMatch(/09:00/);
    expect(text).toMatch(/CET|GMT\+1/);
  });

  it("uses the zone, not the server's, so a different zone shows a different hour", () => {
    expect(formatSchedule("2026-11-03T08:00:00.000Z", "America/New_York")).toMatch(/03:00/);
  });

  it("falls back to UTC text for an unknown zone instead of throwing", () => {
    expect(formatSchedule("2026-11-03T08:00:00.000Z", "Mars/Olympus")).toMatch(/08:00/);
  });
});

describe("formatDay", () => {
  it("shows the calendar day in the event's zone with no time, for all-day events", () => {
    // Local midnight in Paris is 23:00 UTC the evening before: the day must still read 6 Nov.
    expect(formatDay("2026-11-05T23:00:00.000Z", "Europe/Paris")).toBe("Fri 6 Nov");
  });

  it("falls back to UTC for an unknown zone instead of throwing", () => {
    expect(formatDay("2026-11-05T23:00:00.000Z", "Mars/Olympus")).toBe("Thu 5 Nov");
  });
});
