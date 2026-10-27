import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteChunkRepository } from "../../../src/adapters/sqlite/chunk-repository";
import { SqliteJobRepository } from "../../../src/adapters/sqlite/job-repository";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import {
  getProcessingStatus,
  type StatusDeps,
} from "../../../src/app/transcription/processing-status";
import {
  T0,
  chunk,
  consentedMeeting,
  freshDb,
  insert,
  meeting,
  owner,
} from "../../support/db-fixtures";

let db: DatabaseSync;
let deps: StatusDeps;

beforeEach(() => {
  db = freshDb();
  const clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  const ids = new SequentialIds("id");
  deps = {
    meetings: new SqliteMeetingRepository(db, ids, clock),
    chunks: new SqliteChunkRepository(db),
    jobs: new SqliteJobRepository(db, ids),
  };
  owner(db, "A");
  owner(db, "B");
});

const job = (over: Record<string, string | number | null>) =>
  insert(db, "job", {
    id: "j1",
    owner_id: "A",
    meeting_id: "m1",
    kind: "transcribe",
    job_key: "transcribe:m1",
    attempts: 0,
    max_attempts: 5,
    created_at: T0,
    updated_at: T0,
    ...over,
  });

describe("getProcessingStatus", () => {
  it("reports meeting status, transcription job state and chunk counts", async () => {
    consentedMeeting(db, "A", "m1", { status: "processing" });
    chunk(db, "A", "m1", 0, { state: "transcribed" });
    chunk(db, "A", "m1", 1, { state: "failed", last_error_code: "stt_unavailable" });
    chunk(db, "A", "m1", 2, { state: "purged", object_key: null, purged_at: T0 });
    chunk(db, "A", "m1", 3);
    job({
      status: "retrying",
      attempts: 2,
      next_run_at: "2026-10-27T10:05:00.000Z",
      last_error_code: "stt_unavailable",
    });
    expect(await getProcessingStatus(deps, "A", "m1")).toEqual({
      ok: true,
      value: {
        meetingStatus: "processing",
        job: {
          status: "retrying",
          attempts: 2,
          maxAttempts: 5,
          nextRunAt: "2026-10-27T10:05:00.000Z",
          lastErrorCode: "stt_unavailable",
        },
        chunks: { total: 4, uploaded: 1, transcribed: 1, failed: 1, purged: 1 },
      },
    });
  });

  it("has no job before capture stops, and zero counts for an empty meeting", async () => {
    meeting(db, "A", "m2");
    expect(await getProcessingStatus(deps, "A", "m2")).toEqual({
      ok: true,
      value: {
        meetingStatus: "scheduled",
        job: null,
        chunks: { total: 0, uploaded: 0, transcribed: 0, failed: 0, purged: 0 },
      },
    });
  });

  it("is not found for another owner, unknown ids and meetings being deleted", async () => {
    consentedMeeting(db, "A", "m1", { status: "processing" });
    meeting(db, "A", "gone", { status: "deleting" });
    for (const [o, id] of [
      ["B", "m1"],
      ["A", "nope"],
      ["A", "gone"],
    ] as const) {
      expect(await getProcessingStatus(deps, o, id)).toEqual({
        ok: false,
        error: { kind: "not_found" },
      });
    }
  });

  it("exposes only the redacted error code, never details", async () => {
    consentedMeeting(db, "A", "m1", { status: "failed" });
    job({ status: "failed", attempts: 5, last_error_code: "stt_rejected" });
    const result = await getProcessingStatus(deps, "A", "m1");
    expect(Object.keys(result.ok ? (result.value.job ?? {}) : {}).sort()).toEqual(
      ["attempts", "lastErrorCode", "maxAttempts", "nextRunAt", "status"].sort(),
    );
  });
});
