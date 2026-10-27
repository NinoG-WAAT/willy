import type { ProviderError } from "../../domain/platform/provider-error";

/**
 * Feedback after a redirect travels as fixed codes (and bounded integers) in the query string, so
 * nothing from the URL is ever reflected into the page.
 */
const NOTICES: Readonly<Record<string, string>> = {
  created: "Note created. It appears under Upcoming.",
};

const PROBLEMS: Readonly<Record<string, string>> = {
  calendar_unavailable:
    "Your calendar could not be reached. Nothing was changed and your notes are safe. Try again in a moment, or create a note manually.",
  calendar_busy: "The calendar service asked us to slow down. Wait a minute and try again.",
  calendar_not_connected:
    "Your calendar is not connected, so events cannot be imported. You can still create a note manually.",
};

const count = (value: string | null): number | null =>
  value !== null && /^\d{1,4}$/.test(value) ? Number(value) : null;

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

export function noticeMessage(params: URLSearchParams): string | null {
  const code = params.get("notice");
  if (code === "imported") {
    const created = count(params.get("new"));
    const existing = count(params.get("existing"));
    if (created === null || existing === null) return "Calendar import finished.";
    if (created === 0 && existing === 0) return "Your calendar has no upcoming events to import.";
    return `Imported ${plural(created, "new meeting", "new meetings")}. ${plural(existing, "event was", "events were")} already in your list.`;
  }
  return code !== null && Object.hasOwn(NOTICES, code) ? (NOTICES[code] ?? null) : null;
}

export function problemMessage(code: string | null): string | null {
  return code !== null && Object.hasOwn(PROBLEMS, code) ? (PROBLEMS[code] ?? null) : null;
}

/** Maps a normalized provider failure to the fixed problem code shown on the home screen. */
export function problemCodeFor(error: ProviderError): string {
  if (error.kind === "rate_limited") return "calendar_busy";
  if (error.kind === "rejected") return "calendar_not_connected";
  return "calendar_unavailable";
}
