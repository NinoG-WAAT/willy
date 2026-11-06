import { canViewMeeting } from "../../domain/authz/predicates";
import { chunkStartOffsets, shiftToMeetingTime } from "../../domain/transcription/chunk-offsets";
import { currentLocale } from "../../i18n/translate";
import { correctWithVocabulary } from "../../domain/transcription/vocabulary-correction";
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
import type { VocabularyRepository } from "../../ports/vocabulary-repository";
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
  vocabulary: VocabularyRepository;
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

  const allChunks = await deps.chunks.listByMeeting(ownerId, meetingId);
  // Built from every chunk row, whatever its state, so a retried chunk lands where it belongs.
  const offsets = chunkStartOffsets(allChunks);
  const needsTranscription = allChunks.some(
    (c) => c.state !== "purged" && c.state !== "transcribed",
  );
  const vocabulary = needsTranscription ? await loadVocabulary(deps, log, ownerId) : [];

  for (const chunk of allChunks) {
    if (chunk.state === "purged") continue;
    if (chunk.state === "transcribed") {
      // A previous run finished the text but may have stopped before deleting the audio.
      if (retentionHours === 0) await purgeChunkAudio(deps, log, ownerId, chunk);
      continue;
    }
    const failure = await transcribeChunk(
      deps,
      log,
      ownerId,
      meetingId,
      chunk,
      offsets.get(chunk.seq) ?? 0,
      vocabulary,
    );
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
    log.info("job.transcribed", {
      chunksTranscribed: transcribed,
      vocabularyTerms: vocabulary.length,
    });
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

/**
 * The owner's vocabulary, read once per run. It only helps recognition, so a failure to read it
 * must never fail the transcription: carry on without. Terms can be sensitive project names, so
 * neither they nor the error text (which could quote them) are logged: counts only.
 */
async function loadVocabulary(
  deps: TranscribeDeps,
  log: Logger,
  ownerId: string,
): Promise<string[]> {
  try {
    return (await deps.vocabulary.list(ownerId)).map((t) => t.term);
  } catch {
    log.warn("job.vocabulary_unavailable", { vocabularyTerms: 0 });
    return [];
  }
}

/** Returns null on success, or what went wrong. */
async function transcribeChunk(
  deps: TranscribeDeps,
  log: Logger,
  ownerId: string,
  meetingId: string,
  chunk: ChunkRow,
  offsetMs: number,
  vocabulary: readonly string[],
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
    vocabulary,
    language: currentLocale(),
  });
  if (!result.ok) {
    return { seq: chunk.seq, code: `stt_${result.error.kind}`, retryable: result.error.retryable };
  }

  const segments = [];
  // Transcribers report times relative to the chunk's own audio; stored times are meeting-relative.
  for (const [segIndex, s] of shiftToMeetingTime(result.value, offsetMs).entries()) {
    const id = deps.ids.newId();
    // The transcriber hears the words but spells them its own way ("Salsa", "site tracker"): the
    // owner's spelling is what gets stored, so search, notes and the summary all use it.
    const text = correctWithVocabulary(s.text, vocabulary);
    const sealed = await deps.textCipher.encrypt(text, segmentTextContext(id));
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
