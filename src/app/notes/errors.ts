import type { FieldError } from "../../domain/platform/text";

/** Expected failures of notes use cases. `not_found` also covers other owners' ids (never a 403). */
export type NotesError =
  | { kind: "invalid"; errors: FieldError[] }
  | { kind: "blocked"; message: string }
  | { kind: "not_found" };

export const NOT_FOUND: NotesError = { kind: "not_found" };

export const nameTaken = (what: "folder" | "template"): NotesError => ({
  kind: "invalid",
  errors: [{ field: "name", message: `You already have a ${what} with that name.` }],
});
