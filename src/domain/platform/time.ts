const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Milliseconds the zone is ahead of UTC at the instant `utcMs`, or null for an unknown zone. */
function offsetMs(utcMs: number, timeZone: string): number | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(new Date(utcMs));
  } catch {
    return null;
  }
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Number.isNaN(asUtc) ? null : asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instant (UTC ISO-8601) at which calendar day `date` (YYYY-MM-DD) ends, 23:59:59 local time,
 * in the IANA zone `timeZone`: what "due on Friday" means for the person who said it. Uses the
 * offset in force at that moment, so daylight-saving change days come out right. Returns null for
 * an invalid date or an unknown zone.
 */
export function endOfLocalDayUtc(date: string, timeZone: string): string | null {
  const match = DATE.exec(date);
  if (!match || timeZone === "") return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }

  const wall = Date.UTC(y, m - 1, d, 23, 59, 59);
  const first = offsetMs(wall, timeZone);
  if (first === null) return null;
  // The offset at the wall-clock time may differ from the offset at the real instant when a
  // daylight-saving change falls inside the day; look again at the corrected instant.
  const second = offsetMs(wall - first, timeZone);
  if (second === null) return null;
  return new Date(wall - second).toISOString();
}
