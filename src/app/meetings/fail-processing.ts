import { failProcessing, type Meeting } from "../../domain/meetings/lifecycle";
import type { Clock } from "../../ports/clock";
import type { Logger } from "../../ports/logger";
import type { MeetingRepository } from "../../ports/meeting-repository";

/**
 * A background step gave up: the meeting moves `processing -> failed` (system actor, audit event)
 * so the owner sees a recoverable failure and can retry. Rough notes are untouched.
 */
export async function failMeetingProcessing(
  deps: { meetings: MeetingRepository; clock: Clock },
  log: Logger,
  meeting: Meeting,
): Promise<void> {
  const outcome = failProcessing(meeting, deps.clock.now());
  if (!outcome.ok || !outcome.value.changed) return;
  const applied = await deps.meetings.applyTransition(meeting.ownerId, meeting, outcome.value);
  log.error("job.meeting_failed", { applied: applied === "applied" });
}
