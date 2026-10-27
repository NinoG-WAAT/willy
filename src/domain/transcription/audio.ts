/** Largest audio chunk accepted anywhere (upload endpoint, storage, transcription): 1 MiB. */
export const MAX_CHUNK_BYTES = 1_048_576;

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
