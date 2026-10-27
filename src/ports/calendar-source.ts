import type { CalendarEvent } from "../domain/calendar/event";
import type { ProviderError } from "../domain/platform/provider-error";
import type { Result } from "../domain/platform/result";

export interface TimeRange {
  /** UTC ISO-8601, inclusive. */
  from: string;
  /** UTC ISO-8601, exclusive. */
  to: string;
}

/** Reads one owner's calendar. Implementations scope strictly by owner and never throw for provider failures. */
export interface CalendarSource {
  listEvents(ownerId: string, range: TimeRange): Promise<Result<CalendarEvent[], ProviderError>>;
}
