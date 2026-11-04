import { LOCALES, parseLocale, t, type Locale } from "../../i18n/translate";
import { err, ok, type Result } from "../platform/result";
import type { FieldError } from "../platform/text";

export interface LanguageChoice {
  locale: Locale;
  label: string;
}

/**
 * Each language is named in itself and these labels are never translated: an owner who cannot
 * read the current language must still be able to find theirs.
 */
export const LANGUAGE_CHOICES: readonly LanguageChoice[] = [
  { locale: "en", label: "English" },
  { locale: "fr", label: "Français" },
];

// Keeps the list above and the supported locales in step: adding a locale without a label fails
// at start-up in every test, not on a screen.
if (LANGUAGE_CHOICES.map((c) => c.locale).join() !== LOCALES.join()) {
  throw new Error("LANGUAGE_CHOICES must list every supported locale, in order");
}

/** The submitted `language` field: exactly a supported locale code, nothing guessed from it. */
export function parseLanguageChoice(raw: unknown): Result<Locale, FieldError[]> {
  const locale = parseLocale(raw);
  if (locale !== null && raw === locale) return ok(locale);
  return err([{ field: "language", message: t("Choose a language from the list.") }]);
}
