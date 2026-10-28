import type { DatabaseSync } from "node:sqlite";
import type { DeletionStatusQuery, DeletionStatusRow } from "../../ports/deletion-status-query";

const COLUMNS =
  "meeting_id, status, attempts, max_attempts, next_run_at, last_error_code, created_at, updated_at";

function toRow(r: Record<string, unknown>): DeletionStatusRow {
  return {
    meetingId: String(r["meeting_id"]),
    status: String(r["status"]) as DeletionStatusRow["status"],
    attempts: Number(r["attempts"]),
    maxAttempts: Number(r["max_attempts"]),
    nextRunAt: typeof r["next_run_at"] === "string" ? r["next_run_at"] : null,
    lastErrorCode: typeof r["last_error_code"] === "string" ? r["last_error_code"] : null,
    requestedAt: String(r["created_at"]),
    updatedAt: String(r["updated_at"]),
  };
}

/**
 * Reads only the job table, so no meeting content can leak into the panel; every statement is
 * scoped by owner_id.
 */
export class SqliteDeletionStatusQuery implements DeletionStatusQuery {
  constructor(private readonly db: DatabaseSync) {}

  listForOwner(ownerId: string, limit: number): Promise<DeletionStatusRow[]> {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM job
          WHERE owner_id = ? AND kind = 'delete' AND meeting_id IS NOT NULL
          ORDER BY updated_at DESC, id
          LIMIT ?`,
      )
      .all(ownerId, limit);
    return Promise.resolve(rows.map(toRow));
  }

  findForMeeting(ownerId: string, meetingId: string): Promise<DeletionStatusRow | null> {
    const row = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM job WHERE owner_id = ? AND kind = 'delete' AND meeting_id = ?`,
      )
      .get(ownerId, meetingId);
    return Promise.resolve(row ? toRow(row) : null);
  }
}
