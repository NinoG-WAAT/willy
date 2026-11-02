import { describe, expect, it } from "vitest";
import { actionItemChips } from "../../../src/domain/notes/action-chips";

type Item = Parameters<typeof actionItemChips>[0];

const NOW = new Date("2026-11-02T09:00:00.000Z");
const names = new Map([["a1", "Ada Lovelace"]]);
const chips = (over: Partial<Item> = {}) =>
  actionItemChips(
    { status: "open", assigneeId: null, dueAt: null, dueTimezone: null, ...over },
    { now: NOW, meetingTimezone: "Europe/Paris", attendeeNames: names },
  );

describe("actionItemChips: assignee", () => {
  it("names the attendee the item is assigned to", () => {
    expect(chips({ assigneeId: "a1" }).assignee).toBe("Ada Lovelace");
  });

  it("has no assignee chip when nobody owns the item", () => {
    expect(chips().assignee).toBeNull();
  });

  it("says Unknown for an owner that is not on the attendee list, never an id", () => {
    expect(chips({ assigneeId: "gone" }).assignee).toBe("Unknown");
  });
});

describe("actionItemChips: due date", () => {
  it("shows the day in the meeting's zone, with the weekday, without a time", () => {
    // The end of 5 Nov in Paris is 22:59:59 UTC the same day.
    expect(chips({ dueAt: "2026-11-05T22:59:59.000Z" }).due).toBe("Due Thu 5 Nov");
  });

  it("reads the instant in the zone the due date was meant in", () => {
    // 23:59 in Auckland on 5 Nov is 10:59 UTC; 23:30 UTC is already 6 Nov in Auckland.
    expect(chips({ dueAt: "2026-11-05T10:59:59.000Z", dueTimezone: "Pacific/Auckland" }).due).toBe(
      "Due Thu 5 Nov",
    );
    expect(chips({ dueAt: "2026-11-05T23:30:00.000Z", dueTimezone: "Pacific/Auckland" }).due).toBe(
      "Due Fri 6 Nov",
    );
  });

  it("adds the year when the due date is not in the current year", () => {
    expect(chips({ dueAt: "2027-01-08T22:59:59.000Z" }).due).toBe("Due Fri 8 Jan 2027");
  });

  it("falls back to UTC for a zone the runtime does not know", () => {
    expect(chips({ dueAt: "2026-11-05T22:59:59.000Z", dueTimezone: "Mars/Olympus" }).due).toBe(
      "Due Thu 5 Nov",
    );
  });

  it("has no due chip without a due date", () => {
    expect(chips().due).toBeNull();
  });
});

describe("actionItemChips: overdue", () => {
  it("flags an open item due in the past, in words", () => {
    expect(chips({ dueAt: "2026-10-30T22:59:59.000Z" }).overdue).toBe("Overdue");
  });

  it("does not flag a done item, a future item or an item without a due date", () => {
    expect(chips({ dueAt: "2026-10-30T22:59:59.000Z", status: "done" }).overdue).toBeNull();
    expect(chips({ dueAt: "2026-11-05T22:59:59.000Z" }).overdue).toBeNull();
    expect(chips().overdue).toBeNull();
  });
});
