/** Bounds on the work: the owner's list and the text it is applied to. */
export const MAX_VOCABULARY_TERMS = 200;
export const MAX_VOCABULARY_TERM_LENGTH = 80;
/** A transcript segment is at most 5000 characters; this leaves room for a whole transcript. */
export const MAX_CORRECTION_TEXT_LENGTH = 200_000;

/** "go live" and "site tracker" are two words, "Plan B" two, nothing the owner says needs more. */
const MAX_RUN_WORDS = 3;
/**
 * A replacement can change how many words a window covers ('go live' becomes the single word
 * 'go-live'), which can bring a longer term into reach. Each extra pass makes at most that one
 * kind of change, so a few passes reach the fixed point that makes the function idempotent.
 */
const MAX_PASSES = 4;

const HYPHENS = new Set(["-", "‐", "‑"]);
/** Straight, curly (both) and modifier-letter apostrophes. */
const APOSTROPHES = new Set(["'", "‘", "’", "ʼ"]);

const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;
const MARK = /^\p{M}$/u;
const HORIZONTAL_SPACE = /^\p{Zs}$/u;
/** What squashing removes. A fixed character class: no backtracking, whatever the text. */
const IGNORED_WHEN_MATCHING = /[\p{M}\s\-‐‑'‘’ʼ]/gu;
const ONLY_LETTERS_AND_DIGITS = /^[\p{L}\p{N}]+$/u;
/** A term that carried one of these would put a line break or a control character in the text. */
const UNSAFE_IN_TERM = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/**
 * The form two spellings are compared by: lower case, no accents, no spaces, no hyphens, no
 * apostrophes. 'Site Tracker', 'site-tracker' and 'SiteTracker' all squash to 'sitetracker'.
 */
export function squashForMatching(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(IGNORED_WHEN_MATCHING, "");
}

/**
 * The part of the owner's list that is used: the first 200 entries, trimmed, and without those
 * that are empty, longer than 80 characters or carry a line break or control character. Storage
 * normalizes terms too; this is the guard for every other caller (and for the prompt).
 */
export function boundedVocabulary(terms: readonly string[]): string[] {
  return terms
    .slice(0, MAX_VOCABULARY_TERMS)
    .map((term) => term.trim())
    .filter(
      (term) =>
        term !== "" && term.length <= MAX_VOCABULARY_TERM_LENGTH && !UNSAFE_IN_TERM.test(term),
    );
}

/**
 * Squashed form to the owner's exact spelling. The first term wins when two squash alike. A term
 * whose squashed form holds anything but letters and digits ('C++', 'a.b*') could never equal a
 * run of words, so it is left out rather than matched loosely.
 */
function indexTerms(terms: readonly string[]): { byKey: Map<string, string>; longestKey: number } {
  const byKey = new Map<string, string>();
  let longestKey = 0;
  for (const term of boundedVocabulary(terms)) {
    const key = squashForMatching(term);
    if (!ONLY_LETTERS_AND_DIGITS.test(key) || byKey.has(key)) continue;
    byKey.set(key, term);
    longestKey = Math.max(longestKey, key.length);
  }
  return { byKey, longestKey };
}

interface Word {
  start: number;
  end: number;
  key: string;
}

function codePointAt(text: string, at: number): { ch: string; length: number } {
  const ch = String.fromCodePoint(text.codePointAt(at) ?? 0);
  return { ch, length: ch.length };
}

/**
 * Words as a scanner sees them: a letter or digit, then letters, digits, marks, and a hyphen or
 * apostrophe only when a letter or digit follows it. So "l'équipe" and "go-live" are one word and
 * "salsa-" or "'salsa'" is the word "salsa" with punctuation around it. Marks alone (an emoji's
 * variation selector) never start a word. Everything else is a separator.
 */
function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  let at = 0;
  while (at < text.length) {
    const first = codePointAt(text, at);
    if (!LETTER_OR_DIGIT.test(first.ch)) {
      at += first.length;
      continue;
    }
    const start = at;
    at += first.length;
    while (at < text.length) {
      const next = codePointAt(text, at);
      if (LETTER_OR_DIGIT.test(next.ch) || MARK.test(next.ch)) {
        at += next.length;
      } else if (
        (HYPHENS.has(next.ch) || APOSTROPHES.has(next.ch)) &&
        at + next.length < text.length &&
        LETTER_OR_DIGIT.test(codePointAt(text, at + next.length).ch)
      ) {
        at += next.length;
      } else {
        break;
      }
    }
    words.push({ start, end: at, key: squashForMatching(text.slice(start, at)) });
  }
  return words;
}

/** Words only join into one term across spaces and tabs: a line break or punctuation ends a run. */
function joinsAcross(text: string, from: number, to: number): boolean {
  for (let at = from; at < to;) {
    const { ch, length } = codePointAt(text, at);
    if (ch !== " " && ch !== "\t" && !HORIZONTAL_SPACE.test(ch)) return false;
    at += length;
  }
  return true;
}

function correctOnce(
  text: string,
  { byKey, longestKey }: { byKey: Map<string, string>; longestKey: number },
): string {
  const words = wordsOf(text);
  let out = "";
  let copied = 0;
  let index = 0;
  while (index < words.length) {
    let best: { count: number; spelling: string } | null = null;
    let key = "";
    for (let count = 1; count <= MAX_RUN_WORDS && index + count <= words.length; count += 1) {
      const word = words[index + count - 1];
      const previous = count > 1 ? words[index + count - 2] : undefined;
      if (word === undefined) break;
      if (previous !== undefined && !joinsAcross(text, previous.end, word.start)) break;
      // Too long to equal any term, and every longer run would be longer still.
      if (key.length + word.key.length > longestKey) break;
      key += word.key;
      const spelling = byKey.get(key);
      if (spelling !== undefined) best = { count, spelling };
    }
    const first = words[index];
    const last = words[index + (best?.count ?? 1) - 1];
    if (best === null || first === undefined || last === undefined) {
      index += 1;
      continue;
    }
    // A run already spelled right is still consumed, so the longest term keeps winning.
    if (text.slice(first.start, last.end) !== best.spelling) {
      out += text.slice(copied, first.start) + best.spelling;
      copied = last.end;
    }
    index += best.count;
  }
  return copied === 0 ? text : out + text.slice(copied);
}

/**
 * Rewrites the words the speech-to-text spelled wrong to the owner's exact spelling. A run of 1 to
 * 3 consecutive words (separated by spaces or tabs only) is replaced when, ignoring case, spaces,
 * hyphens, apostrophes and accents, it equals a term: 'Salsa' becomes 'SALSA', 'site tracker'
 * becomes 'Sitetracker', 'go live' becomes 'go-live'. Nothing else is ever rewritten: no fuzzy,
 * edit-distance or phonetic matching, and text with no variant of a term comes back as the same
 * string. Punctuation, spacing and line breaks around a match are kept.
 *
 * At a position the longest run wins; two terms that squash alike resolve to the first in the
 * list. A word that is part of a longer word never matches ('salsas', "Salsa's", 'salsa-verde'),
 * but a term inside a phrase does ('salsa verde' becomes 'SALSA verde'). The list's spelling
 * always wins, even for a common word ('apple' becomes 'Apple' if the owner listed 'Apple'):
 * the owner chose the list, and judging which words are "really" the company's is not our call.
 * A multi-word term such as 'Plan B' matches one, two or hyphenated words ('planb', 'plan b').
 *
 * Bounded work: terms are never turned into patterns, matching is one scan plus a Map lookup, at
 * most 200 terms of 80 characters are used, and a text over 200000 characters is returned
 * untouched (never truncated). Idempotent: correcting the output again changes nothing.
 */
export function correctWithVocabulary(text: string, terms: readonly string[]): string {
  if (text === "" || text.length > MAX_CORRECTION_TEXT_LENGTH) return text;
  const index = indexTerms(terms);
  if (index.byKey.size === 0) return text;
  let current = text;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = correctOnce(current, index);
    if (next === current) break;
    current = next;
  }
  return current;
}
