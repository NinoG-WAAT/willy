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
}
