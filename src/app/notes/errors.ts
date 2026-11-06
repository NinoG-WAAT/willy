import { t } from "../../i18n/translate";
import type { FieldError } from "../../domain/platform/text";

/** Expected failures of notes use cases. `not_found` also covers other owners' ids (never a 403). */
export type NotesError =
  | { kind: "invalid"; errors: FieldError[] }
  | { kind: "blocked"; message: string }
  | { kind: "not_found" };

export const NOT_FOUND: NotesError = { kind: "not_found" };

/** One sentence per kind of thing: the article and agreement differ in French, so no `${what}`. */
export const nameTaken = (what: "folder" | "template"): NotesError => ({
  kind: "invalid",
  errors: [
    {
      field: "name",
      message:
        what === "folder"
          ? t("You already have a folder with that name.")
          : t("You already have a template with that name."),
    },
  ],
});
