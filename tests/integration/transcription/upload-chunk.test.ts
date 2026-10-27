import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChunkCipher } from "../../../src/adapters/crypto/chunk-cipher";
import { parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";
import { sha256HexBytes } from "../../../src/adapters/crypto/sha256";
import { createLocalObjectStore } from "../../../src/adapters/fs/local-object-store";
import { InMemoryRateLimiter } from "../../../src/adapters/memory/in-memory-rate-limiter";
import { SqliteChunkRepository } from "../../../src/adapters/sqlite/chunk-repository";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { createChunkStore } from "../../../src/app/storage/chunk-store";
import { uploadChunk, type UploadDeps } from "../../../src/app/transcription/upload-chunk";
import { MAX_CHUNKS_PER_MEETING, MAX_CHUNK_BYTES } from "../../../src/domain/transcription/audio";
import { T0, consentedMeeting, count, freshDb, meeting, owner } from "../../support/db-fixtures";

const key = Buffer.alloc(32, 1).toString("base64");
const audio = new TextEncoder().encode("RIFF-private-audio-0123456789");

let db: DatabaseSync;
let root: string;
let objects: ReturnType<typeof createLocalObjectStore>;
let clock: FixedClock;
let deps: UploadDeps;

beforeEach(() => {
  db = freshDb();
  root = mkdtempSync(join(tmpdir(), "willy-upload-"));
  objects = createLocalObjectStore(root);
  clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  deps = {
    meetings: new SqliteMeetingRepository(db, new SequentialIds("id"), clock),
    chunks: new SqliteChunkRepository(db),
    chunkStore: createChunkStore({
      objects,
      cipher: createChunkCipher(parseKeyring(`k1:${key}`), "k1"),
    }),
    ids: new SequentialIds("chunk"),
    limiter: new InMemoryRateLimiter(clock),
  };
  owner(db, "A");
  owner(db, "B");
  consentedMeeting(db, "A", "m1");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const input = (seq = 0, bytes: Uint8Array<ArrayBuffer> = audio, contentType = "audio/webm") => ({
  seq,
  audio: bytes,
  contentType,
  durationMs: 10_000,
});

const rows = () => db.prepare("SELECT * FROM audio_chunk ORDER BY seq").all();

describe("uploadChunk: success and idempotency", () => {
  it("stores the chunk encrypted and records its metadata", async () => {
    const result = await uploadChunk(deps, "A", "m1", input(0));
    expect(result).toEqual({ ok: true, value: { seq: 0, replay: false } });
    expect(rows()).toEqual([
      expect.objectContaining({
        meeting_id: "m1",
        owner_id: "A",
        seq: 0,
        state: "uploaded",
        byte_size: audio.byteLength,
        duration_ms: 10_000,
        content_type: "audio/webm",
        sha256: await sha256HexBytes(audio),
        key_id: "k1",
        object_key: "owner/A/meeting/m1/chunk-0",
        transcription_attempts: 0,
      }),
    ]);
    const raw = await objects.get("owner/A/meeting/m1/chunk-0");
    expect(raw.ok && raw.value && Buffer.from(raw.value.bytes).includes(Buffer.from(audio))).toBe(
      false,
    );
  });

  it("works while paused too", async () => {
    consentedMeeting(db, "A", "m2", { status: "paused" });
    expect((await uploadChunk(deps, "A", "m2", input(0))).ok).toBe(true);
  });

  it("is idempotent by (meeting, seq): a retry returns success and creates nothing new", async () => {
    await uploadChunk(deps, "A", "m1", input(0));
    const objectBefore = await objects.get("owner/A/meeting/m1/chunk-0");
    const again = await uploadChunk(deps, "A", "m1", input(0));
    expect(again).toEqual({ ok: true, value: { seq: 0, replay: true } });
    expect(rows()).toHaveLength(1);
    expect(await objects.get("owner/A/meeting/m1/chunk-0")).toEqual(objectBefore);
  });

  it("two racing uploads of the same chunk leave exactly one row", async () => {
    const [a, b] = await Promise.all([
      uploadChunk(deps, "A", "m1", input(4)),
      uploadChunk(deps, "A", "m1", input(4)),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(rows()).toHaveLength(1);
  });

  it("refuses different audio for an existing sequence number and keeps the original", async () => {
    await uploadChunk(deps, "A", "m1", input(0));
    const other = new TextEncoder().encode("different audio");
    expect(await uploadChunk(deps, "A", "m1", input(0, other))).toEqual({
      ok: false,
      error: { kind: "conflict" },
    });
    expect(rows()[0]).toMatchObject({ sha256: await sha256HexBytes(audio) });
  });

  it("does not resurrect raw audio that was already transcribed and purged", async () => {
    await uploadChunk(deps, "A", "m1", input(0));
    db.prepare(
      "UPDATE audio_chunk SET state = 'purged', object_key = NULL, purged_at = ? WHERE seq = 0",
    ).run(T0);
    await objects.delete("owner/A/meeting/m1/chunk-0");
    expect(await uploadChunk(deps, "A", "m1", input(0))).toEqual({
      ok: true,
      value: { seq: 0, replay: true },
    });
    expect(await objects.get("owner/A/meeting/m1/chunk-0")).toEqual({ ok: true, value: null });
    expect(rows()[0]).toMatchObject({ state: "purged", object_key: null });
  });
});

describe("uploadChunk: meeting state and ownership", () => {
  it.each(["scheduled", "processing", "review", "published", "failed", "archived"] as const)(
    "rejects uploads while the meeting is %s and stores nothing",
    async (status) => {
      if (status === "scheduled" || status === "archived") {
        meeting(
          db,
          "A",
          "mx",
          status === "archived" ? { status, status_before_archive: "scheduled" } : {},
        );
      } else {
        consentedMeeting(db, "A", "mx", { status });
      }
      expect(await uploadChunk(deps, "A", "mx", input(0))).toEqual({
        ok: false,
        error: { kind: "invalid_state", status },
      });
      expect(count(db, "audio_chunk")).toBe(0);
      expect(await objects.deleteByPrefix("owner/A/")).toEqual({ ok: true, value: { deleted: 0 } });
    },
  );

  it("treats another owner's meeting, unknown ids and meetings being deleted as not found", async () => {
    meeting(db, "A", "gone", { status: "deleting" });
    for (const [owner_, id] of [
      ["B", "m1"],
      ["A", "nope"],
      ["A", "gone"],
    ] as const) {
      expect(await uploadChunk(deps, owner_, id, input(0))).toEqual({
        ok: false,
        error: { kind: "not_found" },
      });
    }
    expect(count(db, "audio_chunk")).toBe(0);
    expect(await objects.deleteByPrefix("owner/B/")).toEqual({ ok: true, value: { deleted: 0 } });
  });
});

describe("uploadChunk: bounds (reject, never truncate)", () => {
  it.each([
    ["empty audio", input(0, new Uint8Array(0)), "empty"],
    ["oversized audio", input(0, new Uint8Array(MAX_CHUNK_BYTES + 1)), "too_large"],
    ["unsupported type", input(0, audio, "text/html"), "unsupported_type"],
    ["negative sequence", input(-1), "bad_sequence"],
    ["too many chunks", input(MAX_CHUNKS_PER_MEETING), "too_many_chunks"],
  ] as const)("rejects %s and stores nothing", async (_name, chunk, reason) => {
    expect(await uploadChunk(deps, "A", "m1", chunk)).toEqual({
      ok: false,
      error: { kind: "rejected", reason },
    });
    expect(count(db, "audio_chunk")).toBe(0);
    expect(await objects.deleteByPrefix("owner/A/")).toEqual({ ok: true, value: { deleted: 0 } });
  });

  it.each([0, -1, 60_001, 1.5])("rejects a chunk duration of %s ms", async (durationMs) => {
    expect(await uploadChunk(deps, "A", "m1", { ...input(0), durationMs })).toEqual({
      ok: false,
      error: { kind: "rejected", reason: "bad_duration" },
    });
    expect(count(db, "audio_chunk")).toBe(0);
  });
});

describe("uploadChunk: rate limit and storage failures", () => {
  it("limits uploads per owner and reports when to retry", async () => {
    for (let i = 0; i < 120; i++) await uploadChunk(deps, "A", "m1", input(i % 5));
    const blocked = await uploadChunk(deps, "A", "m1", input(1));
    expect(blocked).toMatchObject({ ok: false, error: { kind: "rate_limited" } });
    if (!blocked.ok && blocked.error.kind === "rate_limited") {
      expect(blocked.error.retryAfterSeconds).toBeGreaterThan(0);
    }
    // Another owner is unaffected.
    consentedMeeting(db, "B", "mb");
    expect((await uploadChunk(deps, "B", "mb", input(0))).ok).toBe(true);
    // The window resets.
    clock.advance(60_000);
    expect((await uploadChunk(deps, "A", "m1", input(1))).ok).toBe(true);
  });

  it("reports storage trouble as retryable unavailable and leaves no row behind", async () => {
    objects.script.failOnce("unavailable");
    expect(await uploadChunk(deps, "A", "m1", input(0))).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
    expect(count(db, "audio_chunk")).toBe(0);
    expect((await uploadChunk(deps, "A", "m1", input(0))).ok).toBe(true);
  });
});
