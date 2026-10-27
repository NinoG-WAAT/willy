import { describe, expect, it } from "vitest";
import { toNewDraft } from "../../../src/domain/notes/draft";
import type { SummaryDraft } from "../../../src/domain/notes/summary";

const summary: SummaryDraft = {
  sections: [
    { heading: "Summary", body: "We met.", sourceFrom: 0, sourceTo: 1 },
    { heading: "Risks", body: "Pricing.", sourceFrom: 10000, sourceTo: 10000 },
  ],
  decisions: [{ text: "Ship in November", sourceFrom: 1, sourceTo: 1 }],
  actionItems: [
    { text: "Send the deck", assigneeId: "a1", dueDate: "2026-11-05", sourceFrom: 1, sourceTo: 1 },
    { text: "Think about it", assigneeId: null, dueDate: null, sourceFrom: 0, sourceTo: 0 },
  ],
};

describe("toNewDraft", () => {
  it("numbers sections, decisions and action items in order and keeps their source ranges", () => {
    const draft = toNewDraft(summary, { timezone: "Europe/Paris" });
    expect(draft.sections.map((s) => [s.position, s.heading, s.sourceFrom, s.sourceTo])).toEqual([
      [0, "Summary", 0, 1],
      [1, "Risks", 10000, 10000],
    ]);
    expect(draft.decisions).toEqual([
      { position: 0, text: "Ship in November", sourceFrom: 1, sourceTo: 1 },
    ]);
    expect(draft.actionItems.map((a) => [a.position, a.text, a.assigneeId])).toEqual([
      [0, "Send the deck", "a1"],
      [1, "Think about it", null],
    ]);
  });

  it("turns a due date into the end of that day in the meeting's time zone, stored with the zone", () => {
    const [first, second] = toNewDraft(summary, { timezone: "Europe/Paris" }).actionItems;
    expect(first).toMatchObject({
      dueAt: "2026-11-05T22:59:59.000Z",
      dueTimezone: "Europe/Paris",
    });
    expect(second).toMatchObject({ dueAt: null, dueTimezone: null });
  });

  it("drops a due date it cannot place in time instead of guessing a zone", () => {
    const [first] = toNewDraft(summary, { timezone: "Mars/Base" }).actionItems;
    expect(first).toMatchObject({ dueAt: null, dueTimezone: null });
  });

  it("produces an empty draft for an empty summary", () => {
    expect(
      toNewDraft({ sections: [], decisions: [], actionItems: [] }, { timezone: "UTC" }),
    ).toEqual({
      sections: [],
      decisions: [],
      actionItems: [],
    });
  });
});
