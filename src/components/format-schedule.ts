/** "Tue 3 Nov, 09:00 CET": the wall time in the meeting's own IANA zone, never the server's. */
export function formatSchedule(startsAtUtc: string, timeZone: string): string {
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
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(date);
  }
}
