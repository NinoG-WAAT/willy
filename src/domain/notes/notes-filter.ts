import type { MeetingStatus } from "../meetings/lifecycle";

/** The status chips of All notes. Deleting and deleted meetings are never a choice. */
export const NOTE_STATUS_FILTERS = ["all", "draft", "published", "archived"] as const;
export type NoteStatusFilter = (typeof NOTE_STATUS_FILTERS)[number];

export interface NotesFilter {
  status: NoteStatusFilter;
  /** Only published notes filed in this folder. An unknown or foreign id matches nothing. */
  folderId: string | null;
}

/** What the query string says, before the page number is clamped to the real page count. */
export interface NotesFilterInput extends NotesFilter {
  page: string | null;
}

/** Folder ids are short generated ids; anything longer is junk and ignored. */
const MAX_FOLDER_ID_LENGTH = 100;

/** Reads the filter from the URL. Every value is untrusted: nothing here throws. */
export function parseNotesFilter(params: URLSearchParams): NotesFilterInput {
  const rawStatus = params.get("status");
  const status = NOTE_STATUS_FILTERS.find((s) => s === rawStatus) ?? "all";
  const rawFolder = params.get("folder");
  const folderId =
    rawFolder !== null && rawFolder !== "" && rawFolder.length <= MAX_FOLDER_ID_LENGTH
      ? rawFolder
      : null;
  return { status, folderId, page: params.get("page") };
}

/**
 * The meeting statuses a filter shows; null means every one the owner may see. A draft is a
 * meeting whose summary waits in review. Deleting and deleted never appear, whatever the filter.
 */
export function statusesOf(status: NoteStatusFilter): MeetingStatus[] | null {
  switch (status) {
    case "all":
      return null;
    case "draft":
      return ["review"];
    case "published":
      return ["published"];
    case "archived":
      return ["archived"];
  }
}

/** A link to All notes with this filter on the given page (page 1 has no parameter). */
export function notesHref(filter: NotesFilter, page = 1): string {
  const params = new URLSearchParams();
  if (filter.status !== "all") params.set("status", filter.status);
  if (filter.folderId !== null) params.set("folder", filter.folderId);
  if (page > 1) params.set("page", String(page));
  const query = params.toString().replace(/\+/g, "%20");
  return query === "" ? "/notes" : `/notes?${query}`;
}
