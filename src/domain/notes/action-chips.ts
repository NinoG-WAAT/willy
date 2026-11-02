import { isOverdue } from "./review";

/** What the review outline says about one ActionItem, as short words for chips. Null: no chip. */
export interface ActionItemChips {
  /** The assignee's name. */
  assignee: string | null;
  /** "Due Thu 5 Nov": the day in the zone it was meant in, with the year when it is not this one. */
  due: string | null;
  /** "Overdue" for an open item whose due date has passed: words, never colour alone. */
  overdue: string | null;
}

interface ChipSource {
  status: "open" | "done";
  assigneeId: string | null;
  dueAt: string | null;
  dueTimezone: string | null;
}

interface ChipContext {
  /** The page's clock, read once per request. */
  now: Date;
  meetingTimezone: string;
  /** Attendee id to name. */
  attendeeNames: ReadonlyMap<string, string>;
}

function inZone(instant: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(instant);
  } catch {
    // A zone name this runtime does not know: UTC is wrong by hours at worst, never a crash.
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(instant);
  }
}

function dueText(dueAt: string, zone: string, now: Date): string {
  const due = new Date(dueAt);
  const day = inZone(due, zone, { weekday: "short", day: "numeric", month: "short" });
  const year = inZone(due, zone, { year: "numeric" });
  const thisYear = inZone(now, zone, { year: "numeric" });
  return year === thisYear ? `Due ${day}` : `Due ${day} ${year}`;
}

export function actionItemChips(item: ChipSource, context: ChipContext): ActionItemChips {
  const zone = item.dueTimezone ?? context.meetingTimezone;
  return {
    assignee:
      item.assigneeId === null ? null : (context.attendeeNames.get(item.assigneeId) ?? "Unknown"),
    due: item.dueAt === null ? null : dueText(item.dueAt, zone, context.now),
    overdue: isOverdue(item, context.now) ? "Overdue" : null,
  };
}
