import { currentLocale, intlLocale, type Locale } from "../i18n/translate";

/**
 * "Tue 3 Nov, 09:00 CET": the wall time in the meeting's own IANA zone, never the server's.
 * The words follow the locale (`en-GB` or `fr-FR`); pass `locale` only to override the request's.
 */
export function formatSchedule(
  startsAtUtc: string,
  timeZone: string,
  locale: Locale = currentLocale(),
): string {
  const date = new Date(startsAtUtc);
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: "UTC" }).format(
      date,
    );
  }
}

/** "Fri 6 Nov": the calendar day in the event's own zone, for all-day events that have no time. */
export function formatDay(
  startsAtUtc: string,
  timeZone: string,
  locale: Locale = currentLocale(),
): string {
  const date = new Date(startsAtUtc);
  const options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: "UTC" }).format(
      date,
    );
  }
}
