import type { MeetingStatus } from "./lifecycle";

/** Read model for the meetings home screen. Never carries notes, transcript text or attendee emails. */
export interface MeetingListItem {
  id: string;
  title: string;
  status: MeetingStatus;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  timezone: string;
  calendarProvider: string | null;
  consentConfirmedAt: string | null;
  attendeeCount: number;
  /** Name of the folder the published note is filed in, if any. */
  folderName: string | null;
  noteStatus: "draft" | "published" | null;
}
