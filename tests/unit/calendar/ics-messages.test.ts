import { describe, expect, it } from "vitest";
import {
  icsProblemMessage,
  icsProblemStatus,
  skippedReason,
} from "../../../src/app/calendar/ics-messages";
import { noticeMessage } from "../../../src/app/meetings/messages";

describe("icsProblemMessage", () => {
  it("has fixed text for every refusal code and nothing for anything else", () => {
    for (const code of [
      "no_input",
      "both_sources",
      "wrong_type",
      "too_large",
      "bad_encoding",
      "bad_zone",
      "empty",
      "not_ics",
      "no_events",
      "too_many_events",
      "none_selected",
      "unknown_selection",
      "malformed",
      "too_many_selected",
      "line_too_long",
      "too_many_lines",
      "too_deep",
      "invalid_characters",
    ]) {
      expect(icsProblemMessage(code), code).toEqual(expect.any(String));
    }
    expect(icsProblemMessage(null)).toBeNull();
    expect(icsProblemMessage("<script>alert(1)</script>")).toBeNull();
    expect(icsProblemMessage("constructor")).toBeNull();
    expect(icsProblemMessage("__proto__")).toBeNull();
  });

  it("never mentions file content, a stack, or an internal word", () => {
    for (const code of ["malformed", "line_too_long", "invalid_characters", "not_ics"]) {
      expect(icsProblemMessage(code)).not.toMatch(/stack|undefined|exception|line \d/i);
    }
  });

  it("answers 413 for an oversize file and 422 for the other refusals", () => {
    expect(icsProblemStatus("too_large")).toBe(413);
    expect(icsProblemStatus("not_ics")).toBe(422);
  });
});

describe("skippedReason", () => {
  it("gives every skip code a reason", () => {
    for (const code of [
      "bad_uid",
      "missing_start",
      "bad_start",
      "bad_end",
      "unknown_timezone",
      "end_before_start",
      "invalid_event",
      "duplicate",
    ] as const) {
      expect(skippedReason(code).length).toBeGreaterThan(5);
    }
  });
});

describe("the ICS import notice", () => {
  it("states how many meetings were created and how many were already there", () => {
    const params = new URLSearchParams("notice=ics_imported&new=3&existing=1");
    expect(noticeMessage(params)).toBe(
      "Imported 3 new meetings from the calendar file. 1 event was already in your list.",
    );
  });

  it("falls back to a plain sentence for tampered counts instead of echoing them", () => {
    const params = new URLSearchParams("notice=ics_imported&new=%3Cb%3E&existing=1");
    expect(noticeMessage(params)).toBe("Calendar file import finished.");
  });
});
