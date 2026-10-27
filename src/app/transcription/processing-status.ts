import { canViewMeeting } from "../../domain/authz/predicates";
import type { MeetingStatus } from "../../domain/meetings/lifecycle";
import { err, ok, type Result } from "../../domain/platform/result";
import type { ChunkRepository } from "../../ports/chunk-repository";
import type { JobRepository, JobRow, JobStatus } from "../../ports/job-repository";
import type { MeetingRepository } from "../../ports/meeting-repository";

export interface StatusDeps {
  meetings: MeetingRepository;
  chunks: ChunkRepository;
  jobs: JobRepository;
}

export interface JobStatusView {
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string | null;
  lastErrorCode: string | null;
}

export interface ProcessingStatus {
  meetingStatus: MeetingStatus;
  /** Transcription. */
  job: JobStatusView | null;
  /** The first summary of the meeting. */
  summary: JobStatusView | null;
  /** The most recent "regenerate this section" request. */
  regeneration: (JobStatusView & { sectionId: string }) | null;
  chunks: { total: number; uploaded: number; transcribed: number; failed: number; purged: number };
}

const view = (job: JobRow): JobStatusView => ({
  status: job.status,
  attempts: job.attempts,
  maxAttempts: job.maxAttempts,
  nextRunAt: job.nextRunAt,
  lastErrorCode: job.lastErrorCode,
});

/**
 * What the live note and review screens poll: meeting status, the transcription and summary
 * jobs' states (pending, running, retrying, succeeded, failed with attempts and next retry), the
 * latest section regeneration and chunk counts. Owner-scoped; unknown ids, other owners'
 * meetings and meetings being deleted are `not_found`. Carries codes and counts only, never
 * transcript, note or audio content.
 */
export async function getProcessingStatus(
  deps: StatusDeps,
  ownerId: string,
  meetingId: string,
): Promise<Result<ProcessingStatus, { kind: "not_found" }>> {
  const meeting = await deps.meetings.findById(ownerId, meetingId);
  if (!meeting || !canViewMeeting(ownerId, meeting)) return err({ kind: "not_found" });

  const jobs = await deps.jobs.listForMeeting(ownerId, meetingId);
  const transcription = jobs.find((j) => j.jobKey === `transcribe:${meetingId}`);
  const summary = jobs.find((j) => j.jobKey === `summarize:${meetingId}:1`);
  const regeneration = jobs
    .filter((j) => typeof j.payload["sectionId"] === "string")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .pop();
  const chunks = await deps.chunks.listByMeeting(ownerId, meetingId);
  const count = (state: string): number => chunks.filter((c) => c.state === state).length;
  return ok({
    meetingStatus: meeting.status,
    job: transcription ? view(transcription) : null,
    summary: summary ? view(summary) : null,
    regeneration: regeneration
      ? { sectionId: String(regeneration.payload["sectionId"]), ...view(regeneration) }
      : null,
    chunks: {
      total: chunks.length,
      uploaded: count("uploaded"),
      transcribed: count("transcribed"),
      failed: count("failed"),
      purged: count("purged"),
    },
  });
}
