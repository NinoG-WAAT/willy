import { sha256HexBytes } from "../../adapters/crypto/sha256";
import { canViewMeeting } from "../../domain/authz/predicates";
import type { MeetingStatus } from "../../domain/meetings/lifecycle";
import { err, ok, type Result } from "../../domain/platform/result";
import type { RateLimitPolicy } from "../../domain/platform/rate-limit";
import { validateChunk, type ChunkRejection } from "../../domain/transcription/audio";
import type { ChunkRepository } from "../../ports/chunk-repository";
import type { Clock } from "../../ports/clock";
import type { IdGenerator } from "../../ports/id-generator";
import type { MeetingRepository } from "../../ports/meeting-repository";
import type { RateLimiter } from "../../ports/rate-limiter";
import type { ChunkStore } from "../storage/chunk-store";

export interface UploadDeps {
  meetings: MeetingRepository;
  chunks: ChunkRepository;
  chunkStore: ChunkStore;
  ids: IdGenerator;
  limiter: RateLimiter;
  clock: Clock;
}

export interface ChunkUpload {
  seq: number;
  audio: Uint8Array<ArrayBuffer>;
  contentType: string;
  durationMs: number;
}

export type UploadChunkError =
  | { kind: "not_found" }
  | { kind: "invalid_state"; status: MeetingStatus }
  | { kind: "rejected"; reason: ChunkRejection | "bad_duration" }
  | { kind: "conflict" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "unavailable" };

/** Chunks arrive every ~10 seconds, so this is generous for a real capture and tight for abuse. */
export const UPLOAD_LIMIT: RateLimitPolicy = { limit: 120, windowMs: 60_000 };

const CAPTURE_STATES: readonly MeetingStatus[] = ["capturing", "paused"];
const MAX_DURATION_MS = 60_000;

/**
 * Stores one audio chunk for one of the Owner's meetings. Only `capturing` or `paused` meetings
 * accept audio; bounds are enforced before anything is written (reject, never truncate); the
 * chunk is encrypted before it reaches storage; and the upload is idempotent by (meeting, seq):
 * a retry with the same bytes succeeds, different bytes conflict, and a chunk that was already
 * transcribed and purged is never resurrected.
 */
export async function uploadChunk(
  deps: UploadDeps,
  ownerId: string,
  meetingId: string,
  chunk: ChunkUpload,
): Promise<Result<{ seq: number; replay: boolean }, UploadChunkError>> {
  const limit = await deps.limiter.consume(`chunk:owner:${ownerId}`, UPLOAD_LIMIT);
  if (!limit.allowed)
    return err({ kind: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds });

  const meeting = await deps.meetings.findById(ownerId, meetingId);
  if (!meeting || !canViewMeeting(ownerId, meeting)) return err({ kind: "not_found" });
  if (!CAPTURE_STATES.includes(meeting.status)) {
    return err({ kind: "invalid_state", status: meeting.status });
  }

  const valid = validateChunk({
    byteSize: chunk.audio.byteLength,
    contentType: chunk.contentType,
    seq: chunk.seq,
  });
  if (!valid.ok) return err({ kind: "rejected", reason: valid.error.reason });
  if (
    !Number.isInteger(chunk.durationMs) ||
    chunk.durationMs < 1 ||
    chunk.durationMs > MAX_DURATION_MS
  ) {
    return err({ kind: "rejected", reason: "bad_duration" });
  }

  const sha256 = await sha256HexBytes(chunk.audio);
  const existing = await deps.chunks.find(ownerId, meetingId, chunk.seq);
  if (existing) {
    return existing.sha256 === sha256
      ? ok({ seq: chunk.seq, replay: true })
      : err({ kind: "conflict" });
  }

  const stored = await deps.chunkStore.putChunk(ownerId, meetingId, chunk);
  if (!stored.ok) {
    switch (stored.error.kind) {
      case "rejected":
        return err({ kind: "rejected", reason: stored.error.reason });
      case "conflict":
      case "corrupt":
        return err({ kind: "conflict" });
      case "not_found":
      case "provider":
        return err({ kind: "unavailable" });
    }
  }

  const inserted = await deps.chunks.insertUploaded(ownerId, meetingId, {
    id: deps.ids.newId(),
    seq: chunk.seq,
    byteSize: stored.value.byteSize,
    durationMs: chunk.durationMs,
    contentType: stored.value.contentType,
    sha256: stored.value.sha256,
    keyId: stored.value.keyId,
    objectKey: stored.value.objectKey,
    createdAt: deps.clock.now().toISOString(),
  });
  if (inserted.created) return ok({ seq: chunk.seq, replay: false });

  // Lost a race with an identical concurrent upload: same bytes are a replay, anything else conflicts.
  const winner = await deps.chunks.find(ownerId, meetingId, chunk.seq);
  return winner?.sha256 === sha256
    ? ok({ seq: chunk.seq, replay: true })
    : err({ kind: "conflict" });
}
