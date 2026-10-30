import type { DatabaseSync } from "node:sqlite";
import type {
  AuditEventDraft,
  Meeting,
  MeetingStatus,
  TransitionOutcome,
} from "../../domain/meetings/lifecycle";
import type { ActionItemFields } from "../../domain/notes/review";
import type { IdGenerator } from "../../ports/id-generator";
import type {
  ActionItemOutcome,
  EditOutcome,
  NoteFolderState,
  ReviewRepository,
  ReviewView,
} from "../../ports/review-repository";
import { applyTransitionRows } from "./meeting-transition";
import { inTransaction, settle } from "./transaction";

class Conflict extends Error {}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

/** Review-screen reads and draft edits. Every statement is scoped by owner_id (CLAUDE.md A01). */
export class SqliteReviewRepository implements ReviewRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ids: IdGenerator,
  ) {}

  timezoneOf(ownerId: string, meetingId: string): Promise<string | null> {
    const row = this.db
      .prepare("SELECT timezone FROM meeting WHERE owner_id = ? AND id = ?")
      .get(ownerId, meetingId);
    return Promise.resolve(row ? String(row["timezone"]) : null);
  }

  loadReview(ownerId: string, meetingId: string): Promise<ReviewView | null> {
    const db = this.db;
    const m = db
      .prepare(
        `SELECT m.id, m.title, m.status, m.timezone, m.scheduled_start_at, m.rough_notes,
                m.template_id, t.name AS template_name
           FROM meeting m
           LEFT JOIN template t ON t.owner_id = m.owner_id AND t.id = m.template_id
          WHERE m.owner_id = ? AND m.id = ? AND m.status NOT IN ('deleting', 'deleted')`,
      )
      .get(ownerId, meetingId);
    if (!m) return Promise.resolve(null);

    const n = db
      .prepare(
        `SELECT n.id, n.status, n.revision, n.folder_id, n.published_at, f.name AS folder_name
           FROM note n LEFT JOIN folder f ON f.owner_id = n.owner_id AND f.id = n.folder_id
          WHERE n.owner_id = ? AND n.meeting_id = ?`,
      )
      .get(ownerId, meetingId);
    const noteId = n ? String(n["id"]) : "";
    const forNote = (table: string, columns: string) =>
      db
        .prepare(
          `SELECT id, ${columns} FROM ${table} WHERE owner_id = ? AND note_id = ? ORDER BY position`,
        )
        .all(ownerId, noteId);

    return Promise.resolve({
      meeting: {
        id: String(m["id"]),
        title: String(m["title"]),
        status: String(m["status"]) as MeetingStatus,
        timezone: String(m["timezone"]),
        scheduledStartAt: String(m["scheduled_start_at"]),
        roughNotes: text(m["rough_notes"]) ?? "",
        template:
          text(m["template_id"]) !== null && text(m["template_name"]) !== null
            ? { id: String(m["template_id"]), name: String(m["template_name"]) }
            : null,
      },
      attendees: db
        .prepare(
          "SELECT id, name FROM attendee WHERE owner_id = ? AND meeting_id = ? ORDER BY created_at, id",
        )
        .all(ownerId, meetingId)
        .map((a) => ({ id: String(a["id"]), name: String(a["name"]) })),
      note: n
        ? {
            id: noteId,
            status: n["status"] === "published" ? "published" : "draft",
            revision: Number(n["revision"]),
            folderId: text(n["folder_id"]),
            folderName: text(n["folder_name"]),
            publishedAt: text(n["published_at"]),
          }
        : null,
      sections: forNote("note_section", "heading, body, source_from, source_to, edited").map(
        (r) => ({
          id: String(r["id"]),
          heading: String(r["heading"]),
          body: String(r["body"]),
          sourceFrom: num(r["source_from"]),
          sourceTo: num(r["source_to"]),
          edited: r["edited"] === 1,
        }),
      ),
      decisions: forNote("decision", "text, source_from, source_to, edited").map((r) => ({
        id: String(r["id"]),
        text: String(r["text"]),
        sourceFrom: num(r["source_from"]),
        sourceTo: num(r["source_to"]),
        edited: r["edited"] === 1,
      })),
      actionItems: forNote(
        "action_item",
        "text, assignee_attendee_id, due_at, due_timezone, status, source_from, source_to, edited",
      ).map((r) => ({
        id: String(r["id"]),
        text: String(r["text"]),
        assigneeId: text(r["assignee_attendee_id"]),
        dueAt: text(r["due_at"]),
        dueTimezone: text(r["due_timezone"]),
        status: r["status"] === "done" ? "done" : "open",
        sourceFrom: num(r["source_from"]),
        sourceTo: num(r["source_to"]),
        edited: r["edited"] === 1,
      })),
      segments: db
        .prepare(
          `SELECT id, position, start_ms, speaker_label, text_ciphertext FROM transcript_segment
            WHERE owner_id = ? AND meeting_id = ? ORDER BY position`,
        )
        .all(ownerId, meetingId)
        .map((r) => ({
          id: String(r["id"]),
          position: Number(r["position"]),
          startMs: Number(r["start_ms"]),
          speaker: String(r["speaker_label"]),
          textCiphertext: String(r["text_ciphertext"]),
        })),
    });
  }

  editSection(
    ownerId: string,
    meetingId: string,
    sectionId: string,
    body: string,
    now: Date,
  ): Promise<EditOutcome> {
    return this.editDraft(ownerId, meetingId, now, (noteId, iso) => {
      const section = this.db
        .prepare(
          `UPDATE note_section SET body = ?, edited = 1, updated_at = ?
            WHERE id = ? AND owner_id = ? AND note_id = ? RETURNING heading`,
        )
        .get(body, iso, sectionId, ownerId, noteId);
      if (!section) return "missing";
      this.reindex(ownerId, meetingId, "note_section", sectionId, String(section["heading"]), body);
      return "saved";
    });
  }

  addDecision(ownerId: string, meetingId: string, text: string, now: Date): Promise<EditOutcome> {
    return this.editDraft(ownerId, meetingId, now, (noteId, iso) => {
      const id = this.ids.newId();
      this.db
        .prepare(
          `INSERT INTO decision (id, owner_id, note_id, position, text, edited, created_at, updated_at)
           VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM decision WHERE note_id = ?), ?, 1, ?, ?)`,
        )
        .run(id, ownerId, noteId, noteId, text, iso, iso);
      this.reindex(ownerId, meetingId, "decision", id, "Decision", text);
      return "saved";
    });
  }

  editDecision(
    ownerId: string,
    meetingId: string,
    decisionId: string,
    text: string,
    now: Date,
  ): Promise<EditOutcome> {
    return this.editDraft(ownerId, meetingId, now, (noteId, iso) => {
      const changed = this.db
        .prepare(
          "UPDATE decision SET text = ?, edited = 1, updated_at = ? WHERE id = ? AND owner_id = ? AND note_id = ?",
        )
        .run(text, iso, decisionId, ownerId, noteId).changes;
      if (changed !== 1) return "missing";
      this.reindex(ownerId, meetingId, "decision", decisionId, "Decision", text);
      return "saved";
    });
  }

  deleteDecision(
    ownerId: string,
    meetingId: string,
    decisionId: string,
    now: Date,
  ): Promise<EditOutcome> {
    return this.editDraft(ownerId, meetingId, now, (noteId) => {
      const changed = this.db
        .prepare("DELETE FROM decision WHERE id = ? AND owner_id = ? AND note_id = ?")
        .run(decisionId, ownerId, noteId).changes;
      if (changed !== 1) return "missing";
      this.unindex(ownerId, "decision", decisionId);
      return "saved";
    });
  }

  addActionItem(
    ownerId: string,
    meetingId: string,
    f: ActionItemFields,
    now: Date,
  ): Promise<ActionItemOutcome> {
    return this.editDraft(ownerId, meetingId, now, (noteId, iso) => {
      if (!this.isAttendee(ownerId, meetingId, f.assigneeId)) return "unknown_assignee";
      const id = this.ids.newId();
      this.db
        .prepare(
          `INSERT INTO action_item (id, owner_id, meeting_id, note_id, position, text,
                                    assignee_attendee_id, due_at, due_timezone, status, edited,
                                    created_at, updated_at)
           VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM action_item WHERE note_id = ?),
                   ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          ownerId,
          meetingId,
          noteId,
          noteId,
          f.text,
          f.assigneeId,
          f.dueAt,
          f.dueTimezone,
          f.done ? "done" : "open",
          iso,
          iso,
        );
      this.reindex(ownerId, meetingId, "action_item", id, "Action item", f.text);
      return "saved";
    });
  }

  editActionItem(
    ownerId: string,
    meetingId: string,
    itemId: string,
    f: ActionItemFields,
    now: Date,
  ): Promise<ActionItemOutcome> {
    return this.editDraft(ownerId, meetingId, now, (noteId, iso) => {
      if (!this.isAttendee(ownerId, meetingId, f.assigneeId)) return "unknown_assignee";
      const changed = this.db
        .prepare(
          `UPDATE action_item
              SET text = ?, assignee_attendee_id = ?, due_at = ?, due_timezone = ?, status = ?,
                  edited = 1, updated_at = ?
            WHERE id = ? AND owner_id = ? AND note_id = ?`,
        )
        .run(
          f.text,
          f.assigneeId,
          f.dueAt,
          f.dueTimezone,
          f.done ? "done" : "open",
          iso,
          itemId,
          ownerId,
          noteId,
        ).changes;
      if (changed !== 1) return "missing";
      this.reindex(ownerId, meetingId, "action_item", itemId, "Action item", f.text);
      return "saved";
    });
  }

  deleteActionItem(
    ownerId: string,
    meetingId: string,
    itemId: string,
    now: Date,
  ): Promise<EditOutcome> {
    return this.editDraft(ownerId, meetingId, now, (noteId) => {
      const changed = this.db
        .prepare("DELETE FROM action_item WHERE id = ? AND owner_id = ? AND note_id = ?")
        .run(itemId, ownerId, noteId).changes;
      if (changed !== 1) return "missing";
      this.unindex(ownerId, "action_item", itemId);
      return "saved";
    });
  }

  renameSpeaker(
    ownerId: string,
    meetingId: string,
    from: string,
    to: string,
    now: Date,
  ): Promise<number> {
    return settle(() =>
      Number(
        this.db
          .prepare(
            `UPDATE transcript_segment SET speaker_label = ?, updated_at = ?
              WHERE owner_id = ? AND meeting_id = ? AND speaker_label = ?`,
          )
          .run(to, now.toISOString(), ownerId, meetingId, from).changes,
      ),
    );
  }

  applyNoteStatus(
    ownerId: string,
    meeting: Meeting,
    outcome: TransitionOutcome,
    note: { status: "published"; folderId: string } | { status: "draft" },
    now: Date,
  ): Promise<"applied" | "conflict"> {
    const iso = now.toISOString();
    return settle(() => {
      try {
        return inTransaction(this.db, () => {
          if (
            applyTransitionRows(this.db, this.ids, now, ownerId, meeting, outcome) === "conflict"
          ) {
            throw new Conflict();
          }
          const moved =
            note.status === "published"
              ? this.db
                  .prepare(
                    `UPDATE note SET status = 'published', folder_id = ?, published_at = ?,
                            revision = revision + 1, updated_at = ?
                      WHERE owner_id = ? AND meeting_id = ? AND status = 'draft'`,
                  )
                  .run(note.folderId, iso, iso, ownerId, meeting.id)
              : this.db
                  .prepare(
                    `UPDATE note SET status = 'draft', published_at = NULL,
                            revision = revision + 1, updated_at = ?
                      WHERE owner_id = ? AND meeting_id = ? AND status = 'published'`,
                  )
                  .run(iso, ownerId, meeting.id);
          // No note in the expected state: undo the meeting transition too.
          if (moved.changes !== 1) throw new Conflict();
          return "applied" as const;
        });
      } catch (cause) {
        if (cause instanceof Conflict) return "conflict" as const;
        throw cause;
      }
    });
  }

  noteFolderState(ownerId: string, meetingId: string): Promise<NoteFolderState | null> {
    const row = this.db
      .prepare(
        `SELECT m.status AS meeting_status, n.status AS note_status, n.folder_id
           FROM meeting m
           LEFT JOIN note n ON n.owner_id = m.owner_id AND n.meeting_id = m.id
          WHERE m.owner_id = ? AND m.id = ?`,
      )
      .get(ownerId, meetingId);
    if (!row) return Promise.resolve(null);
    const noteStatus = text(row["note_status"]);
    return Promise.resolve({
      meetingStatus: String(row["meeting_status"]) as MeetingStatus,
      noteStatus: noteStatus === "draft" || noteStatus === "published" ? noteStatus : null,
      folderId: text(row["folder_id"]),
    });
  }

  applyNoteMove(
    ownerId: string,
    meetingId: string,
    move: { fromFolderId: string | null; toFolderId: string; event: AuditEventDraft },
    now: Date,
  ): Promise<"applied" | "conflict"> {
    const iso = now.toISOString();
    return settle(() => {
      try {
        return inTransaction(this.db, () => {
          // Guarded by everything the decision was made on: still published, still in the old
          // folder. The composite FK (owner_id, folder_id) refuses a folder of another owner.
          const moved = this.db
            .prepare(
              `UPDATE note SET folder_id = ?, updated_at = ?
                WHERE owner_id = ? AND meeting_id = ? AND status = 'published' AND folder_id IS ?
                  AND EXISTS (SELECT 1 FROM meeting m
                               WHERE m.owner_id = note.owner_id AND m.id = note.meeting_id
                                 AND m.status = 'published')`,
            )
            .run(move.toFolderId, iso, ownerId, meetingId, move.fromFolderId);
          if (moved.changes !== 1) throw new Conflict();
          this.db
            .prepare(
              `INSERT INTO audit_event (id, owner_id, meeting_id, kind, actor, detail_json, occurred_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              this.ids.newId(),
              ownerId,
              meetingId,
              move.event.kind,
              move.event.actor,
              JSON.stringify(move.event.detail),
              iso,
            );
          return "applied" as const;
        });
      } catch (cause) {
        if (cause instanceof Conflict) return "conflict" as const;
        throw cause;
      }
    });
  }

  /**
   * Runs one edit against the meeting's DRAFT note (a note in review) in a transaction, and
   * raises the note revision when it changed something, so a regeneration queued earlier cannot
   * overwrite this edit. A nothing-to-edit result writes nothing.
   */
  private editDraft<T extends string>(
    ownerId: string,
    meetingId: string,
    now: Date,
    work: (noteId: string, iso: string) => T | "missing",
  ): Promise<T | "missing"> {
    const iso = now.toISOString();
    return settle(() =>
      inTransaction(this.db, () => {
        const note = this.db
          .prepare(
            `SELECT n.id FROM note n JOIN meeting m ON m.owner_id = n.owner_id AND m.id = n.meeting_id
              WHERE n.owner_id = ? AND n.meeting_id = ? AND n.status = 'draft' AND m.status = 'review'`,
          )
          .get(ownerId, meetingId);
        if (!note) return "missing";
        const noteId = String(note["id"]);
        const outcome = work(noteId, iso);
        if (outcome === "saved") {
          this.db
            .prepare(
              "UPDATE note SET revision = revision + 1, updated_at = ? WHERE id = ? AND owner_id = ?",
            )
            .run(iso, noteId, ownerId);
        }
        return outcome;
      }),
    );
  }

  private isAttendee(ownerId: string, meetingId: string, attendeeId: string | null): boolean {
    if (attendeeId === null) return true;
    return (
      this.db
        .prepare("SELECT 1 AS ok FROM attendee WHERE owner_id = ? AND meeting_id = ? AND id = ?")
        .get(ownerId, meetingId, attendeeId) !== undefined
    );
  }

  private unindex(ownerId: string, kind: string, refId: string): void {
    this.db
      .prepare("DELETE FROM search_index WHERE owner_id = ? AND kind = ? AND ref_id = ?")
      .run(ownerId, kind, refId);
  }

  private reindex(
    ownerId: string,
    meetingId: string,
    kind: string,
    refId: string,
    title: string,
    body: string,
  ): void {
    this.unindex(ownerId, kind, refId);
    this.db
      .prepare(
        "INSERT INTO search_index (title, body, owner_id, meeting_id, kind, ref_id) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(title, body, ownerId, meetingId, kind, refId);
  }
}
