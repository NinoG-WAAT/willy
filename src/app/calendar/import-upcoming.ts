import type { ProviderError } from "../../domain/platform/provider-error";
import type { Result } from "../../domain/platform/result";
import { importCalendarEvents, type ImportDeps, type ImportSummary } from "./import-events";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Look back a day (to catch today's earlier events) and ahead two weeks. */
const LOOK_BACK_DAYS = 1;
const LOOK_AHEAD_DAYS = 14;

/** The home screen's "Import from calendar" action. Safe to repeat: events never duplicate. */
export function importUpcomingEvents(
  deps: ImportDeps,
  ownerId: string,
  now: Date,
): Promise<Result<ImportSummary, ProviderError>> {
  return importCalendarEvents(deps, ownerId, {
    from: new Date(now.getTime() - LOOK_BACK_DAYS * DAY_MS).toISOString(),
    to: new Date(now.getTime() + LOOK_AHEAD_DAYS * DAY_MS).toISOString(),
  });
}
