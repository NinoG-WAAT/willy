import type { Meeting, TransitionOutcome } from "../domain/meetings/lifecycle";

export interface MeetingRepository {
  /** Scoped by owner: another owner's id is indistinguishable from an unknown id (null). */
  findById(ownerId: string, meetingId: string): Promise<Meeting | null>;

  /**
   * Stores a lifecycle outcome in ONE transaction: the meeting row (only if its status is still
   * `expected.status`), the audit events, and the effects (job rows, unique by job key).
   * Returns "conflict" and writes nothing when the row changed meanwhile or is not owned by
   * `ownerId`. Throws (after rolling everything back) if any part cannot be stored.
   */
  applyTransition(
    ownerId: string,
    expected: Meeting,
    outcome: TransitionOutcome,
  ): Promise<"applied" | "conflict">;

  /**
   * Replaces the content of a meeting that is `deleting` with a tombstone, in ONE transaction:
   * search rows and every dependent row (attendees, audio chunk rows, transcript segments, note
   * with sections, decisions and action items) are removed, the meeting row is scrubbed
   * (`deleted`, empty title, no agenda, rough notes or calendar link), and the audit events of the
   * outcome are appended. Audit history and job rows stay and hold no content. Returns "conflict"
   * and writes nothing when the meeting is no longer `deleting` for this owner.
   */
  erase(
    ownerId: string,
    meeting: Meeting,
    outcome: TransitionOutcome,
  ): Promise<"erased" | "conflict">;

  /**
   * Ids of the owner's meetings whose retention period (settings.note_retention_days) has passed
   * and that are at rest (review, published, archived or failed). Never in-progress or deleting.
   */
  listExpiredForRetention(ownerId: string, now: Date, limit: number): Promise<string[]>;
}
