import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import {
  archiveMeetingCommand,
  confirmMeetingConsent,
  pauseMeetingCapture,
  resumeMeetingCapture,
  retryMeetingProcessing,
  startMeetingCapture,
  stopMeetingCapture,
  unarchiveMeetingCommand,
  type MeetingDeps,
} from "../../../src/app/meetings/capture";
import { stopCapture } from "../../../src/domain/meetings/lifecycle";
import { T0, count, freshDb, insert, meeting, owner } from "../../support/db-fixtures";

let db: DatabaseSync;
let clock: FixedClock;
let deps: MeetingDeps;
let repo: SqliteMeetingRepository;

beforeEach(() => {
  db = freshDb();
  clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  repo = new SqliteMeetingRepository(db, new SequentialIds("id"), clock);
  deps = { meetings: repo, clock };
  owner(db, "A");
  owner(db, "B");
  meeting(db, "A", "m1");
});

const status = (id = "m1") =>
  db.prepare("SELECT status FROM meeting WHERE id = ?").get(id)?.["status"];
const events = (id = "m1") =>
  db
    .prepare("SELECT kind, actor, detail_json FROM audit_event WHERE meeting_id = ? ORDER BY id")
    .all(id);
const jobs = (id = "m1") => db.prepare("SELECT * FROM job WHERE meeting_id = ?").all(id);

describe("acceptance scenario 1: consent gate and exactly one transcription job", () => {
  it("keeps capture disabled until consent is confirmed, then starts, then stop queues exactly one job", async () => {
    const blocked = await startMeetingCapture(deps, "A", "m1");
    expect(blocked).toEqual({ ok: false, error: { kind: "consent_required" } });
    expect(status()).toBe("scheduled");
    expect(count(db, "audit_event")).toBe(0);

    expect((await confirmMeetingConsent(deps, "A", "m1", { accepted: true })).ok).toBe(true);
    const row = db
      .prepare("SELECT consent_confirmed_at AS at, consent_statement_version AS v FROM meeting")
      .get();
    expect(row).toEqual({ at: "2026-10-27T10:00:00.000Z", v: 1 });

    expect((await startMeetingCapture(deps, "A", "m1")).ok).toBe(true);
    expect(status()).toBe("capturing");

    expect((await stopMeetingCapture(deps, "A", "m1")).ok).toBe(true);
    expect(status()).toBe("processing");
    const queued = jobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      kind: "transcribe",
      job_key: "transcribe:m1",
      status: "pending",
      attempts: 0,
      owner_id: "A",
    });
  });

  it("double-submit and retry of stop never queue a second job, even when two requests race", async () => {
    await confirmMeetingConsent(deps, "A", "m1", { accepted: true });
    await startMeetingCapture(deps, "A", "m1");
    const [a, b] = await Promise.all([
      stopMeetingCapture(deps, "A", "m1"),
      stopMeetingCapture(deps, "A", "m1"),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect((await stopMeetingCapture(deps, "A", "m1")).ok).toBe(true);
    expect(jobs()).toHaveLength(1);
    const stopEvents = events().filter((e) =>
      String(e["detail_json"]).includes('"to":"processing"'),
    );
    expect(stopEvents).toHaveLength(1);
  });

  it("stop from paused works and a resumed capture can be paused again", async () => {
    await confirmMeetingConsent(deps, "A", "m1", { accepted: true });
    await startMeetingCapture(deps, "A", "m1");
    await pauseMeetingCapture(deps, "A", "m1");
    expect(status()).toBe("paused");
    await resumeMeetingCapture(deps, "A", "m1");
    await pauseMeetingCapture(deps, "A", "m1");
    expect((await stopMeetingCapture(deps, "A", "m1")).ok).toBe(true);
    expect(jobs()).toHaveLength(1);
  });
});

describe("audit trail", () => {
  it("appends one immutable event per change, in order, with the injected clock", async () => {
    await confirmMeetingConsent(deps, "A", "m1", { accepted: true });
    await confirmMeetingConsent(deps, "A", "m1", { accepted: true });
    clock.advance(5000);
    await startMeetingCapture(deps, "A", "m1");
    const rows = db.prepare("SELECT kind, actor, occurred_at FROM audit_event ORDER BY id").all();
    expect(rows).toEqual([
      {
        kind: "meeting.consent_confirmed",
        actor: "owner",
        occurred_at: "2026-10-27T10:00:00.000Z",
      },
      { kind: "meeting.status_changed", actor: "owner", occurred_at: "2026-10-27T10:00:05.000Z" },
    ]);
    expect(() => db.prepare("DELETE FROM audit_event").run()).toThrow(/append-only/);
  });
});

describe("failure, retry and archive flows", () => {
  it("re-queues the failed transcription job on retry instead of creating another", async () => {
    meeting(db, "A", "m2", {
      status: "failed",
      consent_confirmed_at: T0,
      consent_statement_version: 1,
    });
    insert(db, "job", {
      id: "j-old",
      owner_id: "A",
      meeting_id: "m2",
      kind: "transcribe",
      job_key: "transcribe:m2",
      status: "failed",
      attempts: 5,
      max_attempts: 5,
      last_error_code: "provider_unavailable",
      created_at: T0,
      updated_at: T0,
    });
    expect((await retryMeetingProcessing(deps, "A", "m2")).ok).toBe(true);
    expect(status("m2")).toBe("processing");
    const rows = jobs("m2");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "j-old",
      status: "pending",
      attempts: 0,
      last_error_code: null,
    });
  });

  it("does not disturb a job that is still running when the effect repeats", async () => {
    meeting(db, "A", "m3", {
      status: "failed",
      consent_confirmed_at: T0,
      consent_statement_version: 1,
    });
    insert(db, "job", {
      id: "j-live",
      owner_id: "A",
      meeting_id: "m3",
      kind: "transcribe",
      job_key: "transcribe:m3",
      status: "running",
      attempts: 2,
      max_attempts: 5,
      created_at: T0,
      updated_at: T0,
    });
    await retryMeetingProcessing(deps, "A", "m3");
    expect(jobs("m3")[0]).toMatchObject({ status: "running", attempts: 2 });
  });

  it("archives and restores", async () => {
    meeting(db, "A", "m4");
    expect((await archiveMeetingCommand(deps, "A", "m4")).ok).toBe(true);
    expect(status("m4")).toBe("archived");
    expect((await unarchiveMeetingCommand(deps, "A", "m4")).ok).toBe(true);
    expect(status("m4")).toBe("scheduled");
  });
});

describe("authorization: another owner and guessed ids see nothing (404 semantics)", () => {
  it("returns not_found to owner B for every command on A's meeting and changes nothing", async () => {
    await confirmMeetingConsent(deps, "A", "m1", { accepted: true });
    const before = JSON.stringify(db.prepare("SELECT * FROM meeting").all());
    const results = await Promise.all([
      confirmMeetingConsent(deps, "B", "m1", { accepted: true }),
      startMeetingCapture(deps, "B", "m1"),
      pauseMeetingCapture(deps, "B", "m1"),
      resumeMeetingCapture(deps, "B", "m1"),
      stopMeetingCapture(deps, "B", "m1"),
      retryMeetingProcessing(deps, "B", "m1"),
      archiveMeetingCommand(deps, "B", "m1"),
      unarchiveMeetingCommand(deps, "B", "m1"),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(JSON.stringify(db.prepare("SELECT * FROM meeting").all())).toBe(before);
    expect(count(db, "job")).toBe(0);
  });

  it("returns the same not_found for ids that do not exist", async () => {
    expect(await startMeetingCapture(deps, "A", "nope")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });

  it("treats a meeting being deleted as nonexistent even for its owner", async () => {
    meeting(db, "A", "m5", { status: "deleting" });
    expect(await archiveMeetingCommand(deps, "A", "m5")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });

  it("repository lookups are scoped by owner", async () => {
    expect(await repo.findById("A", "m1")).not.toBeNull();
    expect(await repo.findById("B", "m1")).toBeNull();
  });
});

describe("repository transaction and concurrency guarantees", () => {
  it("refuses a stale transition and writes nothing (optimistic concurrency)", async () => {
    const stale = await repo.findById("A", "m1");
    if (!stale) throw new Error("setup");
    await confirmMeetingConsent(deps, "A", "m1", { accepted: true });
    await startMeetingCapture(deps, "A", "m1");
    const outcome = stopCapture({ ...stale, status: "capturing" }, clock.now());
    if (!outcome.ok) throw new Error("setup");
    const result = await repo.applyTransition("A", { ...stale, status: "paused" }, outcome.value);
    expect(result).toBe("conflict");
    expect(status()).toBe("capturing");
    expect(jobs()).toHaveLength(0);
  });

  it("rolls the status change back when an effect cannot be stored", async () => {
    const m = await repo.findById("A", "m1");
    if (!m) throw new Error("setup");
    const bad = {
      meeting: { ...m, status: "archived" as const, statusBeforeArchive: "scheduled" as const },
      changed: true,
      events: [{ kind: "meeting.status_changed", actor: "owner" as const, detail: {} }],
      effects: [
        {
          kind: "enqueue_job" as const,
          jobKind: "bogus" as never,
          jobKey: "x",
          requeueIfFailed: false,
        },
      ],
    };
    await expect(repo.applyTransition("A", m, bad)).rejects.toThrow();
    expect(status()).toBe("scheduled");
    expect(count(db, "audit_event")).toBe(0);
  });

  it("does not let a repository call for owner B modify owner A's row", async () => {
    const m = await repo.findById("A", "m1");
    if (!m) throw new Error("setup");
    const out = {
      meeting: { ...m, status: "archived" as const, statusBeforeArchive: "scheduled" as const },
      changed: true,
      events: [],
      effects: [],
    };
    expect(await repo.applyTransition("B", m, out)).toBe("conflict");
    expect(status()).toBe("scheduled");
  });
});
