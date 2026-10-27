import { err, ok, type Result } from "../platform/result";

/** Largest audio chunk accepted anywhere (upload endpoint, storage, transcription): 1 MiB. */
export const MAX_CHUNK_BYTES = 1_048_576;
/** 4 hours of 10-second chunks (docs/PLAN.md section 11, question 9). */
export const MAX_CHUNKS_PER_MEETING = (4 * 3600) / 10;
/** Encrypted chunk plus header and tag; nothing larger is ever stored. */
export const MAX_STORED_OBJECT_BYTES = MAX_CHUNK_BYTES + 4096;

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
]);

/** Returns the bare allowlisted media type (parameters such as codecs dropped), or null. */
export function normalizeAudioContentType(raw: string): string | null {
  const base = (raw.split(";")[0] ?? "").trim().toLowerCase();
  return ALLOWED_AUDIO_TYPES.has(base) ? base : null;
}

export type ChunkRejection =
  "empty" | "too_large" | "unsupported_type" | "bad_sequence" | "too_many_chunks";

/** Upload bounds for one chunk. Reject, never truncate or coerce. */
export function validateChunk(input: {
  byteSize: number;
  contentType: string;
  seq: number;
}): Result<{ contentType: string }, { reason: ChunkRejection }> {
  if (!(input.byteSize > 0)) return err({ reason: "empty" });
  if (input.byteSize > MAX_CHUNK_BYTES) return err({ reason: "too_large" });
  const contentType = normalizeAudioContentType(input.contentType);
  if (contentType === null) return err({ reason: "unsupported_type" });
  if (!Number.isInteger(input.seq) || input.seq < 0) return err({ reason: "bad_sequence" });
  if (input.seq >= MAX_CHUNKS_PER_MEETING) return err({ reason: "too_many_chunks" });
  return ok({ contentType });
}
