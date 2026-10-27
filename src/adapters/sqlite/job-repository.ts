import type { DatabaseSync } from "node:sqlite";
import type { IdGenerator } from "../../ports/id-generator";
import type { JobKind, JobRepository, JobRow, JobStatus, NewJob } from "../../ports/job-repository";

const MAX_ATTEMPTS = 5;

function toJobRow(r: Record<string, unknown>): JobRow {
  const meetingId = r["meeting_id"];
  const nextRunAt = r["next_run_at"];
  const lastError = r["last_error_code"];
  return {
    id: String(r["id"]),
    ownerId: String(r["owner_id"]),
    meetingId: typeof meetingId === "string" ? meetingId : null,
    kind: String(r["kind"]) as JobKind,
    jobKey: String(r["job_key"]),
    status: String(r["status"]) as JobStatus,
    attempts: Number(r["attempts"]),
    maxAttempts: Number(r["max_attempts"]),
    nextRunAt: typeof nextRunAt === "string" ? nextRunAt : null,
    lastErrorCode: typeof lastError === "string" ? lastError : null,
  };
}

export class SqliteJobRepository implements JobRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ids: IdGenerator,
  ) {}

  claimNext(now: Date, kinds: readonly JobKind[], leaseMs: number): Promise<JobRow | null> {
    if (kinds.length === 0) return Promise.resolve(null);
    const nowIso = now.toISOString();
    const staleBefore = new Date(now.getTime() - leaseMs).toISOString();
    const marks = kinds.map(() => "?").join(", ");
    // One statement, so two runners can never claim the same job. A stale `running` job (its
    // runner died) can be taken over even at the last attempt; MIN keeps attempts <= max.
    const row = this.db
      .prepare(
        `UPDATE job
         SET status = 'running', attempts = MIN(attempts + 1, max_attempts), updated_at = ?
         WHERE id = (
           SELECT id FROM job
           WHERE kind IN (${marks})
             AND ((status IN ('pending', 'retrying') AND attempts < max_attempts
                   AND (next_run_at IS NULL OR next_run_at <= ?))
               OR (status = 'running' AND updated_at <= ?))
           ORDER BY COALESCE(next_run_at, created_at), created_at, id
           LIMIT 1)
         RETURNING *`,
      )
      .get(nowIso, ...kinds, nowIso, staleBefore);
    return Promise.resolve(row ? toJobRow(row) : null);
  }

  markSucceeded(id: string, now: Date): Promise<void> {
    this.db
      .prepare(
        `UPDATE job SET status = 'succeeded', next_run_at = NULL, last_error_code = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(now.toISOString(), id);
    return Promise.resolve();
  }

  markRetrying(id: string, now: Date, nextRunAt: string, errorCode: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE job SET status = 'retrying', next_run_at = ?, last_error_code = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(nextRunAt, errorCode, now.toISOString(), id);
    return Promise.resolve();
  }

  markFailed(id: string, now: Date, errorCode: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE job SET status = 'failed', next_run_at = NULL, last_error_code = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(errorCode, now.toISOString(), id);
    return Promise.resolve();
  }

  enqueue(job: NewJob, now: Date): Promise<{ created: boolean }> {
    const iso = now.toISOString();
    const onConflict = job.requeueIfFailed
      ? `ON CONFLICT (job_key) DO UPDATE SET status = 'pending', attempts = 0, last_error_code = NULL,
           next_run_at = excluded.next_run_at, updated_at = excluded.updated_at
         WHERE job.status = 'failed'`
      : "ON CONFLICT (job_key) DO NOTHING";
    const result = this.db
      .prepare(
        `INSERT INTO job (id, owner_id, meeting_id, kind, job_key, status, attempts, max_attempts,
                          next_run_at, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, '{}', ?, ?)
         ${onConflict}`,
      )
      .run(
        this.ids.newId(),
        job.ownerId,
        job.meetingId,
        job.kind,
        job.jobKey,
        MAX_ATTEMPTS,
        iso,
        iso,
        iso,
      );
    return Promise.resolve({ created: result.changes === 1 });
  }

  findForMeeting(ownerId: string, meetingId: string, kind: JobKind): Promise<JobRow | null> {
    const row = this.db
      .prepare("SELECT * FROM job WHERE owner_id = ? AND meeting_id = ? AND kind = ?")
      .get(ownerId, meetingId, kind);
    return Promise.resolve(row ? toJobRow(row) : null);
  }
}
