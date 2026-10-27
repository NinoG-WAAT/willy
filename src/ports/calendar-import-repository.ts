import type { CalendarEvent } from "../domain/calendar/event";

export interface ImportOutcome {
  meetingId: string;
  /** False when the event had been imported before (the existing Meeting was refreshed). */
  created: boolean;
}

/**
 * Persists a calendar event as a Meeting. Must be idempotent per (owner, provider, providerEventId),
 * backed by a UNIQUE constraint, and must only refresh calendar-owned fields (title, schedule,
 * attendees): rough notes, consent and capture state are never touched by an import.
 */
export interface CalendarImportRepository {
  upsertFromCalendar(ownerId: string, event: CalendarEvent): Promise<ImportOutcome>;
}
