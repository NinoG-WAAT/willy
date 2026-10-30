import { describe, expect, it } from "vitest";
import { consentLabel, describeMeeting } from "../../../src/domain/meetings/home";
import type { MeetingListItem } from "../../../src/ports/meeting-list";

function item(id: string, overrides: Partial<MeetingListItem> = {}): MeetingListItem {
  return {
    id,
    title: `Meeting ${id}`,
    status: "scheduled",
    scheduledStartAt: "2026-11-04T09:00:00.000Z",
    scheduledEndAt: "2026-11-04T09:30:00.000Z",
    timezone: "Europe/Paris",
    calendarProvider: null,
    consentConfirmedAt: null,
    attendeeCount: 0,
    folderName: null,
    noteStatus: null,
    ...overrides,
  };
}

describe("describeMeeting", () => {
  it.each([
    ["scheduled", {}, "Scheduled", "Start note", "/meetings/m1"],
    ["capturing", {}, "Recording", "Return to recording", "/meetings/m1"],
    ["paused", {}, "Recording paused", "Resume note", "/meetings/m1"],
    ["processing", {}, "Processing", "View progress", "/meetings/m1/review"],
    ["review", {}, "Draft", "Review note", "/meetings/m1/review"],
    [
      "published",
      { folderName: "Board updates" },
      "Published to Board updates",
      "Open note",
      "/meetings/m1/review",
    ],
    ["published", {}, "Published", "Open note", "/meetings/m1/review"],
    ["failed", {}, "Needs attention", "Open and retry", "/meetings/m1/review"],
    ["archived", {}, "Archived", "Open note", "/meetings/m1"],
  ] as const)("describes %s %j", (status, extra, label, action, href) => {
    expect(describeMeeting(item("m1", { status, ...extra }))).toMatchObject({
      label,
      actionLabel: action,
      href,
    });
  });

  it("always gives text and a marker, never colour alone", () => {
    const d = describeMeeting(item("m1", { status: "failed" }));
    expect(d.label.length).toBeGreaterThan(0);
    expect(d.marker.length).toBeGreaterThan(0);
  });
});

describe("consentLabel", () => {
  it("states readiness in words and never claims consent from others", () => {
    expect(consentLabel(item("a"))).toBe(
      "Your consent confirmation is still needed before capture",
    );
    expect(consentLabel(item("a", { consentConfirmedAt: "2026-11-03T09:00:00.000Z" }))).toBe(
      "You confirmed consent",
    );
  });
});
