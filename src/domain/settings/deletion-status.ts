import { t, tn } from "../../i18n/translate";
import { displayableErrorCode } from "./error-code";

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
 * The server and the live-update script both call it, so the words are in the page language in
 * both (the strings live in the client catalog).
 */
export function describeDeletion(job: DeletionJobView): DeletionDescription {
  // The code is shown as a code, never translated; the sentence around it is.
  const reason = job.lastErrorCode === null ? "" : ` (${displayableErrorCode(job.lastErrorCode)})`;
  switch (job.status) {
    case "pending":
      return {
        state: "pending",
        label: t("Queued"),
        detail: t(
          "The meeting is already hidden. Removing its files and records has not started yet.",
        ),
        inProgress: true,
        canRetry: false,
      };
    case "running":
      return {
        state: "running",
        label: t("Deleting"),
        detail: t("The meeting is already hidden. Its files and records are being removed."),
        inProgress: true,
        canRetry: false,
      };
    case "retrying":
      return {
        state: "retrying",
        label: t("Retrying"),
        detail: t(
          "Attempt {attempt} of {max} did not finish{reason}. It will try again automatically.",
          {
            attempt: job.attempts,
            max: job.maxAttempts,
            reason,
          },
        ),
        inProgress: true,
        canRetry: false,
      };
    case "failed":
      return {
        state: "failed",
        label: t("Failed"),
        detail: tn(
          "Deletion stopped after {n} attempt{reason}. The meeting stays hidden. It will be retried automatically within the hour, or you can retry now.",
          "Deletion stopped after {n} attempts{reason}. The meeting stays hidden. It will be retried automatically within the hour, or you can retry now.",
          job.attempts,
          { reason },
        ),
        inProgress: false,
        canRetry: true,
      };
    case "succeeded":
      return {
        state: "succeeded",
        label: t("Deleted"),
        detail: t("The note, transcript, audio and search entries are gone."),
        inProgress: false,
        canRetry: false,
      };
  }
}
