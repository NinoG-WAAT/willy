import { describe, expect, it } from "vitest";
import {
  speakerFormsOpen,
  speakerLines,
  transcriptPanelOpen,
  transcriptSummary,
} from "../../../src/domain/notes/transcript-panel";

describe("transcriptSummary", () => {
  it("names the length of the meeting and the number of lines", () => {
    const segments = [{ startMs: 0 }, { startMs: 4000 }, { startMs: 1_100_000 }];
    expect(transcriptSummary(segments)).toEqual({
      duration: "18:20",
      lines: 3,
      text: "Transcript, 18:20, 3 lines",
    });
  });

  it("takes the latest start, whatever the order of the lines", () => {
    expect(transcriptSummary([{ startMs: 65_000 }, { startMs: 5000 }]).duration).toBe("1:05");
  });

  it("uses an hour field past the hour", () => {
    expect(transcriptSummary([{ startMs: 3_723_000 }]).duration).toBe("1:02:03");
  });

  it("says one line in the singular", () => {
    expect(transcriptSummary([{ startMs: 0 }]).text).toBe("Transcript, 0:00, 1 line");
  });

  it("says so when there are no lines, without a made-up duration", () => {
    expect(transcriptSummary([])).toEqual({
      duration: null,
      lines: 0,
      text: "Transcript, no lines",
    });
  });
});

describe("transcriptPanelOpen", () => {
  it("is closed by default", () => {
    expect(transcriptPanelOpen({ range: null, hit: null })).toBe(false);
  });

  it("opens for a source range, so the cited lines are visible", () => {
    expect(transcriptPanelOpen({ range: { from: 2, to: 4 }, hit: null })).toBe(true);
  });

  it("opens for a search hit that cites lines", () => {
    expect(
      transcriptPanelOpen({ range: { from: 1, to: 1 }, hit: { kind: "decision", id: "d1" } }),
    ).toBe(true);
  });

  it("stays closed for a hit on an item the owner wrote (nothing to show)", () => {
    expect(transcriptPanelOpen({ range: null, hit: { kind: "action_item", id: "a1" } })).toBe(
      false,
    );
  });
});

describe("speakerFormsOpen", () => {
  it("opens when a rename or merge was rejected, so its error shows", () => {
    expect(speakerFormsOpen("rename_speaker")).toBe(true);
    expect(speakerFormsOpen("merge_speaker")).toBe(true);
  });

  it("stays closed otherwise", () => {
    expect(speakerFormsOpen(null)).toBe(false);
    expect(speakerFormsOpen("publish")).toBe(false);
    expect(speakerFormsOpen("edit_section")).toBe(false);
  });
});

describe("speakerLines", () => {
  it("counts the lines of each speaker in order of first appearance", () => {
    const lines = [{ speaker: "B" }, { speaker: "A" }, { speaker: "B" }];
    expect(speakerLines(lines)).toEqual([
      { name: "B", lines: 2 },
      { name: "A", lines: 1 },
    ]);
  });

  it("is empty without lines", () => {
    expect(speakerLines([])).toEqual([]);
  });
});
