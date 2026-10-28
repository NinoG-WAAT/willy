import { completeDeletion } from "../../domain/meetings/lifecycle";
import type { Clock } from "../../ports/clock";
import type { Logger } from "../../ports/logger";
import type { MeetingRepository } from "../../ports/meeting-repository";
import type { JobHandler, JobOutcome } from "../jobs/runner";
import type { ChunkStore } from "../storage/chunk-store";

export interface DeleteDeps {
  meetings: MeetingRepository;
  chunkStore: ChunkStore;
  clock: Clock;
  logger: Logger;
}

export function deleteJobHandler(deps: DeleteDeps): JobHandler {
  return {
    kind: "delete",
    async run(job, log): Promise<JobOutcome> {
      const { ownerId, meetingId } = job;
      if (meetingId === null) return { kind: "succeeded" };
      const meeting = await deps.meetings.findById(ownerId, meetingId);
      if (!meeting) return { kind: "succeeded" };
      // Only a meeting that was really marked `deleting` is ever erased; a stray job does nothing.
      if (meeting.status !== "deleting" && meeting.status !== "deleted") {
        log.warn("job.skipped", { reason: "meeting_not_deleting" });
        return { kind: "succeeded" };
      }

      // Files first (idempotent), then derived indexes and rows in one transaction: a crash or a
      // storage failure in between only repeats work, and the meeting stays hidden throughout.
      const removed = await deps.chunkStore.deleteMeeting(ownerId, meetingId);
      if (!removed.ok) {
        const error = removed.error.kind === "provider" ? removed.error.error : null;
        return {
          kind: error && !error.retryable ? "failed" : "retry",
          errorCode: `storage_${error?.kind ?? "unavailable"}`,
        };
      }
      if (meeting.status === "deleted") return { kind: "succeeded" };

      const completed = completeDeletion(meeting, deps.clock.now());
      if (!completed.ok) return { kind: "succeeded" };
      if ((await deps.meetings.erase(ownerId, meeting, completed.value)) === "conflict") {
        return { kind: "retry", errorCode: "conflict" };
      }
      log.info("deletion.completed", { objectsDeleted: removed.value.deleted });
      return { kind: "succeeded" };
    },
  };
}
