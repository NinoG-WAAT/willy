import { err, ok, type Result } from "../platform/result";
import { normalizeLine, normalizeMultiline, type FieldError } from "../platform/text";
import { endOfLocalDayUtc } from "../platform/time";
import { MAX_ITEM_TEXT_LENGTH, MAX_SECTION_BODY_LENGTH } from "./summary";

export const MAX_SPEAKER_NAME_LENGTH = 100;

export type ReviewItemKind = "note_section" | "decision" | "action_item";

const KINDS: readonly string[] = ["note_section", "decision", "action_item"];

export interface HighlightableItem {
  kind: ReviewItemKind;
  id: string;
  /** Transcript positions this item cites; null for items the owner added by hand. */
  sourceFrom: number | null;
  sourceTo: number | null;
}

export interface TranscriptRange {
  from: number;
  to: number;
}

export interface Highlight {
  /** Transcript segments to mark as the source. */
  range: TranscriptRange | null;
  /** The summary item a search hit points at. */
  hit: { kind: ReviewItemKind; id: string } | null;
}

const RANGE = /^(\d{1,9})-(\d{1,9})$/;

/**
 * What the review page marks, from query parameters that are untrusted: `src=<from>-<to>` (a
 * source link) or `hit=<kind>:<id>` (a search result). A hit only counts when it names an item of
 * this very note, so a guessed or foreign id marks nothing.
 */
export function resolveHighlight(
  params: { src: string | null; hit: string | null },
  items: readonly HighlightableItem[],
): Highlight {
  const nothing: Highlight = { range: null, hit: null };
  if (params.src !== null) {
    const match = RANGE.exec(params.src);
    if (!match) return nothing;
    const [from, to] = [Number(match[1]), Number(match[2])];
    return from <= to ? { range: { from, to }, hit: null } : nothing;
  }
  if (params.hit === null) return nothing;
  const colon = params.hit.indexOf(":");
  const kind = params.hit.slice(0, colon);
  const id = params.hit.slice(colon + 1);
  if (colon === -1 || !KINDS.includes(kind) || id === "") return nothing;
  const item = items.find((i) => i.kind === kind && i.id === id);
  if (!item) return nothing;
  return {
    range:
      item.sourceFrom !== null && item.sourceTo !== null
        ? { from: item.sourceFrom, to: item.sourceTo }
        : null,
    hit: { kind: item.kind, id: item.id },
  };
}

/** Overdue is a fact about an open item and the clock; the page states it in words. */
export function isOverdue(item: { status: "open" | "done"; dueAt: string | null }, now: Date) {
  return item.status === "open" && item.dueAt !== null && Date.parse(item.dueAt) < now.getTime();
}

/** The calendar day (YYYY-MM-DD) of a due instant in the zone it was meant in, for a date input. */
export function dueDateInputValue(dueAt: string | null, timeZone: string): string {
  if (dueAt === null) return "";
  const format = (zone: string): string =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(dueAt));
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

/** Time into the recording as people read it: 0:05, 12:30, 1:02:03. */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const [h, m, sec] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const two = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${String(h)}:${two(m)}:${two(sec)}` : `${String(m)}:${two(sec)}`;
}

const tooLong = (field: string, max: number): FieldError => ({
  field,
  message: `Use at most ${String(max)} characters.`,
});

export function normalizeSectionBody(raw: unknown): Result<string, FieldError> {
  const body = normalizeMultiline(raw);
  if (body === null || body === "") return err({ field: "body", message: "Write something." });
  if (body.length > MAX_SECTION_BODY_LENGTH) return err(tooLong("body", MAX_SECTION_BODY_LENGTH));
  return ok(body);
}

export function normalizeDecisionText(raw: unknown): Result<string, FieldError> {
  const text = normalizeLine(raw);
  if (text === null || text === "")
    return err({ field: "text", message: "Describe the decision." });
  if (text.length > MAX_ITEM_TEXT_LENGTH) return err(tooLong("text", MAX_ITEM_TEXT_LENGTH));
  return ok(text);
}

export function normalizeSpeakerName(raw: unknown, field: string): Result<string, FieldError> {
  const name = normalizeLine(raw);
  if (name === null || name === "") return err({ field, message: "Enter a name." });
  if (name.length > MAX_SPEAKER_NAME_LENGTH) return err(tooLong(field, MAX_SPEAKER_NAME_LENGTH));
  return ok(name);
}

export interface ActionItemFields {
  text: string;
  /** Must be an Attendee of the meeting (the repository checks), never free text. */
  assigneeId: string | null;
  dueAt: string | null;
  dueTimezone: string | null;
  done: boolean;
}

/**
 * Validates an action item edit. A due day (YYYY-MM-DD) is stored as the end of that day in the
 * meeting's zone, the same rule as for generated items, so what is shown matches what was meant.
 */
export function normalizeActionItemInput(
  raw: { text: unknown; assignee: unknown; due: unknown; done: boolean },
  meetingTimeZone: string,
): Result<ActionItemFields, FieldError[]> {
  const errors: FieldError[] = [];
  const text = normalizeLine(raw.text);
  if (text === null || text === "") errors.push({ field: "text", message: "Describe the action." });
  else if (text.length > MAX_ITEM_TEXT_LENGTH) errors.push(tooLong("text", MAX_ITEM_TEXT_LENGTH));

  const assignee = normalizeLine(raw.assignee) ?? "";
  const due = normalizeLine(raw.due) ?? "";
  const dueAt = due === "" ? null : endOfLocalDayUtc(due, meetingTimeZone);
  if (due !== "" && dueAt === null) {
    errors.push({ field: "due", message: "Enter a real date." });
  }
  if (errors.length > 0 || text === null) return err(errors);
  return ok({
    text,
    assigneeId: assignee === "" ? null : assignee,
    dueAt,
    dueTimezone: dueAt === null ? null : meetingTimeZone,
    done: raw.done,
  });
}
