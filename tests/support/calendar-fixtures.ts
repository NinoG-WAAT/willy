import type { CalendarEvent } from "../../src/domain/calendar/event";

/** Deterministic event factory shared by calendar tests. */
export function makeEvent(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    provider: "google",
    providerEventId: id,
    title: `Meeting ${id}`,
    startsAt: "2026-11-03T08:00:00.000Z",
    endsAt: "2026-11-03T08:30:00.000Z",
    timezone: "Europe/Paris",
    attendees: [{ name: "Ada Lovelace", email: "ada@example.com" }],
    ...overrides,
  };
}

export const RANGE = { from: "2026-11-01T00:00:00.000Z", to: "2026-11-30T00:00:00.000Z" };
