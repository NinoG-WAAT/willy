import type {
  AuditEventDraft,
  Meeting,
  MeetingStatus,
  TransitionOutcome,
} from "../domain/meetings/lifecycle";
import type { ActionItemFields } from "../domain/notes/review";

export interface ReviewSection {
  id: string;
  heading: string;
  body: string;
  sourceFrom: number | null;
  sourceTo: number | null;
  edited: boolean;
}

export interface ReviewDecision {
  id: string;
  text: string;
  sourceFrom: number | null;
  sourceTo: number | null;
  edited: boolean;
}

export interface ReviewActionItem {
  id: string;
  text: string;
  assigneeId: string | null;
  dueAt: string | null;
  dueTimezone: string | null;
  status: "open" | "done";
  sourceFrom: number | null;
  sourceTo: number | null;
  edited: boolean;
}

export interface ReviewSegment {
  id: string;
  position: number;
  startMs: number;
  speaker: string;
  /** Still encrypted: the use case decrypts for display. */
  textCiphertext: string;
}

/** Everything the review screen shows about one meeting. */
export interface ReviewView {
  meeting: {
    id: string;
    title: string;
    status: MeetingStatus;
    timezone: string;
    scheduledStartAt: string;
    /** The owner's own rough notes: they survive any failure and are shown when there is no summary. */
    roughNotes: string;
    /** The template the meeting was created from, when it still exists. */
    template: { id: string; name: string } | null;
  };
  attendees: { id: string; name: string }[];
  note: {
    id: string;
    status: "draft" | "published";
    revision: number;
    folderId: string | null;
    folderName: string | null;
    publishedAt: string | null;
  } | null;
  sections: ReviewSection[];
  decisions: ReviewDecision[];
  actionItems: ReviewActionItem[];
  segments: ReviewSegment[];
}

/** The states and folder the move rule reads: ids and states only. */
export interface NoteFolderState {
  meetingStatus: MeetingStatus;
  /** Null when the meeting has no note (failed before a summary). */
  noteStatus: "draft" | "published" | null;
  folderId: string | null;
}

/** `missing`: not the owner's, unknown, or the note is not an editable draft. */
export type EditOutcome = "saved" | "missing";
export type ActionItemOutcome = EditOutcome | "unknown_assignee";

/**
 * Review-screen reads and edits. Every method is scoped by the owner from the session; another
 * owner's id behaves like an unknown one. Edits only touch a DRAFT note, mark what was edited,
 * raise the note revision (so a queued regeneration cannot overwrite a manual edit) and keep the
 * search index in step, all in one transaction.
 */
export interface ReviewRepository {
  /** The meeting's IANA zone, or null for an unknown id or another owner's meeting. */
  timezoneOf(ownerId: string, meetingId: string): Promise<string | null>;

  /** Null for an unknown id, another owner's meeting, or a meeting being deleted. */
  loadReview(ownerId: string, meetingId: string): Promise<ReviewView | null>;

  editSection(
    ownerId: string,
    meetingId: string,
    sectionId: string,
    body: string,
    now: Date,
  ): Promise<EditOutcome>;

  addDecision(ownerId: string, meetingId: string, text: string, now: Date): Promise<EditOutcome>;
  editDecision(
    ownerId: string,
    meetingId: string,
    decisionId: string,
    text: string,
    now: Date,
  ): Promise<EditOutcome>;
  deleteDecision(
    ownerId: string,
    meetingId: string,
    decisionId: string,
    now: Date,
  ): Promise<EditOutcome>;

  addActionItem(
    ownerId: string,
    meetingId: string,
    fields: ActionItemFields,
    now: Date,
  ): Promise<ActionItemOutcome>;
  editActionItem(
    ownerId: string,
    meetingId: string,
    itemId: string,
    fields: ActionItemFields,
    now: Date,
  ): Promise<ActionItemOutcome>;
  deleteActionItem(
    ownerId: string,
    meetingId: string,
    itemId: string,
    now: Date,
  ): Promise<EditOutcome>;

  /**
   * Gives every segment of this meeting that carries the label `from` the label `to`. Renaming
   * to a label that already exists merges the two speakers. Returns how many segments changed
   * (0 when the label does not occur or the meeting is not the owner's).
   */
  renameSpeaker(
    ownerId: string,
    meetingId: string,
    from: string,
    to: string,
    now: Date,
  ): Promise<number>;

  /**
   * In ONE transaction applies the lifecycle outcome (meeting row, audit event) and moves the
   * note: published into `folderId`, or back to draft (it keeps its folder, which the next
   * publish offers again). `conflict` writes nothing: the meeting or note changed meanwhile.
   */
  applyNoteStatus(
    ownerId: string,
    meeting: Meeting,
    outcome: TransitionOutcome,
    note: { status: "published"; folderId: string } | { status: "draft" },
    now: Date,
  ): Promise<"applied" | "conflict">;

  /** Null for an unknown id or another owner's meeting. A meeting being deleted is returned: the caller hides it. */
  noteFolderState(ownerId: string, meetingId: string): Promise<NoteFolderState | null>;

  /**
   * Moves the note of a Published meeting from `fromFolderId` to `toFolderId` and appends
   * `event` to the audit history in ONE transaction. Nothing else changes (not the status, the
   * revision or the content). `conflict` writes nothing: the note is no longer published, or no
   * longer in `fromFolderId`.
   */
  applyNoteMove(
    ownerId: string,
    meetingId: string,
    move: { fromFolderId: string | null; toFolderId: string; event: AuditEventDraft },
    now: Date,
  ): Promise<"applied" | "conflict">;
}
