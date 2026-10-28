import type { NewDraft } from "../domain/notes/draft";
import type { Meeting, TransitionOutcome } from "../domain/meetings/lifecycle";

export interface SummaryContext {
  agenda: string | null;
  /** IANA zone of the meeting: due dates are read in it. */
  timezone: string;
  templateId: string | null;
  /** Id and name only: emails are never part of what leaves the database for the model. */
  attendees: { id: string; name: string }[];
  /** Still encrypted; ordered by transcript position. */
  segments: { id: string; position: number; speaker: string; textCiphertext: string }[];
}

export interface SectionRef {
  sectionId: string;
  heading: string;
  noteId: string;
  noteStatus: "draft" | "published";
  noteRevision: number;
}

/** Every method is scoped by the owner from the session or the job. */
export interface NoteRepository {
  /** Null for an unknown id or another owner's meeting. */
  loadSummaryContext(ownerId: string, meetingId: string): Promise<SummaryContext | null>;

  /**
   * In ONE transaction: stores the generated draft (note, sections, decisions, action items and
   * their search rows) and applies the meeting transition. A meeting has at most one note, so a
   * replay stores nothing new (`exists`) but still completes the transition. `conflict` means the
   * meeting changed meanwhile and nothing was written.
   */
  saveDraft(
    ownerId: string,
    meeting: Meeting,
    draft: NewDraft,
    transition: TransitionOutcome,
    now: Date,
  ): Promise<"saved" | "exists" | "conflict">;

  /** The section and its note, for one of the owner's meetings; null when it is not theirs. */
  findSection(ownerId: string, meetingId: string, sectionId: string): Promise<SectionRef | null>;

  /**
   * Replaces ONE section's text and source range (it becomes unedited) and raises the note's
   * revision, in one transaction. Only a draft note whose revision is still `expectedRevision`
   * is touched (`stale` otherwise, so a replayed job changes nothing). Other sections, decisions
   * and action items, and their manual edits, are never touched. The section's search row is
   * refreshed in the same transaction.
   */
  replaceSection(
    ownerId: string,
    meetingId: string,
    sectionId: string,
    expectedRevision: number,
    section: { heading: string; body: string; sourceFrom: number; sourceTo: number },
    now: Date,
  ): Promise<"replaced" | "stale" | "missing">;
}
