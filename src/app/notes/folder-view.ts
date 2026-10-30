import type { MeetingListItem } from "../../domain/meetings/list-item";
import { pageWindow, parsePage, type PageWindow } from "../../domain/notes/folder-view";
import { err, ok, type Result } from "../../domain/platform/result";
import type { FolderNotesQuery } from "../../ports/folder-notes";
import type { FolderRepository, FolderWithCount } from "../../ports/folder-repository";
import { NOT_FOUND, type NotesError } from "./errors";

export interface FolderViewDeps {
  folders: FolderRepository;
  notes: FolderNotesQuery;
}

export interface FolderView {
  folder: FolderWithCount;
  items: MeetingListItem[];
  page: PageWindow;
}

/**
 * Read-only folder browsing. The owner comes from the session; another owner's folder and an
 * unknown id are the same `not_found`, so ids cannot be enumerated. The page number is untrusted.
 */
export async function loadFolderView(
  deps: FolderViewDeps,
  ownerId: string,
  folderId: string,
  rawPage: string | null,
): Promise<Result<FolderView, NotesError>> {
  const folder = await deps.folders.find(ownerId, folderId);
  if (!folder) return err(NOT_FOUND);
  const page = pageWindow(folder.publishedCount, parsePage(rawPage));
  const items =
    folder.publishedCount === 0
      ? []
      : await deps.notes.list(ownerId, folderId, { offset: page.offset, limit: page.limit });
  return ok({ folder, items, page });
}
