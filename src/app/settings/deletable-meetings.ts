import type { MeetingListItem, MeetingListQuery } from "../../ports/meeting-list";

/**
 * Every meeting the owner can permanently delete from settings, archived ones included. Meetings
 * already being deleted are never listed (they are hidden everywhere; see the deletions panel).
 */
export const listDeletableMeetings = (
  deps: { list: MeetingListQuery },
  ownerId: string,
): Promise<MeetingListItem[]> => deps.list.list(ownerId, { folderId: null, includeArchived: true });
