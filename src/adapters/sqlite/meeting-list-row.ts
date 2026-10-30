import type { MeetingListItem } from "../../domain/meetings/list-item";
import type { MeetingStatus } from "../../domain/meetings/lifecycle";

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * The columns a meeting card needs, for a query over `meeting m` with `folder f` and `note n`
 * joined. Never selects notes, transcript text or attendee emails.
 */
export const MEETING_CARD_COLUMNS = `m.id, m.title, m.status, m.scheduled_start_at, m.scheduled_end_at, m.timezone,
                m.calendar_provider, m.consent_confirmed_at,
                (SELECT COUNT(*) FROM attendee a WHERE a.owner_id = m.owner_id AND a.meeting_id = m.id) AS attendee_count,
                f.name AS folder_name, n.status AS note_status`;

export function toMeetingListItem(r: Record<string, unknown>): MeetingListItem {
  const noteStatus = text(r["note_status"]);
  return {
    id: String(r["id"]),
    title: String(r["title"]),
    status: String(r["status"]) as MeetingStatus,
    scheduledStartAt: String(r["scheduled_start_at"]),
    scheduledEndAt: text(r["scheduled_end_at"]),
    timezone: String(r["timezone"]),
    calendarProvider: text(r["calendar_provider"]),
    consentConfirmedAt: text(r["consent_confirmed_at"]),
    attendeeCount: Number(r["attendee_count"]),
    folderName: text(r["folder_name"]),
    noteStatus: noteStatus === "draft" || noteStatus === "published" ? noteStatus : null,
  };
}
