import type { ProviderError } from "../domain/platform/provider-error";
import type { Result } from "../domain/platform/result";
import type { TranscribedSegment } from "../domain/transcription/segments";

export interface TranscribeRequest {
  /** Stable id of the chunk (idempotency: the same chunk always maps to the same segments). */
  chunkId: string;
  /** Decrypted audio, at most MAX_CHUNK_BYTES. Never logged. */
  audio: Uint8Array<ArrayBuffer>;
  contentType: string;
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
