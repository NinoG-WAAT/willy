/** A wall-clock reading with no zone attached, as ICS writes "20261103T100000". */
export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MIN_YEAR = 1970;
const MAX_YEAR = 2200;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(zone);
  if (cached) return cached;
  try {
    const made = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, made);
    return made;
  } catch {
    return null;
  }
}

/** Offset of the zone from UTC at an instant, in milliseconds (east is positive). */
function offsetAt(format: Intl.DateTimeFormat, utcMs: number): number {
  const part = new Map<string, number>();
  for (const p of format.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") part.set(p.type, Number(p.value));
  }
  const asIfUtc = Date.UTC(
    part.get("year") ?? 0,
    (part.get("month") ?? 1) - 1,
    part.get("day") ?? 1,
    (part.get("hour") ?? 0) % 24,
    part.get("minute") ?? 0,
    part.get("second") ?? 0,
  );
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

function isRealLocalTime(t: LocalDateTime, asIfUtc: number): boolean {
  if (t.year < MIN_YEAR || t.year > MAX_YEAR) return false;
  const d = new Date(asIfUtc);
  return (
    d.getUTCFullYear() === t.year &&
    d.getUTCMonth() === t.month - 1 &&
    d.getUTCDate() === t.day &&
    d.getUTCHours() === t.hour &&
    d.getUTCMinutes() === t.minute &&
    d.getUTCSeconds() === t.second
  );
}

/**
 * Converts a wall-clock time in an IANA zone to a UTC instant (ISO-8601), following RFC 5545
 * 3.3.5: a time that happens twice (clocks going back) is the first occurrence; a time that does
 * not exist (clocks going forward) is read with the offset in force before the gap. Returns null
 * for an unknown zone or a date that is not on the calendar. Uses only the runtime's tz database.
 */
export function localToUtc(zone: string, t: LocalDateTime): string | null {
  const format = formatterFor(zone);
  if (!format) return null;
  const asIfUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  if (Number.isNaN(asIfUtc) || !isRealLocalTime(t, asIfUtc)) return null;

  const before = offsetAt(format, asIfUtc - DAY_MS);
  const after = offsetAt(format, asIfUtc + DAY_MS);
  const valid = [...new Set([before, after])]
    .map((offset) => asIfUtc - offset)
    .filter((utc) => asIfUtc - utc === offsetAt(format, utc));
  const utc = valid.length > 0 ? Math.min(...valid) : asIfUtc - before;
  return new Date(utc).toISOString();
}
