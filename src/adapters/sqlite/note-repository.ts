import type { DatabaseSync } from "node:sqlite";
import type { Meeting, TransitionOutcome } from "../../domain/meetings/lifecycle";
import type { NewDraft } from "../../domain/notes/draft";
import type { IdGenerator } from "../../ports/id-generator";
import type { NoteRepository, SummaryContext } from "../../ports/note-repository";
import { applyTransitionRows } from "./meeting-transition";
import { inTransaction } from "./transaction";

class TransitionConflict extends Error {}

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
