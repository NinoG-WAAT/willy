import type { DatabaseSync } from "node:sqlite";
import type { Meeting, MeetingStatus, TransitionOutcome } from "../../domain/meetings/lifecycle";
import type { Clock } from "../../ports/clock";
import type { IdGenerator } from "../../ports/id-generator";
import type { MeetingRepository } from "../../ports/meeting-repository";

const MAX_JOB_ATTEMPTS = 5;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export class SqliteMeetingRepository implements MeetingRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  findById(ownerId: string, meetingId: string): Promise<Meeting | null> {
    const r = this.db
      .prepare(
        `SELECT id, owner_id, status, status_before_archive, consent_confirmed_at,
                consent_statement_version, capture_started_at, capture_ended_at
         FROM meeting WHERE id = ? AND owner_id = ?`,
      )
      .get(meetingId, ownerId);
    if (!r) return Promise.resolve(null);
    const version = r["consent_statement_version"];
    return Promise.resolve({
      id: String(r["id"]),
      ownerId: String(r["owner_id"]),
      status: String(r["status"]) as MeetingStatus,
      statusBeforeArchive: text(r["status_before_archive"]) as MeetingStatus | null,
      consentConfirmedAt: text(r["consent_confirmed_at"]),
      consentStatementVersion: typeof version === "number" ? version : null,
      captureStartedAt: text(r["capture_started_at"]),
      captureEndedAt: text(r["capture_ended_at"]),
    });
  }

  applyTransition(
    ownerId: string,
    expected: Meeting,
    outcome: TransitionOutcome,
  ): Promise<"applied" | "conflict"> {
    const now = this.clock.now().toISOString();
    const next = outcome.meeting;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const updated = this.db
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
      if (updated.changes !== 1) {
        this.db.exec("ROLLBACK");
        return Promise.resolve("conflict");
      }

      for (const event of outcome.events) {
        this.db
          .prepare(
            `INSERT INTO audit_event (id, owner_id, meeting_id, kind, actor, detail_json, occurred_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.ids.newId(),
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
        this.db
          .prepare(
            `INSERT INTO job (id, owner_id, meeting_id, kind, job_key, status, attempts, max_attempts,
                              next_run_at, payload_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, '{}', ?, ?) ${conflictClause}`,
          )
          .run(
            this.ids.newId(),
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

      this.db.exec("COMMIT");
      return Promise.resolve("applied");
    } catch (cause) {
      this.db.exec("ROLLBACK");
      return Promise.reject(cause instanceof Error ? cause : new Error("transition failed"));
    }
  }
}
