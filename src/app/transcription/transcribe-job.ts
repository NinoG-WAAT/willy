import { canViewMeeting } from "../../domain/authz/predicates";
import { segmentTextContext } from "../../domain/transcription/encryption-context";
import type { ChunkRepository, ChunkRow } from "../../ports/chunk-repository";
import type { Clock } from "../../ports/clock";
import type { IdGenerator } from "../../ports/id-generator";
import type { JobRepository, JobRow } from "../../ports/job-repository";
import type { Logger } from "../../ports/logger";
import type { MeetingRepository } from "../../ports/meeting-repository";
import type { SettingsRepository } from "../../ports/settings-repository";
import type { TextCipher } from "../../ports/text-cipher";
import type { Transcriber } from "../../ports/transcriber";
import type { JobHandler, JobOutcome } from "../jobs/runner";
import { failMeetingProcessing } from "../meetings/fail-processing";
import type { ChunkStore } from "../storage/chunk-store";
import { purgeChunkAudio } from "./purge";

export interface TranscribeDeps {
  meetings: MeetingRepository;
  chunks: ChunkRepository;
  chunkStore: ChunkStore;
  transcriber: Transcriber;
  textCipher: TextCipher;
  settings: SettingsRepository;
  jobs: JobRepository;
  ids: IdGenerator;
  clock: Clock;
  logger: Logger;
}

interface ChunkFailure {
  seq: number;
  code: string;
  retryable: boolean;
}

/** The summary job (#12) is keyed by meeting and note revision. */
export const summaryJobKey = (meetingId: string): string => `summarize:${meetingId}:1`;

export function transcribeJobHandler(deps: TranscribeDeps): JobHandler {
  return { kind: "transcribe", run: (job, log) => runTranscription(deps, job, log) };
}

/**
 * Transcribes every chunk that still needs it, independently, so one bad chunk never blocks the
 * rest. Safe to replay: finished chunks are skipped, segments are unique per (meeting, chunk,
 * index), and raw audio is deleted only for chunks that were transcribed successfully (or kept
 * for the owner's retention window). Rough notes live on the meeting row and are never touched.
 */
async function runTranscription(
  deps: TranscribeDeps,
  job: JobRow,
  log: Logger,
): Promise<JobOutcome> {
  const { ownerId, meetingId } = job;
  const meeting = meetingId === null ? null : await deps.meetings.findById(ownerId, meetingId);
  if (
    meetingId === null ||
    !meeting ||
    !canViewMeeting(ownerId, meeting) ||
    meeting.status !== "processing"
  ) {
    log.info("job.skipped", { reason: "meeting_not_processing" });
    return { kind: "succeeded" };
  }

  const retentionHours = await deps.settings.rawAudioRetentionHours(ownerId);
  const failures: ChunkFailure[] = [];
  let transcribed = 0;

  for (const chunk of await deps.chunks.listByMeeting(ownerId, meetingId)) {
    if (chunk.state === "purged") continue;
    if (chunk.state === "transcribed") {
      // A previous run finished the text but may have stopped before deleting the audio.
      if (retentionHours === 0) await purgeChunkAudio(deps, log, ownerId, chunk);
      continue;
    }
    const failure = await transcribeChunk(deps, log, ownerId, meetingId, chunk);
    if (failure) {
      failures.push(failure);
      await deps.chunks.markFailed(ownerId, meetingId, chunk.seq, failure.code);
      log.warn("job.chunk_failed", {
        chunkSeq: chunk.seq,
        errorCode: failure.code,
        retryable: failure.retryable,
      });
      continue;
    }
    transcribed += 1;
    if (retentionHours === 0) await purgeChunkAudio(deps, log, ownerId, chunk);
  }

  if (failures.length === 0) {
    await deps.jobs.enqueue(
      {
        ownerId,
        meetingId,
        kind: "summarize",
        jobKey: summaryJobKey(meetingId),
        // After a failed summary and the owner's retry, transcription completes again: re-queue it.
        requeueIfFailed: true,
      },
      deps.clock.now(),
    );
    log.info("job.transcribed", { chunksTranscribed: transcribed });
    return { kind: "succeeded" };
  }

  const code = failures[failures.length - 1]?.code ?? "stt_unavailable";
  const permanent = failures.some((f) => !f.retryable);
  log.warn("job.partial_failure", {
    chunksTranscribed: transcribed,
    chunksFailed: failures.length,
    permanent,
  });
  if (permanent || job.attempts >= job.maxAttempts) {
    await failMeetingProcessing(deps, log, meeting);
    return { kind: "failed", errorCode: code };
  }
  return { kind: "retry", errorCode: code };
}

/** Returns null on success, or what went wrong. */
async function transcribeChunk(
  deps: TranscribeDeps,
  log: Logger,
  ownerId: string,
  meetingId: string,
  chunk: ChunkRow,
): Promise<ChunkFailure | null> {
  const stored = await deps.chunkStore.getChunk(ownerId, meetingId, chunk.seq);
  if (!stored.ok) {
    switch (stored.error.kind) {
      case "not_found":
        return { seq: chunk.seq, code: "audio_missing", retryable: false };
      case "corrupt":
        return { seq: chunk.seq, code: "audio_corrupt", retryable: false };
      case "provider":
        return {
          seq: chunk.seq,
          code: `storage_${stored.error.error.kind}`,
          retryable: stored.error.error.retryable,
        };
      case "rejected":
      case "conflict":
        return { seq: chunk.seq, code: "audio_unreadable", retryable: false };
    }
  }

  const result = await deps.transcriber.transcribe({
    chunkId: `${meetingId}:${String(chunk.seq)}`,
    audio: stored.value.audio,
    contentType: stored.value.contentType,
  });
  if (!result.ok) {
    return { seq: chunk.seq, code: `stt_${result.error.kind}`, retryable: result.error.retryable };
  }

  const segments = [];
  for (const [segIndex, s] of result.value.entries()) {
    const id = deps.ids.newId();
    const sealed = await deps.textCipher.encrypt(s.text, segmentTextContext(id));
    segments.push({
      id,
      segIndex,
      startMs: s.startMs,
      endMs: s.endMs,
      speaker: s.speaker,
      textCiphertext: sealed.ciphertext,
      textKeyId: sealed.keyId,
    });
  }
  const recorded = await deps.chunks.recordTranscription(
    ownerId,
    meetingId,
    chunk.seq,
    segments,
    deps.clock.now(),
  );
  log.info("job.chunk_transcribed", {
    chunkSeq: chunk.seq,
    segments: segments.length,
    newSegments: recorded.inserted,
  });
  return null;
}
