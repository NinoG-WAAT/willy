import { canViewMeeting } from "../../domain/authz/predicates";
import type { MeetingStatus } from "../../domain/meetings/lifecycle";
import { err, ok, type Result } from "../../domain/platform/result";
import type { Clock } from "../../ports/clock";
import type { JobRepository } from "../../ports/job-repository";
import type { MeetingRepository } from "../../ports/meeting-repository";
import type { NoteRepository } from "../../ports/note-repository";

export interface RegenerateDeps {
  meetings: MeetingRepository;
  notes: NoteRepository;
  jobs: JobRepository;
  clock: Clock;
}

export type RegenerateError =
  { kind: "not_found" } | { kind: "invalid_state"; status: MeetingStatus };

/** One job per meeting, section and note revision; a finished regeneration bumps the revision. */
export const regenerationJobKey = (
  meetingId: string,
  revision: number,
  sectionId: string,
): string => `summarize:${meetingId}:r${String(revision)}:${sectionId}`;

/**
 * Queues "regenerate this section" for a draft note in review. Only that section is replaced when
 * the job runs; manual edits elsewhere are untouched. Idempotent per section and revision (a
 * double click queues nothing more); a failed attempt can be requested again. Another owner's
 * meeting, an unknown section or a section of another meeting are all `not_found`.
 */
export async function requestSectionRegeneration(
  deps: RegenerateDeps,
  ownerId: string,
  meetingId: string,
  sectionId: string,
): Promise<Result<{ jobKey: string; alreadyQueued: boolean }, RegenerateError>> {
  const meeting = await deps.meetings.findById(ownerId, meetingId);
  if (!meeting || !canViewMeeting(ownerId, meeting)) return err({ kind: "not_found" });
  if (meeting.status !== "review") return err({ kind: "invalid_state", status: meeting.status });

  const section = await deps.notes.findSection(ownerId, meetingId, sectionId);
  if (!section) return err({ kind: "not_found" });

  const jobKey = regenerationJobKey(meetingId, section.noteRevision, section.sectionId);
  const queued = await deps.jobs.enqueue(
    {
      ownerId,
      meetingId,
      kind: "summarize",
      jobKey,
      requeueIfFailed: true,
      payload: { sectionId: section.sectionId, revision: section.noteRevision },
    },
    deps.clock.now(),
  );
  return ok({ jobKey, alreadyQueued: !queued.created });
}
