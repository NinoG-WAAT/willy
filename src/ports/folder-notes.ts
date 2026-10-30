import type { MeetingListItem } from "../domain/meetings/list-item";

export interface FolderNotesWindow {
  offset: number;
  limit: number;
}

/**
 * The published notes in one folder, as cards, newest meeting first. Owner-scoped: another
 * owner's folder yields nothing. Archived, deleting and deleted meetings are never listed.
 */
export interface FolderNotesQuery {
  list(ownerId: string, folderId: string, window: FolderNotesWindow): Promise<MeetingListItem[]>;
}
