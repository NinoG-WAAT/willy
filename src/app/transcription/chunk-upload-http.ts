import { err, ok, type Result } from "../../domain/platform/result";
import { MAX_CHUNK_BYTES } from "../../domain/transcription/audio";
import type { ChunkUpload, UploadChunkError } from "./upload-chunk";

export interface ChunkUploadRequest {
  /** From the session, never from the request. */
  ownerId: string;
  /** From the URL path. */
  meetingId: string;
  /** Raw query string, e.g. `?seq=3&durationMs=10000`. */
  search: string;
  contentType: string | null;
  contentLength: string | null;
  body: ReadableStream<Uint8Array> | null;
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export type UploadFn = (
  ownerId: string,
  meetingId: string,
  chunk: ChunkUpload,
) => Promise<Result<{ seq: number; replay: boolean }, UploadChunkError>>;

const DEFAULT_DURATION_MS = 10_000;
const ALLOWED_PARAMS = new Set(["seq", "durationMs"]);
const NUMBER = /^\d{1,9}$/;

const json = (
  status: number,
  body: Record<string, unknown>,
  extra: Record<string, string> = {},
): HttpResult => ({
  status,
  headers: { "Cache-Control": "no-store", ...extra },
  body,
});

/** Parses `seq` (required) and `durationMs`; any other, repeated or malformed parameter is an error. */
function parseQuery(search: string): Result<{ seq: number; durationMs: number }, "bad_request"> {
  const params = new URLSearchParams(search);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMS.has(key) || seen.has(key)) return err("bad_request");
    seen.add(key);
  }
  const seq = params.get("seq");
  const duration = params.get("durationMs");
  if (seq === null || !NUMBER.test(seq)) return err("bad_request");
  if (duration !== null && !NUMBER.test(duration)) return err("bad_request");
  return ok({
    seq: Number(seq),
    durationMs: duration === null ? DEFAULT_DURATION_MS : Number(duration),
  });
}

/** Reads at most MAX_CHUNK_BYTES; returns null (and stops reading) as soon as the body is bigger. */
async function readBounded(
  body: ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = body.getReader();
  const pieces: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CHUNK_BYTES) {
      await reader.cancel();
      return null;
    }
    pieces.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.byteLength;
  }
  return out;
}

function failure(error: UploadChunkError): HttpResult {
  switch (error.kind) {
    case "not_found":
      return json(404, { error: "not_found" });
    case "invalid_state":
      return json(409, { error: "meeting_not_capturing" });
    case "conflict":
      return json(409, { error: "chunk_conflict" });
    case "rate_limited":
      return json(
        429,
        { error: "rate_limited" },
        { "Retry-After": String(error.retryAfterSeconds) },
      );
    case "unavailable":
      return json(503, { error: "unavailable" }, { "Retry-After": "5" });
    case "rejected":
      switch (error.reason) {
        case "empty":
          return json(400, { error: "empty_chunk" });
        case "too_large":
          return json(413, { error: "chunk_too_large" });
        case "unsupported_type":
          return json(415, { error: "unsupported_media_type" });
        case "too_many_chunks":
          return json(422, { error: "too_many_chunks" });
        case "bad_sequence":
        case "bad_duration":
          return json(400, { error: "bad_request" });
      }
  }
}

/**
 * HTTP adapter for `POST /api/meetings/:id/chunks?seq=N[&durationMs=M]` with the raw audio as the
 * body. Owner and meeting come from the session and path only; the query is strict; the body is
 * capped while streaming (never trusting Content-Length); error bodies are fixed codes that never
 * echo request data. Session and CSRF are enforced earlier, by the middleware.
 */
export async function handleChunkUpload(
  upload: UploadFn,
  request: ChunkUploadRequest,
): Promise<HttpResult> {
  const query = parseQuery(request.search);
  if (!query.ok) return json(400, { error: "bad_request" });
  if (request.contentType === null || request.contentType.trim() === "") {
    return json(415, { error: "unsupported_media_type" });
  }
  if (request.body === null) return json(400, { error: "bad_request" });

  const declared =
    request.contentLength !== null && NUMBER.test(request.contentLength)
      ? Number(request.contentLength)
      : null;
  if (declared !== null && declared > MAX_CHUNK_BYTES)
    return json(413, { error: "chunk_too_large" });

  const audio = await readBounded(request.body);
  if (audio === null) return json(413, { error: "chunk_too_large" });

  const result = await upload(request.ownerId, request.meetingId, {
    seq: query.value.seq,
    audio,
    contentType: request.contentType,
    durationMs: query.value.durationMs,
  });
  if (!result.ok) return failure(result.error);
  return json(result.value.replay ? 200 : 201, {
    seq: result.value.seq,
    replay: result.value.replay,
  });
}
