import { endOfLocalDayUtc } from "../platform/time";
import type { SummaryDraft } from "./summary";

export interface NewSection {
  position: number;
  heading: string;
  body: string;
  sourceFrom: number;
  sourceTo: number;
}

export interface NewDecision {
  position: number;
  text: string;
  sourceFrom: number;
  sourceTo: number;
}

export interface NewActionItem {
  position: number;
  text: string;
  /** An attendee of the meeting, or null (already verified by `verifySummary`). */
  assigneeId: string | null;
  /** UTC instant, with the zone it was meant in; both or neither (a database constraint). */
  dueAt: string | null;
  dueTimezone: string | null;
  sourceFrom: number;
  sourceTo: number;
}

export interface NewDraft {
  sections: NewSection[];
  decisions: NewDecision[];
  actionItems: NewActionItem[];
}

/**
 * Turns a verified summary into the rows of a draft note: stable positions, and a due date
 * (a calendar day the model read from the transcript) placed at the end of that day in the
 * meeting's time zone. A date that cannot be placed is dropped rather than guessed.
 */
export function toNewDraft(summary: SummaryDraft, ctx: { timezone: string }): NewDraft {
  return {
    sections: summary.sections.map((s, position) => ({ position, ...s })),
    decisions: summary.decisions.map((d, position) => ({ position, ...d })),
    actionItems: summary.actionItems.map((a, position) => {
      const dueAt = a.dueDate === null ? null : endOfLocalDayUtc(a.dueDate, ctx.timezone);
      return {
        position,
        text: a.text,
        assigneeId: a.assigneeId,
        dueAt,
        dueTimezone: dueAt === null ? null : ctx.timezone,
        sourceFrom: a.sourceFrom,
        sourceTo: a.sourceTo,
      };
    }),
  };
}
