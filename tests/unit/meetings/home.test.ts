import { describe, expect, it } from "vitest";
import {
  consentLabel,
  describeMeeting,
  groupMeetings,
} from "../../../src/domain/meetings/home";
import type { MeetingListItem } from "../../../src/ports/meeting-list";

const NOW = new Date("2026-11-03T10:00:00.000Z");

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

describe("groupMeetings", () => {
  it("puts live captures first, future scheduled meetings soonest-first, and the rest newest-first", () => {
    const groups = groupMeetings(
      [
        item("later", { scheduledStartAt: "2026-11-09T09:00:00.000Z", scheduledEndAt: null }),
        item("soon"),
        item("live", { status: "capturing", scheduledStartAt: "2026-11-03T09:00:00.000Z" }),
        item("paused", { status: "paused", scheduledStartAt: "2026-11-03T08:00:00.000Z" }),
        item("old-pub", { status: "published", scheduledStartAt: "2026-10-01T09:00:00.000Z" }),
        item("newer-review", { status: "review", scheduledStartAt: "2026-11-02T09:00:00.000Z" }),
        item("missed", { scheduledStartAt: "2026-11-01T09:00:00.000Z", scheduledEndAt: "2026-11-01T09:30:00.000Z" }),
      ],
      NOW,
    );
    expect(groups.inProgress.map((m) => m.id)).toEqual(["live", "paused"]);
    expect(groups.upcoming.map((m) => m.id)).toEqual(["soon", "later"]);
    expect(groups.recent.map((m) => m.id)).toEqual(["newer-review", "missed", "old-pub"]);
  });

  it("keeps a meeting that is still running (end in the future) in upcoming", () => {
    const groups = groupMeetings(
      [item("running", { scheduledStartAt: "2026-11-03T09:30:00.000Z", scheduledEndAt: "2026-11-03T10:30:00.000Z" })],
      NOW,
    );
    expect(groups.upcoming).toHaveLength(1);
  });

  it("assumes one hour when a scheduled meeting has no end", () => {
    const justEnded = item("a", { scheduledStartAt: "2026-11-03T08:30:00.000Z", scheduledEndAt: null });
    const stillOn = item("b", { scheduledStartAt: "2026-11-03T09:30:00.000Z", scheduledEndAt: null });
    const groups = groupMeetings([justEnded, stillOn], NOW);
    expect(groups.upcoming.map((m) => m.id)).toEqual(["b"]);
    expect(groups.recent.map((m) => m.id)).toEqual(["a"]);
  });

  it("returns empty groups for no meetings", () => {
    expect(groupMeetings([], NOW)).toEqual({ inProgress: [], upcoming: [], recent: [] });
  });
});

describe("describeMeeting", () => {
  it.each([
    ["scheduled", {}, "Not started", "Start note", "/meetings/m1"],
    ["capturing", {}, "Recording", "Return to recording", "/meetings/m1"],
    ["paused", {}, "Recording paused", "Resume note", "/meetings/m1"],
    ["processing", {}, "Transcribing", "View progress", "/meetings/m1/review"],
    ["review", {}, "Draft ready for review", "Review note", "/meetings/m1/review"],
    ["published", { folderName: "Board updates" }, "Published to Board updates", "Open note", "/meetings/m1/review"],
    ["published", {}, "Published", "Open note", "/meetings/m1/review"],
    ["failed", {}, "Needs attention: processing failed", "Open and retry", "/meetings/m1/review"],
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
    expect(consentLabel(item("a"))).toBe("Your consent confirmation is still needed before capture");
    expect(consentLabel(item("a", { consentConfirmedAt: "2026-11-03T09:00:00.000Z" }))).toBe(
      "You confirmed consent",
    );
  });
});
