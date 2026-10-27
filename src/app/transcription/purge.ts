import type { ChunkRepository, ChunkRow } from "../../ports/chunk-repository";
import type { Clock } from "../../ports/clock";
import type { Logger } from "../../ports/logger";
import type { ChunkStore } from "../storage/chunk-store";

export interface PurgeDeps {
  chunks: ChunkRepository;
  chunkStore: ChunkStore;
  clock: Clock;
}

/**
 * Deletes the raw audio of a chunk whose text is stored, then records that it is gone. The
 * object is deleted first (idempotent), so a crash in between only repeats the delete. A storage
 * failure leaves the chunk `transcribed` with its audio; the retention job tries again. The
 * database refuses to purge a chunk that is not `transcribed`.
 */
export async function purgeChunkAudio(
  deps: PurgeDeps,
  log: Logger,
  ownerId: string,
  chunk: Pick<ChunkRow, "meetingId" | "seq" | "objectKey">,
): Promise<boolean> {
  if (chunk.objectKey === null) return true;
  const removed = await deps.chunkStore.deleteChunk(ownerId, chunk.meetingId, chunk.seq);
  if (!removed.ok) {
    log.warn("audio.purge_failed", { meetingId: chunk.meetingId, chunkSeq: chunk.seq });
    return false;
  }
  await deps.chunks.markPurged(ownerId, chunk.meetingId, chunk.seq, deps.clock.now());
  return true;
}
