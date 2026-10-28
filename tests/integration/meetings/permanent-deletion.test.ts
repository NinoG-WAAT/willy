import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChunkCipher } from "../../../src/adapters/crypto/chunk-cipher";
import { createFileTokenService } from "../../../src/adapters/crypto/file-tokens";
import { createLocalObjectStore } from "../../../src/adapters/fs/local-object-store";
import { createCaptureLogger } from "../../../src/adapters/logging/json-logger";
import { InMemoryRateLimiter } from "../../../src/adapters/memory/in-memory-rate-limiter";
import { parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";
import { SqliteChunkRepository } from "../../../src/adapters/sqlite/chunk-repository";
import { SqliteJobRepository } from "../../../src/adapters/sqlite/job-repository";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { SqliteNoteRepository } from "../../../src/adapters/sqlite/note-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { runDueJobs, type RunnerDeps } from "../../../src/app/jobs/runner";
import { requestMeetingDeletion } from "../../../src/app/meetings/delete";
import { deleteJobHandler, type DeleteDeps } from "../../../src/app/meetings/delete-job";
import { requestSectionRegeneration } from "../../../src/app/notes/regenerate-section";
import { createChunkStore } from "../../../src/app/storage/chunk-store";
import { getProcessingStatus } from "../../../src/app/transcription/processing-status";
import { uploadChunk } from "../../../src/app/transcription/upload-chunk";
import {
  T0,
  attendee,
  chunk,
  consentedMeeting,
  count,
  folder,
  freshDb,
  insert,
  meeting,
  note,
  owner,
  segment,
} from "../../support/db-fixtures";

const keyring = parseKeyring(`k1:${Buffer.alloc(32, 1).toString("base64")}`);
const audio = new TextEncoder().encode("RIFF-private-audio");

let db: DatabaseSync;
let root: string;
let objects: ReturnType<typeof createLocalObjectStore>;
let clock: FixedClock;
let logger: ReturnType<typeof createCaptureLogger>;
let meetings: SqliteMeetingRepository;
let jobs: SqliteJobRepository;
let chunkStore: ReturnType<typeof createChunkStore>;
let deleteDeps: DeleteDeps;
let runner: RunnerDeps;

beforeEach(async () => {
  db = freshDb();
  root = mkdtempSync(join(tmpdir(), "willy-delete-"));
  objects = createLocalObjectStore(root);
  clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  logger = createCaptureLogger();
  const ids = new SequentialIds("id");
  meetings = new SqliteMeetingRepository(db, ids, clock);
  jobs = new SqliteJobRepository(db, ids);
  chunkStore = createChunkStore({ objects, cipher: createChunkCipher(keyring, "k1") });
  deleteDeps = { meetings, chunkStore, clock, logger };
  runner = { jobs, clock, logger, random: () => 0, leaseMs: 5 * 60_000 };
  owner(db, "A");
  owner(db, "B");
  await fullMeeting("A", "m1");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A finished, published meeting with everything that must disappear. */
async function fullMeeting(ownerId: string, id: string): Promise<void> {
  folder(db, ownerId, `f-${id}`);
  consentedMeeting(db, ownerId, id, {
    status: "published",
    title: `Secret title ${id}`,
    agenda: "Secret agenda",
    rough_notes: "Secret rough notes",
    calendar_provider: "google",
    provider_event_id: `evt-${id}`,
  });
  attendee(db, ownerId, id, `${id}-att`, { name: "Grace Hopper", email: "grace@example.test" });
  for (const seq of [0, 1]) {
    chunk(db, ownerId, id, seq, { state: "transcribed" });
    expect(
      (await chunkStore.putChunk(ownerId, id, { seq, audio, contentType: "audio/webm" })).ok,
    ).toBe(true);
    segment(db, ownerId, id, seq, 0, { id: `${id}-seg-${String(seq)}`, text_ciphertext: "v1.x" });
  }
  note(db, ownerId, id, `${id}-note`, {
    status: "published",
    published_at: T0,
    folder_id: `f-${id}`,
  });
  insert(db, "note_section", {
    id: `${id}-sec`,
    owner_id: ownerId,
    note_id: `${id}-note`,
    position: 0,
    heading: "Summary",
    body: "Secret summary",
    source_from: 0,
    source_to: 1,
    created_at: T0,
    updated_at: T0,
  });
  insert(db, "decision", {
    id: `${id}-dec`,
    owner_id: ownerId,
    note_id: `${id}-note`,
    position: 0,
    text: "Secret decision",
    created_at: T0,
    updated_at: T0,
  });
  insert(db, "action_item", {
    id: `${id}-act`,
    owner_id: ownerId,
    meeting_id: id,
    note_id: `${id}-note`,
    position: 0,
    text: "Secret task",
    assignee_attendee_id: `${id}-att`,
    status: "open",
    created_at: T0,
    updated_at: T0,
  });
  for (const [kind, ref, title, body] of [
    ["meeting", id, `Secret title ${id}`, "Secret rough notes"],
    ["note_section", `${id}-sec`, "Summary", "Secret summary"],
  ] as const) {
    insert(db, "search_index", {
      title,
      body,
      owner_id: ownerId,
      meeting_id: id,
      kind,
      ref_id: ref,
    });
  }
  insert(db, "audit_event", {
    id: `${id}-aud`,
    owner_id: ownerId,
    meeting_id: id,
    kind: "meeting.consent_confirmed",
    actor: "owner",
    detail_json: "{}",
    occurred_at: T0,
  });
  insert(db, "job", {
    id: `${id}-job-t`,
    owner_id: ownerId,
    meeting_id: id,
    kind: "transcribe",
    job_key: `transcribe:${id}`,
    status: "succeeded",
    attempts: 1,
    max_attempts: 5,
    created_at: T0,
    updated_at: T0,
  });
}

const requestDelete = (ownerId = "A", id = "m1") =>
  requestMeetingDeletion({ meetings, clock }, ownerId, id);
const run = () => runDueJobs(runner, [deleteJobHandler(deleteDeps)]);
const meetingRow = (id = "m1") => db.prepare("SELECT * FROM meeting WHERE id = ?").get(id);
const deleteJob = (id = "m1") =>
  db.prepare("SELECT * FROM job WHERE job_key = ?").get(`delete:${id}`);
const objectCount = async (id = "m1", ownerId = "A") => {
  const r = await objects.get(`owner/${ownerId}/meeting/${id}/chunk-0`);
  const r1 = await objects.get(`owner/${ownerId}/meeting/${id}/chunk-1`);
  return [r, r1].filter((x) => x.ok && x.value !== null).length;
};

describe("step 1: marking the meeting deleting hides it at once", () => {
  it("moves the meeting to deleting, queues exactly one delete job and purges search hits immediately", async () => {
    expect((await requestDelete()).ok).toBe(true);
    expect(meetingRow()).toMatchObject({ status: "deleting" });
    expect(count(db, "job", "kind = 'delete'")).toBe(1);
    expect(deleteJob()).toMatchObject({ status: "pending", owner_id: "A", meeting_id: "m1" });
    expect(count(db, "search_index", "meeting_id = 'm1'")).toBe(0);
    // Nothing has been physically removed yet.
    expect(count(db, "note")).toBe(1);
    expect(await objectCount()).toBe(2);
  });

  it("is a 404 on every surface straight away, for the owner and for guessed ids", async () => {
    await requestDelete();
    const status = await getProcessingStatus(
      { meetings, chunks: new SqliteChunkRepository(db), jobs },
      "A",
      "m1",
    );
    expect(status).toEqual({ ok: false, error: { kind: "not_found" } });
    const regen = await requestSectionRegeneration(
      { meetings, notes: new SqliteNoteRepository(db, new SequentialIds("n")), jobs, clock },
      "A",
      "m1",
      "m1-sec",
    );
    expect(regen).toEqual({ ok: false, error: { kind: "not_found" } });
    const upload = await uploadChunk(
      {
        meetings,
        chunks: new SqliteChunkRepository(db),
        chunkStore,
        ids: new SequentialIds("c"),
        limiter: new InMemoryRateLimiter(clock),
        clock,
      },
      "A",
      "m1",
      { seq: 5, audio, contentType: "audio/webm", durationMs: 1000 },
    );
    expect(upload).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("repeating the request changes nothing and never queues a second job", async () => {
    await requestDelete();
    expect(await requestDelete()).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(count(db, "job", "kind = 'delete'")).toBe(1);
  });

  it("another owner cannot delete it, and unknown ids look the same", async () => {
    expect(await requestDelete("B", "m1")).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(await requestDelete("A", "nope")).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(meetingRow()).toMatchObject({ status: "published" });
    expect(count(db, "job", "kind = 'delete'")).toBe(0);
  });

  it("can be requested from any live status", async () => {
    for (const status of ["scheduled", "capturing", "paused", "processing", "review", "failed"]) {
      if (status === "scheduled") meeting(db, "A", `x-${status}`);
      else consentedMeeting(db, "A", `x-${status}`, { status });
      expect((await requestDelete("A", `x-${status}`)).ok, status).toBe(true);
    }
  });
});

describe("step 2: the deletion job removes files, indexes and rows", () => {
  it("leaves nothing of the meeting, its transcript, note, audio or search entries (acceptance scenario 3)", async () => {
    await requestDelete();
    await run();

    expect(await objectCount()).toBe(0);
    for (const table of [
      "attendee",
      "audio_chunk",
      "transcript_segment",
      "note",
      "note_section",
      "decision",
      "action_item",
    ]) {
      expect(count(db, table, "owner_id = 'A'"), table).toBe(0);
    }
    expect(count(db, "search_index", "meeting_id = 'm1'")).toBe(0);
    expect(meetingRow()).toMatchObject({
      status: "deleted",
      title: "",
      agenda: null,
      rough_notes: null,
      calendar_provider: null,
      provider_event_id: null,
      template_id: null,
    });
    expect(String(meetingRow()?.["deleted_at"])).toBe("2026-10-27T10:00:00.000Z");
    expect(deleteJob()).toMatchObject({ status: "succeeded" });
  });

  it("keeps a minimal audit record that holds no content", async () => {
    await requestDelete();
    await run();
    const events = db
      .prepare(
        "SELECT kind, actor, detail_json FROM audit_event WHERE meeting_id = 'm1' ORDER BY occurred_at, id",
      )
      .all();
    expect(events.map((e) => e["kind"])).toEqual([
      "meeting.consent_confirmed",
      "meeting.status_changed",
      "meeting.status_changed",
    ]);
    expect(events.slice(1).map((e) => e["actor"])).toEqual(["owner", "system"]);
    expect(JSON.stringify(events)).not.toMatch(/Secret|Grace|grace@/);
    expect(count(db, "meeting", "id = 'm1'")).toBe(1);
  });

  it("the stored audio and any guessed signed URL no longer resolve", async () => {
    const tokens = createFileTokenService({
      secret: "a-long-random-secret-for-tests-only",
      clock,
    });
    const token = await tokens.mint({ ownerId: "A", objectKey: "owner/A/meeting/m1/chunk-0" }, 300);
    await requestDelete();
    await run();
    const claims = await tokens.verify(token);
    expect(claims.ok).toBe(true);
    expect(await chunkStore.getChunk("A", "m1", 0)).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });

  it("stays a 404 after completion", async () => {
    await requestDelete();
    await run();
    const status = await getProcessingStatus(
      { meetings, chunks: new SqliteChunkRepository(db), jobs },
      "A",
      "m1",
    );
    expect(status).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("does not touch other meetings, other owners or lookalike ids", async () => {
    await fullMeeting("A", "m10");
    await fullMeeting("B", "m1b");
    await requestDelete();
    await run();
    for (const [o, id] of [
      ["A", "m10"],
      ["B", "m1b"],
    ] as const) {
      expect(meetingRow(id)).toMatchObject({ status: "published" });
      expect(await objectCount(id, o)).toBe(2);
      expect(count(db, "note", `meeting_id = '${id}'`)).toBe(1);
      expect(count(db, "search_index", `meeting_id = '${id}'`)).toBe(2);
    }
  });

  it("frees the calendar event so it can be imported again", async () => {
    await requestDelete();
    await run();
    expect(() =>
      meeting(db, "A", "reimport", { calendar_provider: "google", provider_event_id: "evt-m1" }),
    ).not.toThrow();
  });

  it("is idempotent: running the job again after completion is a quiet no-op", async () => {
    await requestDelete();
    await run();
    db.prepare(
      "UPDATE job SET status = 'pending', attempts = 0, next_run_at = NULL WHERE kind = 'delete'",
    ).run();
    await run();
    expect(deleteJob()).toMatchObject({ status: "succeeded" });
    expect(meetingRow()).toMatchObject({ status: "deleted" });
    expect(count(db, "audit_event", "meeting_id = 'm1'")).toBe(3);
  });

  it("skips jobs that are not for a meeting being deleted", async () => {
    insert(db, "job", {
      id: "stray",
      owner_id: "A",
      meeting_id: "m1",
      kind: "delete",
      job_key: "delete:m1",
      status: "pending",
      attempts: 0,
      max_attempts: 5,
      next_run_at: T0,
      created_at: T0,
      updated_at: T0,
    });
    await run();
    expect(meetingRow()).toMatchObject({ status: "published" });
    expect(await objectCount()).toBe(2);
  });
});

describe("failures are visible and retried until the deletion completes", () => {
  it("a storage failure keeps everything hidden, retries with backoff and then completes cleanly", async () => {
    await requestDelete();
    objects.script.failOnce("unavailable");
    await run();
    expect(deleteJob()).toMatchObject({
      status: "retrying",
      attempts: 1,
      last_error_code: "storage_unavailable",
    });
    expect(meetingRow()).toMatchObject({ status: "deleting" });
    expect(count(db, "note")).toBe(1);
    expect(logger.entries.some((e) => e.event === "job.retry_scheduled")).toBe(true);

    await run();
    expect(deleteJob()).toMatchObject({ status: "retrying" });
    clock.advance(10 * 60_000);
    await run();
    expect(deleteJob()).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(meetingRow()).toMatchObject({ status: "deleted" });
    expect(await objectCount()).toBe(0);
    expect(count(db, "note")).toBe(0);
  });

  it("finishes after a crash that happened between deleting files and deleting rows", async () => {
    await requestDelete();
    await objects.deleteByPrefix("owner/A/meeting/m1/");
    await run();
    expect(meetingRow()).toMatchObject({ status: "deleted" });
    expect(count(db, "audio_chunk")).toBe(0);
  });

  it("a permanent failure fails the job but the meeting stays hidden; a later requeue completes it", async () => {
    await requestDelete();
    db.prepare("UPDATE job SET max_attempts = 2").run();
    objects.script.failOnce("rejected");
    await run();
    expect(deleteJob()).toMatchObject({ status: "failed", last_error_code: "storage_rejected" });
    expect(meetingRow()).toMatchObject({ status: "deleting" });
    expect(await jobs.requeueFailed("A", "delete", clock.now())).toBe(1);
    await run();
    expect(meetingRow()).toMatchObject({ status: "deleted" });
  });

  it("never logs titles, notes or transcript text", async () => {
    await requestDelete();
    await run();
    expect(JSON.stringify(logger.entries)).not.toMatch(/Secret|Grace|grace@|RIFF/);
    expect(logger.entries.map((e) => e.event)).toContain("deletion.completed");
  });
});
