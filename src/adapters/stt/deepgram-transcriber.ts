import { providerError, type ProviderError } from "../../domain/platform/provider-error";
import { err, ok, type Result } from "../../domain/platform/result";
import { MAX_CHUNK_BYTES, normalizeAudioContentType } from "../../domain/transcription/audio";
import {
  normalizeSegments,
  type RawSegment,
  type TranscribedSegment,
} from "../../domain/transcription/segments";
import type { Transcriber } from "../../ports/transcriber";
import { guardedFetchJson } from "../http/guarded-fetch";

export interface DeepgramConfig {
  fetch: typeof fetch;
  /** Server-side secret: sent in the Authorization header only, never logged or put in URLs. */
  apiKey: string;
  /** https origin of the provider; the only host this adapter may contact. */
  baseUrl: string;
  timeoutMs: number;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const unexpected = (): ProviderError =>
  providerError("unavailable", "provider returned an unexpected payload");

const toMs = (seconds: unknown): number =>
  typeof seconds === "number" ? Math.round(seconds * 1000) : Number.NaN;

/** Extracts raw segments from a Deepgram prerecorded response, or null if the shape is wrong. */
function rawSegments(body: unknown): RawSegment[] | null {
  if (!isObject(body) || !isObject(body["results"])) return null;
  const results = body["results"];
  const utterances = results["utterances"];

  if (Array.isArray(utterances)) {
    const mapped: RawSegment[] = [];
    for (const u of utterances as unknown[]) {
      if (!isObject(u)) return null;
      mapped.push({
        startMs: toMs(u["start"]),
        endMs: toMs(u["end"]),
        speaker: u["speaker"],
        text: u["transcript"],
      });
    }
    if (mapped.length > 0) return mapped;
  } else if (utterances !== undefined) {
    return null;
  }

  // No utterances: fall back to the plain channel transcript (provider without diarization).
  const channels = results["channels"];
  const first = Array.isArray(channels) ? (channels as unknown[])[0] : undefined;
  const alternatives = isObject(first) ? first["alternatives"] : undefined;
  const best = Array.isArray(alternatives) ? (alternatives as unknown[])[0] : undefined;
  const transcript = isObject(best) ? best["transcript"] : undefined;
  if (typeof transcript === "string" && transcript.trim() !== "") {
    const metadata = isObject(body["metadata"]) ? body["metadata"] : {};
    const duration = toMs(metadata["duration"]);
    return [{ startMs: 0, endMs: Number.isNaN(duration) ? 0 : duration, text: transcript }];
  }
  return utterances === undefined && !Array.isArray(channels) ? null : [];
}

export function createDeepgramTranscriber(config: DeepgramConfig): Transcriber {
  return {
    async transcribe(request): Promise<Result<TranscribedSegment[], ProviderError>> {
      const contentType = normalizeAudioContentType(request.contentType);
      if (contentType === null) return err(providerError("rejected", "audio type not allowed"));
      if (request.audio.byteLength === 0 || request.audio.byteLength > MAX_CHUNK_BYTES) {
        return err(providerError("rejected", "audio size not allowed"));
      }

      let url: URL;
      try {
        url = new URL("/v1/listen", config.baseUrl);
      } catch {
        return err(providerError("rejected", "invalid provider URL"));
      }
      url.searchParams.set("model", "nova-2");
      url.searchParams.set("diarize", "true");
      url.searchParams.set("utterances", "true");
      url.searchParams.set("punctuate", "true");

      const body = await guardedFetchJson(
        config.fetch,
        url.toString(),
        {
          method: "POST",
          headers: {
            Authorization: `Token ${config.apiKey}`,
            "Content-Type": contentType,
            Accept: "application/json",
          },
          body: request.audio,
        },
        { timeoutMs: config.timeoutMs, allowedHosts: [url.hostname] },
      );
      if (!body.ok) return err(body.error);

      const raw = rawSegments(body.value);
      if (raw === null) return err(unexpected());
      const normalized = normalizeSegments(raw);
      return normalized.ok
        ? ok(normalized.value)
        : err(providerError("unavailable", "provider returned invalid segments"));
    },
  };
}
