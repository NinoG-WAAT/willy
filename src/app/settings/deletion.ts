import { err, ok, type Result } from "../../domain/platform/result";
import { isDeletionConfirmed } from "../../domain/settings/deletion-confirmation";
import { describeDeletion, type DeletionDescription } from "../../domain/settings/deletion-status";
import type { MeetingStatus } from "../../domain/meetings/lifecycle";
import type { Clock } from "../../ports/clock";
import type { DeletionStatusQuery } from "../../ports/deletion-status-query";
import type { JobRepository } from "../../ports/job-repository";
import type { MeetingDetailQuery } from "../../ports/meeting-detail";
import { requestMeetingDeletion } from "../meetings/delete";
import type { MeetingDeps } from "../meetings/capture";

export interface DeletionDeps {
  /** Deletion itself is `requestMeetingDeletion` (#13): this module never reimplements it. */
  meeting: MeetingDeps;
  detail: MeetingDetailQuery;
  deletions: DeletionStatusQuery;
  jobs: Pick<JobRepository, "enqueue">;
  clock: Clock;
}

/** What the confirmation page shows about the meeting: no notes, transcript or contact data. */
export interface DeletionPrompt {
  id: string;
  title: string;
  status: MeetingStatus;
  scheduledStartAt: string;
  timezone: string;
  attendeeCount: number;
}

/**
 * `not_found` covers unknown ids and other owners' meetings (a 404, never a 403).
 * `already_requested`: the owner's own deletion is already queued; the meeting is hidden everywhere.
 */
export type DeletionLookupError = { kind: "not_found" } | { kind: "already_requested" };

export async function loadDeletionPrompt(
  deps: DeletionDeps,
  ownerId: string,
  meetingId: string,
): Promise<Result<DeletionPrompt, DeletionLookupError>> {
  const detail = await deps.detail.findDetail(ownerId, meetingId);
  if (!detail) {
    return err(
      (await deps.deletions.findForMeeting(ownerId, meetingId))
        ? { kind: "already_requested" }
        : { kind: "not_found" },
    );
  }
  return ok({
    id: detail.id,
    title: detail.title,
    status: detail.status,
    scheduledStartAt: detail.scheduledStartAt,
    timezone: detail.timezone,
    attendeeCount: detail.attendees.length,
  });
}

export type ConfirmDeletionError =
  | { kind: "not_found" }
  | { kind: "confirmation_required" }
  | { kind: "conflict" }
  | { kind: "not_allowed" };

/**
 * Step one of permanent deletion, behind the typed confirmation. Ownership comes first, so
 * another owner's id answers `not_found` whether or not the word was typed. The repeat of an
 * already queued deletion is a harmless `already_requested`, so a double submit never shows a 404.
 */
export async function confirmMeetingDeletion(
  deps: DeletionDeps,
  ownerId: string,
  meetingId: string,
  typedConfirmation: unknown,
): Promise<Result<{ outcome: "requested" | "already_requested" }, ConfirmDeletionError>> {
  const prompt = await loadDeletionPrompt(deps, ownerId, meetingId);
  if (!prompt.ok) {
    return prompt.error.kind === "already_requested"
      ? ok({ outcome: "already_requested" })
      : err({ kind: "not_found" });
  }
  if (!isDeletionConfirmed(typedConfirmation)) return err({ kind: "confirmation_required" });

  const result = await requestMeetingDeletion(deps.meeting, ownerId, meetingId);
  if (result.ok) return ok({ outcome: "requested" });
  if (result.error.kind === "not_found") {
    // Lost a race with another request for the same deletion.
    return (await deps.deletions.findForMeeting(ownerId, meetingId))
      ? ok({ outcome: "already_requested" })
      : err({ kind: "not_found" });
  }
  return err({ kind: result.error.kind === "conflict" ? "conflict" : "not_allowed" });
}

const PANEL_LIMIT = 10;

export interface DeletionEntry {
  meetingId: string;
  requestedAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  view: DeletionDescription;
}

/** The owner's latest deletions with pending / retrying / failed / finished state (#13 jobs). */
export async function listDeletions(deps: DeletionDeps, ownerId: string): Promise<DeletionEntry[]> {
  const rows = await deps.deletions.listForOwner(ownerId, PANEL_LIMIT);
  return rows.map((row) => ({
    meetingId: row.meetingId,
    requestedAt: row.requestedAt,
    updatedAt: row.updatedAt,
    nextRunAt: row.nextRunAt,
    view: describeDeletion(row),
  }));
}

/** Puts the owner's failed deletion back in the queue; anything else is left alone. */
export async function retryMeetingDeletion(
  deps: DeletionDeps,
  ownerId: string,
  meetingId: string,
): Promise<Result<{ outcome: "requeued" | "nothing_to_retry" }, { kind: "not_found" }>> {
  const row = await deps.deletions.findForMeeting(ownerId, meetingId);
  if (!row) return err({ kind: "not_found" });
  if (!describeDeletion(row).canRetry) return ok({ outcome: "nothing_to_retry" });
  await deps.jobs.enqueue(
    {
      ownerId,
      meetingId,
      kind: "delete",
      jobKey: `delete:${meetingId}`,
      requeueIfFailed: true,
    },
    deps.clock.now(),
  );
  return ok({ outcome: "requeued" });
}
