import type { CalendarEvent } from "../../domain/calendar/event";
import { providerError, type ProviderErrorKind } from "../../domain/platform/provider-error";
import { err, ok } from "../../domain/platform/result";
import type { CalendarSource } from "../../ports/calendar-source";

export interface FakeCalendarSource extends CalendarSource {
  /** Replace the events in `ownerId`'s calendar. */
  seed(ownerId: string, events: CalendarEvent[]): void;
  /** Fail the next `times` calls the way the real provider would. */
  failNext(kind: ProviderErrorKind, times?: number): void;
}

/** Deterministic stand-in for the real provider: same contract, scriptable failures, per-owner data. */
export function createFakeCalendarSource(): FakeCalendarSource {
  const calendars = new Map<string, CalendarEvent[]>();
  const failures: ProviderErrorKind[] = [];

  return {
    seed(ownerId, events) {
      calendars.set(ownerId, structuredClone(events));
    },
    failNext(kind, times = 1) {
      for (let i = 0; i < times; i++) failures.push(kind);
    },
    listEvents(ownerId, range) {
      const kind = failures.shift();
      if (kind !== undefined)
        return Promise.resolve(err(providerError(kind, `fake calendar ${kind}`)));
      const from = Date.parse(range.from);
      const to = Date.parse(range.to);
      const events = (calendars.get(ownerId) ?? []).filter((e) => {
        const start = Date.parse(e.startsAt);
        return start >= from && start < to;
      });
      return Promise.resolve(ok(structuredClone(events)));
    },
  };
}
