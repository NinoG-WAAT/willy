import { canViewMeeting } from "../../domain/authz/predicates";
import type { MeetingStatus } from "../../domain/meetings/lifecycle";
import { err, ok, type Result } from "../../domain/platform/result";
import type { Clock } from "../../ports/clock";
import type { JobRepository } from "../../ports/job-repository";
import type { MeetingRepository } from "../../ports/meeting-repository";
import type { NoteRepository } from "../../ports/note-repository";

export interface RegenerateDraftDeps {
  meetings: MeetingRepository;
  notes: NoteRepository;
  jobs: JobRepository;
  clock: Clock;
}

export type RegenerateDraftError =
  | { kind: "not_found" }
  | { kind: "invalid_state"; status: MeetingStatus }
  /** The owner did not confirm that their edits will be replaced. */
  | { kind: "not_confirmed" };

/** One job per meeting and note revision; a finished regeneration bumps the revision. */
export const draftRegenerationJobKey = (meetingId: string, revision: number): string =>
  `summarize:${meetingId}:r${String(revision)}:all`;

/**
 * Queues "write the whole draft again" for a draft note in review. It replaces every section,
 * decision and action item, including the owner's edits to them, so the owner must confirm; the
 * rough notes, the transcript and speaker names are kept. Idempotent per revision (a double click
 * queues nothing more); a failed attempt can be requested again. Another owner's meeting, an
 * unknown id and a meeting without a note are all `not_found`.
 */
export async function requestDraftRegeneration(
  deps: RegenerateDraftDeps,
  ownerId: string,
  meetingId: string,
  input: { confirmed: boolean },
): Promise<Result<{ jobKey: string; alreadyQueued: boolean }, RegenerateDraftError>> {
  const meeting = await deps.meetings.findById(ownerId, meetingId);
  if (!meeting || !canViewMeeting(ownerId, meeting)) return err({ kind: "not_found" });
  const note = await deps.notes.findNote(ownerId, meetingId);
  if (!note) return err({ kind: "not_found" });
  if (meeting.status !== "review" || note.noteStatus !== "draft") {
    return err({ kind: "invalid_state", status: meeting.status });
  }
  if (!input.confirmed) return err({ kind: "not_confirmed" });

  const jobKey = draftRegenerationJobKey(meetingId, note.noteRevision);
  const queued = await deps.jobs.enqueue(
    {
      ownerId,
      meetingId,
      kind: "summarize",
      jobKey,
      requeueIfFailed: true,
      payload: { scope: "all", revision: note.noteRevision },
    },
    deps.clock.now(),
  );
  return ok({ jobKey, alreadyQueued: !queued.created });
}
