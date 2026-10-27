import type { Result } from "../platform/result";
import { err, ok } from "../platform/result";

export interface CalendarAttendee {
  name: string;
  email: string | null;
}

/**
 * A calendar event reduced to the minimum the product needs (product.md: minimum personal data).
 * Instants are UTC ISO-8601; the IANA zone travels next to them for local display.
 */
export interface CalendarEvent {
  provider: string;
  providerEventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  attendees: CalendarAttendee[];
}

export interface NormalizationError {
  field: string;
  message: string;
}

export const LIMITS = {
  title: 200,
  id: 256,
  provider: 32,
  attendees: 100,
  name: 100,
  email: 254,
} as const;

const EVENT_KEYS = new Set([
  "provider",
  "providerEventId",
  "title",
  "startsAt",
  "endsAt",
  "timezone",
  "attendees",
]);
const ATTENDEE_KEYS = new Set(["name", "email"]);
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value
    .normalize("NFC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((k) => allowed.has(k));
}

function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function toUtcIso(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_WITH_OFFSET.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function normalizeAttendees(raw: unknown): Result<CalendarAttendee[], NormalizationError> {
  const fail = (message: string) => err({ field: "attendees", message });
  if (!Array.isArray(raw)) return fail("must be a list");
  if (raw.length > LIMITS.attendees) return fail(`at most ${String(LIMITS.attendees)} attendees`);
  const byEmail = new Set<string>();
  const out: CalendarAttendee[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !hasOnlyKeys(item, ATTENDEE_KEYS))
      return fail("unexpected attendee shape");
    const name = clean(item["name"]) ?? "";
    const rawEmail =
      item["email"] === null || item["email"] === undefined ? "" : clean(item["email"]);
    if (rawEmail === null) return fail("email must be text");
    const email = rawEmail.toLowerCase();
    if (email !== "" && (email.length > LIMITS.email || !EMAIL.test(email)))
      return fail("invalid email");
    if (name.length > LIMITS.name) return fail(`name longer than ${String(LIMITS.name)}`);
    // Never invent an attendee: with neither a name nor an email there is nobody to keep.
    if (name === "" && email === "") continue;
    if (email !== "") {
      if (byEmail.has(email)) continue;
      byEmail.add(email);
    }
    out.push({ name: name === "" ? email : name, email: email === "" ? null : email });
  }
  return ok(out);
}

/** Validates and normalizes untrusted provider data into a CalendarEvent. Unknown fields are rejected. */
export function normalizeCalendarEvent(raw: unknown): Result<CalendarEvent, NormalizationError> {
  if (!isRecord(raw)) return err({ field: "event", message: "must be an object" });
  if (!hasOnlyKeys(raw, EVENT_KEYS)) return err({ field: "event", message: "unknown field" });

  const provider = clean(raw["provider"]);
  if (!provider || provider.length > LIMITS.provider)
    return err({ field: "provider", message: "invalid provider" });
  const providerEventId = clean(raw["providerEventId"]);
  if (!providerEventId || providerEventId.length > LIMITS.id) {
    return err({ field: "providerEventId", message: "invalid provider event id" });
  }
  const title = clean(raw["title"]);
  if (!title || title.length > LIMITS.title) {
    return err({
      field: "title",
      message: `title required, at most ${String(LIMITS.title)} characters`,
    });
  }
  const timezone = clean(raw["timezone"]);
  if (!timezone || !isValidTimezone(timezone))
    return err({ field: "timezone", message: "unknown IANA time zone" });
  const startsAt = toUtcIso(raw["startsAt"]);
  if (!startsAt)
    return err({ field: "startsAt", message: "must be an ISO-8601 instant with an offset" });
  const endsAt = toUtcIso(raw["endsAt"]);
  if (!endsAt)
    return err({ field: "endsAt", message: "must be an ISO-8601 instant with an offset" });
  if (Date.parse(endsAt) <= Date.parse(startsAt))
    return err({ field: "endsAt", message: "must be after start" });

  const attendees = normalizeAttendees(raw["attendees"]);
  if (!attendees.ok) return attendees;

  return ok({
    provider,
    providerEventId,
    title,
    startsAt,
    endsAt,
    timezone,
    attendees: attendees.value,
  });
}
