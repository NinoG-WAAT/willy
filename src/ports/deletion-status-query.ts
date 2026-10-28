import type { DeletionJobView } from "../domain/settings/deletion-status";

/** One permanent-deletion job: state and counters only, never the meeting's title or content. */
export interface DeletionStatusRow extends DeletionJobView {
  meetingId: string;
  /** When the owner (or the retention sweeper) asked for the deletion. */
  requestedAt: string;
  updatedAt: string;
}

/** Owner-scoped read model behind the "Deletions" panel of the settings screen. */
export interface DeletionStatusQuery {
  /** The owner's most recent deletion jobs, newest activity first. */
  listForOwner(ownerId: string, limit: number): Promise<DeletionStatusRow[]>;
  /** Null for unknown ids and for other owners' meetings. */
  findForMeeting(ownerId: string, meetingId: string): Promise<DeletionStatusRow | null>;
}
