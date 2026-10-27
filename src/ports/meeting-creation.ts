import type { Attendee } from "../domain/meetings/attendee";

export interface NewMeetingRecord {
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  agenda: string | null;
  /** An id the owner owns, or null (the built-in layout applies). */
  templateId: string | null;
  attendees: Attendee[];
}

export interface MeetingCreation {
  /**
   * Creates a `scheduled` meeting with its attendees and audit event in one transaction.
   * Idempotent per (owner, submission key): a repeat returns the first meeting with created=false.
   * Consent is never set here; it is a separate, explicit owner action.
   */
  create(
    ownerId: string,
    record: NewMeetingRecord,
    submissionKey: string,
  ): Promise<{ meetingId: string; created: boolean }>;
}
