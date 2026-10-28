import { describe, expect, it } from "vitest";
import {
  dueDateInputValue,
  formatOffset,
  isOverdue,
  normalizeActionItemInput,
  normalizeDecisionText,
  normalizeSectionBody,
  normalizeSpeakerName,
  resolveHighlight,
  type HighlightableItem,
} from "../../../src/domain/notes/review";

const items: HighlightableItem[] = [
  { kind: "note_section", id: "s1", sourceFrom: 0, sourceTo: 10001 },
  { kind: "decision", id: "d1", sourceFrom: 10000, sourceTo: 10000 },
  { kind: "action_item", id: "a1", sourceFrom: null, sourceTo: null },
];

describe("resolveHighlight", () => {
  it("returns nothing without parameters", () => {
    expect(resolveHighlight({ src: null, hit: null }, items)).toEqual({ range: null, hit: null });
  });

  it("highlights the range a source link names", () => {
    expect(resolveHighlight({ src: "0-10001", hit: null }, items).range).toEqual({
      from: 0,
      to: 10001,
    });
  });

  it("opens a search hit on its item and marks the cited transcript range", () => {
    expect(resolveHighlight({ src: null, hit: "decision:d1" }, items)).toEqual({
      range: { from: 10000, to: 10000 },
      hit: { kind: "decision", id: "d1" },
    });
  });

  it("still marks the item of a hit whose item has no source range", () => {
    expect(resolveHighlight({ src: null, hit: "action_item:a1" }, items)).toEqual({
      range: null,
      hit: { kind: "action_item", id: "a1" },
    });
  });

  it("ignores malformed, reversed, unknown or foreign values instead of trusting them", () => {
    for (const src of ["x", "5-1", "1-2-3", "-1-2", "1e3-2000", "99999999999-1"]) {
      expect(resolveHighlight({ src, hit: null }, items).range).toBeNull();
    }
    for (const hit of ["decision:other", "meeting:s1", "s1", "decision:", ":d1"]) {
      expect(resolveHighlight({ src: null, hit }, items)).toEqual({ range: null, hit: null });
    }
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");

  it("is overdue only for an open item whose due instant has passed", () => {
    expect(isOverdue({ status: "open", dueAt: "2026-10-27T11:59:59.000Z" }, now)).toBe(true);
    expect(isOverdue({ status: "open", dueAt: "2026-10-27T12:00:01.000Z" }, now)).toBe(false);
    expect(isOverdue({ status: "done", dueAt: "2026-10-01T00:00:00.000Z" }, now)).toBe(false);
    expect(isOverdue({ status: "open", dueAt: null }, now)).toBe(false);
  });
});

describe("dueDateInputValue", () => {
  it("reads the due instant as a calendar day in the item's own zone", () => {
    // End of 30 Oct in Paris (CET) is 22:59:59 UTC: the UTC date would be wrong only near midnight.
    expect(dueDateInputValue("2026-10-30T22:59:59.000Z", "Europe/Paris")).toBe("2026-10-30");
    expect(dueDateInputValue("2026-10-31T02:00:00.000Z", "America/New_York")).toBe("2026-10-30");
  });

  it("is empty without a due date and falls back to UTC for an unknown zone", () => {
    expect(dueDateInputValue(null, "Europe/Paris")).toBe("");
    expect(dueDateInputValue("2026-10-30T10:00:00.000Z", "Nowhere/Land")).toBe("2026-10-30");
  });
});

describe("normalizers", () => {
  it("normalizes a section body and rejects empty or oversized text", () => {
    expect(normalizeSectionBody("  Line one \r\n\r\n\r\n\r\nLine two  ")).toEqual({
      ok: true,
      value: "Line one\n\nLine two",
    });
    expect(normalizeSectionBody("   ").ok).toBe(false);
    expect(normalizeSectionBody("x".repeat(20_001)).ok).toBe(false);
    expect(normalizeSectionBody(42).ok).toBe(false);
  });

  it("normalizes a decision to one line", () => {
    expect(normalizeDecisionText("  Ship   in\nNovember ")).toEqual({
      ok: true,
      value: "Ship in November",
    });
    expect(normalizeDecisionText("").ok).toBe(false);
    expect(normalizeDecisionText("x".repeat(2001)).ok).toBe(false);
  });

  it("normalizes a speaker name and bounds its length", () => {
    expect(normalizeSpeakerName("  Grace   Hopper ", "to")).toEqual({
      ok: true,
      value: "Grace Hopper",
    });
    expect(normalizeSpeakerName("", "to")).toMatchObject({ ok: false, error: { field: "to" } });
    expect(normalizeSpeakerName("x".repeat(101), "to").ok).toBe(false);
  });

  it("builds an action item: due day becomes the end of that day in the meeting's zone", () => {
    const result = normalizeActionItemInput(
      { text: " Send the deck ", assignee: "att-1", due: "2026-10-30", done: true },
      "Europe/Paris",
    );
    expect(result).toEqual({
      ok: true,
      value: {
        text: "Send the deck",
        assigneeId: "att-1",
        dueAt: "2026-10-30T22:59:59.000Z",
        dueTimezone: "Europe/Paris",
        done: true,
      },
    });
  });

  it("allows no assignee and no due date, and reports each bad field", () => {
    expect(
      normalizeActionItemInput({ text: "x", assignee: "", due: "", done: false }, "Europe/Paris"),
    ).toEqual({
      ok: true,
      value: { text: "x", assigneeId: null, dueAt: null, dueTimezone: null, done: false },
    });
    const bad = normalizeActionItemInput(
      { text: " ", assignee: "", due: "2026-02-30", done: false },
      "Europe/Paris",
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.map((e) => e.field).sort()).toEqual(["due", "text"]);
  });
});

describe("formatOffset", () => {
  it("formats the time into the recording", () => {
    expect(formatOffset(0)).toBe("0:00");
    expect(formatOffset(5_999)).toBe("0:05");
    expect(formatOffset(750_000)).toBe("12:30");
    expect(formatOffset(3_723_000)).toBe("1:02:03");
    expect(formatOffset(-5)).toBe("0:00");
  });
});
