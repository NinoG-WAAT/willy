import { randomBytes } from "node:crypto";

const SUFFIX_LENGTH = 12;

/**
 * A letters-only word that no other test, worker or project run will produce, so a search for it
 * finds exactly the note the test created. The index matches prefixes and treats digits as word
 * breaks, so the suffix is random letters of one fixed length: two words are equal or unrelated,
 * never a prefix of one another. (A clock-derived suffix collided across workers: #47, #48.)
 */
export function uniqueWord(project: string): string {
  const letters = Array.from(randomBytes(SUFFIX_LENGTH), (byte) =>
    String.fromCharCode(97 + (byte % 26)),
  ).join("");
  return `zork${project}${letters}`;
}
