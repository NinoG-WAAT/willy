import { join } from "node:path";
import { openDatabase } from "../../src/adapters/sqlite/database";
import type { MeetingStatus } from "../../src/domain/meetings/lifecycle";
import { consentedMeeting, folder, meeting, note, T0 } from "./db-fixtures";

export interface NoteSpec {
  title: string;
  status: Extract<
    MeetingStatus,
    | "scheduled"
    | "capturing"
    | "paused"
    | "processing"
    | "failed"
    | "review"
    | "published"
    | "archived"
    | "deleting"
  >;
  /** ISO instant of the meeting; later is newer. */
  startsAt: string;
  /** Scheduled meetings only: when it ends. Without it the meeting is assumed to last an hour. */
  endsAt?: string;
  /** A published note filed in this folder (the id the helper returned from `createFolder`). */
  folderId?: string;
}

function withDb<T>(run: (db: ReturnType<typeof openDatabase>) => T): T {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const db = openDatabase(join(dir, "willy.db"));
  try {
    return run(db);
  } finally {
    db.close();
  }
}

const suffix = (): string => Math.random().toString(36).slice(2, 10);

/** A folder of the owner, inserted straight into the e2e server's database. */
export function createFolder(ownerId: string, name: string): string {
  const id = `folder-e2e-${suffix()}`;
  withDb((db) => folder(db, ownerId, id, { name }));
  return id;
}

/**
 * Meetings of one owner in the states the Inbox and All notes tell apart, inserted directly (the
 * capture, review and publish UI have their own tests). Insertion is the only shortcut.
 */
export function createNotes(ownerId: string, specs: readonly NoteSpec[]): void {
  const tag = suffix();
  withDb((db) => {
    specs.forEach((spec, index) => {
      const id = `e2e-note-${tag}-${String(index)}`;
      const times = {
        title: spec.title,
        scheduled_start_at: spec.startsAt,
        ...(spec.endsAt === undefined ? {} : { scheduled_end_at: spec.endsAt }),
      };
      if (spec.status === "scheduled") meeting(db, ownerId, id, times);
      else if (spec.status === "archived")
        consentedMeeting(db, ownerId, id, {
          ...times,
          status: "archived",
          status_before_archive: "published",
        });
      else consentedMeeting(db, ownerId, id, { ...times, status: spec.status });
      if (spec.folderId !== undefined)
        note(db, ownerId, id, `${id}-note`, {
          status: "published",
          folder_id: spec.folderId,
          published_at: T0,
        });
    });
  });
}
