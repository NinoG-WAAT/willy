import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChunkCipher } from "../../../src/adapters/crypto/chunk-cipher";
import { parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";
import { sha256HexBytes } from "../../../src/adapters/crypto/sha256";
import { createLocalObjectStore } from "../../../src/adapters/fs/local-object-store";
import { createChunkStore } from "../../../src/app/storage/chunk-store";
import { MAX_CHUNKS_PER_MEETING, MAX_CHUNK_BYTES } from "../../../src/domain/transcription/audio";

const keyA = Buffer.alloc(32, 1).toString("base64");
const keyB = Buffer.alloc(32, 2).toString("base64");

let root: string;
let objects: ReturnType<typeof createLocalObjectStore>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "willy-chunks-"));
  objects = createLocalObjectStore(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const storeWith = (spec: string, active: string) =>
  createChunkStore({
    objects,
    cipher: createChunkCipher(parseKeyring(spec), active),
  });

const audio = new TextEncoder().encode("RIFF-this-is-private-audio-0123456789");
const chunk = (seq = 0, bytes: Uint8Array<ArrayBuffer> = audio, contentType = "audio/webm") => ({
  seq,
  audio: bytes,
  contentType,
});

describe("putChunk / getChunk", () => {
  it("stores encrypted audio under the owner's prefix and returns what the row needs", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    const result = await chunks.putChunk("o1", "m1", chunk(3));
    expect(result).toEqual({
      ok: true,
      value: {
        objectKey: "owner/o1/meeting/m1/chunk-3",
        keyId: "k1",
        sha256: await sha256HexBytes(audio),
        byteSize: audio.byteLength,
        contentType: "audio/webm",
        replay: false,
      },
    });
    const raw = await objects.get("owner/o1/meeting/m1/chunk-3");
    expect(raw.ok && raw.value && Buffer.from(raw.value.bytes).includes(Buffer.from(audio))).toBe(
      false,
    );
  });

  it("round-trips the audio and its normalized content type", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    await chunks.putChunk("o1", "m1", chunk(0, audio, "audio/webm;codecs=opus"));
    expect(await chunks.getChunk("o1", "m1", 0)).toEqual({
      ok: true,
      value: { audio, contentType: "audio/webm" },
    });
  });

  it("treats a replay of the same chunk as success without rewriting it", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    await chunks.putChunk("o1", "m1", chunk(0));
    const before = await objects.get("owner/o1/meeting/m1/chunk-0");
    const again = await chunks.putChunk("o1", "m1", chunk(0));
    const after = await objects.get("owner/o1/meeting/m1/chunk-0");
    expect(again).toMatchObject({ ok: true, value: { replay: true } });
    expect(after).toEqual(before);
  });

  it("refuses different audio for an existing sequence number and keeps the original", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    await chunks.putChunk("o1", "m1", chunk(0));
    const other = new TextEncoder().encode("different audio");
    expect(await chunks.putChunk("o1", "m1", chunk(0, other))).toEqual({
      ok: false,
      error: { kind: "conflict" },
    });
    expect(await chunks.getChunk("o1", "m1", 0)).toMatchObject({ ok: true, value: { audio } });
  });

  it.each([
    ["empty audio", chunk(0, new Uint8Array(0)), "empty"],
    ["oversized audio", chunk(0, new Uint8Array(MAX_CHUNK_BYTES + 1)), "too_large"],
    ["wrong content type", chunk(0, audio, "text/html"), "unsupported_type"],
    ["negative sequence", chunk(-1), "bad_sequence"],
    ["too many chunks", chunk(MAX_CHUNKS_PER_MEETING), "too_many_chunks"],
  ] as const)("rejects %s and stores nothing", async (_name, input, reason) => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    expect(await chunks.putChunk("o1", "m1", input)).toEqual({
      ok: false,
      error: { kind: "rejected", reason },
    });
    expect(await objects.deleteByPrefix("owner/o1/")).toEqual({ ok: true, value: { deleted: 0 } });
  });

  it("accepts exactly the maximum chunk size", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    const max = new Uint8Array(MAX_CHUNK_BYTES).fill(5);
    expect((await chunks.putChunk("o1", "m1", chunk(0, max))).ok).toBe(true);
    const got = await chunks.getChunk("o1", "m1", 0);
    expect(got.ok && got.value.audio.byteLength).toBe(MAX_CHUNK_BYTES);
  });

  it("returns not_found for a missing chunk", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    expect(await chunks.getChunk("o1", "m1", 9)).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });

  it("throws for ids that could escape the prefix (a bug, not user input)", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    await expect(chunks.putChunk("../x", "m1", chunk())).rejects.toThrow();
    await expect(chunks.getChunk("o1", "m/1", 0)).rejects.toThrow();
  });
});

describe("tamper detection and cross-owner access", () => {
  it("reports corrupt, not garbage, when a stored object was modified", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    await chunks.putChunk("o1", "m1", chunk(0));
    const raw = await objects.get("owner/o1/meeting/m1/chunk-0");
    if (!raw.ok || !raw.value) throw new Error("setup");
    const bytes = new Uint8Array(raw.value.bytes);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    await objects.put("owner/o1/meeting/m1/chunk-0", bytes, "audio/webm");
    expect(await chunks.getChunk("o1", "m1", 0)).toEqual({ ok: false, error: { kind: "corrupt" } });
  });

  it("owner B cannot read, replace or delete owner A's chunks, even knowing the ids", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    await chunks.putChunk("oA", "mA", chunk(0));
    expect(await chunks.getChunk("oB", "mA", 0)).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await chunks.deleteMeeting("oB", "mA")).toEqual({ ok: true, value: { deleted: 0 } });
    expect(await chunks.deleteChunk("oB", "mA", 0)).toEqual({ ok: true, value: undefined });
    expect(await chunks.getChunk("oA", "mA", 0)).toMatchObject({ ok: true, value: { audio } });
  });

  it("an object copied into another owner's prefix cannot be decrypted there", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    await chunks.putChunk("oA", "mA", chunk(0));
    const raw = await objects.get("owner/oA/meeting/mA/chunk-0");
    if (!raw.ok || !raw.value) throw new Error("setup");
    await objects.put("owner/oB/meeting/mB/chunk-0", raw.value.bytes, "audio/webm");
    expect(await chunks.getChunk("oB", "mB", 0)).toEqual({ ok: false, error: { kind: "corrupt" } });
  });
});

describe("deletion", () => {
  it("deleteChunk is idempotent", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    await chunks.putChunk("o1", "m1", chunk(0));
    expect((await chunks.deleteChunk("o1", "m1", 0)).ok).toBe(true);
    expect((await chunks.deleteChunk("o1", "m1", 0)).ok).toBe(true);
    expect(await chunks.getChunk("o1", "m1", 0)).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });

  it("deleteMeeting removes only that meeting's objects, reports the count and is idempotent", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    for (const seq of [0, 1, 2]) await chunks.putChunk("o1", "m1", chunk(seq));
    await chunks.putChunk("o1", "m10", chunk(0));
    await chunks.putChunk("o2", "m1", chunk(0));
    expect(await chunks.deleteMeeting("o1", "m1")).toEqual({ ok: true, value: { deleted: 3 } });
    expect(await chunks.deleteMeeting("o1", "m1")).toEqual({ ok: true, value: { deleted: 0 } });
    expect((await chunks.getChunk("o1", "m10", 0)).ok).toBe(true);
    expect((await chunks.getChunk("o2", "m1", 0)).ok).toBe(true);
  });
});

describe("key rotation and provider failures", () => {
  it("reads chunks sealed with an old key and seals new ones with the active key", async () => {
    await storeWith(`k1:${keyA}`, "k1").putChunk("o1", "m1", chunk(0));
    const rotated = storeWith(`k1:${keyA},k2:${keyB}`, "k2");
    expect(await rotated.getChunk("o1", "m1", 0)).toMatchObject({ ok: true, value: { audio } });
    expect(await rotated.putChunk("o1", "m1", chunk(1))).toMatchObject({
      ok: true,
      value: { keyId: "k2" },
    });
  });

  it("reports a missing old key as corrupt rather than throwing", async () => {
    await storeWith(`k1:${keyA}`, "k1").putChunk("o1", "m1", chunk(0));
    expect(await storeWith(`k2:${keyB}`, "k2").getChunk("o1", "m1", 0)).toEqual({
      ok: false,
      error: { kind: "corrupt" },
    });
  });

  it("surfaces storage failures as normalized provider errors", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    objects.script.failOnce("unavailable");
    const put = await chunks.putChunk("o1", "m1", chunk(0));
    expect(put).toMatchObject({
      ok: false,
      error: { kind: "provider", error: { kind: "unavailable", retryable: true } },
    });
    await chunks.putChunk("o1", "m1", chunk(0));
    objects.script.failOnce("timeout");
    expect(await chunks.getChunk("o1", "m1", 0)).toMatchObject({
      ok: false,
      error: { kind: "provider", error: { kind: "timeout" } },
    });
  });
});

describe("no plaintext in errors", () => {
  it("never includes audio or keys in error values", async () => {
    const chunks = storeWith(`k1:${keyA}`, "k1");
    objects.script.failOnce("rejected");
    const result = await chunks.putChunk("o1", "m1", chunk(0));
    expect(JSON.stringify(result)).not.toMatch(/RIFF|private-audio|owner\/o1/);
  });
});
