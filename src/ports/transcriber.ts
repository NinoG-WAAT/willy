import type { ProviderError } from "../domain/platform/provider-error";
import type { Result } from "../domain/platform/result";
import type { TranscribedSegment } from "../domain/transcription/segments";
import type { Locale } from "../i18n/translate";

export interface TranscribeRequest {
  /** Stable id of the chunk (idempotency: the same chunk always maps to the same segments). */
  chunkId: string;
  /** Decrypted audio, at most MAX_CHUNK_BYTES. Never logged. */
  audio: Uint8Array<ArrayBuffer>;
  contentType: string;
  /**
   * Words of the owner's vocabulary (project names, clients, acronyms), already normalised, in
   * the owner's list order. A hint, never a requirement: an adapter uses what its provider can
   * take (whisper: a starting prompt of about 600 characters, Deepgram: at most 100 keywords),
   * drops the rest, and returns the same kind of result with or without it. Absent or empty
   * means no hint. It can hold sensitive names: never logged, never put in an error message.
   */
  vocabulary?: readonly string[];
  /**
   * The owner's language, as a hint for the language spoken. An adapter uses it only when its own
   * configuration does not fix a language, and only if it is one of ours; absent means detect.
   * Never taken from meeting content.
   */
  language?: Locale;
}

/**
 * Speech-to-text for one chunk. Segment times are **relative to the start of that chunk's audio**
 * (every real provider and the fake report them that way); the transcription job moves them onto
 * the meeting timeline, so an adapter must not try to guess an offset. Never throws for provider problems: failures come back as a
 * normalized ProviderError (`retryable` says whether trying again can help).
 */
export interface Transcriber {
  transcribe(request: TranscribeRequest): Promise<Result<TranscribedSegment[], ProviderError>>;
}
