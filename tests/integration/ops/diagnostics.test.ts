import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteDiagnosticsRepository } from "../../../src/adapters/sqlite/diagnostics-repository";
import { getDiagnostics } from "../../../src/app/ops/diagnostics";
import { T0, consentedMeeting, freshDb, insert, owner } from "../../support/db-fixtures";

let db: DatabaseSync;

const providers = {
  speechToText: "fake",
  summaries: "fake",
  calendar: "fake",
  storage: "local",
} as const;

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  owner(db, "B");
  consentedMeeting(db, "A", "mA", { status: "processing" });
  consentedMeeting(db, "B", "mB", { status: "processing" });
});

const job = (id: string, ownerId: string, meetingId: string, status: string) =>
  insert(db, "job", {
    id,
    owner_id: ownerId,
    meeting_id: meetingId,
    kind: "transcribe",
    job_key: `transcribe:${id}`,
    status,
    attempts: status === "pending" ? 0 : 1,
    max_attempts: 5,
    next_run_at: status === "retrying" ? T0 : null,
    created_at: T0,
    updated_at: T0,
  });

describe("getDiagnostics", () => {
  it("reports the migration version, the owner's job counts and honest provider modes", async () => {
    job("j1", "A", "mA", "pending");
    job("j2", "A", "mA", "failed");
    job("j3", "A", "mA", "failed");
    job("j4", "A", "mA", "succeeded");
    job("j5", "A", "mA", "retrying");
    const result = await getDiagnostics(
      { diagnostics: new SqliteDiagnosticsRepository(db), providers },
      "A",
    );
    expect(result).toEqual({
      migration: { latest: "0001" },
      jobs: { pending: 1, running: 0, retrying: 1, succeeded: 1, failed: 2 },
      providers,
    });
  });

  it("counts only the signed-in owner's jobs", async () => {
    job("jb", "B", "mB", "failed");
    const result = await getDiagnostics(
      { diagnostics: new SqliteDiagnosticsRepository(db), providers },
      "A",
    );
    expect(result.jobs.failed).toBe(0);
  });

  it("never carries content, secrets, error text or other owners' ids", async () => {
    job("j1", "A", "mA", "failed");
    db.prepare("UPDATE job SET last_error_code = 'stt_rejected'").run();
    const text = JSON.stringify(
      await getDiagnostics({ diagnostics: new SqliteDiagnosticsRepository(db), providers }, "A"),
    );
    expect(text).not.toMatch(/stt_rejected|owner|key|secret|token|@/i);
    expect(text).not.toMatch(/"m[AB]"/);
  });

  it("copes with an empty database", async () => {
    const empty = freshDb();
    owner(empty, "A");
    const result = await getDiagnostics(
      { diagnostics: new SqliteDiagnosticsRepository(empty), providers },
      "A",
    );
    expect(result.jobs).toEqual({ pending: 0, running: 0, retrying: 0, succeeded: 0, failed: 0 });
  });
});
