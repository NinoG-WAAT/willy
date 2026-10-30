import type { FolderRepository } from "../../ports/folder-repository";

/** The sidebar lists this many folders, then links to "All folders". */
export const SHELL_FOLDER_LIMIT = 8;

/** What the sidebar renders for one folder: a link and a count, nothing about its notes. */
export interface ShellFolder {
  id: string;
  name: string;
  /** The count the folder's own page shows (published notes the owner can open). */
  publishedCount: number;
}

/**
 * The owner's first folders by name, for the persistent sidebar. Runs on every signed-in page, so
 * it is capped in the query itself, owner-scoped, and returns counts only (no meeting titles).
 */
export async function loadShellFolders(
  deps: { folders: Pick<FolderRepository, "list"> },
  ownerId: string,
): Promise<ShellFolder[]> {
  const folders = await deps.folders.list(ownerId, SHELL_FOLDER_LIMIT);
  return folders.map((f) => ({ id: f.id, name: f.name, publishedCount: f.publishedCount }));
}
