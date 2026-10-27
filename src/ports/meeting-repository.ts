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
}
