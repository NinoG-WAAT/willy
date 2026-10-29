import type { DeletionStatusQuery } from "../../ports/deletion-status-query";

/** The same ten the settings screen lists, so the page and its live updates cover the same rows. */
const PANEL_LIMIT = 10;

export interface DeletionProgress {
  meetingId: string;
  status: "pending" | "running" | "succeeded" | "retrying" | "failed";
  attempts: number;
  maxAttempts: number;
  nextRunAt: string | null;
  lastErrorCode: string | null;
}

/**
 * What the settings screen polls while a deletion runs. Owner-scoped by the session's owner id
 * (there is no id in the request to guess); lists ids, state and counters only. Rows are picked
 * field by field, so no title or other meeting content can ride along.
 */
export async function getDeletionProgress(
  deps: { deletions: DeletionStatusQuery },
  ownerId: string,
): Promise<DeletionProgress[]> {
  const rows = await deps.deletions.listForOwner(ownerId, PANEL_LIMIT);
  return rows.map((row) => ({
    meetingId: row.meetingId,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextRunAt: row.nextRunAt,
    lastErrorCode: row.lastErrorCode,
  }));
}
