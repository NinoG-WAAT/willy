import { installI18n, runWithLocale } from "../../src/adapters/i18n/request-locale";
import type { Locale } from "../../src/i18n/translate";

let installed = false;

/**
 * Runs `fn` as if it were a request in `locale`: the French catalog is registered, and `t()`
 * inside `fn` (use cases, domain, components) answers for that locale. Strict mode is on, so a
 * missing French string fails the test that needs it instead of falling back silently.
 *
 *   expect(inLocale("fr", () => saveLanguage(...))).toEqual(...)   // sync or async fn
 */
export function inLocale<T>(locale: Locale, fn: () => T): T {
  if (!installed) {
    installI18n({ defaultLocale: () => "en", strict: true, logger: () => undefined });
    installed = true;
  }
  return runWithLocale(locale, fn);
}
