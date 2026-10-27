import { describe, expect, it } from "vitest";
import {
  MAX_ACTION_ITEMS,
  MAX_DECISIONS,
  MAX_SECTIONS,
  verifySummary,
  type RawSummary,
  type VerificationContext,
} from "../../../src/domain/notes/summary";

const ctx = (over: Partial<VerificationContext> = {}): VerificationContext => ({
  segmentPositions: [0, 1, 2, 10000, 10001],
  attendeeIds: ["a1", "a2"],
  templateHeadings: null,
  only: null,
  ...over,
});

const raw = (over: Partial<RawSummary> = {}): RawSummary => ({
  sections: [{ heading: "Summary", body: "We met.", sourceFrom: 0, sourceTo: 2 }],
  decisions: [{ text: "Ship in November", sourceFrom: 10000, sourceTo: 10001 }],
  actionItems: [
    { text: "Send the deck", assigneeId: "a1", dueDate: "2026-11-05", sourceFrom: 1, sourceTo: 1 },
  ],
  ...over,
});

describe("verifySummary: grounding", () => {
  it("accepts a fully grounded summary unchanged", () => {
    const result = verifySummary(raw(), ctx());
    expect(result).toEqual({
      ok: true,
      value: {
        summary: {
          sections: [{ heading: "Summary", body: "We met.", sourceFrom: 0, sourceTo: 2 }],
          decisions: [{ text: "Ship in November", sourceFrom: 10000, sourceTo: 10001 }],
          actionItems: [
            {
              text: "Send the deck",
              assigneeId: "a1",
              dueDate: "2026-11-05",
              sourceFrom: 1,
              sourceTo: 1,
            },
          ],
        },
        dropped: { sections: 0, decisions: 0, actionItems: 0, assignees: 0, dueDates: 0 },
      },
    });
  });

  it("drops decisions whose source range is missing from the transcript (never invent decisions)", () => {
    const result = verifySummary(
      raw({
        decisions: [
          { text: "Real", sourceFrom: 0, sourceTo: 1 },
          { text: "Ghost", sourceFrom: 5, sourceTo: 6 },
          { text: "Backwards", sourceFrom: 2, sourceTo: 0 },
          { text: "Half", sourceFrom: 0, sourceTo: 99999 },
        ],
      }),
      ctx(),
    );
    expect(result.ok && result.value.summary.decisions.map((d) => d.text)).toEqual(["Real"]);
    expect(result.ok && result.value.dropped.decisions).toBe(3);
  });

  it("drops action items and sections without a valid source range", () => {
    const result = verifySummary(
      raw({
        sections: [
          { heading: "Summary", body: "ok", sourceFrom: 0, sourceTo: 0 },
          { heading: "Invented", body: "made up", sourceFrom: 7, sourceTo: 7 },
        ],
        actionItems: [
          { text: "Real", assigneeId: null, dueDate: null, sourceFrom: 0, sourceTo: 0 },
          { text: "Ghost", assigneeId: null, dueDate: null, sourceFrom: 3, sourceTo: 3 },
        ],
      }),
      ctx(),
    );
    expect(result.ok && result.value.summary.sections.map((s) => s.heading)).toEqual(["Summary"]);
    expect(result.ok && result.value.summary.actionItems.map((a) => a.text)).toEqual(["Real"]);
    expect(result.ok && result.value.dropped).toMatchObject({ sections: 1, actionItems: 1 });
  });

  it("fails when no section survives, instead of returning an empty or invented note", () => {
    const result = verifySummary(
      raw({ sections: [{ heading: "Summary", body: "x", sourceFrom: 7, sourceTo: 7 }] }),
      ctx(),
    );
    expect(result).toEqual({ ok: false, error: { kind: "no_valid_sections" } });
  });
});

describe("verifySummary: attendees and dates", () => {
  it("strips an assignee that is not on the attendee list (never invent attendees)", () => {
    const result = verifySummary(
      raw({
        actionItems: [
          { text: "A", assigneeId: "evil-attendee", dueDate: null, sourceFrom: 0, sourceTo: 0 },
          { text: "B", assigneeId: "a2", dueDate: null, sourceFrom: 0, sourceTo: 0 },
        ],
      }),
      ctx(),
    );
    expect(result.ok && result.value.summary.actionItems.map((a) => a.assigneeId)).toEqual([
      null,
      "a2",
    ]);
    expect(result.ok && result.value.dropped.assignees).toBe(1);
  });

  it("keeps the action item itself when only the assignee was invalid", () => {
    const result = verifySummary(
      raw({
        actionItems: [
          { text: "Do it", assigneeId: "nobody", dueDate: null, sourceFrom: 0, sourceTo: 0 },
        ],
      }),
      ctx(),
    );
    expect(result.ok && result.value.summary.actionItems).toHaveLength(1);
  });

  it.each(["2026-02-30", "11/05/2026", "tomorrow", "2026-13-01", "", "2026-11-05T10:00:00Z"])(
    "strips the invalid due date %j but keeps the action item",
    (dueDate) => {
      const result = verifySummary(
        raw({
          actionItems: [{ text: "Do it", assigneeId: null, dueDate, sourceFrom: 0, sourceTo: 0 }],
        }),
        ctx(),
      );
      expect(result.ok && result.value.summary.actionItems[0]?.dueDate).toBeNull();
      expect(result.ok && result.value.dropped.dueDates).toBe(1);
    },
  );

  it("keeps a valid leap-day due date", () => {
    const result = verifySummary(
      raw({
        actionItems: [
          { text: "x", assigneeId: null, dueDate: "2028-02-29", sourceFrom: 0, sourceTo: 0 },
        ],
      }),
      ctx(),
    );
    expect(result.ok && result.value.summary.actionItems[0]?.dueDate).toBe("2028-02-29");
  });
});

describe("verifySummary: limits (reject, never truncate)", () => {
  it("rejects over-long text", () => {
    const long = (n: number) => "a".repeat(n);
    expect(
      verifySummary(
        raw({ sections: [{ heading: long(201), body: "b", sourceFrom: 0, sourceTo: 0 }] }),
        ctx(),
      ),
    ).toEqual({ ok: false, error: { kind: "too_large" } });
    expect(
      verifySummary(
        raw({ sections: [{ heading: "h", body: long(20001), sourceFrom: 0, sourceTo: 0 }] }),
        ctx(),
      ),
    ).toEqual({ ok: false, error: { kind: "too_large" } });
    expect(
      verifySummary(raw({ decisions: [{ text: long(2001), sourceFrom: 0, sourceTo: 0 }] }), ctx()),
    ).toEqual({ ok: false, error: { kind: "too_large" } });
  });

  it("rejects too many items", () => {
    const section = { heading: "h", body: "b", sourceFrom: 0, sourceTo: 0 };
    expect(
      verifySummary(
        raw({ sections: Array.from({ length: MAX_SECTIONS + 1 }, () => section) }),
        ctx(),
      ),
    ).toEqual({ ok: false, error: { kind: "too_large" } });
    const decision = { text: "d", sourceFrom: 0, sourceTo: 0 };
    expect(
      verifySummary(
        raw({ decisions: Array.from({ length: MAX_DECISIONS + 1 }, () => decision) }),
        ctx(),
      ),
    ).toEqual({ ok: false, error: { kind: "too_large" } });
    const item = { text: "t", assigneeId: null, dueDate: null, sourceFrom: 0, sourceTo: 0 };
    expect(
      verifySummary(
        raw({ actionItems: Array.from({ length: MAX_ACTION_ITEMS + 1 }, () => item) }),
        ctx(),
      ),
    ).toEqual({ ok: false, error: { kind: "too_large" } });
  });

  it("normalizes whitespace and drops empty text", () => {
    const result = verifySummary(
      raw({
        sections: [
          { heading: "  Summary ", body: "  Line   one \n two ", sourceFrom: 0, sourceTo: 0 },
        ],
        decisions: [{ text: "   ", sourceFrom: 0, sourceTo: 0 }],
      }),
      ctx(),
    );
    expect(result.ok && result.value.summary.sections[0]).toMatchObject({
      heading: "Summary",
      body: "Line one two",
    });
    expect(result.ok && result.value.summary.decisions).toEqual([]);
  });
});

describe("verifySummary: template and regenerate-for-selection", () => {
  it("keeps only sections named in the template, in template order, ignoring heading case", () => {
    const result = verifySummary(
      raw({
        sections: [
          { heading: "risks", body: "r", sourceFrom: 0, sourceTo: 0 },
          { heading: "Smuggled", body: "s", sourceFrom: 0, sourceTo: 0 },
          { heading: "Summary", body: "s", sourceFrom: 1, sourceTo: 1 },
        ],
      }),
      ctx({ templateHeadings: ["Summary", "Risks"] }),
    );
    expect(result.ok && result.value.summary.sections.map((s) => s.heading)).toEqual([
      "Summary",
      "Risks",
    ]);
    expect(result.ok && result.value.dropped.sections).toBe(1);
  });

  it("regenerating one section yields exactly that section with the requested heading, no extras", () => {
    const result = verifySummary(
      raw({
        sections: [
          { heading: "Something else", body: "new body", sourceFrom: 0, sourceTo: 1 },
          { heading: "Other", body: "extra", sourceFrom: 0, sourceTo: 1 },
        ],
        decisions: [{ text: "d", sourceFrom: 0, sourceTo: 0 }],
        actionItems: [{ text: "a", assigneeId: null, dueDate: null, sourceFrom: 0, sourceTo: 0 }],
      }),
      ctx({ only: { heading: "Risks" } }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        summary: {
          sections: [{ heading: "Risks", body: "new body", sourceFrom: 0, sourceTo: 1 }],
          decisions: [],
          actionItems: [],
        },
      },
    });
  });

  it("regenerating prefers the section that already carries the requested heading", () => {
    const result = verifySummary(
      raw({
        sections: [
          { heading: "Summary", body: "wrong one", sourceFrom: 0, sourceTo: 0 },
          { heading: "risks", body: "right one", sourceFrom: 0, sourceTo: 0 },
        ],
      }),
      ctx({ only: { heading: "Risks" } }),
    );
    expect(result.ok && result.value.summary.sections[0]?.body).toBe("right one");
  });

  it("fails regenerate when the model returned nothing usable", () => {
    expect(verifySummary(raw({ sections: [] }), ctx({ only: { heading: "Risks" } }))).toEqual({
      ok: false,
      error: { kind: "no_valid_sections" },
    });
  });
});
