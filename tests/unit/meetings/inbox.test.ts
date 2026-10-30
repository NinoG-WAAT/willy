import { describe, expect, it } from "vitest";
import { INBOX_SECTION_LIMIT, upcomingBounds } from "../../../src/domain/meetings/inbox";

describe("upcomingBounds", () => {
  const NOW = new Date("2026-11-03T10:00:00.000Z");

  it("treats a scheduled meeting as upcoming until its end", () => {
    expect(upcomingBounds(NOW).endsAfter).toBe("2026-11-03T10:00:00.000Z");
  });

  it("assumes one hour for a meeting without an end, like the old home screen did", () => {
    expect(upcomingBounds(NOW).openEndedStartsAfter).toBe("2026-11-03T09:00:00.000Z");
  });

  it("keeps a section small enough to read top to bottom", () => {
    expect(INBOX_SECTION_LIMIT).toBeGreaterThan(0);
    expect(INBOX_SECTION_LIMIT).toBeLessThanOrEqual(100);
  });
});
