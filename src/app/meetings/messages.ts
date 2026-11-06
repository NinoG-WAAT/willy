import { t, tn } from "../../i18n/translate";
import type { ProviderError } from "../../domain/platform/provider-error";

/**
 * Feedback after a redirect travels as fixed codes (and bounded integers) in the query string, so
 * nothing from the URL is ever reflected into the page. The sentences are written per request
 * (functions, not tables built at load) so they come out in the owner's language.
 */
const count = (value: string | null): number | null =>
  value !== null && /^\d{1,4}$/.test(value) ? Number(value) : null;

export function noticeMessage(params: URLSearchParams): string | null {
  const code = params.get("notice");
  if (code === "imported") {
    const created = count(params.get("new"));
    const existing = count(params.get("existing"));
    if (created === null || existing === null) return t("Calendar import finished.");
    if (created === 0 && existing === 0)
      return t("Your calendar has no upcoming events to import.");
    return [
      tn("Imported {n} new meeting.", "Imported {n} new meetings.", created),
      alreadyListed(existing),
    ].join(" ");
  }
  if (code === "ics_imported") {
    const created = count(params.get("new"));
    const existing = count(params.get("existing"));
    if (created === null || existing === null) return t("Calendar file import finished.");
    return [
      tn(
        "Imported {n} new meeting from the calendar file.",
        "Imported {n} new meetings from the calendar file.",
        created,
      ),
      alreadyListed(existing),
    ].join(" ");
  }
  if (code === "created") return t("Note created. It appears under Upcoming.");
  return null;
}

// Two whole sentences joined by a space (a separator, not a sentence part).
const alreadyListed = (existing: number): string =>
  tn("{n} event was already in your list.", "{n} events were already in your list.", existing);

export function problemMessage(code: string | null): string | null {
  switch (code) {
    case "calendar_unavailable":
      return t(
        "Your calendar could not be reached. Nothing was changed and your notes are safe. Try again in a moment, or create a note manually.",
      );
    case "calendar_busy":
      return t("The calendar service asked us to slow down. Wait a minute and try again.");
    case "calendar_not_connected":
      return t(
        "Your calendar is not connected, so events cannot be imported. You can still create a note manually.",
      );
    default:
      return null;
  }
}

/** Maps a normalized provider failure to the fixed problem code shown on the home screen. */
export function problemCodeFor(error: ProviderError): string {
  if (error.kind === "rate_limited") return "calendar_busy";
  if (error.kind === "rejected") return "calendar_not_connected";
  return "calendar_unavailable";
}
