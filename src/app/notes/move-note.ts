import { canEditMeeting } from "../../domain/authz/predicates";
import type { MeetingStatus } from "../../domain/meetings/lifecycle";
import { planNoteMove } from "../../domain/notes/move";
import { err, ok, type Result } from "../../domain/platform/result";
import type { ReviewDeps } from "./review";

/**
 * `not_found`: unknown, another owner's or a vanishing meeting (a 404). `folder_not_found`: the
 * target is missing or another owner's (the owner's own form shows it as a field error).
 * `not_published`: the note is not Published, so it never moves (a 409).
 */
export type MoveNoteError =
  | { kind: "not_found" }
  | { kind: "folder_not_found" }
  | { kind: "not_published"; status: MeetingStatus }
  | { kind: "conflict" };

export interface MoveNoteOutcome {
  /** False when the note already was in that folder: nothing was written. */
  moved: boolean;
  folderName: string;
}

/**
 * Moves a Published note to another of the owner's folders without reopening it: the note stays
 * Published, its content and revision are untouched, and one `note.moved` audit event (folder ids
 * only) is written in the same transaction as the folder change. Owner comes from the session.
 * Two attempts: a concurrent change is re-read once, as publish and reopen do.
 */
export async function moveNoteToFolder(
  deps: ReviewDeps,
  ownerId: string,
  meetingId: string,
  folderId: string,
): Promise<Result<MoveNoteOutcome, MoveNoteError>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = await deps.reviews.noteFolderState(ownerId, meetingId);
    if (!state || !canEditMeeting(ownerId, { ownerId, status: state.meetingStatus })) {
      return err({ kind: "not_found" });
    }
    const folder = await deps.folders.find(ownerId, folderId);
    const plan = planNoteMove(
      { ownerId, ...state },
      folder === null ? null : { id: folder.id, ownerId },
    );
    if (!plan.ok) return plan;
    if (folder === null) return err({ kind: "folder_not_found" });
    if (!plan.value.changed) return ok({ moved: false, folderName: folder.name });
    const applied = await deps.reviews.applyNoteMove(
      ownerId,
      meetingId,
      plan.value,
      deps.clock.now(),
    );
    if (applied === "applied") return ok({ moved: true, folderName: folder.name });
  }
  return err({ kind: "conflict" });
}
