import type { AuditEventDraft, MeetingStatus } from "../meetings/lifecycle";
import { err, ok, type Result } from "../platform/result";

/** What the move rule needs to know about one note: ids and states, never content. */
export interface MovableNote {
  ownerId: string;
  meetingStatus: MeetingStatus;
  noteStatus: "draft" | "published" | null;
  folderId: string | null;
}

export type MoveError =
  /** Only a Published note moves: a draft, archived, processing or failed one never does. */
  | { kind: "not_published"; status: MeetingStatus }
  /** Missing or another owner's: deliberately the same error, so ids cannot be probed. */
  | { kind: "folder_not_found" };

export type MovePlan =
  | { changed: false }
  | {
      changed: true;
      fromFolderId: string | null;
      toFolderId: string;
      /** Append-only history: the two folder ids only, no titles and no note content. */
      event: AuditEventDraft;
    };

/**
 * Decides whether a Published note may move to `target` (the folder as the owner's own lookup
 * found it, or null). Moving is not a lifecycle transition: the note stays Published, nothing is
 * regenerated or edited, so there is no status change, only a folder change and one audit event.
 * Moving into the folder it is already in is a harmless no-op with no event.
 */
export function planNoteMove(
  note: MovableNote,
  target: { id: string; ownerId: string } | null,
): Result<MovePlan, MoveError> {
  if (note.meetingStatus !== "published" || note.noteStatus !== "published") {
    return err({ kind: "not_published", status: note.meetingStatus });
  }
  if (target === null || target.ownerId !== note.ownerId) return err({ kind: "folder_not_found" });
  if (target.id === note.folderId) return ok({ changed: false });
  return ok({
    changed: true,
    fromFolderId: note.folderId,
    toFolderId: target.id,
    event: {
      kind: "note.moved",
      actor: "owner",
      detail: { fromFolderId: note.folderId, toFolderId: target.id },
    },
  });
}
