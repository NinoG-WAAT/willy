import type { DatabaseSync } from "node:sqlite";
import type { Meeting, TransitionOutcome } from "../../domain/meetings/lifecycle";
import type { IdGenerator } from "../../ports/id-generator";

const MAX_JOB_ATTEMPTS = 5;

/**
 * Writes one lifecycle outcome: the meeting row (only if its status is still `expected.status`),
 * the audit events and the effects (job rows, unique by job key). It does NOT open a transaction:
 * callers wrap it, so the same statements can run together with other writes (for example the
 * generated note) atomically. Returns "conflict", having written nothing, when the row changed
 * meanwhile or is not owned by `ownerId`.
 */
export function applyTransitionRows(
  db: DatabaseSync,
  ids: IdGenerator,
  nowDate: Date,
  ownerId: string,
  expected: Meeting,
  outcome: TransitionOutcome,
): "applied" | "conflict" {
  const now = nowDate.toISOString();
  const next = outcome.meeting;
  const updated = db
    .prepare(
      `UPDATE meeting
       SET status = ?, status_before_archive = ?, consent_confirmed_at = ?,
           consent_statement_version = ?, capture_started_at = ?, capture_ended_at = ?,
           updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = ?`,
    )
    .run(
      next.status,
      next.statusBeforeArchive,
      next.consentConfirmedAt,
      next.consentStatementVersion,
      next.captureStartedAt,
      next.captureEndedAt,
      now,
      expected.id,
      ownerId,
      expected.status,
    );
  if (updated.changes !== 1) return "conflict";

  for (const event of outcome.events) {
    db.prepare(
      `INSERT INTO audit_event (id, owner_id, meeting_id, kind, actor, detail_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ids.newId(),
      ownerId,
      expected.id,
      event.kind,
      event.actor,
      JSON.stringify(event.detail),
      now,
    );
  }

  for (const effect of outcome.effects) {
    // One job per job_key. A retry may reset a failed job; a live job is never disturbed.
    const conflictClause = effect.requeueIfFailed
      ? `ON CONFLICT (job_key) DO UPDATE SET status = 'pending', attempts = 0,
           last_error_code = NULL, next_run_at = excluded.next_run_at, updated_at = excluded.updated_at
         WHERE job.status = 'failed'`
      : "ON CONFLICT (job_key) DO NOTHING";
    db.prepare(
      `INSERT INTO job (id, owner_id, meeting_id, kind, job_key, status, attempts, max_attempts,
                        next_run_at, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, '{}', ?, ?) ${conflictClause}`,
    ).run(
      ids.newId(),
      ownerId,
      expected.id,
      effect.jobKind,
      effect.jobKey,
      MAX_JOB_ATTEMPTS,
      now,
      now,
      now,
    );
  }
  return "applied";
}
