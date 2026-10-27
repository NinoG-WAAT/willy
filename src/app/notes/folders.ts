import { canDeleteFolder, normalizeFolderName } from "../../domain/notes/folder";
import { err, ok, type Result } from "../../domain/platform/result";
import type { Folder, FolderWithCount } from "../../ports/folder-repository";
import type { NotesDeps } from "./deps";
import { NOT_FOUND, nameTaken, type NotesError } from "./errors";

const notEmpty = (count: number): NotesError => ({
  kind: "blocked",
  message: `This folder still contains ${String(count)} ${count === 1 ? "note" : "notes"}. Move or delete them first.`,
});

export function listFolders(deps: NotesDeps, ownerId: string): Promise<FolderWithCount[]> {
  return deps.folders.list(ownerId);
}

export async function createFolder(
  deps: NotesDeps,
  ownerId: string,
  rawName: unknown,
): Promise<Result<Folder, NotesError>> {
  const name = normalizeFolderName(rawName);
  if (!name.ok) return err({ kind: "invalid", errors: [name.error] });
  const now = deps.clock.now().toISOString();
  const folder: Folder = { id: deps.ids.newId(), name: name.value, createdAt: now, updatedAt: now };
  const created = await deps.folders.create(ownerId, folder);
  return created.ok ? ok(folder) : err(nameTaken("folder"));
}

export async function renameFolder(
  deps: NotesDeps,
  ownerId: string,
  id: string,
  rawName: unknown,
): Promise<Result<void, NotesError>> {
  const name = normalizeFolderName(rawName);
  if (!name.ok) return err({ kind: "invalid", errors: [name.error] });
  const renamed = await deps.folders.rename(
    ownerId,
    id,
    name.value,
    deps.clock.now().toISOString(),
  );
  if (renamed.ok) return ok(undefined);
  return err(renamed.error === "not_found" ? NOT_FOUND : nameTaken("folder"));
}

/** Loads a folder for the delete confirmation page (scope text needs the note count). */
export async function findFolderForDelete(
  deps: NotesDeps,
  ownerId: string,
  id: string,
): Promise<Result<FolderWithCount, NotesError>> {
  const folder = await deps.folders.find(ownerId, id);
  return folder ? ok(folder) : err(NOT_FOUND);
}

export async function deleteFolder(
  deps: NotesDeps,
  ownerId: string,
  id: string,
): Promise<Result<void, NotesError>> {
  const folder = await deps.folders.find(ownerId, id);
  if (!folder) return err(NOT_FOUND);
  if (!canDeleteFolder(folder.noteCount)) return err(notEmpty(folder.noteCount));
  const deleted = await deps.folders.delete(ownerId, id);
  if (deleted.ok) return ok(undefined);
  // Lost a race: a note arrived (or the folder vanished) between the check and the delete.
  return err(deleted.error === "not_found" ? NOT_FOUND : notEmpty(1));
}
