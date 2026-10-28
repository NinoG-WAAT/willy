import type { MeetingStatus } from "../domain/meetings/lifecycle";
import type { HighlightSegment } from "../domain/search/highlight";

export interface SearchQuery {
  /** A ready FTS expression built by `buildMatchExpression` (never raw user text). */
  match: string;
  /** Only meetings whose note is filed in this folder; an unknown or foreign id matches nothing. */
  folderId: string | null;
  includeArchived: boolean;
  limit: number;
}

export interface SearchHit {
  meetingId: string;
  /** `meeting`, `note_section`, `decision` or `action_item`. */
  kind: string;
  /** Id of the indexed thing (the meeting, section, decision or action item). */
  refId: string;
  /** Short label of the indexed text, such as a section heading. */
  label: string;
  meetingTitle: string;
  status: MeetingStatus;
  scheduledStartAt: string;
  timezone: string;
  folderName: string | null;
  /** The matching excerpt, split into plain and matched text (data, not markup). */
  segments: HighlightSegment[];
}

/** Owner-scoped inside the query itself. Meetings being deleted never match. */
export interface SearchIndex {
  search(ownerId: string, query: SearchQuery): Promise<SearchHit[]>;
}
