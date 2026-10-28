import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../../src/adapters/sqlite/database";
import { meetingPrefix } from "../../src/domain/storage/object-key";

type Db = ReturnType<typeof openDatabase>;

function dataDir(): string {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  return dir;
}

function withDb<T>(run: (db: Db) => T): T {
  const db = openDatabase(join(dataDir(), "willy.db"));
  try {
    return run(db);
  } finally {
    db.close();
  }
}

/** The development password every seeded owner has (seeds/seed.ts); fresh owners reuse its hash. */
export const DEV_PASSWORD = "willy-dev-password";

export interface FreshOwner {
  id: string;
  email: string;
}

/**
 * A brand-new owner with the development password, so a journey test owns all of its data: its
 * searches, folders, jobs and settings can never be touched by another test running at the same
 * time. Insertion is the only shortcut; everything else the test does goes through the real UI.
 */
export function createFreshOwner(): FreshOwner {
  const suffix = Math.random().toString(36).slice(2, 10);
  const id = `owner-e2e-${suffix}`;
  const email = `${id}@example.test`;
  const now = new Date().toISOString();
  withDb((db) => {
    const copied = db
      .prepare(
        `INSERT INTO owner (id, email, display_name, password_hash, created_at)
         SELECT ?, ?, 'Fresh Founder', password_hash, ? FROM owner WHERE id = 'owner-ada'`,
      )
      .run(id, email, now);
    if (copied.changes !== 1) throw new Error("seeded owner-ada is missing");
    db.prepare("INSERT INTO settings (owner_id, updated_at) VALUES (?, ?)").run(id, now);
  });
  return { id, email };
}

/** Encrypted audio chunk files still on disk for one meeting (the fake R2 bucket). */
export function storedAudioFiles(ownerId: string, meetingId: string): string[] {
  const dir = join(dataDir(), "objects", ...meetingPrefix(ownerId, meetingId).split("/"));
  return existsSync(dir) ? readdirSync(dir) : [];
}

export interface MeetingFootprint {
  meetings: number;
  chunks: number;
  transcriptSegments: number;
  notes: number;
  searchRows: number;
}

/** How many rows of each kind still exist for a meeting (all zero once it is permanently gone). */
export function meetingFootprint(meetingId: string): MeetingFootprint {
  const count = (db: Db, sql: string): number => Number(db.prepare(sql).get(meetingId)?.["n"] ?? 0);
  return withDb((db) => ({
    meetings: count(db, "SELECT COUNT(*) AS n FROM meeting WHERE id = ?"),
    chunks: count(db, "SELECT COUNT(*) AS n FROM audio_chunk WHERE meeting_id = ?"),
    transcriptSegments: count(
      db,
      "SELECT COUNT(*) AS n FROM transcript_segment WHERE meeting_id = ?",
    ),
    notes: count(db, "SELECT COUNT(*) AS n FROM note WHERE meeting_id = ?"),
    searchRows: count(db, "SELECT COUNT(*) AS n FROM search_index WHERE meeting_id = ?"),
  }));
}
