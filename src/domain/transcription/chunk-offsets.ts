import type { TranscribedSegment } from "./segments";

/** What the timeline needs to know about an uploaded chunk. */
export interface ChunkSpan {
  seq: number;
  durationMs: number;
}

/**
 * Where each chunk starts on the meeting timeline: the summed audio duration of every chunk with
 * a lower sequence number.
 *
 * Only `seq` and `durationMs` are used, never the chunk's state or the order of the input. A
 * chunk that failed, or has not been transcribed yet, still occupies its place, so the offset of
 * a chunk is the same whichever order the chunks are transcribed or retried in. A sequence number
 * that was never uploaded has no duration to count and adds nothing; a zero-length or invalid
 * duration adds nothing either.
 */
export function chunkStartOffsets(chunks: readonly ChunkSpan[]): Map<number, number> {
  const offsets = new Map<number, number>();
  let elapsedMs = 0;
  for (const { seq, durationMs } of [...chunks].sort((a, b) => a.seq - b.seq)) {
    offsets.set(seq, elapsedMs);
    if (Number.isFinite(durationMs) && durationMs > 0) elapsedMs += durationMs;
  }
  return offsets;
}

/** Moves the chunk-relative times a Transcriber returns onto the meeting timeline. */
export function shiftToMeetingTime(
  segments: readonly TranscribedSegment[],
  offsetMs: number,
): TranscribedSegment[] {
  return segments.map((s) => ({
    ...s,
    startMs: s.startMs + offsetMs,
    endMs: s.endMs + offsetMs,
  }));
}
