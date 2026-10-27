import { describe, expect, it } from "vitest";
import {
  MAX_CHUNKS_PER_MEETING,
  MAX_CHUNK_BYTES,
  validateChunk,
} from "../../../src/domain/transcription/audio";

const ok = { byteSize: 1000, contentType: "audio/webm;codecs=opus", seq: 0 };

describe("validateChunk (upload bounds: reject, never truncate)", () => {
  it("accepts a normal chunk and returns the bare content type", () => {
    expect(validateChunk(ok)).toEqual({ ok: true, value: { contentType: "audio/webm" } });
  });

  it("accepts exactly the maximum size and the last allowed sequence number", () => {
    expect(validateChunk({ ...ok, byteSize: MAX_CHUNK_BYTES }).ok).toBe(true);
    expect(validateChunk({ ...ok, seq: MAX_CHUNKS_PER_MEETING - 1 }).ok).toBe(true);
  });

  it.each([
    [{ byteSize: 0 }, "empty"],
    [{ byteSize: -5 }, "empty"],
    [{ byteSize: MAX_CHUNK_BYTES + 1 }, "too_large"],
    [{ contentType: "text/html" }, "unsupported_type"],
    [{ contentType: "" }, "unsupported_type"],
    [{ seq: -1 }, "bad_sequence"],
    [{ seq: 1.5 }, "bad_sequence"],
    [{ seq: Number.NaN }, "bad_sequence"],
    [{ seq: MAX_CHUNKS_PER_MEETING }, "too_many_chunks"],
  ])("rejects %j as %s", (over, reason) => {
    expect(validateChunk({ ...ok, ...over })).toEqual({ ok: false, error: { reason } });
  });

  it("caps a meeting at 4 hours of 10-second chunks", () => {
    expect(MAX_CHUNKS_PER_MEETING).toBe((4 * 3600) / 10);
  });
});
