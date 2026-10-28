import { summarizeErrorCode } from "./provider-status";

/** The slice of a deletion job the settings screen needs: state and counters, never content. */
export interface DeletionJobView {
  status: "pending" | "running" | "succeeded" | "retrying" | "failed";
  attempts: number;
  maxAttempts: number;
  nextRunAt: string | null;
  lastErrorCode: string | null;
}

export interface DeletionDescription {
  state: DeletionJobView["status"];
  label: string;
  detail: string;
  /** Still going: the screen keeps offering a way to look again. */
  inProgress: boolean;
  /** Only a stopped (failed) job can be retried by the owner. */
  canRetry: boolean;
}

/**
 * What the owner sees for a deletion after step one. From the moment it is requested the meeting
 * is hidden everywhere; this describes the job that removes files, the search index and records.
 */
export function describeDeletion(job: DeletionJobView): DeletionDescription {
  const reason = job.lastErrorCode === null ? null : summarizeErrorCode(job.lastErrorCode).code;
  switch (job.status) {
    case "pending":
      return {
        state: "pending",
        label: "Queued",
        detail:
          "The meeting is already hidden. Removing its files and records has not started yet.",
        inProgress: true,
        canRetry: false,
      };
    case "running":
      return {
        state: "running",
        label: "Deleting",
        detail: "The meeting is already hidden. Its files and records are being removed.",
        inProgress: true,
        canRetry: false,
      };
    case "retrying":
      return {
        state: "retrying",
        label: "Retrying",
        detail: `Attempt ${String(job.attempts)} of ${String(job.maxAttempts)} did not finish${reason ? ` (${reason})` : ""}. It will try again automatically.`,
        inProgress: true,
        canRetry: false,
      };
    case "failed":
      return {
        state: "failed",
        label: "Failed",
        detail: `Deletion stopped after ${String(job.attempts)} attempts${reason ? ` (${reason})` : ""}. The meeting stays hidden. It will be retried automatically within the hour, or you can retry now.`,
        inProgress: false,
        canRetry: true,
      };
    case "succeeded":
      return {
        state: "succeeded",
        label: "Deleted",
        detail: "The note, transcript, audio and search entries are gone.",
        inProgress: false,
        canRetry: false,
      };
  }
}
