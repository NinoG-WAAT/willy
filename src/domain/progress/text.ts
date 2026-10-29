import { describeMeeting } from "../meetings/home";
import type { MeetingStatus } from "../meetings/lifecycle";
import { describeDeletion, type DeletionDescription } from "../settings/deletion-status";

/**
 * Words and decisions for job progress, shared by the server-rendered pages and the polling
 * script so a reload and a live update always say the same thing. Pure: the script only moves
 * the strings into the page. Inputs are codes and counters from the status endpoints, never
 * titles, notes or transcript text.
 */

export type JobState = "pending" | "running" | "retrying" | "succeeded" | "failed";
const JOB_STATES: readonly string[] = ["pending", "running", "retrying", "succeeded", "failed"];

export interface JobProgress {
  status: JobState;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string | null;
  lastErrorCode: string | null;
}

const MEETING_STATUSES: readonly string[] = [
  "scheduled",
  "capturing",
  "paused",
  "processing",
  "review",
  "published",
  "failed",
  "archived",
  "deleting",
  "deleted",
] satisfies MeetingStatus[];

export interface ProcessingPayload {
  meetingStatus: MeetingStatus;
  /** Transcription. */
  job: JobProgress | null;
  summary: JobProgress | null;
  regeneration: (JobProgress & { sectionId: string }) | null;
}

export interface DeletionProgressRow extends Omit<JobProgress, "status"> {
  meetingId: string;
  status: JobState;
}

/** What to write into the page: text by field name, whether to stop polling, an extra announcement. */
export interface ProgressView {
  fields: Record<string, string>;
  settled: boolean;
  announce: string | null;
}

export function describeJob(job: JobProgress | null): string {
  if (job === null) return "Not started";
  switch (job.status) {
    case "pending":
      return "Waiting to start";
    case "running":
      return "Running";
    case "retrying":
      return `Retrying (attempt ${String(job.attempts)} of ${String(job.maxAttempts)})`;
    case "failed":
      return `Failed after ${String(job.attempts)} attempts${job.lastErrorCode === null ? "" : ` (${job.lastErrorCode})`}`;
    case "succeeded":
      return "Done";
  }
}

/** The transcript and summary lines of a meeting that is still being prepared. */
export function processingProgress(payload: ProcessingPayload): ProgressView {
  const fields: Record<string, string> = {
    transcript: `Transcript: ${describeJob(payload.job)}`,
    summary: `Summary: ${describeJob(payload.summary)}`,
    outcome: "",
  };
  const settled = payload.meetingStatus !== "processing";
  if (settled) {
    if (payload.meetingStatus === "review") {
      fields["outcome"] = "Your draft is ready. Use Check again to open it.";
      fields["badge"] = "Draft: not published";
    } else if (payload.meetingStatus === "failed") {
      fields["outcome"] =
        "Processing did not finish. Use Check again to see what happened and retry. Your rough notes are kept.";
      fields["badge"] = "Processing needs attention";
    } else {
      fields["outcome"] = "This note has moved on. Use Check again to see where it is now.";
    }
  }
  return { fields, settled, announce: null };
}

/** The latest "regenerate this section" request, if it is the one for this section. */
export function regenerationProgress(payload: ProcessingPayload, sectionId: string): ProgressView {
  const regeneration = payload.regeneration;
  if (regeneration?.sectionId !== sectionId) return { fields: {}, settled: false, announce: null };
  const fields: Record<string, string> = {
    text: `Regeneration: ${describeJob(regeneration)}.`,
    outcome: "",
  };
  if (regeneration.status === "succeeded") {
    fields["outcome"] = "The new draft of this section is ready. Use Check again to see it.";
  } else if (regeneration.status === "failed") {
    fields["outcome"] = "It did not finish. Use Check again to see the details and try again.";
  }
  return {
    fields,
    settled: regeneration.status === "succeeded" || regeneration.status === "failed",
    announce: null,
  };
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** A meeting card on the home screen: new status words, and an announcement once it settles. */
export function cardProgress(
  payload: ProcessingPayload,
  title: string,
  meetingId: string,
): ProgressView {
  const settled = payload.meetingStatus !== "processing";
  const description = describeMeeting({
    id: meetingId,
    status: payload.meetingStatus,
    folderName: null,
  });
  return {
    fields: {
      label: description.label,
      action: description.actionLabel,
      marker: description.marker,
    },
    settled,
    announce: settled ? `${title}: ${lowerFirst(description.label)}.` : null,
  };
}

export type DeletionRowProgress = DeletionDescription & { settled: boolean };

export function deletionRowProgress(
  row: Omit<DeletionProgressRow, "meetingId">,
): DeletionRowProgress {
  const description = describeDeletion(row);
  return { ...description, settled: !description.inProgress };
}

export type StopReason = "settled" | "unavailable" | "errors" | "timeout";

/** Said once when live updates end without a result, so nobody waits for news that will not come. */
export function stoppedMessage(reason: Exclude<StopReason, "settled">): string {
  switch (reason) {
    case "errors":
      return "Live updates stopped because the status could not be checked. Use Check again to see the latest.";
    case "timeout":
      return "Live updates stopped after a while. Use Check again to see the latest.";
    case "unavailable":
      return "Live updates stopped. Use Check again, or sign in again, to see the latest.";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function parseJob(value: unknown): JobProgress | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { status, attempts, maxAttempts, nextRunAt, lastErrorCode } = value;
  if (typeof status !== "string" || !JOB_STATES.includes(status)) return undefined;
  if (typeof attempts !== "number" || typeof maxAttempts !== "number") return undefined;
  if (nextRunAt !== null && typeof nextRunAt !== "string") return undefined;
  if (lastErrorCode !== null && typeof lastErrorCode !== "string") return undefined;
  return { status: status as JobState, attempts, maxAttempts, nextRunAt, lastErrorCode };
}

/** Checks the meeting status endpoint's answer; anything unexpected is null, never a guess. */
export function parseProcessingPayload(body: unknown): ProcessingPayload | null {
  if (!isRecord(body)) return null;
  const meetingStatus = body["meetingStatus"];
  if (typeof meetingStatus !== "string" || !MEETING_STATUSES.includes(meetingStatus)) return null;
  const job = parseJob(body["job"]);
  const summary = parseJob(body["summary"]);
  const regenerationRaw = body["regeneration"];
  const regeneration = parseJob(regenerationRaw);
  if (job === undefined || summary === undefined || regeneration === undefined) return null;
  const sectionId = isRecord(regenerationRaw) ? regenerationRaw["sectionId"] : null;
  if (regeneration !== null && typeof sectionId !== "string") return null;
  return {
    meetingStatus: meetingStatus as MeetingStatus,
    job,
    summary,
    regeneration: regeneration === null ? null : { ...regeneration, sectionId: String(sectionId) },
  };
}

/** Checks the deletions endpoint's answer, keeping only well-formed rows. */
export function parseDeletionsPayload(body: unknown): DeletionProgressRow[] | null {
  if (!isRecord(body) || !Array.isArray(body["deletions"])) return null;
  const rows: DeletionProgressRow[] = [];
  for (const entry of body["deletions"] as unknown[]) {
    const job = parseJob(entry);
    if (!job || !isRecord(entry) || typeof entry["meetingId"] !== "string") continue;
    rows.push({ meetingId: entry["meetingId"], ...job });
  }
  return rows;
}
