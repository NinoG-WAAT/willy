import type { Attendee } from "../domain/meetings/attendee";
import type { MeetingStatus } from "../domain/meetings/lifecycle";
import type { Result } from "../domain/platform/result";

/** Everything the live note screen shows about one meeting. Rough notes are the owner's own text. */
export interface MeetingDetail {
  id: string;
  title: string;
  status: MeetingStatus;
  agenda: string | null;
  roughNotes: string;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  timezone: string;
  attendees: Attendee[];
  consentConfirmedAt: string | null;
  captureStartedAt: string | null;
  updatedAt: string;
  /** The folder the published note is filed in; null until a note is published. */
  folder: { id: string; name: string } | null;
  /** The template the meeting was created from, when it still exists. */
  template: { id: string; name: string } | null;
  /** Null when there is no note yet. */
  noteStatus: "draft" | "published" | null;
}

/** Owner-scoped. Unknown ids, other owners' meetings and meetings being deleted are null. */
export interface MeetingDetailQuery {
  findDetail(ownerId: string, meetingId: string): Promise<MeetingDetail | null>;
}

/** Rough notes survive any failure, so saving works in every state except deleting/deleted. */
export interface RoughNotesStore {
  saveRoughNotes(
    ownerId: string,
    meetingId: string,
    notes: string,
    now: Date,
  ): Promise<Result<{ savedAt: string }, "not_found">>;
}
