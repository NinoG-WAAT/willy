import type { Result } from "../domain/platform/result";

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface FolderWithCount extends Folder {
  /** Every note (draft or published, even of a hidden meeting) filed here: the delete guard. */
  noteCount: number;
  /** Published notes the owner can open in the folder view: what a card's count must show. */
  publishedCount: number;
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
