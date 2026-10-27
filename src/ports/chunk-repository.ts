export type ChunkState = "uploaded" | "transcribed" | "failed" | "purged";

export interface ChunkRow {
  id: string;
  meetingId: string;
  seq: number;
  state: ChunkState;
  byteSize: number;
  durationMs: number;
  contentType: string;
  sha256: string;
  keyId: string;
  /** Null once the raw audio has been purged. */
  objectKey: string | null;
  transcriptionAttempts: number;
  lastErrorCode: string | null;
}

export interface NewChunk {
  id: string;
  seq: number;
  byteSize: number;
  durationMs: number;
  contentType: string;
  sha256: string;
  keyId: string;
  objectKey: string;
  createdAt: string;
}

/** Metadata of uploaded audio chunks. Every method is scoped by the owner from the session. */
export interface ChunkRepository {
  find(ownerId: string, meetingId: string, seq: number): Promise<ChunkRow | null>;
  /**
   * Inserts an `uploaded` chunk. Unique on (meeting, seq): a second insert is a no-op and reports
   * `created: false`, so concurrent or repeated uploads never duplicate a row.
   */
  insertUploaded(
    ownerId: string,
    meetingId: string,
    chunk: NewChunk,
  ): Promise<{ created: boolean }>;
}
