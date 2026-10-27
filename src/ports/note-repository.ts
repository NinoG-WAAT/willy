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
}
