import type { DatabaseSync } from "node:sqlite";
import type { Meeting, MeetingStatus, TransitionOutcome } from "../../domain/meetings/lifecycle";
import type { Clock } from "../../ports/clock";
import type { IdGenerator } from "../../ports/id-generator";
import type { MeetingRepository } from "../../ports/meeting-repository";
import { applyTransitionRows } from "./meeting-transition";
import { inTransaction } from "./transaction";

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
    try {
      return Promise.resolve(
        inTransaction(this.db, () =>
          applyTransitionRows(this.db, this.ids, this.clock.now(), ownerId, expected, outcome),
        ),
      );
    } catch (cause) {
      return Promise.reject(cause instanceof Error ? cause : new Error("transition failed"));
    }
  }

  erase(
    ownerId: string,
    meeting: Meeting,
    outcome: TransitionOutcome,
  ): Promise<"erased" | "conflict"> {
    const now = this.clock.now().toISOString();
    try {
      return Promise.resolve(
        inTransaction(this.db, () => {
          const db = this.db;
          // Re-check inside the transaction: only a meeting that is still being deleted is erased.
          const live = db
            .prepare("SELECT id FROM meeting WHERE id = ? AND owner_id = ? AND status = 'deleting'")
            .get(meeting.id, ownerId);
          if (!live) return "conflict" as const;
          db.prepare("DELETE FROM search_index WHERE owner_id = ? AND meeting_id = ?").run(
            ownerId,
            meeting.id,
          );
          // Notes first (they cascade to sections, decisions and action items, which reference
          // attendees), then attendees, then chunks (which cascade to transcript segments).
          db.prepare("DELETE FROM note WHERE owner_id = ? AND meeting_id = ?").run(
            ownerId,
            meeting.id,
          );
          db.prepare("DELETE FROM attendee WHERE owner_id = ? AND meeting_id = ?").run(
            ownerId,
            meeting.id,
          );
          db.prepare("DELETE FROM audio_chunk WHERE owner_id = ? AND meeting_id = ?").run(
            ownerId,
            meeting.id,
          );
          db.prepare(
            `UPDATE meeting
             SET status = 'deleted', status_before_archive = NULL, title = '', agenda = NULL,
                 rough_notes = NULL, calendar_provider = NULL, provider_event_id = NULL,
                 template_id = NULL, deleted_at = ?, updated_at = ?
             WHERE id = ? AND owner_id = ? AND status = 'deleting'`,
          ).run(now, now, meeting.id, ownerId);
          for (const event of outcome.events) {
            db.prepare(
              `INSERT INTO audit_event (id, owner_id, meeting_id, kind, actor, detail_json, occurred_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).run(
              this.ids.newId(),
              ownerId,
              meeting.id,
              event.kind,
              event.actor,
              JSON.stringify(event.detail),
              now,
            );
          }
          return "erased" as const;
        }),
      );
    } catch (cause) {
      return Promise.reject(
        cause instanceof Error ? cause : new Error("erasing the meeting failed"),
      );
    }
  }

  listExpiredForRetention(ownerId: string, now: Date, limit: number): Promise<string[]> {
    const rows = this.db
      .prepare(
        `SELECT m.id FROM meeting m
         JOIN settings s ON s.owner_id = m.owner_id
         WHERE m.owner_id = ? AND s.note_retention_days IS NOT NULL
           AND m.status IN ('review', 'published', 'archived', 'failed')
           AND julianday(m.scheduled_start_at) + s.note_retention_days <= julianday(?)
         ORDER BY m.scheduled_start_at LIMIT ?`,
      )
      .all(ownerId, now.toISOString(), limit);
    return Promise.resolve(rows.map((r) => String(r["id"])));
  }
}
