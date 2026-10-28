import type { DatabaseSync } from "node:sqlite";

const LIVE = "status NOT IN ('deleting', 'deleted')";

/**
 * Rebuilds the one `meeting` row of the search index (title, agenda, rough notes) from the
 * meeting itself. The index is derived data: this is the only writer of `kind = 'meeting'` rows,
 * called inside the transaction of every change to those fields. A meeting being deleted gets no
 * row (and the trigger on `meeting` has already removed its hits).
 */
export function reindexMeetingRow(db: DatabaseSync, ownerId: string, meetingId: string): void {
  db.prepare(
    "DELETE FROM search_index WHERE owner_id = ? AND meeting_id = ? AND kind = 'meeting'",
  ).run(ownerId, meetingId);
  const meeting = db
    .prepare(
      `SELECT title, agenda, rough_notes FROM meeting WHERE owner_id = ? AND id = ? AND ${LIVE}`,
    )
    .get(ownerId, meetingId);
  if (!meeting) return;
  const body = [meeting["agenda"], meeting["rough_notes"]]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join("\n");
  db.prepare(
    `INSERT INTO search_index (title, body, owner_id, meeting_id, kind, ref_id)
     VALUES (?, ?, ?, ?, 'meeting', ?)`,
  ).run(String(meeting["title"]), body, ownerId, meetingId, meetingId);
}

/** Fills in meetings that have no `meeting` row yet (older data, seeds). Safe to run repeatedly. */
export function rebuildMissingMeetingRows(db: DatabaseSync): void {
  const missing = db
    .prepare(
      `SELECT m.owner_id AS owner_id, m.id AS id FROM meeting m
        WHERE m.${LIVE}
          AND NOT EXISTS (SELECT 1 FROM search_index s WHERE s.meeting_id = m.id AND s.kind = 'meeting')`,
    )
    .all();
  for (const row of missing) reindexMeetingRow(db, String(row["owner_id"]), String(row["id"]));
}
