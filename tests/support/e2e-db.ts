import { createHash } from "node:crypto";
import { join } from "node:path";
import { openDatabase } from "../../src/adapters/sqlite/database";

/** Moves one session's idle expiry into the past in the e2e server's database (no waiting). */
export function expireSession(token: string): void {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const db = openDatabase(join(dir, "willy.db"));
  try {
    const hash = createHash("sha256").update(token).digest("hex");
    const past = new Date(Date.now() - 60_000).toISOString();
    const result = db
      .prepare("UPDATE session SET idle_expires_at = ? WHERE token_hash = ?")
      .run(past, hash);
    if (result.changes !== 1) throw new Error("session to expire was not found");
  } finally {
    db.close();
  }
}

/** Read-only query against the e2e server's database (never used to change state). */
function readOnly<T>(run: (db: ReturnType<typeof openDatabase>) => T): T {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const db = openDatabase(join(dir, "willy.db"));
  try {
    return run(db);
  } finally {
    db.close();
  }
}

export function countTranscribeJobs(meetingId: string): number {
  return readOnly((db) =>
    Number(
      db
        .prepare("SELECT COUNT(*) AS n FROM job WHERE meeting_id = ? AND kind = 'transcribe'")
        .get(meetingId)?.["n"],
    ),
  );
}

export function meetingStatus(meetingId: string): string {
  return readOnly((db) =>
    String(db.prepare("SELECT status FROM meeting WHERE id = ?").get(meetingId)?.["status"]),
  );
}

/**
 * Inserts a fresh meeting straight into the e2e server's database (there is no capture UI yet)
 * and returns its id. "capturing" meetings carry a stored consent, as the schema requires.
 */
export function createCapturingMeeting(
  ownerId: string,
  status: "capturing" | "scheduled" = "capturing",
  title = "E2E meeting",
): string {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const id = `e2e-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const consented = status === "capturing";
  const db = openDatabase(join(dir, "willy.db"));
  try {
    db.prepare(
      `INSERT INTO meeting (id, owner_id, status, title, scheduled_start_at, timezone,
                            consent_confirmed_at, consent_statement_version, capture_started_at,
                            created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Europe/Paris', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      ownerId,
      status,
      title,
      now,
      consented ? now : null,
      consented ? 1 : null,
      consented ? now : null,
      now,
      now,
    );
  } finally {
    db.close();
  }
  return id;
}

/**
 * Inserts a meeting that is already being deleted, with its deletion job in a chosen state, and
 * returns the meeting id. Pending and retrying jobs are due a day from now, so no concurrently
 * running test's job run can pick them up and change what the page shows. A failed job would be
 * re-queued by the hourly sweeper the first time any run happens, so the helper marks this hour's
 * and the next hour's sweeper job as already done for the owner.
 */
export function createDeletionInState(
  ownerId: string,
  state: "pending" | "retrying" | "failed",
): string {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const id = `e2e-del-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date();
  const iso = now.toISOString();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const db = openDatabase(join(dir, "willy.db"));
  try {
    db.prepare(
      `INSERT INTO meeting (id, owner_id, status, title, scheduled_start_at, timezone, created_at, updated_at)
       VALUES (?, ?, 'deleting', 'Hidden meeting', ?, 'Europe/Paris', ?, ?)`,
    ).run(id, ownerId, iso, iso, iso);
    db.prepare(
      `INSERT INTO job (id, owner_id, meeting_id, kind, job_key, status, attempts, max_attempts,
                        next_run_at, last_error_code, created_at, updated_at)
       VALUES (?, ?, ?, 'delete', ?, ?, ?, 5, ?, ?, ?, ?)`,
    ).run(
      `job-${id}`,
      ownerId,
      id,
      `delete:${id}`,
      state,
      state === "pending" ? 0 : state === "retrying" ? 2 : 5,
      state === "failed" ? null : tomorrow,
      state === "pending" ? null : "storage_unavailable",
      iso,
      iso,
    );
    if (state === "failed") {
      for (const hour of [now, new Date(now.getTime() + 60 * 60 * 1000)]) {
        const key = `retention:${ownerId}:${hour.toISOString().slice(0, 13)}`;
        db.prepare(
          `INSERT OR IGNORE INTO job (id, owner_id, meeting_id, kind, job_key, status, attempts,
                                      max_attempts, created_at, updated_at)
           VALUES (?, ?, NULL, 'retention', ?, 'succeeded', 1, 5, ?, ?)`,
        ).run(`job-${key}`, ownerId, key, iso, iso);
      }
    }
  } finally {
    db.close();
  }
  return id;
}
