import type { DatabaseSync } from "node:sqlite";
import type { MeetingStatus } from "../../domain/meetings/lifecycle";
import type { ExportActionItem, ExportData, ExportNote } from "../../domain/search/markdown-export";
import type { NoteReader } from "../../ports/note-reader";

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Read-only view of a meeting and its note for export. Every statement is scoped by owner_id. */
export class SqliteNoteReader implements NoteReader {
  constructor(private readonly db: DatabaseSync) {}

  loadForExport(ownerId: string, meetingId: string): Promise<ExportData | null> {
    const m = this.db
      .prepare(
        `SELECT id, title, status, agenda, rough_notes, scheduled_start_at, timezone
           FROM meeting
          WHERE owner_id = ? AND id = ? AND status NOT IN ('deleting', 'deleted')`,
      )
      .get(ownerId, meetingId);
    if (!m) return Promise.resolve(null);

    // Names only: attendee emails never leave through an export.
    const attendees = this.db
      .prepare(
        "SELECT name FROM attendee WHERE owner_id = ? AND meeting_id = ? ORDER BY created_at, name",
      )
      .all(ownerId, meetingId)
      .map((a) => String(a["name"]));

    const noteRow = this.db
      .prepare(
        `SELECT n.id, n.status, f.name AS folder_name
           FROM note n LEFT JOIN folder f ON f.owner_id = n.owner_id AND f.id = n.folder_id
          WHERE n.owner_id = ? AND n.meeting_id = ?`,
      )
      .get(ownerId, meetingId);

    let note: ExportNote | null = null;
    if (noteRow) {
      const noteId = String(noteRow["id"]);
      const sections = this.db
        .prepare(
          "SELECT heading, body FROM note_section WHERE owner_id = ? AND note_id = ? ORDER BY position",
        )
        .all(ownerId, noteId)
        .map((r) => ({ heading: String(r["heading"]), body: String(r["body"]) }));
      const decisions = this.db
        .prepare("SELECT text FROM decision WHERE owner_id = ? AND note_id = ? ORDER BY position")
        .all(ownerId, noteId)
        .map((r) => String(r["text"]));
      const actionItems = this.db
        .prepare(
          `SELECT a.text, a.due_at, a.due_timezone, a.status, att.name AS assignee
             FROM action_item a
             LEFT JOIN attendee att
               ON att.owner_id = a.owner_id AND att.meeting_id = a.meeting_id AND att.id = a.assignee_attendee_id
            WHERE a.owner_id = ? AND a.note_id = ?
            ORDER BY a.position`,
        )
        .all(ownerId, noteId)
        .map((r): ExportActionItem => ({
          text: String(r["text"]),
          assignee: text(r["assignee"]),
          dueAt: text(r["due_at"]),
          dueTimezone: text(r["due_timezone"]),
          done: r["status"] === "done",
        }));
      note = {
        status: noteRow["status"] === "published" ? "published" : "draft",
        sections,
        decisions,
        actionItems,
      };
    }

    return Promise.resolve({
      title: String(m["title"]),
      status: String(m["status"]) as MeetingStatus,
      scheduledStartAt: String(m["scheduled_start_at"]),
      timezone: String(m["timezone"]),
      folderName: noteRow ? text(noteRow["folder_name"]) : null,
      attendees,
      agenda: text(m["agenda"]),
      roughNotes: text(m["rough_notes"]) ?? "",
      note,
    });
  }
}
