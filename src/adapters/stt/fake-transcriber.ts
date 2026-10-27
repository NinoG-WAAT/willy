import { providerError, type ProviderErrorKind } from "../../domain/platform/provider-error";
import { err, ok } from "../../domain/platform/result";
import { MAX_CHUNK_BYTES, normalizeAudioContentType } from "../../domain/transcription/audio";
import { normalizeSegments } from "../../domain/transcription/segments";
import type { Transcriber, TranscribeRequest } from "../../ports/transcriber";

export interface Utterance {
  startMs: number;
  endMs: number;
  speaker: number | null;
  text: string;
}

export interface FakeTranscriber extends Transcriber {
  /** Calls that reached the "provider" (sizes only: audio is never kept). */
  calls: { chunkId: string; bytes: number; contentType: string }[];
  script: {
    respondOnce(utterances: Utterance[]): void;
    failOnce(kind: ProviderErrorKind): void;
    /** Fails every call for this chunk id (or the next `times` calls), other chunks succeed. */
    failOnChunk(chunkId: string, kind: ProviderErrorKind, times?: number): void;
  };
}

/** Deterministic text derived from the chunk id, so tests can assert exact transcripts. */
function defaultUtterances(chunkId: string): Utterance[] {
  return [
    { startMs: 0, endMs: 4000, speaker: 0, text: `Fake transcript for ${chunkId}, part 1.` },
    { startMs: 4000, endMs: 8000, speaker: 1, text: `Fake transcript for ${chunkId}, part 2.` },
  ];
}

/**
 * Deterministic Transcriber for tests and local development. It validates input and normalizes
 * output exactly like the real adapters (Liskov: shared contract suite) and can fail on demand.
 */
export function createFakeTranscriber(): FakeTranscriber {
  const calls: FakeTranscriber["calls"] = [];
  const responses: Utterance[][] = [];
  const failures: ProviderErrorKind[] = [];
  const chunkFailures = new Map<string, { kind: ProviderErrorKind; remaining: number }>();

  return {
    calls,
    script: {
      respondOnce: (utterances) => responses.push(utterances),
      failOnce: (kind) => failures.push(kind),
      failOnChunk: (chunkId, kind, times = Number.POSITIVE_INFINITY) => {
        chunkFailures.set(chunkId, { kind, remaining: times });
      },
    },
    transcribe(request: TranscribeRequest) {
      if (request.audio.byteLength === 0 || request.audio.byteLength > MAX_CHUNK_BYTES) {
        return Promise.resolve(err(providerError("rejected", "audio size not allowed")));
      }
      if (normalizeAudioContentType(request.contentType) === null) {
        return Promise.resolve(err(providerError("rejected", "audio type not allowed")));
      }
      calls.push({
        chunkId: request.chunkId,
        bytes: request.audio.byteLength,
        contentType: request.contentType,
      });

      const once = failures.shift();
      const perChunk = chunkFailures.get(request.chunkId);
      const kind = once ?? (perChunk && perChunk.remaining > 0 ? perChunk.kind : undefined);
      if (kind !== undefined) {
        if (once === undefined && perChunk) perChunk.remaining -= 1;
        return Promise.resolve(err(providerError(kind, `fake provider ${kind}`)));
      }

      const utterances = responses.shift() ?? defaultUtterances(request.chunkId);
      const normalized = normalizeSegments(utterances);
      return Promise.resolve(
        normalized.ok
          ? ok(normalized.value)
          : err(providerError("unavailable", "fake provider returned invalid segments")),
      );
    },
  };
}
