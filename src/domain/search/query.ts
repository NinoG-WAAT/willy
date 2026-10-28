import { err, ok, type Result } from "../platform/result";
import { type FieldError } from "../platform/text";

export const MAX_TERMS = 12;
export const MAX_TERM_CHARS = 50;

const invalid = (message: string): Result<never, FieldError> => err({ field: "q", message });

/**
 * Turns what the owner typed into plain words. Everything that is not a letter or a digit
 * (quotes, `*`, `-`, `:`, parentheses, `^`) separates words, so input can never act as search
 * syntax: no operators, column filters or unbalanced quotes reach the index (A03).
 */
export function parseSearchQuery(raw: unknown): Result<string[], FieldError> {
  if (typeof raw !== "string") return invalid("Enter something to search for.");
  const terms = raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((term) => term !== "");
  if (terms.length === 0) return invalid("Enter at least one word to search for.");
  if (terms.length > MAX_TERMS) return invalid(`Use at most ${String(MAX_TERMS)} words.`);
  if (terms.some((term) => term.length > MAX_TERM_CHARS)) {
    return invalid(`Words can be at most ${String(MAX_TERM_CHARS)} characters.`);
  }
  return ok(terms);
}

/**
 * FTS5 MATCH expression: every word is a quoted string (so a word like OR or NEAR is just a word)
 * and a prefix, joined by an implicit AND. Terms only ever contain letters and digits, so there is
 * nothing to escape inside the quotes.
 */
export function buildMatchExpression(terms: readonly string[]): string {
  return terms.map((term) => `"${term}"*`).join(" ");
}
