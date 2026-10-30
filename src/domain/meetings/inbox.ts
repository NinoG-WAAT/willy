/** A scheduled meeting without an end is assumed to last this long. */
const ASSUMED_DURATION_MS = 60 * 60 * 1000;

/**
 * The Inbox shows what needs the owner, section by section, and nothing that is finished
 * (published notes live in folders). A section is cut at this many rows; the page says when more
 * exist and links to All notes, so no query is unbounded.
 */
export const INBOX_SECTION_LIMIT = 50;

export interface UpcomingBounds {
  /** A scheduled meeting with an end is upcoming while that end is at or after this instant. */
  endsAfter: string;
  /** One without an end is assumed to last an hour: upcoming while it started at or after this. */
  openEndedStartsAfter: string;
}

/** The instants a scheduled meeting is compared with to tell upcoming from over, as ISO text. */
export function upcomingBounds(now: Date): UpcomingBounds {
  return {
    endsAfter: now.toISOString(),
    openEndedStartsAfter: new Date(now.getTime() - ASSUMED_DURATION_MS).toISOString(),
  };
}
