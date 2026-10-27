import type { ChunkRepository } from "../../ports/chunk-repository";
import type { Clock } from "../../ports/clock";
import type { JobRepository } from "../../ports/job-repository";
import type { Logger } from "../../ports/logger";
import type { JobHandler } from "../jobs/runner";
import type { ChunkStore } from "../storage/chunk-store";
import { purgeChunkAudio } from "./purge";

export interface RetentionDeps {
  chunks: ChunkRepository;
  chunkStore: ChunkStore;
  clock: Clock;
  logger: Logger;
}

/**
 * Purges one owner's raw audio that outlived its retention window (0 hours by default, at most
 * 7 days by the settings constraint). Only transcribed chunks are ever purged here.
 */
export function retentionJobHandler(deps: RetentionDeps): JobHandler {
  return {
    kind: "retention",
    async run(job, log) {
      const expired = await deps.chunks.findExpiredTranscribed(job.ownerId, deps.clock.now());
      let failed = 0;
      for (const chunk of expired) {
        if (!(await purgeChunkAudio(deps, log, job.ownerId, chunk))) failed += 1;
      }
      log.info("retention.finished", { expired: expired.length, failed });
      return failed === 0
        ? { kind: "succeeded" }
        : { kind: "retry", errorCode: "storage_unavailable" };
    },
  };
}

/**
 * Enqueues an hourly retention job for every owner that still holds raw audio after
 * transcription. Idempotent: the job key contains the owner and the hour.
 */
export async function scheduleRetentionJobs(deps: {
  chunks: ChunkRepository;
  jobs: JobRepository;
  clock: Clock;
}): Promise<void> {
  const now = deps.clock.now();
  const hour = now.toISOString().slice(0, 13);
  for (const ownerId of await deps.chunks.ownersWithRetainedAudio()) {
    await deps.jobs.enqueue(
      { ownerId, meetingId: null, kind: "retention", jobKey: `retention:${ownerId}:${hour}` },
      now,
    );
  }
}
