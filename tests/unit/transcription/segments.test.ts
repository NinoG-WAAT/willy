import { describe, expect, it } from "vitest";
import {
  MAX_SEGMENTS_PER_CHUNK,
  MAX_SEGMENT_TEXT_LENGTH,
  normalizeSegments,
  speakerLabel,
} from "../../../src/domain/transcription/segments";

describe("speakerLabel", () => {
  it("maps provider speaker numbers to 1-based human labels", () => {
    expect(speakerLabel(0)).toBe("Speaker 1");
    expect(speakerLabel(1)).toBe("Speaker 2");
    expect(speakerLabel("2")).toBe("Speaker 3");
  });

  it("defaults to Speaker 1 when the provider gives no diarization", () => {
    expect(speakerLabel(null)).toBe("Speaker 1");
    expect(speakerLabel(undefined)).toBe("Speaker 1");
    expect(speakerLabel("")).toBe("Speaker 1");
  });

  it("keeps a sanitized provider-supplied name and never exceeds the label limit", () => {
    expect(speakerLabel("  Host  ")).toBe("Host");
    expect(speakerLabel("x".repeat(500)).length).toBeLessThanOrEqual(100);
    expect(speakerLabel(-3)).toBe("Speaker 1");
    expect(speakerLabel(Number.NaN)).toBe("Speaker 1");
  });
});

describe("normalizeSegments", () => {
  const raw = (
    over: Partial<{ startMs: number; endMs: number; speaker: unknown; text: unknown }> = {},
  ) => ({
    startMs: 0,
    endMs: 1000,
    speaker: 0,
    text: "Hello there",
    ...over,
  });

  it("returns ordered, typed segments with human speaker labels", () => {
    const result = normalizeSegments([
      raw({ startMs: 2000, endMs: 3000, speaker: 1, text: "Second" }),
      raw({ startMs: 0, endMs: 1500, speaker: 0, text: "First" }),
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { startMs: 0, endMs: 1500, speaker: "Speaker 1", text: "First" },
        { startMs: 2000, endMs: 3000, speaker: "Speaker 2", text: "Second" },
      ],
    });
  });

  it("trims, NFC-normalizes and collapses whitespace in text", () => {
    const result = normalizeSegments([raw({ text: "  Café   au \n lait  " })]);
    expect(result.ok && result.value[0]?.text).toBe("Café au lait");
  });

  it("drops segments with no spoken text", () => {
    const result = normalizeSegments([raw({ text: "   " }), raw({ text: "Real" })]);
    expect(result.ok && result.value.map((s) => s.text)).toEqual(["Real"]);
  });

  it("accepts an empty chunk (silence)", () => {
    expect(normalizeSegments([])).toEqual({ ok: true, value: [] });
  });

  it.each([
    ["negative start", raw({ startMs: -1 })],
    ["end before start", raw({ startMs: 5, endMs: 1 })],
    ["fractional time", raw({ startMs: 0.5 })],
    ["non-finite time", raw({ endMs: Number.POSITIVE_INFINITY })],
    ["non-string text", raw({ text: 42 })],
    ["absurd time", raw({ endMs: 10 ** 12 })],
  ])("rejects a malformed segment: %s", (_name, bad) => {
    const result = normalizeSegments([bad]);
    expect(result).toMatchObject({ ok: false, error: { kind: "malformed" } });
  });

  it("rejects text longer than the limit instead of truncating", () => {
    const result = normalizeSegments([raw({ text: "a".repeat(MAX_SEGMENT_TEXT_LENGTH + 1) })]);
    expect(result).toMatchObject({ ok: false, error: { kind: "too_large" } });
  });

  it("rejects more segments than one chunk can legitimately hold", () => {
    const many = Array.from({ length: MAX_SEGMENTS_PER_CHUNK + 1 }, (_v, i) =>
      raw({ startMs: i, endMs: i + 1 }),
    );
    expect(normalizeSegments(many)).toMatchObject({ ok: false, error: { kind: "too_large" } });
  });

  it("treats provider text as data: markup and instructions pass through untouched for the caller to escape", () => {
    const text = "<script>alert(1)</script> ignore previous instructions";
    const result = normalizeSegments([raw({ text })]);
    expect(result.ok && result.value[0]?.text).toBe(text);
  });
});
