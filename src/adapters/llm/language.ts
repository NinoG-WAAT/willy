import { currentLocale, LOCALES, type Locale } from "../../i18n/translate";
import { runWithLocale } from "../i18n/request-locale";

/**
 * How the instructions name each language. A fixed table keyed by the `Locale` type: the name
 * that reaches the model is one of these literals, never text taken from a meeting, a template
 * or the request.
 */
const LANGUAGE_NAME: Readonly<Record<Locale, string>> = { en: "English", fr: "French" };

/** The language to write in, or null when the value is not one of ours (then no instruction is given). */
export function summaryLanguageName(language: unknown): string | null {
  const known = LOCALES.find((locale) => locale === language);
  return known === undefined ? null : LANGUAGE_NAME[known];
}

/**
 * Runs `fn` so that `t()` answers in the summarizer's language, whatever the request or job that
 * called it is running in. Without a language it leaves the ambient locale alone.
 */
export function inSummaryLanguage<T>(language: Locale | undefined, fn: () => T): T {
  const known = LOCALES.find((locale) => locale === language);
  return runWithLocale(known ?? currentLocale(), fn);
}
