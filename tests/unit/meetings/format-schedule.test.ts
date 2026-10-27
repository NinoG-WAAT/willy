import { describe, expect, it } from "vitest";
import { formatSchedule } from "../../../src/components/format-schedule";

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
