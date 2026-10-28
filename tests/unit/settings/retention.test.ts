import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION,
  describeNoteRetention,
  describeRawAudioRetention,
  noteRetentionChoices,
  parseRetention,
  rawAudioChoices,
  type RetentionSettings,
} from "../../../src/domain/settings/retention";

const current: RetentionSettings = { rawAudioRetentionHours: 0, noteRetentionDays: null };

describe("defaults and wording", () => {
  it("deletes raw audio right after transcription and keeps notes by default", () => {
    expect(DEFAULT_RETENTION).toEqual({ rawAudioRetentionHours: 0, noteRetentionDays: null });
    expect(describeRawAudioRetention(0)).toMatch(/right after.*transcri/i);
    expect(describeNoteRetention(null)).toMatch(/until you delete/i);
  });

  it("names the periods in words", () => {
    expect(describeRawAudioRetention(24)).toBe("Keep for 1 day after transcription");
    expect(describeRawAudioRetention(72)).toBe("Keep for 3 days after transcription");
    expect(describeRawAudioRetention(168)).toBe("Keep for 7 days after transcription");
    expect(describeRawAudioRetention(5)).toBe("Keep for 5 hours after transcription");
    expect(describeNoteRetention(90)).toMatch(/90 days/);
  });
});

describe("choices", () => {
  it("offers a short fixed list, within the database limit of 7 days", () => {
    expect(rawAudioChoices(0)).toEqual([0, 24, 72, 168]);
    expect(Math.max(...rawAudioChoices(0))).toBeLessThanOrEqual(168);
    expect(noteRetentionChoices(null)).toEqual([30, 90, 180, 365]);
  });

  it("keeps a stored custom value selectable so the form never silently changes it", () => {
    expect(rawAudioChoices(5)).toEqual([0, 5, 24, 72, 168]);
    expect(noteRetentionChoices(45)).toEqual([30, 45, 90, 180, 365]);
  });
});

describe("parseRetention", () => {
  const form = (over: Record<string, string | boolean | undefined> = {}) => ({
    rawAudioRetentionHours: "0" as string | undefined,
    noteRetentionDays: "off" as string | undefined,
    acknowledged: false,
    ...over,
  });

  it("accepts the defaults", () => {
    expect(parseRetention(form(), current)).toEqual({ ok: true, value: DEFAULT_RETENTION });
  });

  it("accepts a longer audio window without further confirmation", () => {
    expect(parseRetention(form({ rawAudioRetentionHours: "72" }), current)).toEqual({
      ok: true,
      value: { rawAudioRetentionHours: 72, noteRetentionDays: null },
    });
  });

  it.each(["", "-1", "1", "169", "24.5", "abc", "1e2", " 24", "0x18", undefined])(
    "rejects raw audio retention %j",
    (value) => {
      expect(parseRetention(form({ rawAudioRetentionHours: value }), current)).toMatchObject({
        ok: false,
        error: [{ field: "raw_audio_retention_hours" }],
      });
    },
  );

  it.each(["", "0", "1", "29", "366", "abc", "30.5", undefined])(
    "rejects note retention %j",
    (value) => {
      expect(
        parseRetention(form({ noteRetentionDays: value, acknowledged: true }), current),
      ).toMatchObject({ ok: false, error: [{ field: "note_retention_days" }] });
    },
  );

  it("requires an explicit acknowledgement before notes start expiring", () => {
    const enable = form({ noteRetentionDays: "90" });
    expect(parseRetention(enable, current)).toMatchObject({
      ok: false,
      error: [{ field: "acknowledge_note_retention" }],
    });
    expect(parseRetention({ ...enable, acknowledged: true }, current)).toEqual({
      ok: true,
      value: { rawAudioRetentionHours: 0, noteRetentionDays: 90 },
    });
  });

  it("requires acknowledgement when the period gets shorter, not when it stays or grows", () => {
    const at90: RetentionSettings = { rawAudioRetentionHours: 0, noteRetentionDays: 90 };
    expect(parseRetention(form({ noteRetentionDays: "30" }), at90).ok).toBe(false);
    expect(parseRetention(form({ noteRetentionDays: "90" }), at90).ok).toBe(true);
    expect(parseRetention(form({ noteRetentionDays: "180" }), at90).ok).toBe(true);
    expect(parseRetention(form({ noteRetentionDays: "off" }), at90).ok).toBe(true);
  });

  it("accepts the stored custom value unchanged, and nothing else outside the lists", () => {
    const custom: RetentionSettings = { rawAudioRetentionHours: 5, noteRetentionDays: 45 };
    expect(
      parseRetention(form({ rawAudioRetentionHours: "5", noteRetentionDays: "45" }), custom),
    ).toEqual({ ok: true, value: custom });
    expect(parseRetention(form({ rawAudioRetentionHours: "6", noteRetentionDays: "45" }), custom).ok).toBe(
      false,
    );
  });

  it("reports every problem at once", () => {
    const result = parseRetention(
      form({ rawAudioRetentionHours: "999", noteRetentionDays: "999" }),
      current,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((e) => e.field)).toEqual([
        "raw_audio_retention_hours",
        "note_retention_days",
      ]);
    }
  });
});
