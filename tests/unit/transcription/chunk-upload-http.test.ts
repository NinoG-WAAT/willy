import { describe, expect, it } from "vitest";
import {
  handleChunkUpload,
  type ChunkUploadRequest,
} from "../../../src/app/transcription/chunk-upload-http";
import type { UploadChunkError } from "../../../src/app/transcription/upload-chunk";
import { MAX_CHUNK_BYTES } from "../../../src/domain/transcription/audio";
import { err, ok, type Result } from "../../../src/domain/platform/result";

type Call = {
  ownerId: string;
  meetingId: string;
  seq: number;
  bytes: number;
  contentType: string;
  durationMs: number;
};

function build(
  outcome: Result<{ seq: number; replay: boolean }, UploadChunkError> = ok({
    seq: 0,
    replay: false,
  }),
) {
  const calls: Call[] = [];
  const upload = (
    ownerId: string,
    meetingId: string,
    chunk: { seq: number; audio: Uint8Array<ArrayBuffer>; contentType: string; durationMs: number },
  ) => {
    calls.push({
      ownerId,
      meetingId,
      seq: chunk.seq,
      bytes: chunk.audio.byteLength,
      contentType: chunk.contentType,
      durationMs: chunk.durationMs,
    });
    return Promise.resolve(outcome);
  };
  return { calls, upload };
}

const stream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      // Deliver in small pieces, like a network body.
      for (let i = 0; i < bytes.length; i += 4096) controller.enqueue(bytes.slice(i, i + 4096));
      controller.close();
    },
  });

const req = (over: Partial<ChunkUploadRequest> = {}): ChunkUploadRequest => ({
  ownerId: "A",
  meetingId: "m1",
  search: "?seq=3&durationMs=9000",
  contentType: "audio/webm;codecs=opus",
  contentLength: "5",
  body: stream(new Uint8Array([1, 2, 3, 4, 5])),
  ...over,
});

describe("handleChunkUpload", () => {
  it("passes the owner from the session, the parsed query and the bytes to the use case", async () => {
    const { calls, upload } = build(ok({ seq: 3, replay: false }));
    const res = await handleChunkUpload(upload, req());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ seq: 3, replay: false });
    expect(calls).toEqual([
      {
        ownerId: "A",
        meetingId: "m1",
        seq: 3,
        bytes: 5,
        contentType: "audio/webm;codecs=opus",
        durationMs: 9000,
      },
    ]);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("answers a replay with 200", async () => {
    const res = await handleChunkUpload(build(ok({ seq: 3, replay: true })).upload, req());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ seq: 3, replay: true });
  });

  it("defaults the duration to 10 seconds", async () => {
    const { calls, upload } = build();
    await handleChunkUpload(upload, req({ search: "?seq=0" }));
    expect(calls[0]?.durationMs).toBe(10_000);
  });

  it.each([
    ["", "missing seq"],
    ["?seq=abc", "non-numeric seq"],
    ["?seq=-1", "negative seq"],
    ["?seq=1.5", "fractional seq"],
    ["?seq=1&seq=2", "repeated seq"],
    ["?seq=1&durationMs=abc", "bad duration"],
    ["?seq=1&owner=B", "unknown parameter (owner ids never come from the request)"],
    ["?seq=1&meetingId=m2", "unknown parameter meetingId"],
  ])("rejects %j (%s) with 400 before reading the body", async (search) => {
    const { calls, upload } = build();
    const res = await handleChunkUpload(upload, req({ search }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad_request" });
    expect(calls).toHaveLength(0);
  });

  it("rejects a missing body and a missing content type", async () => {
    const { upload } = build();
    expect((await handleChunkUpload(upload, req({ body: null }))).status).toBe(400);
    expect((await handleChunkUpload(upload, req({ contentType: null }))).status).toBe(415);
  });

  it("rejects an oversized body from Content-Length without reading it", async () => {
    const { calls, upload } = build();
    const body = new ReadableStream<Uint8Array>();
    const res = await handleChunkUpload(
      upload,
      req({ contentLength: String(MAX_CHUNK_BYTES + 1), body }),
    );
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
    // Nobody took a reader, so not a single byte of the body was consumed.
    expect(body.locked).toBe(false);
  });

  it("rejects an oversized body that lies about, or omits, Content-Length (streaming cap)", async () => {
    const { calls, upload } = build();
    const big = new Uint8Array(MAX_CHUNK_BYTES + 10);
    expect(
      (await handleChunkUpload(upload, req({ contentLength: "10", body: stream(big) }))).status,
    ).toBe(413);
    expect(
      (await handleChunkUpload(upload, req({ contentLength: null, body: stream(big) }))).status,
    ).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("accepts a body of exactly the maximum size", async () => {
    const { calls, upload } = build();
    const exact = new Uint8Array(MAX_CHUNK_BYTES);
    const res = await handleChunkUpload(upload, req({ contentLength: null, body: stream(exact) }));
    expect(res.status).toBe(201);
    expect(calls[0]?.bytes).toBe(MAX_CHUNK_BYTES);
  });

  it.each<[UploadChunkError, number, string]>([
    [{ kind: "not_found" }, 404, "not_found"],
    [{ kind: "invalid_state", status: "processing" }, 409, "meeting_not_capturing"],
    [{ kind: "conflict" }, 409, "chunk_conflict"],
    [{ kind: "rejected", reason: "empty" }, 400, "empty_chunk"],
    [{ kind: "rejected", reason: "too_large" }, 413, "chunk_too_large"],
    [{ kind: "rejected", reason: "unsupported_type" }, 415, "unsupported_media_type"],
    [{ kind: "rejected", reason: "bad_sequence" }, 400, "bad_request"],
    [{ kind: "rejected", reason: "bad_duration" }, 400, "bad_request"],
    [{ kind: "rejected", reason: "too_many_chunks" }, 422, "too_many_chunks"],
    [{ kind: "unavailable" }, 503, "unavailable"],
  ])("maps %j to %i %s", async (error, status, code) => {
    const res = await handleChunkUpload(build(err(error)).upload, req());
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: code });
  });

  it("maps rate limiting to 429 with Retry-After", async () => {
    const res = await handleChunkUpload(
      build(err({ kind: "rate_limited", retryAfterSeconds: 17 })).upload,
      req(),
    );
    expect(res.status).toBe(429);
    expect(res.headers["Retry-After"]).toBe("17");
    expect(res.body).toEqual({ error: "rate_limited" });
  });

  it("tells clients when to retry after a storage failure", async () => {
    const res = await handleChunkUpload(build(err({ kind: "unavailable" })).upload, req());
    expect(res.headers["Retry-After"]).toBe("5");
  });

  it("never echoes request data in error bodies", async () => {
    const res = await handleChunkUpload(build().upload, req({ search: "?seq=%3Cscript%3E" }));
    expect(JSON.stringify(res.body)).not.toContain("script");
  });
});
