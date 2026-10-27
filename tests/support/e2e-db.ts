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
       VALUES (?, ?, ?, 'E2E meeting', ?, 'Europe/Paris', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      ownerId,
      status,
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
