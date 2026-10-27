import type { CalendarAttendee, CalendarEvent } from "../../domain/calendar/event";
import type { CalendarImportRepository } from "../../ports/calendar-import-repository";

export interface ImportedMeeting {
  id: string;
  provider: string;
  providerEventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  attendees: CalendarAttendee[];
}

export interface InMemoryCalendarImportRepository extends CalendarImportRepository {
  meetingsOf(ownerId: string): ImportedMeeting[];
}

/**
 * Test/dev stand-in with the same uniqueness rule the D1 repository will enforce:
 * one Meeting per (owner, provider, providerEventId).
 */
export function createInMemoryCalendarImportRepository(
  newId: () => string,
): InMemoryCalendarImportRepository {
  const byKey = new Map<string, { ownerId: string; meeting: ImportedMeeting }>();
  const keyOf = (ownerId: string, e: CalendarEvent) =>
    JSON.stringify([ownerId, e.provider, e.providerEventId]);

  return {
    upsertFromCalendar(ownerId, event) {
      const key = keyOf(ownerId, event);
      const existing = byKey.get(key);
      const fields = {
        provider: event.provider,
        providerEventId: event.providerEventId,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
        attendees: structuredClone(event.attendees),
      };
      if (existing) {
        Object.assign(existing.meeting, fields);
        return Promise.resolve({ meetingId: existing.meeting.id, created: false });
      }
      const meeting = { id: newId(), ...fields };
      byKey.set(key, { ownerId, meeting });
      return Promise.resolve({ meetingId: meeting.id, created: true });
    },
    meetingsOf(ownerId) {
      return [...byKey.values()]
        .filter((v) => v.ownerId === ownerId)
        .map((v) => structuredClone(v.meeting));
    },
  };
}
