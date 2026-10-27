import { canViewMeeting } from "../../domain/authz/predicates";
import type { MeetingStatus } from "../../domain/meetings/lifecycle";
import { err, ok, type Result } from "../../domain/platform/result";
import type { ChunkRepository } from "../../ports/chunk-repository";
import type { JobRepository, JobStatus } from "../../ports/job-repository";
import type { MeetingRepository } from "../../ports/meeting-repository";

export interface StatusDeps {
  meetings: MeetingRepository;
  chunks: ChunkRepository;
  jobs: JobRepository;
}

export interface ProcessingStatus {
  meetingStatus: MeetingStatus;
  job: {
    status: JobStatus;
    attempts: number;
    maxAttempts: number;
    nextRunAt: string | null;
    lastErrorCode: string | null;
  } | null;
  chunks: { total: number; uploaded: number; transcribed: number; failed: number; purged: number };
}

/**
 * What the live note and review screens poll: meeting status, the transcription job's state
 * (pending, running, retrying, succeeded, failed with attempts and next retry) and chunk counts.
 * Owner-scoped; unknown ids, other owners' meetings and meetings being deleted are `not_found`.
 * Carries codes and counts only, never transcript or audio content.
 */
export async function getProcessingStatus(
  deps: StatusDeps,
  ownerId: string,
  meetingId: string,
): Promise<Result<ProcessingStatus, { kind: "not_found" }>> {
  const meeting = await deps.meetings.findById(ownerId, meetingId);
  if (!meeting || !canViewMeeting(ownerId, meeting)) return err({ kind: "not_found" });

  const job = await deps.jobs.findForMeeting(ownerId, meetingId, "transcribe");
  const chunks = await deps.chunks.listByMeeting(ownerId, meetingId);
  const count = (state: string): number => chunks.filter((c) => c.state === state).length;
  return ok({
    meetingStatus: meeting.status,
    job: job && {
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      nextRunAt: job.nextRunAt,
      lastErrorCode: job.lastErrorCode,
    },
    chunks: {
      total: chunks.length,
      uploaded: count("uploaded"),
      transcribed: count("transcribed"),
      failed: count("failed"),
      purged: count("purged"),
    },
  });
}
