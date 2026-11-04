import { parseLanguageChoice } from "../../domain/settings/language";
import type { Result } from "../../domain/platform/result";
import type { FieldError } from "../../domain/platform/text";
import type { Locale } from "../../i18n/translate";
import type { Clock } from "../../ports/clock";
import type { LanguageRepository } from "../../ports/language-repository";

export interface LanguageDeps {
  languages: LanguageRepository;
  clock: Clock;
}

export const loadLanguage = (deps: LanguageDeps, ownerId: string): Promise<Locale | null> =>
  deps.languages.get(ownerId);

/** Validates the submitted value, then stores it for this owner only. */
export async function saveLanguage(
  deps: LanguageDeps,
  ownerId: string,
  raw: unknown,
): Promise<Result<Locale, FieldError[]>> {
  const parsed = parseLanguageChoice(raw);
  if (parsed.ok) await deps.languages.save(ownerId, parsed.value, deps.clock.now());
  return parsed;
}

/**
 * The locale a request is served in: the signed-in owner's choice, else the server default.
 * Signed-out requests (no owner id) read nothing and get the default. A preference never blocks
 * a page: if the read fails the default is used and `onFailure` hears about it.
 */
export async function resolveRequestLocale(
  deps: LanguageDeps,
  ownerId: string | undefined,
  defaultLocale: Locale,
  onFailure: (cause: unknown) => void = () => undefined,
): Promise<Locale> {
  if (ownerId === undefined) return defaultLocale;
  try {
    return (await deps.languages.get(ownerId)) ?? defaultLocale;
  } catch (cause) {
    onFailure(cause);
    return defaultLocale;
  }
}
