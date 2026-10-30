import { join } from "node:path";
import { openDatabase } from "../../src/adapters/sqlite/database";
import { consentedMeeting, folder, note } from "./db-fixtures";

export interface FolderNoteSpec {
  title: string;
  /** Meeting status. Anything but "published" is a note the folder view must not show. */
  status?: "published" | "archived" | "deleting";
  /** ISO instant of the meeting; later is newer. */
  startsAt: string;
}

/**
 * A folder of the owner filled straight into the e2e server's database (the review and publish
 * UI is covered by its own tests). Every note is a published note in this folder; the meeting
 * status decides whether the folder view may show it. Archived meetings keep the pre-archive
 * status the schema requires.
 */
export function createFolderWithNotes(
  ownerId: string,
  name: string,
  notes: readonly FolderNoteSpec[],
): { folderId: string } {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const suffix = Math.random().toString(36).slice(2, 10);
  const folderId = `folder-e2e-${suffix}`;
  const db = openDatabase(join(dir, "willy.db"));
  try {
    folder(db, ownerId, folderId, { name });
    notes.forEach((spec, index) => {
      const id = `e2e-fn-${suffix}-${String(index)}`;
      const status = spec.status ?? "published";
      consentedMeeting(db, ownerId, id, {
        status,
        title: spec.title,
        scheduled_start_at: spec.startsAt,
        timezone: "Europe/Paris",
        ...(status === "archived" ? { status_before_archive: "published" } : {}),
      });
      note(db, ownerId, id, `${id}-note`, {
        status: "published",
        folder_id: folderId,
        published_at: spec.startsAt,
      });
    });
  } finally {
    db.close();
  }
  return { folderId };
}
