import { currentLocale, intlLocale, t, type Locale } from "../i18n/translate";

/**
 * "27 Oct 2026, 10:00 UTC": an instant in UTC, labelled, for system events such as job times.
 * The words follow the locale; pass `locale` only to override the request's.
 */
export function formatInstant(iso: string, locale: Locale = currentLocale()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t("unknown time");
  // "UTC" is a zone code, the same in every language, so it is appended rather than translated.
  return `${new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(date)} UTC`;
}
