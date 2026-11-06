import { t, tn } from "../../i18n/translate";
import { err, ok, type Result } from "../platform/result";
import type { FieldError } from "../platform/text";

/**
 * The owner's vocabulary: the words their meetings use that a speech recogniser does not know
 * (project names, clients, acronyms). Whisper reads them as its starting prompt, which made it
 * recognise such words far more often in a benchmark (issue #106). Pure: no I/O, no clock.
 */

export const TERM_MAX_LENGTH = 80;
export const MAX_TERMS_PER_OWNER = 200;
/** Whisper takes about 224 tokens of prompt; 600 characters stays safely under that. */
export const DEFAULT_PROMPT_BUDGET = 600;
/** One paste is far shorter than this (200 terms of 80 characters is about 16 000). */
const MAX_INPUT_CHARS = 20_000;
/**
 * The prompt always starts with this text, so a term can never be read as a command-line flag
 * even though the prompt travels as one argument of a process.
 */
const PROMPT_PREFIX = "Termes : ";
const PROMPT_SUFFIX = ".";
const SEPARATOR = ", ";

export type TermProblem = "empty" | "too_long" | "control" | "leading_dash";

/**
 * One term: NFC, every run of whitespace (including line breaks and tabs) becomes one space,
 * trimmed. Control characters that are not whitespace are refused rather than silently dropped.
 */
export function normalizeTerm(raw: unknown): Result<string, TermProblem> {
  if (typeof raw !== "string") return err("empty");
  const term = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (term === "") return err("empty");
  if (/\p{Cc}/u.test(term)) return err("control");
  if (term.length > TERM_MAX_LENGTH) return err("too_long");
  if (term.startsWith("-")) return err("leading_dash");
  return ok(term);
}

/** The identity of a term: two spellings with the same key are the same word. */
export function termKey(term: string): string {
  return term.normalize("NFC").toLowerCase();
}

const shown = (piece: string): string => {
  const flat = piece.replace(/\s+/gu, " ").trim();
  return flat.length > 30 ? `${flat.slice(0, 29)}…` : flat;
};

function messageFor(problem: TermProblem, piece: string): string {
  const word = shown(piece);
  switch (problem) {
    case "empty":
      return t("Enter at least one word.");
    case "too_long":
      return t('"{word}" is too long: a word can have at most {max} characters.', {
        word,
        max: TERM_MAX_LENGTH,
      });
    case "control":
      return t('"{word}" contains a character that cannot be used in a word.', { word });
    case "leading_dash":
      return t('"{word}" cannot start with a dash.', { word });
  }
}

/**
 * Splits pasted input into terms (new lines or commas), normalises each and drops repeats inside
 * the input, keeping the first spelling. All or nothing: one bad piece refuses the whole input,
 * and every bad piece is reported, so the owner can fix them in one go.
 */
export function parseTerms(raw: unknown): Result<string[], FieldError[]> {
  const empty = err([{ field: "term", message: messageFor("empty", "") }]);
  if (typeof raw !== "string") return empty;
  if (raw.length > MAX_INPUT_CHARS) {
    return err([{ field: "term", message: t("That is too much text at once. Add fewer words.") }]);
  }
  const terms: string[] = [];
  const seen = new Set<string>();
  const errors: FieldError[] = [];
  for (const piece of raw.split(/[\r\n,]+/u)) {
    if (piece.trim() === "") continue;
    const term = normalizeTerm(piece);
    if (!term.ok) {
      errors.push({ field: "term", message: messageFor(term.error, piece) });
      continue;
    }
    const key = termKey(term.value);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term.value);
  }
  if (errors.length > 0) return err(errors);
  return terms.length === 0 ? empty : ok(terms);
}

export interface AdditionPlan {
  /** New terms, in the order they were typed. */
  toAdd: string[];
  /** Terms of the input the owner already had (not added again, not an error). */
  alreadyThere: number;
}

export const limitMessage = (have: number, adding: number): string =>
  t(
    "You can keep at most {max} words and you have {have}. Adding {adding} more would go over; nothing was added.",
    { max: MAX_TERMS_PER_OWNER, have, adding },
  );

/**
 * What adding `raw` to a list that already holds `existing` would do. Over the limit is a
 * validation error: the input is never cut down to fit.
 */
export function planAddition(
  existing: readonly string[],
  raw: unknown,
): Result<AdditionPlan, FieldError[]> {
  const parsed = parseTerms(raw);
  if (!parsed.ok) return parsed;
  const have = new Set(existing.map(termKey));
  const toAdd = parsed.value.filter((term) => !have.has(termKey(term)));
  if (existing.length + toAdd.length > MAX_TERMS_PER_OWNER) {
    return err([{ field: "term", message: limitMessage(existing.length, toAdd.length) }]);
  }
  return ok({ toAdd, alreadyThere: parsed.value.length - toAdd.length });
}

/**
 * Whether the deterministic spelling fix of transcripts (issue #107) can ever rewrite to this
 * term: only when its squashed form (case, spaces, hyphens, apostrophes and accents ignored) is
 * letters and digits and nothing else. A term such as "Node.js" or "C++" still primes the speech
 * recogniser through the prompt, but is never corrected afterwards; the screen says so. It does
 * not affect the prompt or its budget.
 */
export function canBeAutoCorrected(term: string): boolean {
  const squashed = term
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\s\-‐-―'’ʼ]/gu, "");
  return /^[\p{L}\p{N}]+$/u.test(squashed);
}

/** The status line of the Vocabulary screen: how many terms the speech recogniser really reads. */
export function describeVocabularyStatus(total: number, used: number): string {
  if (total === 0) return "";
  const left = total - used;
  if (left === 0) {
    return tn(
      "{used} of {n} term is used by the speech recogniser.",
      "{used} of {n} terms are used by the speech recogniser.",
      total,
      { used },
    );
  }
  return tn(
    "{used} of {total} terms are used by the speech recogniser. {n} does not fit and is left out.",
    "{used} of {total} terms are used by the speech recogniser. {n} do not fit and are left out.",
    left,
    { used, total },
  );
}

export interface TranscriptionPrompt {
  /** `Termes : A, B, C.`, or "" when there is nothing to say. At most `maxChars` characters. */
  text: string;
  used: string[];
  /** The terms that did not fit, in list order. */
  leftOut: string[];
}

/**
 * The prompt for the speech recogniser: whole terms, in list order, as many as fit in the budget.
 * The first term that does not fit ends the list (the rest are "left out" too): a prefix is easy
 * to explain to the owner, and skipping ahead would let a short late term jump the queue.
 */
export function buildTranscriptionPrompt(
  terms: readonly string[],
  maxChars: number = DEFAULT_PROMPT_BUDGET,
): TranscriptionPrompt {
  const used: string[] = [];
  let length = PROMPT_PREFIX.length + PROMPT_SUFFIX.length;
  for (const term of terms) {
    const added = term.length + (used.length > 0 ? SEPARATOR.length : 0);
    if (length + added > maxChars) break;
    used.push(term);
    length += added;
  }
  return {
    text: used.length === 0 ? "" : `${PROMPT_PREFIX}${used.join(SEPARATOR)}${PROMPT_SUFFIX}`,
    used,
    leftOut: terms.slice(used.length),
  };
}
