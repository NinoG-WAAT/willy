import { describe, expect, it } from "vitest";
import {
  chunkStartOffsets,
  shiftToMeetingTime,
} from "../../../src/domain/transcription/chunk-offsets";

const seg = (startMs: number, endMs: number) => ({
  startMs,
  endMs,
  speaker: "Speaker 1",
  text: "t",
});

describe("chunkStartOffsets", () => {
  it("starts each chunk where the previous ones ended", () => {
    const offsets = chunkStartOffsets([
      { seq: 0, durationMs: 10_000 },
      { seq: 1, durationMs: 9_500 },
      { seq: 2, durationMs: 10_250 },
    ]);
    expect([...offsets]).toEqual([
      [0, 0],
      [1, 10_000],
      [2, 19_500],
    ]);
  });

  it("does not depend on the order the chunks are listed in", () => {
    const sorted = chunkStartOffsets([
      { seq: 0, durationMs: 10_000 },
      { seq: 1, durationMs: 7_000 },
      { seq: 2, durationMs: 5_000 },
    ]);
    const shuffled = chunkStartOffsets([
      { seq: 2, durationMs: 5_000 },
      { seq: 0, durationMs: 10_000 },
      { seq: 1, durationMs: 7_000 },
    ]);
    expect(shuffled.get(2)).toBe(17_000);
    expect([...shuffled].sort()).toEqual([...sorted].sort());
  });

  it("adds nothing for a sequence number that was never uploaded", () => {
    const offsets = chunkStartOffsets([
      { seq: 0, durationMs: 10_000 },
      { seq: 2, durationMs: 10_000 },
    ]);
    expect(offsets.get(2)).toBe(10_000);
    expect(offsets.has(1)).toBe(false);
  });

  it("adds nothing for a zero-length or nonsensical duration", () => {
    const offsets = chunkStartOffsets([
      { seq: 0, durationMs: 0 },
      { seq: 1, durationMs: -5 },
      { seq: 2, durationMs: Number.NaN },
      { seq: 3, durationMs: 4_000 },
      { seq: 4, durationMs: 1_000 },
    ]);
    expect([...offsets.values()]).toEqual([0, 0, 0, 0, 4_000]);
  });

  it("returns an empty map for no chunks", () => {
    expect(chunkStartOffsets([]).size).toBe(0);
  });
});

describe("shiftToMeetingTime", () => {
  it("moves chunk-relative times onto the meeting timeline and keeps everything else", () => {
    expect(shiftToMeetingTime([seg(0, 4_000), seg(4_000, 5_060)], 19_500)).toEqual([
      { startMs: 19_500, endMs: 23_500, speaker: "Speaker 1", text: "t" },
      { startMs: 23_500, endMs: 24_560, speaker: "Speaker 1", text: "t" },
    ]);
  });

  it("is the identity for the first chunk and does not mutate its input", () => {
    const input = [seg(1_000, 2_000)];
    expect(shiftToMeetingTime(input, 0)).toEqual(input);
    shiftToMeetingTime(input, 5_000);
    expect(input).toEqual([seg(1_000, 2_000)]);
  });
});
