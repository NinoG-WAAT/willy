import { canViewMeeting } from "../../domain/authz/predicates";
import {
  archiveMeeting,
  confirmConsent,
  pauseCapture,
  resumeCapture,
  retryProcessing,
  startCapture,
  stopCapture,
  unarchiveMeeting,
  type Meeting,
  type MeetingError,
  type TransitionOutcome,
} from "../../domain/meetings/lifecycle";
import { err, ok, type Result } from "../../domain/platform/result";
import type { Clock } from "../../ports/clock";
import type { MeetingRepository } from "../../ports/meeting-repository";

export interface MeetingDeps {
  meetings: MeetingRepository;
  clock: Clock;
}

/** `not_found` covers unknown ids, other owners' meetings and meetings being deleted (404). */
export type MeetingCommandError = MeetingError | { kind: "not_found" } | { kind: "conflict" };

type Transition = (meeting: Meeting, now: Date) => Result<TransitionOutcome, MeetingError>;

/**
 * Loads the Owner's meeting, runs one domain transition and stores it atomically. A concurrent
 * change is retried once against the fresh state, so a racing double submit settles into the
 * harmless "already done" repeat instead of an error.
 */
async function run(
  deps: MeetingDeps,
  ownerId: string,
  meetingId: string,
  transition: Transition,
): Promise<Result<Meeting, MeetingCommandError>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const meeting = await deps.meetings.findById(ownerId, meetingId);
    if (!meeting || !canViewMeeting(ownerId, meeting)) return err({ kind: "not_found" });

    const outcome = transition(meeting, deps.clock.now());
    if (!outcome.ok) return outcome;
    if (!outcome.value.changed) return ok(outcome.value.meeting);

    if ((await deps.meetings.applyTransition(ownerId, meeting, outcome.value)) === "applied") {
      return ok(outcome.value.meeting);
    }
  }
  return err({ kind: "conflict" });
}

export const confirmMeetingConsent = (
  deps: MeetingDeps,
  ownerId: string,
  meetingId: string,
  input: { accepted: boolean },
) => run(deps, ownerId, meetingId, (m, now) => confirmConsent(m, input, now));

export const startMeetingCapture = (deps: MeetingDeps, ownerId: string, meetingId: string) =>
  run(deps, ownerId, meetingId, startCapture);

export const pauseMeetingCapture = (deps: MeetingDeps, ownerId: string, meetingId: string) =>
  run(deps, ownerId, meetingId, pauseCapture);

export const resumeMeetingCapture = (deps: MeetingDeps, ownerId: string, meetingId: string) =>
  run(deps, ownerId, meetingId, resumeCapture);

/** Queues exactly one transcription job (unique per meeting). */
export const stopMeetingCapture = (deps: MeetingDeps, ownerId: string, meetingId: string) =>
  run(deps, ownerId, meetingId, stopCapture);

export const retryMeetingProcessing = (deps: MeetingDeps, ownerId: string, meetingId: string) =>
  run(deps, ownerId, meetingId, retryProcessing);

export const archiveMeetingCommand = (deps: MeetingDeps, ownerId: string, meetingId: string) =>
  run(deps, ownerId, meetingId, archiveMeeting);

export const unarchiveMeetingCommand = (deps: MeetingDeps, ownerId: string, meetingId: string) =>
  run(deps, ownerId, meetingId, unarchiveMeeting);
