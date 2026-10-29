import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteJobRepository } from "../../../src/adapters/sqlite/job-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { runDueJobs, type JobHandler } from "../../../src/app/jobs/runner";
import type { Logger } from "../../../src/ports/logger";
import { T0, freshDb, insert, owner } from "../../support/db-fixtures";

// The dev/test "run due jobs" endpoint belongs to the signed-in owner. Without the scope one
// owner's run also executed everyone else's jobs, so a browser test that ran its own jobs could
// move another running test's meeting out of "processing" (flaky e2e, see #22).

const silent: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

let db: DatabaseSync;
let jobs: SqliteJobRepository;
let ran: string[];

const handler: JobHandler = {
  kind: "retention",
  run: (job) => {
    ran.push(job.id);
    return Promise.resolve({ kind: "succeeded" });
  },
};

const deps = (ownerId?: string) => ({
  jobs,
  clock: new FixedClock(new Date("2026-10-27T10:00:00.000Z")),
  logger: silent,
  random: () => 0.5,
  leaseMs: 60_000,
  ...(ownerId === undefined ? {} : { ownerId }),
});

const retentionJob = (id: string, ownerId: string) =>
  insert(db, "job", {
    id,
    owner_id: ownerId,
    meeting_id: null,
    kind: "retention",
    job_key: `retention:${id}`,
    status: "pending",
    attempts: 0,
    max_attempts: 5,
    created_at: T0,
    updated_at: T0,
  });

beforeEach(() => {
  db = freshDb();
  jobs = new SqliteJobRepository(db, new SequentialIds("id"));
  ran = [];
  owner(db, "A");
  owner(db, "B");
  retentionJob("job-a", "A");
  retentionJob("job-b", "B");
});

describe("runDueJobs scoped to one owner", () => {
  it("runs only that owner's jobs and leaves the other owner's job pending", async () => {
    expect(await runDueJobs(deps("A"), [handler])).toEqual({ ran: 1 });
    expect(ran).toEqual(["job-a"]);
    const left = db.prepare("SELECT id, status FROM job WHERE id = 'job-b'").get();
    expect(left).toMatchObject({ status: "pending" });
  });

  it("an unscoped run (the production runner) still takes every owner's jobs", async () => {
    expect(await runDueJobs(deps(), [handler])).toEqual({ ran: 2 });
    expect(ran.sort()).toEqual(["job-a", "job-b"]);
  });

  it("a scoped run for an owner with nothing due runs nothing", async () => {
    owner(db, "C");
    expect(await runDueJobs(deps("C"), [handler])).toEqual({ ran: 0 });
    expect(ran).toEqual([]);
  });
});
