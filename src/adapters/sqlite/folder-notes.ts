import type { DatabaseSync } from "node:sqlite";
import type { MeetingListItem } from "../../domain/meetings/list-item";
import type { FolderNotesQuery, FolderNotesWindow } from "../../ports/folder-notes";
import { MEETING_CARD_COLUMNS, toMeetingListItem } from "./meeting-list-row";

/**
 * Published notes of one folder. Every join carries owner_id, so a folder id from another owner
 * matches nothing. The visibility rule (published, meeting not archived/deleting/deleted) is the
 * same one `published_count` uses in folder-repository.ts: a card count and its list must agree.
 */
export class SqliteFolderNotes implements FolderNotesQuery {
  constructor(private readonly db: DatabaseSync) {}

  list(ownerId: string, folderId: string, window: FolderNotesWindow): Promise<MeetingListItem[]> {
    const rows = this.db
      .prepare(
        `SELECT ${MEETING_CARD_COLUMNS}
           FROM note n
           JOIN meeting m ON m.owner_id = n.owner_id AND m.id = n.meeting_id
           JOIN folder f ON f.owner_id = n.owner_id AND f.id = n.folder_id
          WHERE n.owner_id = ? AND n.folder_id = ? AND n.status = 'published'
            AND m.status NOT IN ('archived', 'deleting', 'deleted')
          ORDER BY m.scheduled_start_at DESC, m.id
          LIMIT ? OFFSET ?`,
      )
      .all(ownerId, folderId, window.limit, window.offset);
    return Promise.resolve(rows.map(toMeetingListItem));
  }
}
