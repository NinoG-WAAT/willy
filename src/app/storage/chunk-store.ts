import { sha256HexBytes } from "../../adapters/crypto/sha256";
import type { ProviderError } from "../../domain/platform/provider-error";
import { err, ok, type Result } from "../../domain/platform/result";
import { chunkObjectKey, meetingPrefix } from "../../domain/storage/object-key";
import {
  normalizeAudioContentType,
  validateChunk,
  type ChunkRejection,
} from "../../domain/transcription/audio";
import type { BytesCipher } from "../../ports/bytes-cipher";
import type { ObjectStore } from "../../ports/object-store";

export interface StoredChunk {
  objectKey: string;
  keyId: string;
  /** SHA-256 of the plaintext audio, for the audio_chunk row and replay detection. */
  sha256: string;
  byteSize: number;
  contentType: string;
  /** True when this exact chunk had already been stored (idempotent upload replay). */
  replay: boolean;
}

export type ChunkStoreError =
  | { kind: "rejected"; reason: ChunkRejection }
  | { kind: "conflict" }
  | { kind: "not_found" }
  | { kind: "corrupt" }
  | { kind: "provider"; error: ProviderError };

export interface ChunkStore {
  putChunk(
    ownerId: string,
    meetingId: string,
    chunk: { seq: number; audio: Uint8Array<ArrayBuffer>; contentType: string },
  ): Promise<Result<StoredChunk, ChunkStoreError>>;
  getChunk(
    ownerId: string,
    meetingId: string,
    seq: number,
  ): Promise<Result<{ audio: Uint8Array<ArrayBuffer>; contentType: string }, ChunkStoreError>>;
  deleteChunk(
    ownerId: string,
    meetingId: string,
    seq: number,
  ): Promise<Result<void, ChunkStoreError>>;
  /** Removes every object of the meeting (permanent deletion). Idempotent. */
  deleteMeeting(
    ownerId: string,
    meetingId: string,
  ): Promise<Result<{ deleted: number }, ChunkStoreError>>;
}

const provider = (error: ProviderError): ChunkStoreError => ({ kind: "provider", error });

/**
 * Encrypted, owner-scoped storage of audio chunks. Objects live under `owner/<ownerId>/...` and
 * are sealed with the object key as authenticated context, so another owner can neither find nor
 * decrypt them, and a copied or modified object reads back as `corrupt`. Uploads are bounded and
 * idempotent: the same bytes again succeed, different bytes for the same sequence conflict and
 * never overwrite. Ids that could escape the prefix throw (our own data, so that is a bug).
 */
export function createChunkStore(deps: { objects: ObjectStore; cipher: BytesCipher }): ChunkStore {
  const { objects, cipher } = deps;

  return {
    async putChunk(ownerId, meetingId, chunk) {
      const valid = validateChunk({
        byteSize: chunk.audio.byteLength,
        contentType: chunk.contentType,
        seq: chunk.seq,
      });
      if (!valid.ok) return err({ kind: "rejected", reason: valid.error.reason });
      const objectKey = chunkObjectKey(ownerId, meetingId, chunk.seq);
      const sha256 = await sha256HexBytes(chunk.audio);
      const summary = {
        objectKey,
        sha256,
        byteSize: chunk.audio.byteLength,
        contentType: valid.value.contentType,
      };

      const existing = await objects.get(objectKey);
      if (!existing.ok) return err(provider(existing.error));
      if (existing.value) {
        // Replay of the same chunk is success; anything we cannot verify is never overwritten.
        try {
          const plain = await cipher.open(existing.value.bytes, objectKey);
          if ((await sha256HexBytes(plain)) === sha256) {
            const keyId = cipher.keyIdOf(existing.value.bytes);
            if (keyId !== null) return ok({ ...summary, keyId, replay: true });
          }
        } catch {
          // Undecryptable existing object: treated as a conflict below.
        }
        return err({ kind: "conflict" });
      }

      const sealed = await cipher.seal(chunk.audio, objectKey);
      const stored = await objects.put(objectKey, sealed.bytes, valid.value.contentType);
      if (!stored.ok) return err(provider(stored.error));
      return ok({ ...summary, keyId: sealed.keyId, replay: false });
    },

    async getChunk(ownerId, meetingId, seq) {
      const objectKey = chunkObjectKey(ownerId, meetingId, seq);
      const found = await objects.get(objectKey);
      if (!found.ok) return err(provider(found.error));
      if (!found.value) return err({ kind: "not_found" });
      try {
        const audio = await cipher.open(found.value.bytes, objectKey);
        return ok({
          audio,
          contentType:
            normalizeAudioContentType(found.value.contentType) ?? "application/octet-stream",
        });
      } catch {
        return err({ kind: "corrupt" });
      }
    },

    async deleteChunk(ownerId, meetingId, seq) {
      const removed = await objects.delete(chunkObjectKey(ownerId, meetingId, seq));
      return removed.ok ? ok(undefined) : err(provider(removed.error));
    },

    async deleteMeeting(ownerId, meetingId) {
      const removed = await objects.deleteByPrefix(meetingPrefix(ownerId, meetingId));
      return removed.ok ? ok(removed.value) : err(provider(removed.error));
    },
  };
}
