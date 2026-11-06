import { t } from "../../i18n/translate";
import type { IcsSkipCode } from "../../domain/calendar/ics";

/**
 * What the owner reads when a calendar file is refused. Fixed text keyed by code: nothing from the
 * file (or the request) is ever echoed into a message, so a hostile file cannot choose what the
 * page says. Written per request, in the owner's language.
 */
const unreadable = (): string =>
  t(
    "That file could not be read as a calendar export. Export it again from Outlook as an iCalendar (.ics) file.",
  );

export function icsProblemMessage(code: string | null): string | null {
  switch (code) {
    case "no_input":
      return t("Choose an .ics file or paste the calendar text.");
    case "both_sources":
      return t("Use either a file or pasted text, not both.");
    case "wrong_type":
      return t(
        "Only .ics calendar files are accepted. Export your events as an iCalendar (.ics) file.",
      );
    case "too_large":
      return t("That calendar is larger than 1 MB. Export a shorter date range and try again.");
    case "bad_encoding":
      return t(
        "That file is not UTF-8 text. Save the calendar as a UTF-8 .ics file and try again.",
      );
    case "bad_zone":
      return t("Choose a time zone from the list.");
    case "empty":
      return t("The calendar is empty.");
    case "not_ics":
      return t("That does not look like a calendar (.ics) file.");
    case "no_events":
      return t("The calendar holds no events.");
    case "too_many_events":
      return t("That calendar has more than 200 events. Export a shorter date range.");
    case "none_selected":
      return t("Tick at least one event to import.");
    case "unknown_selection":
      return t("Some of the ticked events were not found in the calendar. Preview the file again.");
    case "malformed":
    case "too_many_selected":
    case "line_too_long":
    case "too_many_lines":
    case "too_deep":
    case "invalid_characters":
      return unreadable();
    default:
      return null;
  }
}

/** 413 for a file over the size limit, 422 for the other refusals of a well-formed request. */
export function icsProblemStatus(code: string): 413 | 422 {
  return code === "too_large" ? 413 : 422;
}

/**
 * Why an event in the file will not be imported, as one whole sentence. The title is the owner's
 * own calendar text, put in as a value; an event without one is "An event". Two sentences per
 * reason (not a title glued to a reason) because French agrees and orders them differently.
 */
export function skippedMessage(code: IcsSkipCode, title: string | null): string {
  if (title !== null) {
    switch (code) {
      case "bad_uid":
        return t('"{title}" has no usable identifier.', { title });
      case "missing_start":
        return t('"{title}" has no start time.', { title });
      case "bad_start":
        return t('"{title}" has a start time that could not be read.', { title });
      case "bad_end":
        return t('"{title}" has an end time that could not be read.', { title });
      case "unknown_timezone":
        return t('"{title}" uses a time zone that could not be identified.', { title });
      case "end_before_start":
        return t('"{title}" ends before it starts.', { title });
      case "invalid_event":
        return t(
          '"{title}" has details that cannot be imported (such as a very long title or too many attendees).',
          { title },
        );
      case "duplicate":
        return t('"{title}" appears more than once in the file; the newest copy is used.', {
          title,
        });
    }
  }
  switch (code) {
    case "bad_uid":
      return t("An event has no usable identifier.");
    case "missing_start":
      return t("An event has no start time.");
    case "bad_start":
      return t("An event has a start time that could not be read.");
    case "bad_end":
      return t("An event has an end time that could not be read.");
    case "unknown_timezone":
      return t("An event uses a time zone that could not be identified.");
    case "end_before_start":
      return t("An event ends before it starts.");
    case "invalid_event":
      return t(
        "An event has details that cannot be imported (such as a very long title or too many attendees).",
      );
    case "duplicate":
      return t("An event appears more than once in the file; the newest copy is used.");
  }
}
