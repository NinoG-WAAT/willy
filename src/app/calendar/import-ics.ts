import { parseIcs, ICS_LIMITS, type IcsParse, type IcsRejection } from "../../domain/calendar/ics";
import { err, ok, type Result } from "../../domain/platform/result";
import type { CalendarImportRepository } from "../../ports/calendar-import-repository";
import type { ImportSummary } from "./import-events";

export interface IcsSource {
  text: string;
  /** IANA zone for events that carry none of their own. */
  floatingZone: string;
}

export type IcsSelectionCode = "none_selected" | "unknown_selection" | "too_many_selected";
export interface IcsConfirmError {
  code: IcsRejection["code"] | IcsSelectionCode;
}

/** The preview step: parse only, write nothing. The text is not kept anywhere. */
export function previewIcs(source: IcsSource): Result<IcsParse, IcsRejection> {
  return parseIcs(source.text, { floatingZone: source.floatingZone });
}

/**
 * The confirm step. The file is parsed again here, so what is imported is exactly what the parser
 * produces for this text, never data the browser claims to have parsed. Every selected id must name
 * an importable event of that file (a cancelled event, a series master, or a guessed id does not);
 * if any does not, nothing is written. Writes go through the idempotent import repository keyed by
 * (owner, provider `ics`, stable event id), so repeating a confirm adds no Meeting. The owner is
 * the caller's session owner, passed by the route, never read from the request.
 */
export async function confirmIcsImport(
  deps: { repo: CalendarImportRepository },
  ownerId: string,
  input: IcsSource & { selectedIds: string[] },
): Promise<Result<ImportSummary, IcsConfirmError>> {
  if (input.selectedIds.length > ICS_LIMITS.maxEvents) return err({ code: "too_many_selected" });
  const selected = [...new Set(input.selectedIds)];
  if (selected.length === 0) return err({ code: "none_selected" });

  const parsed = previewIcs(input);
  if (!parsed.ok) return parsed;
  const importable = new Map(
    parsed.value.events.filter((e) => !e.cancelled).map((e) => [e.event.providerEventId, e.event]),
  );
  const events = selected.map((id) => importable.get(id));
  if (events.some((e) => e === undefined)) return err({ code: "unknown_selection" });

  const summary: ImportSummary = { created: 0, existing: 0 };
  for (const event of events) {
    if (event === undefined) continue;
    const outcome = await deps.repo.upsertFromCalendar(ownerId, event);
    if (outcome.created) summary.created += 1;
    else summary.existing += 1;
  }
  return ok(summary);
}
