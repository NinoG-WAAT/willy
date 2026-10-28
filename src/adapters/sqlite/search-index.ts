import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { MeetingStatus } from "../../domain/meetings/lifecycle";
import { highlightSegments } from "../../domain/search/highlight";
import type { SearchHit, SearchIndex, SearchQuery } from "../../ports/search-index";
import { rebuildMissingMeetingRows } from "./search-rows";

const SNIPPET_TOKENS = 24;

/**
 * Full-text search over the derived `search_index` (FTS5). The owner filter is part of the same
 * statement as MATCH, joined meetings must belong to that owner too, and meetings being deleted
 * or deleted never match. Highlight markers carry a per-query random nonce, so text stored in
 * the index cannot forge a highlight.
 */
export class SqliteSearchIndex implements SearchIndex {
  constructor(private readonly db: DatabaseSync) {}

  /** Fills in meeting rows that are missing (run at start-up; the index is rebuildable). */
  rebuildMissingMeetingRows(): void {
    rebuildMissingMeetingRows(this.db);
  }

  search(ownerId: string, query: SearchQuery): Promise<SearchHit[]> {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const markers = { start: `\uE000${nonce}\uE001`, end: `\uE002${nonce}\uE003` };
    const params: SQLInputValue[] = [markers.start, markers.end, query.match, ownerId, ownerId];
    let where =
      "search_index MATCH ? AND search_index.owner_id = ? AND m.owner_id = ? AND m.status NOT IN ('deleting', 'deleted')";
    if (!query.includeArchived) where += " AND m.status <> 'archived'";
    if (query.folderId !== null) {
      where += " AND n.folder_id = ?";
      params.push(query.folderId);
    }
    params.push(query.limit);

    const rows = this.db
      .prepare(
        `SELECT search_index.meeting_id, search_index.kind, search_index.ref_id, search_index.title AS label,
                snippet(search_index, -1, ?, ?, '…', ${String(SNIPPET_TOKENS)}) AS excerpt,
                m.title AS meeting_title, m.status, m.scheduled_start_at, m.timezone,
                f.name AS folder_name
           FROM search_index
           JOIN meeting m ON m.id = search_index.meeting_id
           LEFT JOIN note n ON n.owner_id = m.owner_id AND n.meeting_id = m.id
           LEFT JOIN folder f ON f.owner_id = n.owner_id AND f.id = n.folder_id
          WHERE ${where}
          ORDER BY bm25(search_index, 5.0, 1.0), search_index.rowid
          LIMIT ?`,
      )
      .all(...params);

    return Promise.resolve(
      rows.map((r): SearchHit => {
        const folder = r["folder_name"];
        return {
          meetingId: String(r["meeting_id"]),
          kind: String(r["kind"]),
          refId: String(r["ref_id"]),
          label: String(r["label"]),
          meetingTitle: String(r["meeting_title"]),
          status: String(r["status"]) as MeetingStatus,
          scheduledStartAt: String(r["scheduled_start_at"]),
          timezone: String(r["timezone"]),
          folderName: typeof folder === "string" ? folder : null,
          segments: highlightSegments(String(r["excerpt"]), markers),
        };
      }),
    );
  }
}
