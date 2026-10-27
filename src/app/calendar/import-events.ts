import type { ProviderError } from "../../domain/platform/provider-error";
import { ok, type Result } from "../../domain/platform/result";
import type { CalendarImportRepository } from "../../ports/calendar-import-repository";
import type { CalendarSource, TimeRange } from "../../ports/calendar-source";
import { withRetry, type RetryDeps } from "../platform/retry";

export interface ImportDeps {
  calendar: CalendarSource;
  repo: CalendarImportRepository;
  retry: RetryDeps;
}

export interface ImportSummary {
  created: number;
  existing: number;
}

/** Owner-initiated import of upcoming events. Safe to repeat: the same event always maps to one Meeting. */
export async function importCalendarEvents(
  deps: ImportDeps,
  ownerId: string,
  range: TimeRange,
): Promise<Result<ImportSummary, ProviderError>> {
  const listed = await withRetry(() => deps.calendar.listEvents(ownerId, range), deps.retry);
  if (!listed.ok) return listed;

  const summary: ImportSummary = { created: 0, existing: 0 };
  for (const event of listed.value) {
    const outcome = await deps.repo.upsertFromCalendar(ownerId, event);
    if (outcome.created) summary.created += 1;
    else summary.existing += 1;
  }
  return ok(summary);
}
