import { err, ok, type Result } from "../platform/result";

/** Statuses of docs/PLAN.md section 5.1. */
export type MeetingStatus =
  | "scheduled"
  | "capturing"
  | "paused"
  | "processing"
  | "review"
  | "published"
  | "failed"
  | "archived"
  | "deleting"
  | "deleted";

/**
 * The consent statement the Owner ticks. Changing the wording bumps the version, and the version
 * is stored with the confirmation. It only ever covers the Owner's own attestation: the system
 * never records or claims consent on behalf of participants.
 */
export const CONSENT_STATEMENT =
  "I have told every participant that this meeting will be recorded and transcribed, and I have their consent.";
export const CONSENT_STATEMENT_VERSION = 1;

/** Lifecycle view of a Meeting (the aggregate). Read models carry the other fields. */
export interface Meeting {
  id: string;
  ownerId: string;
  status: MeetingStatus;
  statusBeforeArchive: MeetingStatus | null;
  consentConfirmedAt: string | null;
  consentStatementVersion: number | null;
  captureStartedAt: string | null;
  captureEndedAt: string | null;
}

export interface AuditEventDraft {
  kind: string;
  actor: "owner" | "system";
  /** Ids, states and counts only: never titles, notes or transcript text. */
  detail: Record<string, string | number | boolean | null>;
}

export type JobKind = "transcribe" | "delete";

export interface EnqueueJobEffect {
  kind: "enqueue_job";
  jobKind: JobKind;
  /** Unique per logical side effect: enqueueing twice yields one job. */
  jobKey: string;
  /** Reset a `failed` job with this key to pending (retry); never touches live jobs. */
  requeueIfFailed: boolean;
}

export type Effect = EnqueueJobEffect;

export interface TransitionOutcome {
  meeting: Meeting;
  /** False for harmless repeats (double submit): nothing to store, no events, no effects. */
  changed: boolean;
  events: AuditEventDraft[];
  effects: Effect[];
}

export type MeetingError =
  | { kind: "invalid_transition"; action: string; from: MeetingStatus }
  | { kind: "consent_required" }
  | { kind: "consent_not_given" }
  | { kind: "folder_required" }
  | { kind: "folder_not_owned" };

type Actor = "owner" | "system";

interface Rule {
  /** Statuses the action may start from. Extending the lifecycle means editing this table. */
  from: readonly MeetingStatus[];
  to: MeetingStatus | "previous";
  actor: Actor;
}

const GONE: readonly MeetingStatus[] = ["deleting", "deleted"];

const RULES = {
  start_capture: { from: ["scheduled"], to: "capturing", actor: "owner" },
  pause: { from: ["capturing"], to: "paused", actor: "owner" },
  resume: { from: ["paused"], to: "capturing", actor: "owner" },
  stop_capture: { from: ["capturing", "paused"], to: "processing", actor: "owner" },
  complete_processing: { from: ["processing"], to: "review", actor: "system" },
  fail_processing: { from: ["processing"], to: "failed", actor: "system" },
  retry_processing: { from: ["failed"], to: "processing", actor: "owner" },
  publish: { from: ["review"], to: "published", actor: "owner" },
  reopen: { from: ["published"], to: "review", actor: "owner" },
  archive: { from: ["scheduled", "review", "published", "failed"], to: "archived", actor: "owner" },
  unarchive: { from: ["archived"], to: "previous", actor: "owner" },
  request_deletion: {
    from: [
      "scheduled",
      "capturing",
      "paused",
      "processing",
      "review",
      "published",
      "failed",
      "archived",
    ],
    to: "deleting",
    actor: "owner",
  },
  complete_deletion: { from: ["deleting"], to: "deleted", actor: "system" },
} as const satisfies Record<string, Rule>;

type Action = keyof typeof RULES;

interface Extras {
  patch?: Partial<Meeting>;
  detail?: AuditEventDraft["detail"];
  eventKind?: string;
  effects?: Effect[];
  actor?: Actor;
}

const unchanged = (meeting: Meeting): Result<TransitionOutcome, never> =>
  ok({ meeting, changed: false, events: [], effects: [] });

/** Applies one table-driven transition and records its audit event. */
function transition(
  meeting: Meeting,
  action: Action,
  extras: Extras = {},
): Result<TransitionOutcome, MeetingError> {
  const rule: Rule = RULES[action];
  if (!rule.from.includes(meeting.status)) {
    return err({ kind: "invalid_transition", action, from: meeting.status });
  }
  const to = rule.to === "previous" ? meeting.statusBeforeArchive : rule.to;
  if (to === null) return err({ kind: "invalid_transition", action, from: meeting.status });
  const next: Meeting = {
    ...meeting,
    ...extras.patch,
    status: to,
    statusBeforeArchive: action === "archive" ? meeting.status : null,
  };
  return ok({
    meeting: next,
    changed: true,
    events: [
      {
        kind: extras.eventKind ?? "meeting.status_changed",
        actor: extras.actor ?? rule.actor,
        detail: { from: meeting.status, to, ...extras.detail },
      },
    ],
    effects: extras.effects ?? [],
  });
}

/** The Owner explicitly confirms the consent statement. Repeats keep the first confirmation. */
export function confirmConsent(
  meeting: Meeting,
  input: { accepted: boolean },
  now: Date,
): Result<TransitionOutcome, MeetingError> {
  if (GONE.includes(meeting.status)) {
    return err({ kind: "invalid_transition", action: "confirm_consent", from: meeting.status });
  }
  if (meeting.consentConfirmedAt !== null) return unchanged(meeting);
  if (meeting.status !== "scheduled") {
    return err({ kind: "invalid_transition", action: "confirm_consent", from: meeting.status });
  }
  if (!input.accepted) return err({ kind: "consent_not_given" });
  return ok({
    meeting: {
      ...meeting,
      consentConfirmedAt: now.toISOString(),
      consentStatementVersion: CONSENT_STATEMENT_VERSION,
    },
    changed: true,
    events: [
      {
        kind: "meeting.consent_confirmed",
        actor: "owner",
        detail: { statementVersion: CONSENT_STATEMENT_VERSION },
      },
    ],
    effects: [],
  });
}

/** Capture cannot start without a stored consent confirmation (server-enforced). */
export function startCapture(meeting: Meeting, now: Date): Result<TransitionOutcome, MeetingError> {
  if (meeting.status === "capturing") return unchanged(meeting);
  if (meeting.status === "scheduled" && meeting.consentConfirmedAt === null) {
    return err({ kind: "consent_required" });
  }
  return transition(meeting, "start_capture", {
    patch: { captureStartedAt: now.toISOString() },
  });
}

export function pauseCapture(
  meeting: Meeting,
  _now: Date,
): Result<TransitionOutcome, MeetingError> {
  if (meeting.status === "paused") return unchanged(meeting);
  return transition(meeting, "pause");
}

export function resumeCapture(
  meeting: Meeting,
  _now: Date,
): Result<TransitionOutcome, MeetingError> {
  if (meeting.status === "capturing") return unchanged(meeting);
  return transition(meeting, "resume");
}

/** Stopping queues exactly one transcription job; a repeat is a no-op. */
export function stopCapture(meeting: Meeting, now: Date): Result<TransitionOutcome, MeetingError> {
  if (meeting.status === "processing") return unchanged(meeting);
  return transition(meeting, "stop_capture", {
    patch: { captureEndedAt: now.toISOString() },
    effects: [transcribeJob(meeting.id, false)],
  });
}

export function completeProcessing(
  meeting: Meeting,
  _now: Date,
): Result<TransitionOutcome, MeetingError> {
  return transition(meeting, "complete_processing");
}

export function failProcessing(
  meeting: Meeting,
  _now: Date,
): Result<TransitionOutcome, MeetingError> {
  return transition(meeting, "fail_processing");
}

/** Owner retry after a failure: re-queues the same job key; only failed chunks are redone. */
export function retryProcessing(
  meeting: Meeting,
  _now: Date,
): Result<TransitionOutcome, MeetingError> {
  return transition(meeting, "retry_processing", { effects: [transcribeJob(meeting.id, true)] });
}

/** Publishing is a person's decision and needs a folder that belongs to the same Owner. */
export function publishMeeting(
  meeting: Meeting,
  folder: { id: string; ownerId: string } | null,
  _now: Date,
): Result<TransitionOutcome, MeetingError> {
  if (meeting.status === "published") return unchanged(meeting);
  if (meeting.status === "review") {
    if (folder === null) return err({ kind: "folder_required" });
    if (folder.ownerId !== meeting.ownerId) return err({ kind: "folder_not_owned" });
  }
  return transition(meeting, "publish", {
    eventKind: "meeting.published",
    detail: { folderId: folder?.id ?? null },
  });
}

export function reopenMeeting(
  meeting: Meeting,
  _now: Date,
): Result<TransitionOutcome, MeetingError> {
  return transition(meeting, "reopen");
}

export function archiveMeeting(
  meeting: Meeting,
  _now: Date,
): Result<TransitionOutcome, MeetingError> {
  return transition(meeting, "archive");
}

export function unarchiveMeeting(
  meeting: Meeting,
  _now: Date,
): Result<TransitionOutcome, MeetingError> {
  return transition(meeting, "unarchive");
}

/**
 * Irreversible. Hides the meeting everywhere and queues exactly one deletion job. `retention`
 * is the sweeper acting on the owner's retention period: recorded as the system, with the reason.
 */
export function requestDeletion(
  meeting: Meeting,
  _now: Date,
  trigger: "owner" | "retention" = "owner",
): Result<TransitionOutcome, MeetingError> {
  if (meeting.status === "deleting") return unchanged(meeting);
  return transition(meeting, "request_deletion", {
    ...(trigger === "retention" ? { actor: "system" as const, detail: { trigger } } : {}),
    effects: [
      {
        kind: "enqueue_job",
        jobKind: "delete",
        jobKey: `delete:${meeting.id}`,
        requeueIfFailed: true,
      },
    ],
  });
}

/** System only, after the deletion job has removed files and derived data. Terminal. */
export function completeDeletion(
  meeting: Meeting,
  _now: Date,
): Result<TransitionOutcome, MeetingError> {
  return transition(meeting, "complete_deletion");
}

function transcribeJob(meetingId: string, requeueIfFailed: boolean): Effect {
  return {
    kind: "enqueue_job",
    jobKind: "transcribe",
    jobKey: `transcribe:${meetingId}`,
    requeueIfFailed,
  };
}
