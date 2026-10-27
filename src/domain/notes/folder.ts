import { err, ok, type Result } from "../platform/result";
import { normalizeLine, type FieldError } from "../platform/text";

export const FOLDER_NAME_MAX = 100;

export function normalizeFolderName(raw: unknown): Result<string, FieldError> {
  const name = normalizeLine(raw);
  if (name === null || name === "") return err({ field: "name", message: "Enter a folder name." });
  if (name.length > FOLDER_NAME_MAX) {
    return err({
      field: "name",
      message: `Folder names can be at most ${String(FOLDER_NAME_MAX)} characters.`,
    });
  }
  return ok(name);
}

/**
 * Policy: a folder that still holds notes cannot be deleted. We block instead of silently moving
 * notes, because moving changes where the owner's published notes live.
 */
export function canDeleteFolder(noteCount: number): boolean {
  return noteCount === 0;
}
