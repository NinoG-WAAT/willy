import { err, ok, type Result } from "../platform/result";

export const MAX_SEGMENTS_PER_CHUNK = 200;
export const MAX_SEGMENT_TEXT_LENGTH = 5000;
const MAX_SPEAKER_LABEL_LENGTH = 100;
/** No single chunk is anywhere near this; it only rejects nonsense numbers from a provider. */
const MAX_TIME_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SPEAKER = "Speaker 1";

/** What a Transcriber returns for one chunk, before it is stored as a TranscriptSegment. */
export interface TranscribedSegment {
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
}

export interface RawSegment {
  startMs: number;
  endMs: number;
  speaker?: unknown;
  text: unknown;
}

export type SegmentError = { kind: "malformed" } | { kind: "too_large" };

/** Provider diarization ids are 0-based; people read "Speaker 1". Owner corrections come later. */
export function speakerLabel(raw: unknown): string {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 ? `Speaker ${String(raw + 1)}` : DEFAULT_SPEAKER;
  }
  if (typeof raw !== "string") return DEFAULT_SPEAKER;
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name === "") return DEFAULT_SPEAKER;
  if (/^\d{1,6}$/.test(name)) return `Speaker ${String(Number(name) + 1)}`;
  return name.slice(0, MAX_SPEAKER_LABEL_LENGTH);
}

const isTime = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= MAX_TIME_MS;

/**
 * Validates and normalizes provider output (an untrusted source): bounded counts and lengths
 * (reject, never truncate), integer millisecond times, trimmed NFC text without empty segments,
 * ordered by start time. Text is data: it is not stripped of markup or instructions here, the
 * renderer escapes it and the summarizer treats it as untrusted.
 */
export function normalizeSegments(
  raw: readonly RawSegment[],
): Result<TranscribedSegment[], SegmentError> {
  if (raw.length > MAX_SEGMENTS_PER_CHUNK) return err({ kind: "too_large" });
  const segments: TranscribedSegment[] = [];
  for (const item of raw) {
    if (!isTime(item.startMs) || !isTime(item.endMs) || item.endMs < item.startMs) {
      return err({ kind: "malformed" });
    }
    if (typeof item.text !== "string") return err({ kind: "malformed" });
    const text = item.text.normalize("NFC").replace(/\s+/g, " ").trim();
    if (text.length > MAX_SEGMENT_TEXT_LENGTH) return err({ kind: "too_large" });
    if (text === "") continue;
    segments.push({
      startMs: item.startMs,
      endMs: item.endMs,
      speaker: speakerLabel(item.speaker),
      text,
    });
  }
  segments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return ok(segments);
}
