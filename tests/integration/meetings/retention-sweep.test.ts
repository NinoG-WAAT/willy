import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChunkCipher } from "../../../src/adapters/crypto/chunk-cipher";
import { parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";
import { createLocalObjectStore } from "../../../src/adapters/fs/local-object-store";
import { createCaptureLogger } from "../../../src/adapters/logging/json-logger";
import { SqliteChunkRepository } from "../../../src/adapters/sqlite/chunk-repository";
import { SqliteJobRepository } from "../../../src/adapters/sqlite/job-repository";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { SqliteSettingsRepository } from "../../../src/adapters/sqlite/settings-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { runDueJobs, type RunnerDeps } from "../../../src/app/jobs/runner";
import { requestMeetingDeletion } from "../../../src/app/meetings/delete";
import { deleteJobHandler } from "../../../src/app/meetings/delete-job";
import { createChunkStore } from "../../../src/app/storage/chunk-store";
import {
  retentionJobHandler,
  scheduleRetentionJobs,
} from "../../../src/app/transcription/retention";
import {
  T0,
  consentedMeeting,
  count,
  freshDb,
  insert,
  meeting,
  owner,
} from "../../support/db-fixtures";

let db: DatabaseSync;
let root: string;
let clock: FixedClock;
let jobs: SqliteJobRepository;
let meetings: SqliteMeetingRepository;
let runner: RunnerDeps;
let tick: () => Promise<void>;

beforeEach(() => {
  db = freshDb();
  root = mkdtempSync(join(tmpdir(), "willy-sweep-"));
  clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  const ids = new SequentialIds("id");
  const logger = createCaptureLogger();
  meetings = new SqliteMeetingRepository(db, ids, clock);
  jobs = new SqliteJobRepository(db, ids);
  const chunks = new SqliteChunkRepository(db);
  const settings = new SqliteSettingsRepository(db);
  const chunkStore = createChunkStore({
    objects: createLocalObjectStore(root),
    cipher: createChunkCipher(parseKeyring(`k1:${Buffer.alloc(32, 1).toString("base64")}`), "k1"),
  });
  runner = { jobs, clock, logger, random: () => 0, leaseMs: 5 * 60_000 };
  const retention = retentionJobHandler({
    chunks,
    chunkStore,
    clock,
    logger,
    housekeeping: {
      meetings,
      requestDeletion: async (ownerId, meetingId) => {
        await requestMeetingDeletion({ meetings, clock }, ownerId, meetingId, "retention");
      },
      requeueFailedDeletions: (ownerId, now) => jobs.requeueFailed(ownerId, "delete", now),
    },
  });
  tick = async () => {
    await scheduleRetentionJobs({
      chunks,
      jobs,
      clock,
      extraOwners: async () => [
        ...(await settings.ownersWithNoteRetention()),
        ...(await jobs.ownersWithFailed("delete")),
      ],
    });
    await runDueJobs(runner, [
      retention,
      deleteJobHandler({ meetings, chunkStore, clock, logger }),
    ]);
  };
  owner(db, "A");
  owner(db, "B");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const daysAgo = (n: number) => new Date(clock.now().getTime() - n * 86_400_000).toISOString();
const status = (id: string) =>
  db.prepare("SELECT status FROM meeting WHERE id = ?").get(id)?.["status"];
const retention = (ownerId: string, days: number | null) =>
  insert(db, "settings", { owner_id: ownerId, note_retention_days: days, updated_at: T0 });

describe("note retention sweeper (off by default)", () => {
  it("does nothing when no retention period is set", async () => {
    consentedMeeting(db, "A", "old", { status: "published", scheduled_start_at: daysAgo(400) });
    await tick();
    expect(status("old")).toBe("published");
    expect(count(db, "job", "kind = 'delete'")).toBe(0);
  });

  it("deletes meetings older than the owner's retention period, through the normal two-step deletion", async () => {
    retention("A", 30);
    consentedMeeting(db, "A", "old", { status: "published", scheduled_start_at: daysAgo(31) });
    consentedMeeting(db, "A", "older-review", {
      status: "review",
      scheduled_start_at: daysAgo(90),
    });
    consentedMeeting(db, "A", "recent", { status: "published", scheduled_start_at: daysAgo(29) });
    await tick();
    expect(status("old")).toBe("deleted");
    expect(status("older-review")).toBe("deleted");
    expect(status("recent")).toBe("published");
    expect(
      db
        .prepare("SELECT actor, detail_json FROM audit_event WHERE meeting_id = 'old' ORDER BY id")
        .all(),
    ).toEqual([
      {
        actor: "system",
        detail_json: JSON.stringify({ from: "published", to: "deleting", trigger: "retention" }),
      },
      { actor: "system", detail_json: JSON.stringify({ from: "deleting", to: "deleted" }) },
    ]);
  });

  it("never touches meetings that are in progress, already being deleted, or another owner's", async () => {
    retention("A", 30);
    for (const s of ["capturing", "paused", "processing"] as const) {
      consentedMeeting(db, "A", `live-${s}`, { status: s, scheduled_start_at: daysAgo(100) });
    }
    consentedMeeting(db, "B", "b-old", { status: "published", scheduled_start_at: daysAgo(100) });
    meeting(db, "A", "gone", { status: "deleting", scheduled_start_at: daysAgo(100) });
    await tick();
    for (const s of ["capturing", "paused", "processing"]) expect(status(`live-${s}`)).toBe(s);
    expect(status("b-old")).toBe("published");
    expect(count(db, "job", "kind = 'delete' AND meeting_id = 'gone'")).toBe(0);
  });

  it("honours each owner's own period", async () => {
    retention("A", 30);
    retention("B", 365);
    consentedMeeting(db, "A", "a", { status: "published", scheduled_start_at: daysAgo(60) });
    consentedMeeting(db, "B", "b", { status: "published", scheduled_start_at: daysAgo(60) });
    await tick();
    expect(status("a")).toBe("deleted");
    expect(status("b")).toBe("published");
  });
});

describe("stuck deletions are retried", () => {
  it("re-queues a failed deletion job during the hourly sweep so the meeting is eventually erased", async () => {
    consentedMeeting(db, "A", "m1", { status: "deleting" });
    insert(db, "job", {
      id: "j",
      owner_id: "A",
      meeting_id: "m1",
      kind: "delete",
      job_key: "delete:m1",
      status: "failed",
      attempts: 5,
      max_attempts: 5,
      last_error_code: "storage_unavailable",
      created_at: T0,
      updated_at: T0,
    });
    await tick();
    expect(status("m1")).toBe("deleted");
    expect(db.prepare("SELECT status FROM job WHERE id = 'j'").get()).toEqual({
      status: "succeeded",
    });
  });
});
