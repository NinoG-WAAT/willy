import type { DatabaseSync } from "node:sqlite";
import type { Meeting, TransitionOutcome } from "../../domain/meetings/lifecycle";
import type { NewDraft } from "../../domain/notes/draft";
import type { IdGenerator } from "../../ports/id-generator";
import type { NoteRepository, SectionRef, SummaryContext } from "../../ports/note-repository";
import { applyTransitionRows } from "./meeting-transition";
import { inTransaction } from "./transaction";

class TransitionConflict extends Error {}
class MissingSection extends Error {}
class StaleRevision extends Error {}

export class SqliteNoteRepository implements NoteRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ids: IdGenerator,
  ) {}

  loadSummaryContext(ownerId: string, meetingId: string): Promise<SummaryContext | null> {
    const meeting = this.db
      .prepare("SELECT agenda, timezone, template_id FROM meeting WHERE id = ? AND owner_id = ?")
      .get(meetingId, ownerId);
    if (!meeting) return Promise.resolve(null);
    const attendees = this.db
      .prepare(
        "SELECT id, name FROM attendee WHERE owner_id = ? AND meeting_id = ? ORDER BY created_at, id",
      )
      .all(ownerId, meetingId);
    const segments = this.db
      .prepare(
        `SELECT id, position, speaker_label, text_ciphertext FROM transcript_segment
         WHERE owner_id = ? AND meeting_id = ? ORDER BY position`,
      )
      .all(ownerId, meetingId);
    const agenda = meeting["agenda"];
    const templateId = meeting["template_id"];
    return Promise.resolve({
      agenda: typeof agenda === "string" ? agenda : null,
      timezone: String(meeting["timezone"]),
      templateId: typeof templateId === "string" ? templateId : null,
      attendees: attendees.map((a) => ({ id: String(a["id"]), name: String(a["name"]) })),
      segments: segments.map((s) => ({
        id: String(s["id"]),
        position: Number(s["position"]),
        speaker: String(s["speaker_label"]),
        textCiphertext: String(s["text_ciphertext"]),
      })),
    });
  }

  saveDraft(
    ownerId: string,
    meeting: Meeting,
    draft: NewDraft,
    transition: TransitionOutcome,
    now: Date,
  ): Promise<"saved" | "exists" | "conflict"> {
    const iso = now.toISOString();
    try {
      return Promise.resolve(
        inTransaction(this.db, () => {
          const existing = this.db
            .prepare("SELECT id FROM note WHERE owner_id = ? AND meeting_id = ?")
            .get(ownerId, meeting.id);
          if (!existing) this.insertDraft(ownerId, meeting.id, draft, iso);
          if (
            applyTransitionRows(this.db, this.ids, now, ownerId, meeting, transition) === "conflict"
          ) {
            throw new TransitionConflict();
          }
          return existing ? ("exists" as const) : ("saved" as const);
        }),
      );
    } catch (cause) {
      if (cause instanceof TransitionConflict) return Promise.resolve("conflict");
      return Promise.reject(cause instanceof Error ? cause : new Error("saving the draft failed"));
    }
  }

  findSection(ownerId: string, meetingId: string, sectionId: string): Promise<SectionRef | null> {
    const row = this.db
      .prepare(
        `SELECT s.id, s.heading, n.id AS note_id, n.status, n.revision
         FROM note_section s
         JOIN note n ON n.owner_id = s.owner_id AND n.id = s.note_id
         WHERE s.owner_id = ? AND n.meeting_id = ? AND s.id = ?`,
      )
      .get(ownerId, meetingId, sectionId);
    if (!row) return Promise.resolve(null);
    return Promise.resolve({
      sectionId: String(row["id"]),
      heading: String(row["heading"]),
      noteId: String(row["note_id"]),
      noteStatus: row["status"] === "published" ? "published" : "draft",
      noteRevision: Number(row["revision"]),
    });
  }

  replaceSection(
    ownerId: string,
    meetingId: string,
    sectionId: string,
    expectedRevision: number,
    section: { heading: string; body: string; sourceFrom: number; sourceTo: number },
    now: Date,
  ): Promise<"replaced" | "stale" | "missing"> {
    const iso = now.toISOString();
    try {
      inTransaction(this.db, () => {
        const note = this.db
          .prepare(
            `UPDATE note SET revision = revision + 1, updated_at = ?
             WHERE owner_id = ? AND meeting_id = ? AND status = 'draft' AND revision = ?
               AND id = (SELECT note_id FROM note_section WHERE id = ? AND owner_id = ?)`,
          )
          .run(iso, ownerId, meetingId, expectedRevision, sectionId, ownerId);
        if (note.changes !== 1) throw new StaleRevision();
        const updated = this.db
          .prepare(
            `UPDATE note_section
             SET body = ?, source_from = ?, source_to = ?, edited = 0, updated_at = ?
             WHERE id = ? AND owner_id = ?`,
          )
          .run(section.body, section.sourceFrom, section.sourceTo, iso, sectionId, ownerId);
        if (updated.changes !== 1) throw new MissingSection();
        this.db
          .prepare(
            "DELETE FROM search_index WHERE owner_id = ? AND kind = 'note_section' AND ref_id = ?",
          )
          .run(ownerId, sectionId);
        this.db
          .prepare(
            "INSERT INTO search_index (title, body, owner_id, meeting_id, kind, ref_id) VALUES (?, ?, ?, ?, 'note_section', ?)",
          )
          .run(section.heading, section.body, ownerId, meetingId, sectionId);
      });
      return Promise.resolve("replaced");
    } catch (cause) {
      if (cause instanceof StaleRevision) return Promise.resolve("stale");
      if (cause instanceof MissingSection) return Promise.resolve("missing");
      return Promise.reject(
        cause instanceof Error ? cause : new Error("replacing the section failed"),
      );
    }
  }

  private insertDraft(ownerId: string, meetingId: string, draft: NewDraft, iso: string): void {
    const noteId = this.ids.newId();
    this.db
      .prepare(
        `INSERT INTO note (id, owner_id, meeting_id, status, revision, folder_id, generated_at,
                           published_at, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', 1, NULL, ?, NULL, ?, ?)`,
      )
      .run(noteId, ownerId, meetingId, iso, iso, iso);

    const index = (kind: string, refId: string, title: string, body: string): void => {
      this.db
        .prepare(
          "INSERT INTO search_index (title, body, owner_id, meeting_id, kind, ref_id) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(title, body, ownerId, meetingId, kind, refId);
    };

    for (const s of draft.sections) {
      const id = this.ids.newId();
      this.db
        .prepare(
          `INSERT INTO note_section (id, owner_id, note_id, position, heading, body, source_from,
                                     source_to, edited, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          id,
          ownerId,
          noteId,
          s.position,
          s.heading,
          s.body,
          s.sourceFrom,
          s.sourceTo,
          iso,
          iso,
        );
      index("note_section", id, s.heading, s.body);
    }
    for (const d of draft.decisions) {
      const id = this.ids.newId();
      this.db
        .prepare(
          `INSERT INTO decision (id, owner_id, note_id, position, text, source_from, source_to,
                                 edited, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(id, ownerId, noteId, d.position, d.text, d.sourceFrom, d.sourceTo, iso, iso);
      index("decision", id, "Decision", d.text);
    }
    for (const a of draft.actionItems) {
      const id = this.ids.newId();
      this.db
        .prepare(
          `INSERT INTO action_item (id, owner_id, meeting_id, note_id, position, text,
                                    assignee_attendee_id, due_at, due_timezone, status, source_from,
                                    source_to, edited, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 0, ?, ?)`,
        )
        .run(
          id,
          ownerId,
          meetingId,
          noteId,
          a.position,
          a.text,
          a.assigneeId,
          a.dueAt,
          a.dueTimezone,
          a.sourceFrom,
          a.sourceTo,
          iso,
          iso,
        );
      index("action_item", id, "Action item", a.text);
    }
  }
}
