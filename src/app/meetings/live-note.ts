import { canViewMeeting } from "../../domain/authz/predicates";
import { liveControls, type LiveControls } from "../../domain/meetings/live-note";
import { normalizeRoughNotes } from "../../domain/meetings/rough-notes";
import { err, ok, type Result } from "../../domain/platform/result";
import type { ChunkRepository } from "../../ports/chunk-repository";
import type { Clock } from "../../ports/clock";
import type {
  MeetingDetail,
  MeetingDetailQuery,
  RoughNotesStore,
} from "../../ports/meeting-detail";
import {
  confirmMeetingConsent,
  pauseMeetingCapture,
  resumeMeetingCapture,
  startMeetingCapture,
  stopMeetingCapture,
  type MeetingCommandError,
  type MeetingDeps,
} from "./capture";
import { NOT_FOUND, type NotesError } from "../notes/errors";

export interface LiveNoteDeps {
  detail: MeetingDetailQuery;
  notes: RoughNotesStore;
  chunks: ChunkRepository;
  clock: Clock;
}

export interface LiveNoteView {
  detail: MeetingDetail;
  controls: LiveControls;
  /** Where an uploader continues numbering (one past the highest stored chunk). */
  nextSeq: number;
  /** Audio already stored for this meeting, so the timer continues across reloads. */
  recordedMs: number;
}

const NOT_FOUND_ONLY = { kind: "not_found" } as const;

/** Loads the live note for the Owner's meeting; other owners' ids and deleting meetings are not_found. */
export async function loadLiveNote(
  deps: LiveNoteDeps,
  ownerId: string,
  meetingId: string,
): Promise<Result<LiveNoteView, { kind: "not_found" }>> {
  const detail = await deps.detail.findDetail(ownerId, meetingId);
  if (!detail || !canViewMeeting(ownerId, { ownerId, status: detail.status }))
    return err(NOT_FOUND_ONLY);
  const chunks = await deps.chunks.listByMeeting(ownerId, meetingId);
  return ok({
    detail,
    controls: liveControls(detail.status, detail.consentConfirmedAt),
    nextSeq: chunks.reduce((max, c) => Math.max(max, c.seq + 1), 0),
    recordedMs: chunks.reduce((sum, c) => sum + c.durationMs, 0),
  });
}

export async function saveRoughNotes(
  deps: Pick<LiveNoteDeps, "notes" | "clock">,
  ownerId: string,
  meetingId: string,
  raw: unknown,
): Promise<Result<{ savedAt: string }, NotesError>> {
  const notes = normalizeRoughNotes(raw);
  if (!notes.ok) return err({ kind: "invalid", errors: [notes.error] });
  const saved = await deps.notes.saveRoughNotes(ownerId, meetingId, notes.value, deps.clock.now());
  return saved.ok ? saved : err(NOT_FOUND);
}

export type CaptureAction = "start" | "pause" | "resume" | "stop";

/**
 * One capture button press. Starting records the Owner's consent confirmation first (the domain
 * refuses without the tick, so the rule is enforced here on the server, never by a disabled
 * button); every other action maps to its lifecycle transition.
 */
export async function runCaptureAction(
  deps: MeetingDeps,
  ownerId: string,
  meetingId: string,
  action: CaptureAction,
  input: { consentAccepted: boolean },
) {
  switch (action) {
    case "start": {
      const consent = await confirmMeetingConsent(deps, ownerId, meetingId, {
        accepted: input.consentAccepted,
      });
      if (!consent.ok) return consent;
      return startMeetingCapture(deps, ownerId, meetingId);
    }
    case "pause":
      return pauseMeetingCapture(deps, ownerId, meetingId);
    case "resume":
      return resumeMeetingCapture(deps, ownerId, meetingId);
    case "stop":
      return stopMeetingCapture(deps, ownerId, meetingId);
  }
}

export type { MeetingCommandError };
