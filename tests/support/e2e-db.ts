import { createHash } from "node:crypto";
import { join } from "node:path";
import { openDatabase } from "../../src/adapters/sqlite/database";
import { T0, insert } from "./db-fixtures";
import { seedLongTranscript, seedReviewMeeting } from "./review-fixtures";

/**
 * Moves one session's idle expiry into the past in the e2e server's database (no waiting). The
 * French-default server has a database of its own: pass "fr" for a session created there.
 */
export function expireSession(token: string, server: "en" | "fr" = "en"): void {
  const name = server === "en" ? "E2E_DATA_DIR" : "E2E_FR_DATA_DIR";
  const dir = process.env[name];
  if (!dir) throw new Error(`${name} is not set (set by playwright.config.ts)`);
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

/** How many audit events of one kind the meeting has (the move writes exactly one per change). */
export function countAuditEvents(meetingId: string, kind: string): number {
  return readOnly((db) =>
    Number(
      db
        .prepare("SELECT COUNT(*) AS n FROM audit_event WHERE meeting_id = ? AND kind = ?")
        .get(meetingId, kind)?.["n"],
    ),
  );
}

/** Removes an empty folder behind the page's back, as another tab or device could. */
export function removeEmptyFolder(folderId: string): void {
  writable((db) => {
    db.prepare("DELETE FROM folder WHERE id = ?").run(folderId);
  });
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

/** Gives a meeting the test created a template of its owner's (the template chip). Returns its id. */
export function attachNewTemplate(meetingId: string, name: string): string {
  return writable((db) => {
    const row = db.prepare("SELECT owner_id FROM meeting WHERE id = ?").get(meetingId);
    if (!row) throw new Error("meeting to attach the template to was not found");
    const id = `tpl-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO template (id, owner_id, name, sections_json, created_at, updated_at)
       VALUES (?, ?, ?, '[]', ?, ?)`,
    ).run(id, String(row["owner_id"]), name, now, now);
    db.prepare("UPDATE meeting SET template_id = ? WHERE id = ?").run(id, meetingId);
    return id;
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
export async function createReviewMeeting(ownerId: string, extraLines = 0): Promise<string> {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const id = `e2e-${Math.random().toString(36).slice(2, 10)}`;
  const db = openDatabase(join(dir, "willy.db"));
  try {
    await seedReviewMeeting(db, ownerId, id);
    if (extraLines > 0) await seedLongTranscript(db, ownerId, id, extraLines);
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

/**
 * Adds to a `createReviewMeeting` draft what a real summary has: more decisions (one the owner
 * added, with no transcript source) and action items with an owner and a due date, a done one,
 * and one that is overdue whatever day the suite runs (due in 2020; the others in 2099). Ids are
 * `<meeting>-dec-1/2` and `<meeting>-act-1/2/3`.
 */
export function addOutlineItems(meetingId: string): void {
  writable((db) => {
    const ownerId = String(
      db.prepare("SELECT owner_id FROM meeting WHERE id = ?").get(meetingId)?.["owner_id"],
    );
    const noteId = `${meetingId}-note`;
    const decisions: [number, string, number | null][] = [
      [1, "Hire a product designer in the first quarter", 0],
      [2, "Move the launch review to Fridays", null],
    ];
    for (const [n, text, from] of decisions) {
      insert(db, "decision", {
        id: `${meetingId}-dec-${String(n)}`,
        owner_id: ownerId,
        note_id: noteId,
        position: n,
        text,
        source_from: from,
        source_to: from === null ? null : 1,
        created_at: T0,
        updated_at: T0,
      });
    }
    const items: [number, string, string | null, string | null, "open" | "done"][] = [
      [1, "Book the venue for the offsite", `${meetingId}-a2`, "2099-03-13T22:59:59.000Z", "open"],
      [2, "Share the pricing sheet with the board", null, null, "done"],
      [3, "Renew the office licence", `${meetingId}-a1`, "2020-01-15T22:59:59.000Z", "open"],
    ];
    for (const [n, text, assignee, dueAt, status] of items) {
      insert(db, "action_item", {
        id: `${meetingId}-act-${String(n)}`,
        owner_id: ownerId,
        meeting_id: meetingId,
        note_id: noteId,
        position: n,
        text,
        assignee_attendee_id: assignee,
        due_at: dueAt,
        due_timezone: dueAt === null ? null : "Europe/Paris",
        status,
        source_from: 10000,
        source_to: 10000,
        created_at: T0,
        updated_at: T0,
      });
    }
  });
}

/** The stored status and "edited" marker of one action item (read-only). */
export function actionItemState(itemId: string): { status: string; edited: number } {
  return readOnly((db) => {
    const row = db.prepare("SELECT status, edited FROM action_item WHERE id = ?").get(itemId);
    return { status: String(row?.["status"]), edited: Number(row?.["edited"]) };
  });
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

/**
 * Archives a throwaway meeting so it leaves the Inbox: the Inbox is paged, and a spec that adds
 * many drafts for a seeded owner would otherwise push the seeded ones onto a later page.
 */
export function archiveMeeting(meetingId: string): void {
  writable((db) => {
    db.prepare(
      "UPDATE meeting SET status_before_archive = status, status = 'archived' WHERE id = ?",
    ).run(meetingId);
  });
}

/**
 * Gives one section of a review meeting's draft (position 0 is "Summary", 1 is "Risks") a new
 * text and, optionally, source range, as the summary job would have written it: not edited.
 */
export function setSectionText(
  meetingId: string,
  position: number,
  body: string,
  source?: { from: number; to: number },
): void {
  writable((db) => {
    const found = db
      .prepare("SELECT id FROM note_section WHERE note_id = ? AND position = ?")
      .get(`${meetingId}-note`, position);
    if (!found) throw new Error("section to change was not found");
    db.prepare(
      "UPDATE note_section SET body = ?, source_from = COALESCE(?, source_from), source_to = COALESCE(?, source_to) WHERE id = ?",
    ).run(body, source?.from ?? null, source?.to ?? null, String(found["id"]));
  });
}

/** Sets the start (ms from the meeting start) of transcript lines by position, so chips show real times. */
export function setSegmentStarts(
  meetingId: string,
  startsByPosition: Record<number, number>,
): void {
  writable((db) => {
    for (const [position, startMs] of Object.entries(startsByPosition)) {
      db.prepare(
        "UPDATE transcript_segment SET start_ms = ?, end_ms = MAX(end_ms, ?) WHERE meeting_id = ? AND position = ?",
      ).run(startMs, startMs, meetingId, Number(position));
    }
  });
}

/** Whether the section is marked as changed by the owner, read from the database. */
export function sectionEdited(meetingId: string, position: number): boolean {
  return readOnly(
    (db) =>
      db
        .prepare("SELECT edited FROM note_section WHERE note_id = ? AND position = ?")
        .get(`${meetingId}-note`, position)?.["edited"] === 1,
  );
}
