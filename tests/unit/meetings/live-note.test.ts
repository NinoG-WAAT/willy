import { describe, expect, it } from "vitest";
import { liveControls } from "../../../src/domain/meetings/live-note";
import {
  MAX_ROUGH_NOTES_CHARS,
  normalizeRoughNotes,
} from "../../../src/domain/meetings/rough-notes";
import type { MeetingStatus } from "../../../src/domain/meetings/lifecycle";

const T = "2026-11-03T09:00:00.000Z";

describe("liveControls", () => {
  it("before capture without consent: the consent statement is shown and start is offered", () => {
    expect(liveControls("scheduled", null)).toMatchObject({
      phase: "before",
      indicator: null,
      showConsent: true,
      consentConfirmed: false,
      canStart: true,
      canPause: false,
      canResume: false,
      canStop: false,
      notesEditable: true,
    });
  });

  it("before capture with consent already stored: no checkbox, start still offered", () => {
    expect(liveControls("scheduled", T)).toMatchObject({
      showConsent: false,
      consentConfirmed: true,
      canStart: true,
    });
  });

  it("while capturing: indicator recording, pause and stop offered, no start", () => {
    expect(liveControls("capturing", T)).toMatchObject({
      phase: "recording",
      indicator: "recording",
      canStart: false,
      canPause: true,
      canResume: false,
      canStop: true,
      showConsent: false,
    });
  });

  it("while paused: indicator paused (still unmistakable), resume and stop offered", () => {
    expect(liveControls("paused", T)).toMatchObject({
      phase: "paused",
      indicator: "paused",
      canPause: false,
      canResume: true,
      canStop: true,
    });
  });

  it.each(["processing", "review", "published", "failed"] as const)(
    "after capture (%s): nothing to control, rough notes stay editable",
    (status) => {
      expect(liveControls(status, T)).toMatchObject({
        phase: "after",
        indicator: null,
        canStart: false,
        canPause: false,
        canResume: false,
        canStop: false,
        notesEditable: true,
      });
    },
  );

  it("archived meetings are read-mostly but notes survive", () => {
    expect(liveControls("archived", T)).toMatchObject({
      phase: "archived",
      canStart: false,
      notesEditable: true,
    });
  });

  it.each(["deleting", "deleted"] as const)("%s meetings offer nothing at all", (status) => {
    expect(liveControls(status, T)).toMatchObject({
      canStart: false,
      canStop: false,
      notesEditable: false,
    });
  });

  it("covers every status exhaustively", () => {
    const all: MeetingStatus[] = [
      "scheduled",
      "capturing",
      "paused",
      "processing",
      "review",
      "published",
      "failed",
      "archived",
      "deleting",
      "deleted",
    ];
    for (const status of all) expect(liveControls(status, null).phase).toBeTruthy();
  });
});

describe("normalizeRoughNotes", () => {
  it("keeps the owner's formatting: only normalizes unicode and line endings", () => {
    expect(normalizeRoughNotes("  - one\r\n\t- two  \r\n\r\n\r\n\r\nend ")).toEqual({
      ok: true,
      value: "  - one\n\t- two  \n\n\n\nend ",
    });
    expect(normalizeRoughNotes("Café")).toEqual({ ok: true, value: "Café" });
  });

  it("strips control characters except newline and tab", () => {
    expect(normalizeRoughNotes("a\u0000b\u0007c\nd\te")).toEqual({ ok: true, value: "abc\nd\te" });
  });

  it("allows empty notes (clearing them is valid)", () => {
    expect(normalizeRoughNotes("")).toEqual({ ok: true, value: "" });
  });

  it("rejects notes that are too long instead of truncating them", () => {
    expect(normalizeRoughNotes("x".repeat(MAX_ROUGH_NOTES_CHARS)).ok).toBe(true);
    const tooLong = normalizeRoughNotes("x".repeat(MAX_ROUGH_NOTES_CHARS + 1));
    expect(tooLong).toMatchObject({ ok: false, error: { field: "rough_notes" } });
  });

  it("rejects non-text", () => {
    expect(normalizeRoughNotes(undefined)).toMatchObject({ ok: false });
    expect(normalizeRoughNotes(5)).toMatchObject({ ok: false });
  });

  it("keeps markup as plain text", () => {
    expect(normalizeRoughNotes("<script>alert(1)</script>")).toEqual({
      ok: true,
      value: "<script>alert(1)</script>",
    });
  });
});
