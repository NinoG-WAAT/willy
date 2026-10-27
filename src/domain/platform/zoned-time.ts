import { err, ok, type Result } from "./result";

export type ZonedTimeError =
  "invalid_date" | "invalid_time" | "invalid_timezone" | "nonexistent_time";

const DAY_MS = 86_400_000;

/** The wall-clock reading of `utcMs` in `timeZone`, expressed as if it were UTC. */
function wallClockMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
}

/**
 * Converts a local date (YYYY-MM-DD) and time (HH:MM) in an IANA zone to a UTC ISO instant.
 * A wall time skipped by a clock change is rejected; one that occurs twice resolves to its first
 * occurrence. The zone database is the runtime's, so no offsets are hard-coded here.
 */
export function zonedLocalToUtc(
  date: string,
  time: string,
  timeZone: string,
): Result<string, ZonedTimeError> {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d) return err("invalid_date");
  if (!t) return err("invalid_time");
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];

  const asUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    return err("invalid_date");
  }
  if (hour > 23 || minute > 59) return err("invalid_time");

  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    return err("invalid_timezone");
  }

  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  // The zone's offset a day before and after brackets any clock change on that day.
  const offsets = new Set(
    [wanted - DAY_MS, wanted + DAY_MS].map((probe) => wallClockMs(probe, timeZone) - probe),
  );
  const matches = [...offsets]
    .map((offset) => wanted - offset)
    .filter((candidate) => wallClockMs(candidate, timeZone) === wanted)
    .sort((a, b) => a - b);
  const first = matches[0];
  return first === undefined ? err("nonexistent_time") : ok(new Date(first).toISOString());
}
