import type { MeetingListItem } from "../../domain/meetings/list-item";
import { pageWindow, parsePage, type PageWindow } from "../../domain/notes/folder-view";
import type { NotesFilter, NotesFilterInput } from "../../domain/notes/notes-filter";
import type { FolderRepository, FolderWithCount } from "../../ports/folder-repository";
import type { AllNotesQuery } from "../../ports/note-list";

export interface AllNotesDeps {
  notes: AllNotesQuery;
  folders: FolderRepository;
}

export interface AllNotes {
  filter: NotesFilter;
  items: MeetingListItem[];
  total: number;
  page: PageWindow;
  /** The owner's folders, for the filter chips. */
  folders: FolderWithCount[];
}

/**
 * Every non-deleted meeting of the owner, narrowed by status and folder, one page at a time. The
 * owner comes from the session; the filter and page number are untrusted and already parsed.
 */
export async function loadAllNotes(
  deps: AllNotesDeps,
  ownerId: string,
  input: NotesFilterInput,
): Promise<AllNotes> {
  const filter: NotesFilter = { status: input.status, folderId: input.folderId };
  const [total, folders] = await Promise.all([
    deps.notes.count(ownerId, filter),
    deps.folders.list(ownerId),
  ]);
  const page = pageWindow(total, parsePage(input.page));
  const items =
    total === 0
      ? []
      : await deps.notes.list(ownerId, filter, { offset: page.offset, limit: page.limit });
  return { filter, items, total, page, folders };
}
