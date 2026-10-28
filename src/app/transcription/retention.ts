import type { ChunkRepository } from "../../ports/chunk-repository";
import type { Clock } from "../../ports/clock";
import type { JobRepository } from "../../ports/job-repository";
import type { Logger } from "../../ports/logger";
import type { MeetingRepository } from "../../ports/meeting-repository";
import type { JobHandler } from "../jobs/runner";
import type { ChunkStore } from "../storage/chunk-store";
import { purgeChunkAudio } from "./purge";

export interface RetentionDeps {
  chunks: ChunkRepository;
  chunkStore: ChunkStore;
  clock: Clock;
  logger: Logger;
  /** Owner-level housekeeping beyond raw audio: note retention and stuck deletions. */
  housekeeping?: {
    meetings: MeetingRepository;
    /** Starts the normal two-step deletion for one expired meeting. */
    requestDeletion(ownerId: string, meetingId: string): Promise<void>;
    requeueFailedDeletions(ownerId: string, now: Date): Promise<number>;
  };
}

const SWEEP_BATCH = 50;

/**
 * The hourly per-owner sweeper:
 * 1. purges raw audio that outlived the retention window (0 hours by default, at most 7 days);
 * 2. if the owner set a note retention period (off by default), starts the normal deletion of
 *    meetings older than it, so files, indexes and rows go through the same retryable job;
 * 3. re-queues deletion jobs that exhausted their attempts, so a hidden meeting is always
 *    eventually erased.
 */
export function retentionJobHandler(deps: RetentionDeps): JobHandler {
  return {
    kind: "retention",
    async run(job, log) {
      const now = deps.clock.now();
      const expired = await deps.chunks.findExpiredTranscribed(job.ownerId, now);
      let failed = 0;
      for (const chunk of expired) {
        if (!(await purgeChunkAudio(deps, log, job.ownerId, chunk))) failed += 1;
      }

      let expiredMeetings = 0;
      let requeued = 0;
      if (deps.housekeeping) {
        const ids = await deps.housekeeping.meetings.listExpiredForRetention(
          job.ownerId,
          now,
          SWEEP_BATCH,
        );
        for (const id of ids) await deps.housekeeping.requestDeletion(job.ownerId, id);
        expiredMeetings = ids.length;
        requeued = await deps.housekeeping.requeueFailedDeletions(job.ownerId, now);
      }

      log.info("retention.finished", {
        expired: expired.length,
        failed,
        meetingsExpired: expiredMeetings,
        deletionsRequeued: requeued,
      });
      return failed === 0
        ? { kind: "succeeded" }
        : { kind: "retry", errorCode: "storage_unavailable" };
    },
  };
}

/**
 * Enqueues an hourly retention job for every owner that has work for it: raw audio kept after
 * transcription, plus whoever `extraOwners` names (note retention set, failed deletions).
 * Idempotent: the job key contains the owner and the hour.
 */
export async function scheduleRetentionJobs(deps: {
  chunks: ChunkRepository;
  jobs: JobRepository;
  clock: Clock;
  extraOwners?: () => Promise<string[]>;
}): Promise<void> {
  const now = deps.clock.now();
  const hour = now.toISOString().slice(0, 13);
  const owners = new Set(await deps.chunks.ownersWithRetainedAudio());
  for (const owner of (await deps.extraOwners?.()) ?? []) owners.add(owner);
  for (const ownerId of owners) {
    await deps.jobs.enqueue(
      { ownerId, meetingId: null, kind: "retention", jobKey: `retention:${ownerId}:${hour}` },
      now,
    );
  }
}
