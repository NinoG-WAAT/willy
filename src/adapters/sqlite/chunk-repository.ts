import type { DatabaseSync } from "node:sqlite";
import type {
  ChunkRepository,
  ChunkRow,
  ChunkState,
  NewChunk,
  NewSegment,
} from "../../ports/chunk-repository";

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

  listByMeeting(ownerId: string, meetingId: string): Promise<ChunkRow[]> {
    const rows = this.db
      .prepare("SELECT * FROM audio_chunk WHERE owner_id = ? AND meeting_id = ? ORDER BY seq")
      .all(ownerId, meetingId);
    return Promise.resolve(rows.map(toChunkRow));
  }

  recordTranscription(
    ownerId: string,
    meetingId: string,
    seq: number,
    segments: readonly NewSegment[],
    now: Date,
  ): Promise<{ inserted: number }> {
    const iso = now.toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let inserted = 0;
      for (const s of segments) {
        const result = this.db
          .prepare(
            `INSERT INTO transcript_segment (id, owner_id, meeting_id, chunk_seq, seg_index, start_ms,
                                             end_ms, speaker_label, speaker_label_original,
                                             text_ciphertext, text_key_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (meeting_id, chunk_seq, seg_index) DO NOTHING`,
          )
          .run(
            s.id,
            ownerId,
            meetingId,
            seq,
            s.segIndex,
            s.startMs,
            s.endMs,
            s.speaker,
            s.speaker,
            s.textCiphertext,
            s.textKeyId,
            iso,
            iso,
          );
        inserted += Number(result.changes);
      }
      this.db
        .prepare(
          `UPDATE audio_chunk
           SET state = 'transcribed', transcribed_at = ?, last_error_code = NULL,
               transcription_attempts = transcription_attempts + 1
           WHERE owner_id = ? AND meeting_id = ? AND seq = ? AND state IN ('uploaded', 'failed')`,
        )
        .run(iso, ownerId, meetingId, seq);
      this.db.exec("COMMIT");
      return Promise.resolve({ inserted });
    } catch (cause) {
      this.db.exec("ROLLBACK");
      return Promise.reject(cause instanceof Error ? cause : new Error("recording failed"));
    }
  }

  markFailed(ownerId: string, meetingId: string, seq: number, errorCode: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE audio_chunk
         SET state = 'failed', last_error_code = ?, transcription_attempts = transcription_attempts + 1
         WHERE owner_id = ? AND meeting_id = ? AND seq = ? AND state IN ('uploaded', 'failed')`,
      )
      .run(errorCode, ownerId, meetingId, seq);
    return Promise.resolve();
  }

  markPurged(ownerId: string, meetingId: string, seq: number, now: Date): Promise<void> {
    this.db
      .prepare(
        `UPDATE audio_chunk SET state = 'purged', object_key = NULL, purged_at = ?
         WHERE owner_id = ? AND meeting_id = ? AND seq = ? AND state = 'transcribed'`,
      )
      .run(now.toISOString(), ownerId, meetingId, seq);
    return Promise.resolve();
  }

  findExpiredTranscribed(ownerId: string, now: Date): Promise<ChunkRow[]> {
    const rows = this.db
      .prepare(
        `SELECT c.* FROM audio_chunk c
         LEFT JOIN settings s ON s.owner_id = c.owner_id
         WHERE c.owner_id = ? AND c.state = 'transcribed' AND c.object_key IS NOT NULL
           AND julianday(c.transcribed_at) + COALESCE(s.raw_audio_retention_hours, 0) / 24.0
               <= julianday(?)
         ORDER BY c.meeting_id, c.seq`,
      )
      .all(ownerId, now.toISOString());
    return Promise.resolve(rows.map(toChunkRow));
  }

  ownersWithRetainedAudio(): Promise<string[]> {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT owner_id FROM audio_chunk WHERE state = 'transcribed' AND object_key IS NOT NULL",
      )
      .all();
    return Promise.resolve(rows.map((r) => String(r["owner_id"])));
  }
}
