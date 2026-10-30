import { createHash } from "node:crypto";
import { join } from "node:path";
import { openDatabase } from "../../src/adapters/sqlite/database";
import { seedReviewMeeting } from "./review-fixtures";

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
  status: "capturing" | "scheduled" | "paused" | "failed" | "processing" = "capturing",
  title = "E2E meeting",
): string {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const id = `e2e-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const consented = status !== "scheduled";
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

/** Attaches one of the seeded templates to a meeting the test created (the template chip). */
export function setMeetingTemplate(meetingId: string, templateId: string): void {
  writable((db) => {
    const result = db
      .prepare("UPDATE meeting SET template_id = ? WHERE id = ?")
      .run(templateId, meetingId);
    if (result.changes !== 1) throw new Error("meeting to attach the template to was not found");
  });
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

/**
 * A fresh meeting in review for the owner, with a draft note, two speakers and encrypted
 * transcript lines (see seedReviewMeeting) and its own folder, so a test can edit and publish it without touching
 * shared seed data. Ids are `<id>-a1` (attendee), `<id>-sec-0`, `<id>-dec-0`, `<id>-act-0`.
 */
export async function createReviewMeeting(ownerId: string): Promise<string> {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const id = `e2e-${Math.random().toString(36).slice(2, 10)}`;
  const db = openDatabase(join(dir, "willy.db"));
  try {
    await seedReviewMeeting(db, ownerId, id);
    // A private folder of its own, so publishing in one test never changes what other tests see
    // in the shared seeded folders.
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO folder (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(`folder-${id}`, ownerId, reviewFolderName(id), now, now);
  } finally {
    db.close();
  }
  return id;
}

/** The name of the private folder `createReviewMeeting` creates for a meeting. */
export const reviewFolderName = (meetingId: string): string => `Folder for ${meetingId}`;

/** Opens the e2e server's database for a test that plays the part of the background worker. */
function writable<T>(run: (db: ReturnType<typeof openDatabase>) => T): T {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const db = openDatabase(join(dir, "willy.db"));
  try {
    return run(db);
  } finally {
    db.close();
  }
}

export type JobState = "pending" | "running" | "retrying" | "succeeded" | "failed";

export type ChunkState = "uploaded" | "transcribed" | "failed" | "purged";

/**
 * Plays the transcription worker for the hand-off tests: replaces a meeting's audio chunk rows
 * with one row per given state (in order, seq 0..n-1), so the status endpoint reports real counts
 * ("2 of 7 parts") without any audio. Rows carry no real object, so nothing can transcribe them.
 */
export function setChunkStates(meetingId: string, states: readonly ChunkState[]): void {
  writable((db) => {
    const row = db.prepare("SELECT owner_id FROM meeting WHERE id = ?").get(meetingId);
    const ownerId = String(row?.["owner_id"]);
    const iso = new Date().toISOString();
    db.prepare("DELETE FROM audio_chunk WHERE meeting_id = ?").run(meetingId);
    for (const [seq, state] of states.entries()) {
      db.prepare(
        `INSERT INTO audio_chunk (id, owner_id, meeting_id, seq, state, byte_size, duration_ms,
                                  content_type, sha256, key_id, object_key, created_at)
         VALUES (?, ?, ?, ?, ?, 10, 1000, 'audio/webm', ?, 'e2e-key', ?, ?)`,
      ).run(
        `chunk-${meetingId}-${String(seq)}`,
        ownerId,
        meetingId,
        seq,
        state,
        "a".repeat(64),
        state === "purged" ? null : `e2e/${meetingId}/${String(seq)}`,
        iso,
      );
    }
  });
}

/**
 * Plays the background worker for the progress tests (the in-process runner is off in e2e): moves
 * a meeting's status and sets its transcription job, creating the job on first use. Due times are
 * a day away so no concurrently running test's job run can pick the job up and change it.
 */
export function advanceProcessing(
  meetingId: string,
  to: {
    meeting: "processing" | "review" | "failed";
    transcription: JobState;
    summary?: JobState;
    errorCode?: string;
  },
): void {
  writable((db) => {
    const row = db.prepare("SELECT owner_id FROM meeting WHERE id = ?").get(meetingId);
    const ownerId = String(row?.["owner_id"]);
    const now = new Date();
    const iso = now.toISOString();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE meeting SET status = ?, updated_at = ? WHERE id = ?").run(
      to.meeting,
      iso,
      meetingId,
    );
    const jobs: [string, JobState][] = [[`transcribe:${meetingId}`, to.transcription]];
    if (to.summary !== undefined) jobs.push([`summarize:${meetingId}:1`, to.summary]);
    for (const [key, state] of jobs) {
      const kind = key.startsWith("transcribe") ? "transcribe" : "summarize";
      db.prepare(
        `INSERT INTO job (id, owner_id, meeting_id, kind, job_key, status, attempts, max_attempts,
                          next_run_at, last_error_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 5, ?, ?, ?, ?)
         ON CONFLICT (job_key) DO UPDATE SET status = excluded.status, attempts = excluded.attempts,
           next_run_at = excluded.next_run_at, last_error_code = excluded.last_error_code,
           updated_at = excluded.updated_at`,
      ).run(
        `job-${key}`,
        ownerId,
        meetingId,
        kind,
        key,
        state,
        state === "pending" ? 0 : state === "failed" ? 5 : state === "retrying" ? 2 : 1,
        state === "pending" || state === "retrying" ? tomorrow : null,
        state === "failed" || state === "retrying" ? (to.errorCode ?? "stt_unavailable") : null,
        iso,
        iso,
      );
    }
  });
}

/**
 * Moves a deletion job (created by `createDeletionInState`) to another state. Jobs that are not
 * finished stay due a day away, and a failed one gets the same "sweeper already ran" markers as in
 * `createDeletionInState`, so nothing else in the suite re-queues it.
 */
export function advanceDeletion(
  meetingId: string,
  state: "running" | "retrying" | "succeeded" | "failed",
): void {
  writable((db) => {
    const now = new Date();
    const iso = now.toISOString();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `UPDATE job SET status = ?, attempts = ?, next_run_at = ?, last_error_code = ?, updated_at = ?
        WHERE meeting_id = ? AND kind = 'delete'`,
    ).run(
      state,
      state === "failed" ? 5 : 1,
      state === "succeeded" || state === "failed" ? null : tomorrow,
      state === "failed" || state === "retrying" ? "storage_unavailable" : null,
      iso,
      meetingId,
    );
    if (state === "failed") {
      const ownerId = String(
        db
          .prepare("SELECT owner_id FROM job WHERE meeting_id = ? AND kind = 'delete'")
          .get(meetingId)?.["owner_id"],
      );
      for (const hour of [now, new Date(now.getTime() + 60 * 60 * 1000)]) {
        const key = `retention:${ownerId}:${hour.toISOString().slice(0, 13)}`;
        db.prepare(
          `INSERT OR IGNORE INTO job (id, owner_id, meeting_id, kind, job_key, status, attempts,
                                      max_attempts, created_at, updated_at)
           VALUES (?, ?, NULL, 'retention', ?, 'succeeded', 1, 5, ?, ?)`,
        ).run(`job-${key}`, ownerId, key, iso, iso);
      }
    }
  });
}
