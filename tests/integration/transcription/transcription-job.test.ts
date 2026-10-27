import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChunkCipher } from "../../../src/adapters/crypto/chunk-cipher";
import { DEV_KEYRING } from "../../../src/adapters/crypto/dev-keyring";
import { createEnvelopeCipher, parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";
import { createLocalObjectStore } from "../../../src/adapters/fs/local-object-store";
import { createCaptureLogger } from "../../../src/adapters/logging/json-logger";
import { InMemoryRateLimiter } from "../../../src/adapters/memory/in-memory-rate-limiter";
import { SqliteChunkRepository } from "../../../src/adapters/sqlite/chunk-repository";
import { SqliteJobRepository } from "../../../src/adapters/sqlite/job-repository";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { SqliteSettingsRepository } from "../../../src/adapters/sqlite/settings-repository";
import { createFakeTranscriber } from "../../../src/adapters/stt/fake-transcriber";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { runDueJobs, type RunnerDeps } from "../../../src/app/jobs/runner";
import { retryMeetingProcessing, stopMeetingCapture } from "../../../src/app/meetings/capture";
import { createChunkStore } from "../../../src/app/storage/chunk-store";
import {
  retentionJobHandler,
  scheduleRetentionJobs,
} from "../../../src/app/transcription/retention";
import {
  transcribeJobHandler,
  type TranscribeDeps,
} from "../../../src/app/transcription/transcribe-job";
import { uploadChunk } from "../../../src/app/transcription/upload-chunk";
import { segmentTextContext } from "../../../src/domain/transcription/encryption-context";
import { count, consentedMeeting, freshDb, insert, owner, T0 } from "../../support/db-fixtures";

const chunkKey = parseKeyring(`k1:${Buffer.alloc(32, 1).toString("base64")}`);
const textCipher = createEnvelopeCipher(parseKeyring(DEV_KEYRING.spec), DEV_KEYRING.activeKeyId);
const audio = (n: number) => new TextEncoder().encode(`audio-bytes-private-${String(n)}`);

let db: DatabaseSync;
let root: string;
let objects: ReturnType<typeof createLocalObjectStore>;
let clock: FixedClock;
let fake: ReturnType<typeof createFakeTranscriber>;
let logger: ReturnType<typeof createCaptureLogger>;
let meetings: SqliteMeetingRepository;
let chunks: SqliteChunkRepository;
let jobs: SqliteJobRepository;
let chunkStore: ReturnType<typeof createChunkStore>;
let transcribe: TranscribeDeps;
let runner: RunnerDeps;

const handlers = () => [transcribeJobHandler(transcribe)];

beforeEach(() => {
  db = freshDb();
  root = mkdtempSync(join(tmpdir(), "willy-job-"));
  objects = createLocalObjectStore(root);
  clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  fake = createFakeTranscriber();
  logger = createCaptureLogger();
  const ids = new SequentialIds("id");
  meetings = new SqliteMeetingRepository(db, ids, clock);
  chunks = new SqliteChunkRepository(db);
  jobs = new SqliteJobRepository(db, ids);
  chunkStore = createChunkStore({ objects, cipher: createChunkCipher(chunkKey, "k1") });
  transcribe = {
    meetings,
    chunks,
    chunkStore,
    transcriber: fake,
    textCipher,
    settings: new SqliteSettingsRepository(db),
    jobs,
    ids: new SequentialIds("seg"),
    clock,
    logger,
  };
  runner = { jobs, clock, logger, random: () => 0, leaseMs: 5 * 60_000 };
  owner(db, "A");
  owner(db, "B");
  consentedMeeting(db, "A", "m1", { rough_notes: "Rough notes that must never be lost" });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function capture(ownerId: string, meetingId: string, n: number): Promise<void> {
  const deps = {
    meetings,
    chunks,
    chunkStore,
    ids: new SequentialIds(`up-${meetingId}`),
    limiter: new InMemoryRateLimiter(clock),
    clock,
  };
  for (let seq = 0; seq < n; seq++) {
    const r = await uploadChunk(deps, ownerId, meetingId, {
      seq,
      audio: audio(seq),
      contentType: "audio/webm",
      durationMs: 10_000,
    });
    if (!r.ok) throw new Error(`upload failed: ${JSON.stringify(r.error)}`);
  }
}

const meetingDeps = () => ({ meetings, clock });
const stop = (ownerId = "A", id = "m1") => stopMeetingCapture(meetingDeps(), ownerId, id);
const chunkStates = (id = "m1") =>
  db.prepare("SELECT seq, state FROM audio_chunk WHERE meeting_id = ? ORDER BY seq").all(id);
const segments = (id = "m1") =>
  db
    .prepare(
      "SELECT id, chunk_seq, seg_index, position, speaker_label, text_ciphertext, text_key_id FROM transcript_segment WHERE meeting_id = ? ORDER BY position",
    )
    .all(id);
const job = (key = "transcribe:m1") => db.prepare("SELECT * FROM job WHERE job_key = ?").get(key);
const meetingStatus = (id = "m1") =>
  db.prepare("SELECT status FROM meeting WHERE id = ?").get(id)?.["status"];
const run = () => runDueJobs(runner, handlers());

describe("transcription job: happy path", () => {
  it("transcribes every chunk, stores encrypted segments in order, purges raw audio and queues the summary once", async () => {
    await capture("A", "m1", 3);
    await stop();
    await run();

    const rows = segments();
    expect(rows.map((r) => [r["chunk_seq"], r["seg_index"], r["position"]])).toEqual([
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 10000],
      [1, 1, 10001],
      [2, 0, 20000],
      [2, 1, 20001],
    ]);
    for (const r of rows) {
      const plain = await textCipher.decrypt(
        String(r["text_ciphertext"]),
        segmentTextContext(String(r["id"])),
      );
      expect(plain).toMatch(/^Fake transcript for m1:\d, part [12]\.$/);
      expect(String(r["text_ciphertext"])).not.toContain("Fake transcript");
      expect(r["text_key_id"]).toBe(DEV_KEYRING.activeKeyId);
    }
    expect(rows.map((r) => r["speaker_label"])).toEqual([
      "Speaker 1",
      "Speaker 2",
      "Speaker 1",
      "Speaker 2",
      "Speaker 1",
      "Speaker 2",
    ]);

    expect(chunkStates()).toEqual([
      { seq: 0, state: "purged" },
      { seq: 1, state: "purged" },
      { seq: 2, state: "purged" },
    ]);
    expect(await objects.deleteByPrefix("owner/A/meeting/m1/")).toEqual({
      ok: true,
      value: { deleted: 0 },
    });
    expect(
      db
        .prepare("SELECT object_key FROM audio_chunk")
        .all()
        .every((r) => r["object_key"] === null),
    ).toBe(true);

    expect(job()).toMatchObject({ status: "succeeded", attempts: 1, last_error_code: null });
    expect(
      db.prepare("SELECT job_key, kind, status, owner_id FROM job WHERE kind = 'summarize'").all(),
    ).toEqual([{ job_key: "summarize:m1:1", kind: "summarize", status: "pending", owner_id: "A" }]);
    expect(db.prepare("SELECT rough_notes FROM meeting WHERE id = 'm1'").get()).toEqual({
      rough_notes: "Rough notes that must never be lost",
    });
  });

  it("sends the transcriber a stable chunk id and the decrypted audio", async () => {
    await capture("A", "m1", 2);
    await stop();
    await run();
    expect(fake.calls.map((c) => c.chunkId)).toEqual(["m1:0", "m1:1"]);
    expect(fake.calls.every((c) => c.contentType === "audio/webm" && c.bytes > 0)).toBe(true);
  });
});

describe("acceptance scenario 2: partial failure, notes survive, retry resumes, no duplicates", () => {
  it("keeps the rough notes and finished chunks, retries only the failed chunk and creates no duplicate segments", async () => {
    await capture("A", "m1", 3);
    await stop();
    fake.script.failOnChunk("m1:1", "unavailable", 1);

    await run();
    expect(job()).toMatchObject({
      status: "retrying",
      attempts: 1,
      last_error_code: "stt_unavailable",
    });
    expect(String(job()?.["next_run_at"]) > "2026-10-27T10:00:00.000Z").toBe(true);
    expect(meetingStatus()).toBe("processing");
    expect(chunkStates()).toEqual([
      { seq: 0, state: "purged" },
      { seq: 1, state: "failed" },
      { seq: 2, state: "purged" },
    ]);
    // Raw audio is gone only for chunks that succeeded; the failed one is kept for the retry.
    expect(db.prepare("SELECT seq, object_key FROM audio_chunk ORDER BY seq").all()).toEqual([
      { seq: 0, object_key: null },
      { seq: 1, object_key: "owner/A/meeting/m1/chunk-1" },
      { seq: 2, object_key: null },
    ]);
    expect(segments().map((s) => s["chunk_seq"])).toEqual([0, 0, 2, 2]);
    expect(db.prepare("SELECT rough_notes FROM meeting WHERE id='m1'").get()).toEqual({
      rough_notes: "Rough notes that must never be lost",
    });
    expect(count(db, "job", "kind = 'summarize'")).toBe(0);

    // Not yet due: nothing happens.
    await run();
    expect(fake.calls.filter((c) => c.chunkId === "m1:1")).toHaveLength(1);

    // Due: only the failed chunk is attempted again; finished chunks are not transcribed twice.
    clock.advance(10 * 60_000);
    await run();
    expect(fake.calls.map((c) => c.chunkId)).toEqual(["m1:0", "m1:1", "m1:2", "m1:1"]);
    expect(segments().map((s) => [s["chunk_seq"], s["seg_index"]])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
    ]);
    expect(chunkStates().every((c) => c["state"] === "purged")).toBe(true);
    expect(job()).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(count(db, "job", "kind = 'summarize'")).toBe(1);
  });

  it("backs off with capped exponential delay between attempts", async () => {
    await capture("A", "m1", 1);
    await stop();
    db.prepare("UPDATE job SET max_attempts = 3").run();
    fake.script.failOnChunk("m1:0", "timeout", 10);
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      await run();
      const delay = Date.parse(String(job()?.["next_run_at"])) - clock.now().getTime();
      delays.push(delay);
      clock.advance(delay);
    }
    // random() = 0 gives the minimum of the equal-jitter window: base/2, base, 2*base ...
    expect(delays).toEqual([2_500, 5_000]);
    await run();
    expect(job()).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("fails the job and the meeting after the last attempt, keeping what was transcribed", async () => {
    await capture("A", "m1", 2);
    await stop();
    db.prepare("UPDATE job SET max_attempts = 2").run();
    fake.script.failOnChunk("m1:1", "unavailable", 10);
    await run();
    clock.advance(10 * 60_000);
    await run();
    expect(job()).toMatchObject({
      status: "failed",
      attempts: 2,
      last_error_code: "stt_unavailable",
    });
    expect(meetingStatus()).toBe("failed");
    expect(segments().map((s) => s["chunk_seq"])).toEqual([0, 0]);
    expect(
      db
        .prepare(
          "SELECT actor, detail_json FROM audit_event WHERE meeting_id='m1' ORDER BY id DESC LIMIT 1",
        )
        .get(),
    ).toMatchObject({
      actor: "system",
    });
  });

  it("a permanent rejection fails fast, then the owner's retry resumes only that chunk", async () => {
    await capture("A", "m1", 3);
    await stop();
    fake.script.failOnChunk("m1:1", "rejected", 1);
    await run();
    expect(job()).toMatchObject({ status: "failed", attempts: 1, last_error_code: "stt_rejected" });
    expect(meetingStatus()).toBe("failed");
    expect(segments().map((s) => s["chunk_seq"])).toEqual([0, 0, 2, 2]);

    expect((await retryMeetingProcessing(meetingDeps(), "A", "m1")).ok).toBe(true);
    expect(meetingStatus()).toBe("processing");
    expect(job()).toMatchObject({ status: "pending", attempts: 0 });
    await run();
    expect(job()).toMatchObject({ status: "succeeded" });
    expect(segments()).toHaveLength(6);
    expect(count(db, "job", "kind = 'summarize'")).toBe(1);
  });
});

describe("idempotency and concurrency", () => {
  it("replaying a finished job changes nothing", async () => {
    await capture("A", "m1", 2);
    await stop();
    await run();
    const before = JSON.stringify(segments());
    db.prepare(
      "UPDATE job SET status = 'pending', next_run_at = NULL, attempts = 0 WHERE job_key = 'transcribe:m1'",
    ).run();
    const callsBefore = fake.calls.length;
    await run();
    expect(JSON.stringify(segments())).toBe(before);
    expect(fake.calls).toHaveLength(callsBefore);
    expect(count(db, "job", "kind = 'summarize'")).toBe(1);
  });

  it("two runners at once transcribe each chunk once", async () => {
    await capture("A", "m1", 3);
    await stop();
    await Promise.all([run(), run()]);
    expect(fake.calls).toHaveLength(3);
    expect(segments()).toHaveLength(6);
  });

  it("recovers a job stuck in running after a crash, but leaves a fresh one alone", async () => {
    await capture("A", "m1", 1);
    await stop();
    db.prepare("UPDATE job SET status = 'running', attempts = 1, updated_at = ?").run(
      "2026-10-27T10:00:00.000Z",
    );
    await run();
    expect(fake.calls).toHaveLength(0);
    expect(job()).toMatchObject({ status: "running" });
    clock.advance(6 * 60_000);
    await run();
    expect(job()).toMatchObject({ status: "succeeded", attempts: 2 });
  });

  it("does nothing for a meeting that is no longer processing or is being deleted", async () => {
    await capture("A", "m1", 1);
    await stop();
    db.prepare("UPDATE meeting SET status = 'deleting' WHERE id = 'm1'").run();
    await run();
    expect(fake.calls).toHaveLength(0);
    expect(segments()).toHaveLength(0);
    expect(job()).toMatchObject({ status: "succeeded" });
  });

  it("leaves job kinds without a handler pending for their owners to implement", async () => {
    insert(db, "job", {
      id: "j-sum",
      owner_id: "A",
      meeting_id: "m1",
      kind: "summarize",
      job_key: "summarize:m1:1",
      status: "pending",
      attempts: 0,
      max_attempts: 5,
      created_at: T0,
      updated_at: T0,
    });
    await run();
    expect(db.prepare("SELECT status FROM job WHERE id = 'j-sum'").get()).toEqual({
      status: "pending",
    });
  });

  it("never touches another owner's chunks", async () => {
    consentedMeeting(db, "B", "mB");
    await capture("B", "mB", 2);
    await capture("A", "m1", 1);
    await stop();
    await run();
    expect(chunkStates("mB")).toEqual([
      { seq: 0, state: "uploaded" },
      { seq: 1, state: "uploaded" },
    ]);
    expect(segments("mB")).toHaveLength(0);
  });

  it("turns an unexpected exception into a logged retry without leaking content", async () => {
    await capture("A", "m1", 1);
    await stop();
    transcribe.transcriber = {
      transcribe: () => {
        throw new Error("boom with Fake transcript text");
      },
    };
    await run();
    expect(job()).toMatchObject({ status: "retrying", last_error_code: "internal_error" });
    const entry = logger.entries.find((e) => e.event === "job.crashed");
    expect(entry).toBeDefined();
    expect(JSON.stringify(logger.entries)).not.toContain("Fake transcript");
  });
});

describe("logs and states", () => {
  it("logs job and meeting ids, attempt, chunk counts and outcome, never audio or text", async () => {
    await capture("A", "m1", 2);
    await stop();
    fake.script.failOnChunk("m1:1", "unavailable", 1);
    await run();
    const events = logger.entries.map((e) => e.event);
    expect(events).toContain("job.started");
    expect(events).toContain("job.chunk_failed");
    expect(events).toContain("job.retry_scheduled");
    const failed = logger.entries.find((e) => e.event === "job.chunk_failed");
    expect(failed).toMatchObject({ meetingId: "m1", chunkSeq: 1, errorCode: "stt_unavailable" });
    expect(failed?.["jobId"]).toBeTruthy();
    const dump = JSON.stringify(logger.entries);
    expect(dump).not.toMatch(/Fake transcript|audio-bytes-private|RIFF/);
  });
});

describe("raw audio retention", () => {
  it("keeps audio for the configured hours after transcription, then purges it", async () => {
    insert(db, "settings", { owner_id: "A", raw_audio_retention_hours: 24, updated_at: T0 });
    await capture("A", "m1", 2);
    await stop();
    await run();
    expect(chunkStates()).toEqual([
      { seq: 0, state: "transcribed" },
      { seq: 1, state: "transcribed" },
    ]);
    expect((await objects.get("owner/A/meeting/m1/chunk-0")).ok).toBe(true);

    const retention = retentionJobHandler({ chunks, chunkStore, clock, logger });
    const tick = async () => {
      await scheduleRetentionJobs({ chunks, jobs, clock });
      await runDueJobs(runner, [retention]);
    };
    clock.advance(23 * 3_600_000);
    await tick();
    expect(chunkStates().every((c) => c["state"] === "transcribed")).toBe(true);

    clock.advance(2 * 3_600_000);
    await tick();
    expect(chunkStates().every((c) => c["state"] === "purged")).toBe(true);
    expect(await objects.deleteByPrefix("owner/A/meeting/m1/")).toEqual({
      ok: true,
      value: { deleted: 0 },
    });

    await tick();
    expect(chunkStates().every((c) => c["state"] === "purged")).toBe(true);
  });

  it("still succeeds when purging fails, and a later retention run removes the audio", async () => {
    await capture("A", "m1", 1);
    await stop();
    // Calls: get(chunk) in the handler succeeds; make the delete fail.
    const original = objects.delete.bind(objects);
    let failDelete = true;
    objects.delete = async (key) => {
      if (failDelete) {
        failDelete = false;
        return { ok: false, error: { kind: "unavailable", retryable: true, message: "x" } };
      }
      return original(key);
    };
    await run();
    expect(job()).toMatchObject({ status: "succeeded" });
    expect(chunkStates()).toEqual([{ seq: 0, state: "transcribed" }]);
    const retention = retentionJobHandler({ chunks, chunkStore, clock, logger });
    clock.advance(1_000);
    await scheduleRetentionJobs({ chunks, jobs, clock });
    await runDueJobs(runner, [retention]);
    expect(chunkStates()).toEqual([{ seq: 0, state: "purged" }]);
  });
});
