/** The word the owner types to confirm a permanent deletion. */
export const DELETION_CONFIRMATION_WORD = "DELETE";

/**
 * Typed confirmation for an irreversible action. Exact, case-sensitive match after trimming
 * surrounding whitespace: no normalization that would let lookalike characters (Cyrillic or
 * fullwidth letters, zero-width spaces) pass for the word.
 */
export function isDeletionConfirmed(input: unknown): boolean {
  return typeof input === "string" && input.trim() === DELETION_CONFIRMATION_WORD;
}
