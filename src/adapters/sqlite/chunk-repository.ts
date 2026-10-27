import type { DatabaseSync } from "node:sqlite";
import type { ChunkRepository, ChunkRow, ChunkState, NewChunk } from "../../ports/chunk-repository";

export function toChunkRow(r: Record<string, unknown>): ChunkRow {
  const objectKey = r["object_key"];
  const lastError = r["last_error_code"];
  return {
    id: String(r["id"]),
    meetingId: String(r["meeting_id"]),
    seq: Number(r["seq"]),
    state: String(r["state"]) as ChunkState,
    byteSize: Number(r["byte_size"]),
    durationMs: Number(r["duration_ms"]),
    contentType: String(r["content_type"]),
    sha256: String(r["sha256"]),
    keyId: String(r["key_id"]),
    objectKey: typeof objectKey === "string" ? objectKey : null,
    transcriptionAttempts: Number(r["transcription_attempts"]),
    lastErrorCode: typeof lastError === "string" ? lastError : null,
  };
}

export class SqliteChunkRepository implements ChunkRepository {
  constructor(private readonly db: DatabaseSync) {}

  find(ownerId: string, meetingId: string, seq: number): Promise<ChunkRow | null> {
    const row = this.db
      .prepare("SELECT * FROM audio_chunk WHERE owner_id = ? AND meeting_id = ? AND seq = ?")
      .get(ownerId, meetingId, seq);
    return Promise.resolve(row ? toChunkRow(row) : null);
  }

  insertUploaded(ownerId: string, meetingId: string, c: NewChunk): Promise<{ created: boolean }> {
    const result = this.db
      .prepare(
        `INSERT INTO audio_chunk (id, owner_id, meeting_id, seq, state, byte_size, duration_ms,
                                  content_type, sha256, key_id, object_key, created_at)
         VALUES (?, ?, ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (meeting_id, seq) DO NOTHING`,
      )
      .run(
        c.id,
        ownerId,
        meetingId,
        c.seq,
        c.byteSize,
        c.durationMs,
        c.contentType,
        c.sha256,
        c.keyId,
        c.objectKey,
        c.createdAt,
      );
    return Promise.resolve({ created: result.changes === 1 });
  }
}
