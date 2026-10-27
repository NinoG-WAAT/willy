import type { Result } from "../domain/platform/result";

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface FolderWithCount extends Folder {
  /** Notes (drafts and published) currently filed in this folder. */
  noteCount: number;
}

/** Every method is scoped by `ownerId`; another owner's folder behaves exactly like a missing one. */
export interface FolderRepository {
  list(ownerId: string): Promise<FolderWithCount[]>;
  find(ownerId: string, id: string): Promise<FolderWithCount | null>;
  create(ownerId: string, folder: Folder): Promise<Result<void, "name_taken">>;
  rename(
    ownerId: string,
    id: string,
    name: string,
    updatedAt: string,
  ): Promise<Result<void, "not_found" | "name_taken">>;
  /** Atomic: deletes only if the folder is empty at that moment. */
  delete(ownerId: string, id: string): Promise<Result<void, "not_found" | "not_empty">>;
}
