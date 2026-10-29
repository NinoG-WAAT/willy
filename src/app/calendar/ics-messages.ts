import type { IcsSkipCode } from "../../domain/calendar/ics";

/**
 * What the owner reads when a calendar file is refused. Fixed text keyed by code: nothing from the
 * file (or the request) is ever echoed into a message, so a hostile file cannot choose what the
 * page says.
 */
const UNREADABLE =
  "That file could not be read as a calendar export. Export it again from Outlook as an iCalendar (.ics) file.";

const PROBLEMS: Readonly<Record<string, string>> = {
  no_input: "Choose an .ics file or paste the calendar text.",
  both_sources: "Use either a file or pasted text, not both.",
  wrong_type:
    "Only .ics calendar files are accepted. Export your events as an iCalendar (.ics) file.",
  too_large: "That calendar is larger than 1 MB. Export a shorter date range and try again.",
  bad_encoding:
    "That file is not UTF-8 text. Save the calendar as a UTF-8 .ics file and try again.",
  bad_zone: "Choose a time zone from the list.",
  empty: "The calendar is empty.",
  not_ics: "That does not look like a calendar (.ics) file.",
  no_events: "The calendar holds no events.",
  too_many_events: "That calendar has more than 200 events. Export a shorter date range.",
  none_selected: "Tick at least one event to import.",
  unknown_selection:
    "Some of the ticked events were not found in the calendar. Preview the file again.",
  malformed: UNREADABLE,
  too_many_selected: UNREADABLE,
  line_too_long: UNREADABLE,
  too_many_lines: UNREADABLE,
  too_deep: UNREADABLE,
  invalid_characters: UNREADABLE,
};

export function icsProblemMessage(code: string | null): string | null {
  return code !== null && Object.hasOwn(PROBLEMS, code) ? (PROBLEMS[code] ?? null) : null;
}

/** 413 for a file over the size limit, 422 for the other refusals of a well-formed request. */
export function icsProblemStatus(code: string): 413 | 422 {
  return code === "too_large" ? 413 : 422;
}

const SKIPPED: Readonly<Record<IcsSkipCode, string>> = {
  bad_uid: "has no usable identifier",
  missing_start: "has no start time",
  bad_start: "has a start time that could not be read",
  bad_end: "has an end time that could not be read",
  unknown_timezone: "uses a time zone that could not be identified",
  end_before_start: "ends before it starts",
  invalid_event:
    "has details that cannot be imported (such as a very long title or too many attendees)",
  duplicate: "appears more than once in the file; the newest copy is used",
};

export const skippedReason = (code: IcsSkipCode): string => SKIPPED[code];
