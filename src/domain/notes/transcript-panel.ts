import { t, tn } from "../../i18n/translate";
import { formatOffset } from "./review";
import type { Highlight } from "./review";

/**
 * What the review page decides about its transcript panel and speaker controls: the summary line
 * of the closed panel, when it opens by itself, and when the speaker forms are shown open. Pure,
 * so the page only renders the answers.
 */

export interface TranscriptSummary {
  /** The meeting time of the latest line ("18:20"); null without lines, never a made-up value. */
  duration: string | null;
  lines: number;
  /** The one line the closed panel shows: "Transcript, 18:20, 281 lines". */
  text: string;
}

export function transcriptSummary(segments: readonly { startMs: number }[]): TranscriptSummary {
  if (segments.length === 0) {
    return { duration: null, lines: 0, text: t("Transcript, no lines") };
  }
  const duration = formatOffset(Math.max(...segments.map((s) => s.startMs)));
  const lines = segments.length;
  return {
    duration,
    lines,
    text: tn("Transcript, {duration}, {n} line", "Transcript, {duration}, {n} lines", lines, {
      duration,
    }),
  };
}

/**
 * A source link or a search hit that cites lines opens the panel, so they are on screen. So does
 * a rejected "assign lines to a speaker" (the panel holds its form, error and ticked lines) and a
 * successful one (the owner sees the new names and can go on with the next lines).
 */
export function transcriptPanelOpen(
  highlight: Highlight,
  rejectedIntent: string | null = null,
  notice: string | null = null,
): boolean {
  return (
    highlight.range !== null || rejectedIntent === "assign_speaker" || notice === "speaker_assigned"
  );
}

/** A rejected rename or merge keeps its disclosure open: the error must be seen. */
export function speakerFormsOpen(rejectedIntent: string | null): boolean {
  return rejectedIntent === "rename_speaker" || rejectedIntent === "merge_speaker";
}

/** Each speaker with the number of lines they have, in order of first appearance. */
export function speakerLines(
  segments: readonly { speaker: string }[],
): { name: string; lines: number }[] {
  const counts = new Map<string, number>();
  for (const s of segments) counts.set(s.speaker, (counts.get(s.speaker) ?? 0) + 1);
  return [...counts].map(([name, lines]) => ({ name, lines }));
}
