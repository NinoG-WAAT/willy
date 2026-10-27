export type JobKind = "transcribe" | "summarize" | "delete" | "retention" | "calendar_sync";
export type JobStatus = "pending" | "running" | "succeeded" | "retrying" | "failed";

export interface JobRow {
  id: string;
  ownerId: string;
  /** Null for owner-level jobs such as retention. */
  meetingId: string | null;
  kind: JobKind;
  jobKey: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string | null;
  /** A redacted code (for example `stt_unavailable`), never provider or user content. */
  lastErrorCode: string | null;
}

export interface NewJob {
  ownerId: string;
  meetingId: string | null;
  kind: JobKind;
  /** Unique per logical side effect: enqueueing the same key twice yields one job. */
  jobKey: string;
  /**
   * A `failed` job with this key is reset to pending (recovery after the owner's retry). A
   * pending, running or finished job is never disturbed.
   */
  requeueIfFailed?: boolean;
}

export interface JobRepository {
  /**
   * Atomically claims one due job of the given kinds: `pending` or `retrying` jobs whose
   * `next_run_at` has passed, or `running` jobs whose lease (last update) is older than
   * `leaseMs` (the runner crashed). The claim increments `attempts`.
   */
  claimNext(now: Date, kinds: readonly JobKind[], leaseMs: number): Promise<JobRow | null>;
  markSucceeded(id: string, now: Date): Promise<void>;
  markRetrying(id: string, now: Date, nextRunAt: string, errorCode: string): Promise<void>;
  markFailed(id: string, now: Date, errorCode: string): Promise<void>;
  /** Idempotent by `jobKey`. */
  enqueue(job: NewJob, now: Date): Promise<{ created: boolean }>;
  /** Owner-scoped read for status polling. */
  findForMeeting(ownerId: string, meetingId: string, kind: JobKind): Promise<JobRow | null>;
}
