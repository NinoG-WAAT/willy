import { err, ok, type Result } from "../platform/result";
import type { FieldError } from "../platform/text";

/** Well under the 200,000 character database CHECK; notes are text, never audio or markup. */
export const MAX_ROUGH_NOTES_CHARS = 100_000;

/**
 * Rough notes are the owner's own words, so their formatting is kept: only unicode form, line
 * endings and control characters are normalized. Too-long notes are rejected, never truncated.
 */
export function normalizeRoughNotes(raw: unknown): Result<string, FieldError> {
  if (typeof raw !== "string") return err({ field: "rough_notes", message: "Notes must be text." });
  const notes = raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n\t]/gu, "");
  if (notes.length > MAX_ROUGH_NOTES_CHARS) {
    return err({
      field: "rough_notes",
      message: `Notes can be at most ${String(MAX_ROUGH_NOTES_CHARS)} characters.`,
    });
  }
  return ok(notes);
}
