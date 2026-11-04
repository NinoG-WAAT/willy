/**
 * Exceptions to the catalog rules (tests/unit/i18n/catalog.test.ts). Each entry needs a reason a
 * reviewer can judge; an entry that no longer matches anything fails the test, so this file only
 * ever lists live exceptions. The identical-in-French allowlist is not here: it lives next to the
 * strings, in each area module (`sameInFrench` in src/i18n/fr/<area>.ts).
 */

/**
 * Files that may call `t()`/`tn()`/`msg()` with something other than a string literal, because
 * the literal is written elsewhere, marked with `msg()`. Path -> reason.
 */
export const allowedDynamic: Readonly<Record<string, string>> = {};

/**
 * Files that may join a translated string to other text, because the other text is not a
 * sentence part (a separator, a number, a file name). Path -> reason.
 */
export const allowedConcatenation: Readonly<Record<string, string>> = {};
