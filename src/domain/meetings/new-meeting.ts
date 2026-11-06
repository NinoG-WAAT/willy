import { t } from "../../i18n/translate";
import { err, ok, type Result } from "../platform/result";
import { normalizeLine, normalizeMultiline, type FieldError } from "../platform/text";
import { zonedLocalToUtc } from "../platform/zoned-time";
import { normalizeAttendees, type Attendee } from "./attendee";

export const NEW_MEETING_LIMITS = {
  title: 200,
  agenda: 2000,
  durationMin: 5,
  durationMax: 480,
  durationDefault: 30,
} as const;

export interface RawNewMeeting {
  title: unknown;
  date: unknown;
  time: unknown;
  timezone: unknown;
  durationMinutes: unknown;
  agenda: unknown;
  /** One attendee per line: `Name <email>`, an email, or a name. */
  attendees: unknown;
}

export interface NewMeetingInput {
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  agenda: string | null;
  attendees: Attendee[];
}

/** Splits the attendees textarea into raw rows; validation and normalization happen afterwards. */
export function parseAttendeeLines(text: string): { name: string; email: string }[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const angle = /^(.*)<([^<>]*)>$/.exec(line);
      if (angle) return { name: (angle[1] ?? "").trim(), email: (angle[2] ?? "").trim() };
      if (line.includes("@") && !/\s/.test(line)) return { name: "", email: line };
      return { name: line, email: "" };
    });
}

/** A function, not a table: the message is written in the language of the request being served. */
function zonedError(
  code: "invalid_date" | "invalid_time" | "invalid_timezone" | "nonexistent_time",
): FieldError {
  switch (code) {
    case "invalid_date":
      return { field: "date", message: t("Enter a valid date.") };
    case "invalid_time":
      return { field: "time", message: t("Enter a valid time.") };
    case "invalid_timezone":
      return { field: "timezone", message: t("Choose a time zone from the list.") };
    case "nonexistent_time":
      return {
        field: "time",
        message: t(
          "That time does not exist in this time zone (clocks move forward). Pick another time.",
        ),
      };
  }
}

/**
 * Validates and normalizes the new-note form. Local date and time are interpreted in the chosen
 * IANA zone and stored as UTC next to that zone's name. All problems are returned together.
 */
export function normalizeNewMeeting(raw: RawNewMeeting): Result<NewMeetingInput, FieldError[]> {
  const errors: FieldError[] = [];

  const title = normalizeLine(raw.title) ?? "";
  if (title === "") errors.push({ field: "title", message: t("Enter a title for the meeting.") });
  else if (title.length > NEW_MEETING_LIMITS.title) {
    errors.push({
      field: "title",
      message: t("Titles can be at most {max} characters.", {
        max: String(NEW_MEETING_LIMITS.title),
      }),
    });
  }

  const agendaText = normalizeMultiline(raw.agenda) ?? "";
  if (agendaText.length > NEW_MEETING_LIMITS.agenda) {
    errors.push({
      field: "agenda",
      message: t("The agenda can be at most {max} characters.", {
        max: String(NEW_MEETING_LIMITS.agenda),
      }),
    });
  }

  const durationRaw = normalizeLine(raw.durationMinutes) ?? "";
  const durationMinutes =
    durationRaw === ""
      ? NEW_MEETING_LIMITS.durationDefault
      : /^\d{1,4}$/.test(durationRaw)
        ? Number(durationRaw)
        : NaN;
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < NEW_MEETING_LIMITS.durationMin ||
    durationMinutes > NEW_MEETING_LIMITS.durationMax
  ) {
    errors.push({
      field: "duration",
      message: t("Duration must be between {min} and {max} minutes.", {
        min: String(NEW_MEETING_LIMITS.durationMin),
        max: String(NEW_MEETING_LIMITS.durationMax),
      }),
    });
  }

  const timezone = normalizeLine(raw.timezone) ?? "";
  const date = normalizeLine(raw.date) ?? "";
  const time = normalizeLine(raw.time) ?? "";
  // Check each part on its own so every bad field is reported, not only the first.
  const parts = [
    zonedLocalToUtc(date, "00:00", "UTC"),
    zonedLocalToUtc("2026-01-01", time, "UTC"),
    zonedLocalToUtc("2026-01-01", "00:00", timezone),
  ];
  for (const part of parts) if (!part.ok) errors.push(zonedError(part.error));
  const start = parts.every((p) => p.ok) ? zonedLocalToUtc(date, time, timezone) : null;
  if (start && !start.ok) errors.push(zonedError(start.error));

  const attendeeText = typeof raw.attendees === "string" ? raw.attendees : "";
  const attendees = normalizeAttendees(parseAttendeeLines(attendeeText));
  if (!attendees.ok) errors.push(attendees.error);

  if (errors.length > 0 || !start?.ok || !attendees.ok) return err(errors);
  const endsAt = new Date(Date.parse(start.value) + durationMinutes * 60_000).toISOString();
  return ok({
    title,
    startsAt: start.value,
    endsAt,
    timezone,
    agenda: agendaText === "" ? null : agendaText,
    attendees: attendees.value,
  });
}
