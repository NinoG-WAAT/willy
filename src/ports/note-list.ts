import type { MeetingListItem } from "../domain/meetings/list-item";
import type { NotesFilter } from "../domain/notes/notes-filter";

/** One Inbox section: the first rows, and how many exist in all (rows may be cut). */
export interface InboxSection {
  items: MeetingListItem[];
  total: number;
}

export interface InboxSections {
  /** Capturing, paused, processing, and failed (a failure needs the owner, like running work). */
  inProgress: InboxSection;
  /** Scheduled and not over yet, soonest first. */
  upcoming: InboxSection;
  /** Scheduled, over, never started. */
  missed: InboxSection;
  /** Meetings whose draft waits for review. */
  drafts: InboxSection;
}

/** What still needs the owner. Owner-scoped; deleting and deleted meetings never appear. */
export interface InboxQuery {
  inbox(ownerId: string, now: Date): Promise<InboxSections>;
}

export interface NotesWindow {
  offset: number;
  limit: number;
}

/**
 * Every non-deleted meeting of the owner, newest first, narrowed by a filter. Owner-scoped:
 * another owner's folder id matches nothing. Deleting and deleted meetings never appear.
 */
export interface AllNotesQuery {
  count(ownerId: string, filter: NotesFilter): Promise<number>;
  list(ownerId: string, filter: NotesFilter, window: NotesWindow): Promise<MeetingListItem[]>;
}
