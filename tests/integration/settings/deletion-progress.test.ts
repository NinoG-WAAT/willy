import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteDeletionStatusQuery } from "../../../src/adapters/sqlite/deletion-status-query";
import { getDeletionProgress } from "../../../src/app/settings/deletion-progress";
import { T0, T1, freshDb, insert, meeting, owner } from "../../support/db-fixtures";

let db: DatabaseSync;
let query: SqliteDeletionStatusQuery;

beforeEach(() => {
  db = freshDb();
  query = new SqliteDeletionStatusQuery(db);
  owner(db, "A");
  owner(db, "B");
});

function deletion(ownerId: string, meetingId: string, extra: Record<string, string | number | null>) {
  meeting(db, ownerId, meetingId, {
    status: "deleting",
    title: `Secret title of ${meetingId}`,
  });
  insert(db, "job", {
    id: `job-${meetingId}`,
    owner_id: ownerId,
    meeting_id: meetingId,
    kind: "delete",
    job_key: `delete:${meetingId}`,
    status: "pending",
    attempts: 0,
    max_attempts: 5,
    created_at: T0,
    updated_at: T0,
    ...extra,
  });
}

describe("getDeletionProgress (what the settings screen polls)", () => {
  it("lists the owner's deletions with state and counters only", async () => {
    deletion("A", "m-a1", {
      status: "retrying",
      attempts: 2,
      next_run_at: "2026-10-27T11:00:00.000Z",
      last_error_code: "storage_unavailable",
      updated_at: T1,
    });
    expect(await getDeletionProgress({ deletions: query }, "A")).toEqual([
      {
        meetingId: "m-a1",
        status: "retrying",
        attempts: 2,
        maxAttempts: 5,
        nextRunAt: "2026-10-27T11:00:00.000Z",
        lastErrorCode: "storage_unavailable",
      },
    ]);
  });

  it("never shows another owner's deletions, and carries no titles or content", async () => {
    deletion("A", "m-a1", {});
    deletion("B", "m-b1", { status: "running" });
    const forA = await getDeletionProgress({ deletions: query }, "A");
    const forB = await getDeletionProgress({ deletions: query }, "B");
    expect(forA.map((r) => r.meetingId)).toEqual(["m-a1"]);
    expect(forB.map((r) => r.meetingId)).toEqual(["m-b1"]);
    expect(JSON.stringify([forA, forB])).not.toMatch(/Secret title|@example/);
  });

  it("is empty for an owner with no deletions or an unknown owner id", async () => {
    deletion("A", "m-a1", {});
    expect(await getDeletionProgress({ deletions: query }, "nobody")).toEqual([]);
  });

  it("ignores other kinds of jobs", async () => {
    meeting(db, "A", "m-t", { status: "processing" });
    insert(db, "job", {
      id: "job-t",
      owner_id: "A",
      meeting_id: "m-t",
      kind: "transcribe",
      job_key: "transcribe:m-t",
      status: "running",
      attempts: 1,
      max_attempts: 5,
      created_at: T0,
      updated_at: T0,
    });
    expect(await getDeletionProgress({ deletions: query }, "A")).toEqual([]);
  });
});
