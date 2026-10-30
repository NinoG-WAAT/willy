import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { MeetingListItem } from "../../domain/meetings/list-item";
import { INBOX_SECTION_LIMIT, upcomingBounds } from "../../domain/meetings/inbox";
import { statusesOf, type NotesFilter } from "../../domain/notes/notes-filter";
import type {
  AllNotesQuery,
  InboxQuery,
  InboxSection,
  InboxSections,
  NotesWindow,
} from "../../ports/note-list";
import { MEETING_CARD_COLUMNS, toMeetingListItem } from "./meeting-list-row";

const FROM_CARD = `FROM meeting m
           LEFT JOIN note n ON n.owner_id = m.owner_id AND n.meeting_id = m.id
           LEFT JOIN folder f ON f.owner_id = n.owner_id AND f.id = n.folder_id`;

/** Deleting and deleted meetings are excluded here and nowhere else, so no list can forget it. */
const VISIBLE = "m.owner_id = ? AND m.status NOT IN ('deleting', 'deleted')";

/**
 * A scheduled meeting is upcoming until its end; one with no end counts an hour from its start.
 * A CASE, not OR: a NULL end must give a plain true or false so that NOT is safe to apply.
 */
const IS_UPCOMING =
  "(CASE WHEN m.scheduled_end_at IS NULL THEN m.scheduled_start_at >= ? ELSE m.scheduled_end_at >= ? END)";

/**
 * The Inbox and All notes read models. Both use the card columns of meeting-list-row.ts, so a
 * row looks the same wherever it is listed. Every statement carries owner_id from the session
 * and binds every value.
 */
export class SqliteNoteLists implements InboxQuery, AllNotesQuery {
  constructor(private readonly db: DatabaseSync) {}

  inbox(ownerId: string, now: Date): Promise<InboxSections> {
    const { endsAfter, openEndedStartsAfter } = upcomingBounds(now);
    const upcomingParams = [openEndedStartsAfter, endsAfter];
    return Promise.resolve({
      inProgress: this.section(
        ownerId,
        "m.status IN ('capturing', 'paused', 'processing', 'failed')",
        [],
        "DESC",
      ),
      upcoming: this.section(
        ownerId,
        `m.status = 'scheduled' AND ${IS_UPCOMING}`,
        upcomingParams,
        "ASC",
      ),
      missed: this.section(
        ownerId,
        `m.status = 'scheduled' AND NOT ${IS_UPCOMING}`,
        upcomingParams,
        "DESC",
      ),
      drafts: this.section(ownerId, "m.status = 'review'", [], "DESC"),
    });
  }

  count(ownerId: string, filter: NotesFilter): Promise<number> {
    const { where, params } = this.filterClause(ownerId, filter);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total ${FROM_CARD} WHERE ${where}`)
      .get(...params);
    return Promise.resolve(Number(row?.["total"] ?? 0));
  }

  list(ownerId: string, filter: NotesFilter, window: NotesWindow): Promise<MeetingListItem[]> {
    const { where, params } = this.filterClause(ownerId, filter);
    const rows = this.db
      .prepare(
        `SELECT ${MEETING_CARD_COLUMNS} ${FROM_CARD}
          WHERE ${where}
          ORDER BY m.scheduled_start_at DESC, m.id
          LIMIT ? OFFSET ?`,
      )
      .all(...params, window.limit, window.offset);
    return Promise.resolve(rows.map(toMeetingListItem));
  }

  /** `where` is built from fixed fragments only; every value goes through `params`. */
  private filterClause(
    ownerId: string,
    filter: NotesFilter,
  ): { where: string; params: SQLInputValue[] } {
    const params: SQLInputValue[] = [ownerId];
    let where = VISIBLE;
    const statuses = statusesOf(filter.status);
    if (statuses !== null) {
      where += ` AND m.status IN (${statuses.map(() => "?").join(", ")})`;
      params.push(...statuses);
    }
    if (filter.folderId !== null) {
      // The folder view's rule: a note counts in a folder once it is published there.
      where += " AND n.status = 'published' AND n.folder_id = ?";
      params.push(filter.folderId);
    }
    return { where, params };
  }

  private section(
    ownerId: string,
    condition: string,
    conditionParams: SQLInputValue[],
    direction: "ASC" | "DESC",
  ): InboxSection {
    const where = `${VISIBLE} AND ${condition}`;
    const params = [ownerId, ...conditionParams];
    const rows = this.db
      .prepare(
        `SELECT ${MEETING_CARD_COLUMNS} ${FROM_CARD}
          WHERE ${where}
          ORDER BY m.scheduled_start_at ${direction}, m.id
          LIMIT ?`,
      )
      .all(...params, INBOX_SECTION_LIMIT);
    const total = this.db
      .prepare(`SELECT COUNT(*) AS total ${FROM_CARD} WHERE ${where}`)
      .get(...params);
    return { items: rows.map(toMeetingListItem), total: Number(total?.["total"] ?? 0) };
  }
}
