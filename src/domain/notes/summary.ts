import { err, ok, type Result } from "../platform/result";

export const MAX_SECTIONS = 20;
export const MAX_DECISIONS = 50;
export const MAX_ACTION_ITEMS = 50;
export const MAX_HEADING_LENGTH = 200;
export const MAX_SECTION_BODY_LENGTH = 20_000;
export const MAX_ITEM_TEXT_LENGTH = 2_000;

export interface SummarizerSegment {
  /** Transcript position (chunk_seq * 10000 + seg_index): what source ranges point at. */
  position: number;
  speaker: string;
  text: string;
}

export interface SummarizerAttendee {
  id: string;
  name: string;
}

export interface TemplateSection {
  heading: string;
  prompt: string;
}

export interface SummarizerInput {
  segments: readonly SummarizerSegment[];
  agenda: string | null;
  attendees: readonly SummarizerAttendee[];
  template: { sections: readonly TemplateSection[] } | null;
  /** Regenerate-for-selection: produce exactly this one section. */
  only: TemplateSection | null;
}

export interface SourceRange {
  sourceFrom: number;
  sourceTo: number;
}

/** What the model claims, after schema validation and before grounding checks. */
export interface RawSummary {
  sections: { heading: string; body: string; sourceFrom: number; sourceTo: number }[];
  decisions: { text: string; sourceFrom: number; sourceTo: number }[];
  actionItems: {
    text: string;
    assigneeId: string | null;
    dueDate: string | null;
    sourceFrom: number;
    sourceTo: number;
  }[];
}

/** A grounded draft: safe to store as a Draft note for a person to review and edit. */
export type SummaryDraft = RawSummary;

export interface VerificationContext {
  segmentPositions: readonly number[];
  attendeeIds: readonly string[];
  /** When set, only these headings are kept (in this order). */
  templateHeadings: readonly string[] | null;
  /** Regenerate-for-selection. */
  only: { heading: string } | null;
}

export interface Dropped {
  sections: number;
  decisions: number;
  actionItems: number;
  assignees: number;
  dueDates: number;
}

export type SummaryError = { kind: "too_large" } | { kind: "no_valid_sections" };

const clean = (text: string): string => text.normalize("NFC").replace(/\s+/g, " ").trim();

/** Keeps paragraph structure (single newlines) while normalizing runs of spaces. */
const cleanBody = (text: string): string =>
  text
    .normalize("NFC")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const headingKey = (heading: string): string => clean(heading).toLowerCase();

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * The server-side guardrail between an untrusted model answer and a stored Draft (OWASP A03,
 * product rule 3). Nothing the model says is trusted: every item must cite a real transcript
 * range, assignees must be on the attendee list, dates must be real, sizes are bounded (reject,
 * never truncate). Ungrounded items are dropped and counted so the caller can log how many.
 */
export function verifySummary(
  raw: RawSummary,
  ctx: VerificationContext,
): Result<{ summary: SummaryDraft; dropped: Dropped }, SummaryError> {
  if (
    raw.sections.length > MAX_SECTIONS ||
    raw.decisions.length > MAX_DECISIONS ||
    raw.actionItems.length > MAX_ACTION_ITEMS
  ) {
    return err({ kind: "too_large" });
  }
  if (
    raw.sections.some(
      (s) => s.heading.length > MAX_HEADING_LENGTH || s.body.length > MAX_SECTION_BODY_LENGTH,
    ) ||
    raw.decisions.some((d) => d.text.length > MAX_ITEM_TEXT_LENGTH) ||
    raw.actionItems.some((a) => a.text.length > MAX_ITEM_TEXT_LENGTH)
  ) {
    return err({ kind: "too_large" });
  }

  const positions = new Set(ctx.segmentPositions);
  const grounded = (r: SourceRange): boolean =>
    r.sourceFrom <= r.sourceTo && positions.has(r.sourceFrom) && positions.has(r.sourceTo);
  const attendees = new Set(ctx.attendeeIds);
  const dropped: Dropped = { sections: 0, decisions: 0, actionItems: 0, assignees: 0, dueDates: 0 };

  let sections = raw.sections
    .map((s) => ({
      heading: clean(s.heading),
      body: cleanBody(s.body),
      sourceFrom: s.sourceFrom,
      sourceTo: s.sourceTo,
    }))
    .filter((s) => s.heading !== "" && s.body !== "" && grounded(s));

  if (ctx.only) {
    const wanted = headingKey(ctx.only.heading);
    const chosen = sections.find((s) => headingKey(s.heading) === wanted) ?? sections[0];
    sections = chosen ? [{ ...chosen, heading: clean(ctx.only.heading) }] : [];
  } else if (ctx.templateHeadings) {
    const byKey = new Map<string, (typeof sections)[number]>();
    for (const s of sections)
      if (!byKey.has(headingKey(s.heading))) byKey.set(headingKey(s.heading), s);
    sections = ctx.templateHeadings.flatMap((heading) => {
      const found = byKey.get(headingKey(heading));
      return found ? [{ ...found, heading: clean(heading) }] : [];
    });
  }
  dropped.sections = raw.sections.length - sections.length;
  if (sections.length === 0) return err({ kind: "no_valid_sections" });

  // Regenerating one section never touches decisions or action items.
  const decisions = ctx.only
    ? []
    : raw.decisions
        .map((d) => ({ text: clean(d.text), sourceFrom: d.sourceFrom, sourceTo: d.sourceTo }))
        .filter((d) => d.text !== "" && grounded(d));
  dropped.decisions = ctx.only ? 0 : raw.decisions.length - decisions.length;

  const actionItems = ctx.only
    ? []
    : raw.actionItems
        .map((a) => ({
          text: clean(a.text),
          assigneeId: a.assigneeId,
          dueDate: a.dueDate,
          sourceFrom: a.sourceFrom,
          sourceTo: a.sourceTo,
        }))
        .filter((a) => a.text !== "" && grounded(a))
        .map((a) => {
          let { assigneeId, dueDate } = a;
          if (assigneeId !== null && !attendees.has(assigneeId)) {
            assigneeId = null;
            dropped.assignees += 1;
          }
          if (dueDate !== null && !isRealDate(dueDate)) {
            dueDate = null;
            dropped.dueDates += 1;
          }
          return { ...a, assigneeId, dueDate };
        });
  dropped.actionItems = ctx.only ? 0 : raw.actionItems.length - actionItems.length;

  return ok({ summary: { sections, decisions, actionItems }, dropped });
}
