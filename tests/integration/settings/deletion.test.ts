import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteDeletionStatusQuery } from "../../../src/adapters/sqlite/deletion-status-query";
import { SqliteJobRepository } from "../../../src/adapters/sqlite/job-repository";
import { SqliteMeetingCatalog } from "../../../src/adapters/sqlite/meeting-catalog";
import { SqliteMeetingRepository } from "../../../src/adapters/sqlite/meeting-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import {
  confirmMeetingDeletion,
  listDeletions,
  loadDeletionPrompt,
  retryMeetingDeletion,
  type DeletionDeps,
} from "../../../src/app/settings/deletion";
import { count, freshDb, meeting, owner } from "../../support/db-fixtures";

let db: DatabaseSync;
let deps: DeletionDeps;
let jobs: SqliteJobRepository;
let clock: FixedClock;

beforeEach(() => {
  db = freshDb();
  clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
  const ids = new SequentialIds("id");
  jobs = new SqliteJobRepository(db, ids);
  deps = {
    meeting: { meetings: new SqliteMeetingRepository(db, ids, clock), clock },
    detail: new SqliteMeetingCatalog(db, ids, clock),
    deletions: new SqliteDeletionStatusQuery(db),
    jobs,
    clock,
  };
  owner(db, "A");
  owner(db, "B");
  meeting(db, "A", "m-a", { title: "Old kickoff" });
  meeting(db, "B", "m-b", { title: "Ben's confidential roadmap review" });
});

const status = (id: string) =>
  String(db.prepare("SELECT status FROM meeting WHERE id = ?").get(id)?.["status"]);
const deleteJobs = (id: string) => count(db, "job", `kind = 'delete' AND meeting_id = '${id}'`);

describe("loadDeletionPrompt", () => {
  it("describes the owner's own meeting without any note, transcript or contact data", async () => {
    const result = await loadDeletionPrompt(deps, "A", "m-a");
    expect(result).toMatchObject({
      ok: true,
      value: { id: "m-a", title: "Old kickoff", status: "scheduled", timezone: "Europe/Paris" },
    });
    if (result.ok) expect(Object.keys(result.value).sort()).toEqual([
      "attendeeCount",
      "id",
      "scheduledStartAt",
      "status",
      "timezone",
      "title",
    ]);
  });

  it("is not_found for another owner's meeting, a guessed id and a lookalike, identically", async () => {
    const foreign = await loadDeletionPrompt(deps, "A", "m-b");
    const unknown = await loadDeletionPrompt(deps, "A", "does-not-exist");
    const lookalike = await loadDeletionPrompt(deps, "A", "M-A");
    expect(foreign).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(unknown).toEqual(foreign);
    expect(lookalike).toEqual(foreign);
  });
});

describe("confirmMeetingDeletion", () => {
  it("does nothing without the typed word", async () => {
    for (const typed of [undefined, "", "delete", "yes", "DELETE IT"]) {
      const result = await confirmMeetingDeletion(deps, "A", "m-a", typed);
      expect(result).toEqual({ ok: false, error: { kind: "confirmation_required" } });
    }
    expect(status("m-a")).toBe("scheduled");
    expect(deleteJobs("m-a")).toBe(0);
    expect(count(db, "audit_event")).toBe(0);
  });

  it("hides the meeting at once and queues exactly one deletion job", async () => {
    const result = await confirmMeetingDeletion(deps, "A", "m-a", "DELETE");
    expect(result).toEqual({ ok: true, value: { outcome: "requested" } });
    expect(status("m-a")).toBe("deleting");
    expect(deleteJobs("m-a")).toBe(1);
    expect(count(db, "audit_event", "meeting_id = 'm-a' AND kind = 'meeting.deletion_requested'")).toBe(1);
    expect(await loadDeletionPrompt(deps, "A", "m-a")).toEqual({
      ok: false,
      error: { kind: "already_requested" },
    });
  });

  it("owner A cannot delete owner B's meeting, even with the right word", async () => {
    const result = await confirmMeetingDeletion(deps, "A", "m-b", "DELETE");
    expect(result).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(status("m-b")).toBe("scheduled");
    expect(deleteJobs("m-b")).toBe(0);
    expect(count(db, "audit_event")).toBe(0);
  });

  it("answers a foreign id the same way with and without the word (no existence leak)", async () => {
    const withWord = await confirmMeetingDeletion(deps, "A", "m-b", "DELETE");
    const withoutWord = await confirmMeetingDeletion(deps, "A", "m-b", "nope");
    const unknown = await confirmMeetingDeletion(deps, "A", "no-such-id", "nope");
    expect(withoutWord).toEqual(withWord);
    expect(unknown).toEqual(withWord);
  });

  it("a guessed id deletes nothing", async () => {
    for (const guess of ["m-", "m-a%", "m-a' OR '1'='1", "../m-a", "M-A", ""]) {
      expect(await confirmMeetingDeletion(deps, "A", guess, "DELETE")).toEqual({
        ok: false,
        error: { kind: "not_found" },
      });
    }
    expect(status("m-a")).toBe("scheduled");
    expect(status("m-b")).toBe("scheduled");
    expect(count(db, "job", "kind = 'delete'")).toBe(0);
  });

  it("is idempotent: a repeat is a safe no-op that still points at the one job", async () => {
    await confirmMeetingDeletion(deps, "A", "m-a", "DELETE");
    const again = await confirmMeetingDeletion(deps, "A", "m-a", "DELETE");
    expect(again).toEqual({ ok: true, value: { outcome: "already_requested" } });
    expect(deleteJobs("m-a")).toBe(1);
    expect(count(db, "audit_event", "meeting_id = 'm-a'")).toBe(1);
  });

  it("does not let owner B see that A's meeting is already being deleted", async () => {
    await confirmMeetingDeletion(deps, "A", "m-a", "DELETE");
    expect(await confirmMeetingDeletion(deps, "B", "m-a", "DELETE")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });
});

describe("listDeletions", () => {
  it("shows the owner's pending deletion with state and no meeting content", async () => {
    await confirmMeetingDeletion(deps, "A", "m-a", "DELETE");
    const entries = await listDeletions(deps, "A");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      meetingId: "m-a",
      requestedAt: "2026-10-27T10:00:00.000Z",
      view: { state: "pending", label: "Queued", inProgress: true, canRetry: false },
    });
    const flat = JSON.stringify(entries);
    expect(flat).not.toContain("Old kickoff");
  });

  it("never lists another owner's deletions", async () => {
    await confirmMeetingDeletion(deps, "A", "m-a", "DELETE");
    expect(await listDeletions(deps, "B")).toEqual([]);
  });

  it("reflects retrying, failed and finished jobs", async () => {
    meeting(db, "A", "m-2");
    meeting(db, "A", "m-3");
    for (const id of ["m-a", "m-2", "m-3"]) await confirmMeetingDeletion(deps, "A", id, "DELETE");
    const rows = db.prepare("SELECT id, meeting_id FROM job WHERE kind = 'delete'").all();
    const jobOf = (meetingId: string) =>
      String(rows.find((r) => r["meeting_id"] === meetingId)?.["id"]);
    await jobs.markRetrying(
      jobOf("m-a"),
      clock.now(),
      "2026-10-27T10:05:00.000Z",
      "storage_unavailable",
    );
    await jobs.markFailed(jobOf("m-2"), clock.now(), "storage_unavailable");
    await jobs.markSucceeded(jobOf("m-3"), clock.now());

    const byMeeting = new Map((await listDeletions(deps, "A")).map((e) => [e.meetingId, e]));
    expect(byMeeting.get("m-a")?.view).toMatchObject({ state: "retrying" });
    expect(byMeeting.get("m-a")?.nextRunAt).toBe("2026-10-27T10:05:00.000Z");
    expect(byMeeting.get("m-2")?.view).toMatchObject({ state: "failed", canRetry: true });
    expect(byMeeting.get("m-3")?.view).toMatchObject({ state: "succeeded" });
  });

  it("caps the list to the most recent entries", async () => {
    for (let i = 0; i < 15; i++) {
      meeting(db, "A", `bulk-${String(i)}`);
      await confirmMeetingDeletion(deps, "A", `bulk-${String(i)}`, "DELETE");
    }
    expect((await listDeletions(deps, "A")).length).toBe(10);
  });
});

describe("retryMeetingDeletion", () => {
  async function failedDeletion(): Promise<string> {
    await confirmMeetingDeletion(deps, "A", "m-a", "DELETE");
    const id = String(db.prepare("SELECT id FROM job WHERE meeting_id = 'm-a'").get()?.["id"]);
    await jobs.markFailed(id, clock.now(), "storage_unavailable");
    return id;
  }

  it("puts a failed deletion back in the queue, once", async () => {
    const jobId = await failedDeletion();
    expect(await retryMeetingDeletion(deps, "A", "m-a")).toEqual({
      ok: true,
      value: { outcome: "requeued" },
    });
    const row = db.prepare("SELECT status, attempts, last_error_code FROM job WHERE id = ?").get(jobId);
    expect(row).toMatchObject({ status: "pending", attempts: 0, last_error_code: null });
    expect(deleteJobs("m-a")).toBe(1);
    // Repeating while it is queued changes nothing.
    expect(await retryMeetingDeletion(deps, "A", "m-a")).toEqual({
      ok: true,
      value: { outcome: "nothing_to_retry" },
    });
  });

  it("leaves a deletion that is not failed alone", async () => {
    await confirmMeetingDeletion(deps, "A", "m-a", "DELETE");
    expect(await retryMeetingDeletion(deps, "A", "m-a")).toEqual({
      ok: true,
      value: { outcome: "nothing_to_retry" },
    });
  });

  it("owner A cannot retry owner B's failed deletion; unknown ids are the same 404", async () => {
    await confirmMeetingDeletion(deps, "B", "m-b", "DELETE");
    const jobId = String(db.prepare("SELECT id FROM job WHERE meeting_id = 'm-b'").get()?.["id"]);
    await jobs.markFailed(jobId, clock.now(), "storage_unavailable");

    const foreign = await retryMeetingDeletion(deps, "A", "m-b");
    const unknown = await retryMeetingDeletion(deps, "A", "no-such-id");
    expect(foreign).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(unknown).toEqual(foreign);
    expect(db.prepare("SELECT status FROM job WHERE id = ?").get(jobId)).toMatchObject({
      status: "failed",
    });
  });

  it("is not_found for a meeting nobody asked to delete", async () => {
    expect(await retryMeetingDeletion(deps, "A", "m-a")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });
});
