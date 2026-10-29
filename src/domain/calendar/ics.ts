import { ATTENDEE_LIMITS } from "../meetings/attendee";
import { NEW_MEETING_LIMITS } from "../meetings/new-meeting";
import { err, ok, type Result } from "../platform/result";
import { normalizeLine, normalizeMultiline } from "../platform/text";
import { LIMITS, normalizeCalendarEvent, type CalendarEvent } from "./event";
import {
  parseContentLine,
  unescapeText,
  unfoldLines,
  type IcsLine,
  type LineLimitCode,
} from "./ics-lines";
import { localToUtc, type LocalDateTime } from "./local-time";
import { isIanaZone, resolveIcsTimezone } from "./windows-timezones";

/**
 * Hostile-input limits for an uploaded calendar. A file over any limit is rejected as a whole:
 * truncating would silently drop meetings.
 */
export const ICS_LIMITS = {
  /** File size. The route checks bytes; the parser checks the text it was handed. */
  maxBytes: 1_048_576,
  maxEvents: 200,
  /** Longest unfolded content line. Outlook writes rich HTML alternatives of a few KB. */
  maxLineLength: 65_536,
  maxLines: 50_000,
  maxDepth: 8,
  /** Description kept for the preview; the Meeting never stores it. */
  descriptionChars: 4_000,
} as const;

export type IcsRejectionCode =
  | LineLimitCode
  | "empty"
  | "not_ics"
  | "too_large"
  | "too_many_events"
  | "too_deep"
  | "malformed"
  | "no_events"
  | "bad_zone";

export interface IcsRejection {
  code: IcsRejectionCode;
}

export type IcsSkipCode =
  | "bad_uid"
  | "missing_start"
  | "bad_start"
  | "bad_end"
  | "unknown_timezone"
  | "end_before_start"
  | "invalid_event"
  | "duplicate";

/** An event that was in the file but cannot become a Meeting. The title is shown only when it is short enough to be a title. */
export interface IcsSkipped {
  code: IcsSkipCode;
  title: string | null;
}

/** A recurring series (RRULE/RDATE master). It is reported, never expanded. */
export interface IcsSeries {
  title: string;
}

/** An event ready to preview and, unless cancelled, to import. */
export interface IcsEvent {
  event: CalendarEvent;
  allDay: boolean;
  cancelled: boolean;
  /** Plain text only. A URL in here is never fetched or linked. */
  location: string | null;
  description: string | null;
}

export interface IcsParse {
  /** Sorted by start. */
  events: IcsEvent[];
  skipped: IcsSkipped[];
  series: IcsSeries[];
}

export interface IcsOptions {
  /** IANA zone for floating times and all-day dates, which carry none of their own. */
  floatingZone: string;
}

const PROVIDER = "ics";
const UNTITLED = "Untitled meeting";
const MAX_UID = 200;
const MINUTE_MS = 60_000;

interface RawEvent {
  lines: IcsLine[];
  /** METHOD:CANCEL on the enclosing calendar. */
  calendarCancelled: boolean;
}

type Build =
  | { kind: "event"; item: IcsEvent; sequence: number }
  | { kind: "series"; uid: string; title: string }
  | { kind: "skipped"; skip: IcsSkipped };

// ---------------------------------------------------------------------------------------------
// Walking the components
// ---------------------------------------------------------------------------------------------

/** Splits the file into VEVENTs, ignoring everything inside VTIMEZONE, VALARM and unknown blocks. */
function collectEvents(lines: string[]): Result<RawEvent[], IcsRejection> {
  const fail = (code: IcsRejectionCode) => err({ code });
  const stack: string[] = [];
  const events: RawEvent[] = [];
  let current: RawEvent | null = null;
  let calendarStart = 0;
  let method: string | null = null;

  const first = lines[0] === undefined ? null : parseContentLine(lines[0]);
  if (first?.name !== "BEGIN" || first.value.trim().toUpperCase() !== "VCALENDAR") {
    return fail("not_ics");
  }

  for (const text of lines) {
    const line = parseContentLine(text);
    if (!line) continue;
    if (line.name === "BEGIN") {
      const component = line.value.trim().toUpperCase();
      if (stack.length === 0 && component !== "VCALENDAR") return fail("malformed");
      if (stack.length >= ICS_LIMITS.maxDepth) return fail("too_deep");
      if (stack.length === 0) {
        calendarStart = events.length;
        method = null;
      }
      if (component === "VEVENT" && stack.length === 1) {
        if (events.length >= ICS_LIMITS.maxEvents) return fail("too_many_events");
        current = { lines: [], calendarCancelled: false };
        events.push(current);
      }
      stack.push(component);
    } else if (line.name === "END") {
      const component = line.value.trim().toUpperCase();
      if (stack.pop() !== component) return fail("malformed");
      if (component === "VEVENT") current = null;
      if (component === "VCALENDAR" && method === "CANCEL") {
        for (const e of events.slice(calendarStart)) e.calendarCancelled = true;
      }
    } else if (stack.length === 0) {
      return fail("malformed");
    } else if (stack.length === 1 && stack[0] === "VCALENDAR" && line.name === "METHOD") {
      method = line.value.trim().toUpperCase();
    } else if (stack.length === 2 && stack[1] === "VEVENT" && current) {
      current.lines.push(line);
    }
  }
  if (stack.length > 0) return fail("malformed");
  return ok(events);
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

type DateFail = "missing" | "bad" | "unknown_timezone";

interface ParsedWhen {
  instant: string;
  zone: string;
  allDay: boolean;
  local: LocalDateTime | null;
}

const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;
const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;

function parseWhen(line: IcsLine | undefined, floatingZone: string): Result<ParsedWhen, DateFail> {
  if (!line) return err("missing");
  const value = line.value.trim();
  if (value.length > 20) return err("bad");
  const dateTime = DATE_TIME.exec(value);
  const dateOnly = dateTime ? null : DATE_ONLY.exec(value);
  const m = dateTime ?? dateOnly;
  if (!m) return err("bad");

  const local: LocalDateTime = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: dateTime ? Number(m[4]) : 0,
    minute: dateTime ? Number(m[5]) : 0,
    second: dateTime ? Number(m[6]) : 0,
  };
  const utc = dateTime?.[7] === "Z";
  const tzid = line.params.get("TZID");
  let zone = floatingZone;
  if (utc) {
    zone = "UTC";
  } else if (tzid !== undefined) {
    const resolved = resolveIcsTimezone(tzid);
    if (resolved === null) return err("unknown_timezone");
    zone = resolved;
  }
  const instant = localToUtc(zone, local);
  if (instant === null) return err("bad");
  return ok({ instant, zone, allDay: dateOnly !== null, local });
}

function addDays(local: LocalDateTime, days: number): LocalDateTime {
  const d = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return { ...local, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const DURATION =
  /^(\+)?P(?:(\d{1,4})W)?(?:(\d{1,4})D)?(?:T(?:(\d{1,4})H)?(?:(\d{1,4})M)?(?:(\d{1,4})S)?)?$/;

/** Days and the remaining time of a positive RFC 5545 DURATION, or null when it is not one. */
function parseDuration(raw: string): { days: number; ms: number } | null {
  const value = raw.trim();
  if (value.length > 24) return null;
  const m = DURATION.exec(value);
  if (!m) return null;
  const [, , weeks, days, hours, minutes, seconds] = m;
  const n = (x: string | undefined) => Number(x ?? 0);
  return {
    days: n(weeks) * 7 + n(days),
    ms: n(hours) * 3_600_000 + n(minutes) * MINUTE_MS + n(seconds) * 1000,
  };
}

/** `20261109T080000Z`: the instant a RECURRENCE-ID override replaces, spelled the same whatever zone the file used. */
const compactInstant = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

// ---------------------------------------------------------------------------------------------
// One event
// ---------------------------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NO_PERSON = new Set(["ROOM", "RESOURCE"]);

/** ORGANIZER first, then ATTENDEEs: only people the file names. Rooms and equipment cannot consent. */
function peopleOf(lines: IcsLine[]): { name: string; email: string | null }[] {
  const seen = new Set<string>();
  const people: { name: string; email: string | null }[] = [];
  const ordered = [
    ...lines.filter((l) => l.name === "ORGANIZER"),
    ...lines.filter((l) => l.name === "ATTENDEE"),
  ];
  for (const line of ordered) {
    if (NO_PERSON.has((line.params.get("CUTYPE") ?? "").trim().toUpperCase())) continue;
    const address = line.value.trim();
    const mailto = /^mailto:/i.test(address) ? address.slice(7).split("?")[0]?.trim() : undefined;
    const email =
      mailto !== undefined && mailto.length <= ATTENDEE_LIMITS.email && EMAIL.test(mailto)
        ? mailto.toLowerCase()
        : null;
    const common = normalizeLine(line.params.get("CN") ?? "") ?? "";
    const name = common !== "" && common.length <= ATTENDEE_LIMITS.name ? common : (email ?? "");
    if (name === "") continue;
    const key = email ?? `name:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ name, email });
    // One more than a Meeting may hold is enough for validation to refuse it; no need to keep going.
    if (people.length > ATTENDEE_LIMITS.count) break;
  }
  return people;
}

const textOf = (line: IcsLine | undefined): string | null =>
  line === undefined ? null : unescapeText(line.value);

function buildEvent(raw: RawEvent, options: IcsOptions): Build {
  const first = (name: string) => raw.lines.find((l) => l.name === name);
  const summary = normalizeLine(textOf(first("SUMMARY")) ?? "") ?? "";
  const shown = summary !== "" && summary.length <= LIMITS.title ? summary : null;
  const skip = (code: IcsSkipCode): Build => ({ kind: "skipped", skip: { code, title: shown } });

  const uid = (first("UID")?.value ?? "").trim();
  if (uid === "" || uid.length > MAX_UID || uid.includes("|")) return skip("bad_uid");

  const recurrenceId = first("RECURRENCE-ID");
  if (first("RRULE") !== undefined || first("RDATE") !== undefined) {
    return { kind: "series", uid, title: shown ?? UNTITLED };
  }

  const start = parseWhen(first("DTSTART"), options.floatingZone);
  if (!start.ok) {
    return skip(
      start.error === "missing"
        ? "missing_start"
        : start.error === "unknown_timezone"
          ? "unknown_timezone"
          : "bad_start",
    );
  }
  const { instant: startsAt, zone, allDay, local } = start.value;

  let endsAt: string;
  const endLine = first("DTEND");
  const durationLine = first("DURATION");
  if (endLine) {
    const end = parseWhen(endLine, options.floatingZone);
    if (!end.ok) return skip(end.error === "unknown_timezone" ? "unknown_timezone" : "bad_end");
    endsAt = end.value.instant;
  } else if (durationLine) {
    const duration = parseDuration(durationLine.value);
    if (!duration || !local) return skip("bad_end");
    const base = allDay ? localToUtc(zone, addDays(local, duration.days)) : null;
    const viaDays =
      base === null ? Date.parse(startsAt) + duration.days * 86_400_000 : Date.parse(base);
    endsAt = new Date(viaDays + duration.ms).toISOString();
  } else if (allDay && local) {
    endsAt = localToUtc(zone, addDays(local, 1)) ?? startsAt;
  } else {
    endsAt = new Date(
      Date.parse(startsAt) + NEW_MEETING_LIMITS.durationDefault * MINUTE_MS,
    ).toISOString();
  }
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return skip("end_before_start");

  let providerEventId = uid;
  if (recurrenceId) {
    const replaced = parseWhen(recurrenceId, options.floatingZone);
    if (!replaced.ok)
      return skip(replaced.error === "unknown_timezone" ? "unknown_timezone" : "bad_start");
    providerEventId = `${uid}|${compactInstant(replaced.value.instant)}`;
  }

  const normalized = normalizeCalendarEvent({
    provider: PROVIDER,
    providerEventId,
    title: summary === "" ? UNTITLED : summary,
    startsAt,
    endsAt,
    timezone: zone,
    attendees: peopleOf(raw.lines),
  });
  if (!normalized.ok) return skip("invalid_event");

  const description = normalizeMultiline(textOf(first("DESCRIPTION")) ?? "");
  const location = normalizeLine(textOf(first("LOCATION")) ?? "");
  const sequenceText = first("SEQUENCE")?.value.trim() ?? "";
  return {
    kind: "event",
    sequence: /^\d{1,9}$/.test(sequenceText) ? Number(sequenceText) : 0,
    item: {
      event: normalized.value,
      allDay,
      cancelled:
        raw.calendarCancelled ||
        (first("STATUS")?.value ?? "").trim().toUpperCase() === "CANCELLED",
      location: location === "" || location === null ? null : location,
      description:
        description === "" || description === null
          ? null
          : description.slice(0, ICS_LIMITS.descriptionChars),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The whole file
// ---------------------------------------------------------------------------------------------

/**
 * Parses an Outlook/Teams/Google/Apple `.ics` export (a bounded RFC 5545 subset: VEVENT with UID,
 * SUMMARY, DTSTART/DTEND/DURATION, ORGANIZER, ATTENDEE, LOCATION, DESCRIPTION, STATUS, SEQUENCE,
 * RECURRENCE-ID) into calendar events. Pure: no I/O, no clock, deterministic.
 *
 * Recurring series are never expanded (RRULE/RDATE masters are reported in `series`); explicit
 * single occurrences and RECURRENCE-ID overrides are imported. A file over a limit or that is not a
 * calendar is rejected whole; a single bad event is skipped and reported while the rest import.
 */
export function parseIcs(text: string, options: IcsOptions): Result<IcsParse, IcsRejection> {
  if (!isIanaZone(options.floatingZone)) return err({ code: "bad_zone" });
  if (text.length > ICS_LIMITS.maxBytes) return err({ code: "too_large" });
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.trim() === "") return err({ code: "empty" });

  const unfolded = unfoldLines(body, ICS_LIMITS);
  if (!unfolded.ok) return err({ code: unfolded.error });
  const collected = collectEvents(unfolded.value);
  if (!collected.ok) return collected;
  if (collected.value.length === 0) return err({ code: "no_events" });

  const skipped: IcsSkipped[] = [];
  const seriesByUid = new Map<string, IcsSeries>();
  const winners = new Map<string, { item: IcsEvent; sequence: number }>();
  for (const raw of collected.value) {
    const built = buildEvent(raw, options);
    if (built.kind === "skipped") {
      skipped.push(built.skip);
    } else if (built.kind === "series") {
      seriesByUid.set(built.uid, { title: built.title });
    } else {
      const id = built.item.event.providerEventId;
      const held = winners.get(id);
      if (held && held.sequence > built.sequence) {
        skipped.push({ code: "duplicate", title: built.item.event.title });
      } else {
        if (held) skipped.push({ code: "duplicate", title: held.item.event.title });
        winners.set(id, { item: built.item, sequence: built.sequence });
      }
    }
  }

  const events = [...winners.values()]
    .map((w) => w.item)
    .sort(
      (a, b) =>
        a.event.startsAt.localeCompare(b.event.startsAt) ||
        a.event.providerEventId.localeCompare(b.event.providerEventId),
    );
  return ok({ events, skipped, series: [...seriesByUid.values()] });
}
