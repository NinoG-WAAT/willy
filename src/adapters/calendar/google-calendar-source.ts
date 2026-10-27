import { normalizeCalendarEvent, type CalendarEvent } from "../../domain/calendar/event";
import type { ProviderError } from "../../domain/platform/provider-error";
import { err, ok, type Result } from "../../domain/platform/result";
import type { CalendarSource } from "../../ports/calendar-source";
import { guardedFetchJson } from "../http/guarded-fetch";

export const GOOGLE_API_HOST = "www.googleapis.com";
const MAX_PAGES = 5;
const PAGE_SIZE = 50;

export interface GoogleCalendarSourceConfig {
  fetch: typeof fetch;
  credentials: { getAccessToken(ownerId: string): Promise<Result<string, ProviderError>> };
  timeoutMs: number;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Maps one Google event to a CalendarEvent, or null when it is not a timed, live, valid event. */
function mapEvent(item: unknown, calendarTimeZone: string | undefined): CalendarEvent | null {
  if (!isObject(item) || item["status"] === "cancelled") return null;
  const start = isObject(item["start"]) ? item["start"] : {};
  const end = isObject(item["end"]) ? item["end"] : {};
  // All-day events carry `date` only: there is no meeting to capture.
  if (text(start["dateTime"]) === undefined || text(end["dateTime"]) === undefined) return null;

  const attendees = (Array.isArray(item["attendees"]) ? item["attendees"] : [])
    .filter((a): a is Json => isObject(a) && a["resource"] !== true)
    .map((a) => ({ name: text(a["displayName"]) ?? "", email: text(a["email"]) ?? null }));

  const normalized = normalizeCalendarEvent({
    provider: "google",
    providerEventId: text(item["id"]),
    title: text(item["summary"]) ?? "Untitled meeting",
    startsAt: text(start["dateTime"]),
    endsAt: text(end["dateTime"]),
    timezone: text(start["timeZone"]) ?? calendarTimeZone ?? "UTC",
    attendees,
  });
  return normalized.ok ? normalized.value : null;
}

export function createGoogleCalendarSource(config: GoogleCalendarSourceConfig): CalendarSource {
  return {
    async listEvents(ownerId, range) {
      const token = await config.credentials.getAccessToken(ownerId);
      if (!token.ok) return token;

      const events: CalendarEvent[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(`https://${GOOGLE_API_HOST}/calendar/v3/calendars/primary/events`);
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("timeMin", range.from);
        url.searchParams.set("timeMax", range.to);
        url.searchParams.set("maxResults", String(PAGE_SIZE));
        if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);

        const body = await guardedFetchJson(
          config.fetch,
          url.toString(),
          {
            method: "GET",
            headers: { Authorization: `Bearer ${token.value}`, Accept: "application/json" },
          },
          { timeoutMs: config.timeoutMs, allowedHosts: [GOOGLE_API_HOST] },
        );
        if (!body.ok) return err(body.error);
        if (!isObject(body.value)) {
          return err({
            kind: "unavailable",
            retryable: true,
            message: "provider returned an unexpected payload",
          });
        }

        const items = Array.isArray(body.value["items"]) ? body.value["items"] : [];
        const calendarZone = text(body.value["timeZone"]);
        for (const item of items) {
          const event = mapEvent(item, calendarZone);
          if (event) events.push(event);
        }
        pageToken = text(body.value["nextPageToken"]);
        if (pageToken === undefined) break;
      }
      return ok(events);
    },
  };
}
