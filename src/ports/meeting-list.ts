import type { MeetingListItem } from "../domain/meetings/list-item";

export type { MeetingListItem };

export interface MeetingListFilter {
  /** Only meetings whose note is filed in this folder. An unknown or foreign id matches nothing. */
  folderId: string | null;
  includeArchived: boolean;
}

/** Owner-scoped. Meetings being deleted never appear. */
export interface MeetingListQuery {
  list(ownerId: string, filter: MeetingListFilter): Promise<MeetingListItem[]>;
}
