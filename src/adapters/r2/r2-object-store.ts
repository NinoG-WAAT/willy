import {
  providerError,
  providerErrorFromStatus,
  type ProviderError,
} from "../../domain/platform/provider-error";
import { err, ok, type Result } from "../../domain/platform/result";
import { isSafePrefix, isValidObjectKey } from "../../domain/storage/object-key";
import { MAX_STORED_OBJECT_BYTES } from "../../domain/transcription/audio";
import type { ObjectStore, StoredObject } from "../../ports/object-store";

/**
 * The slice of Cloudflare's `R2Bucket` binding this adapter uses, declared structurally so the
 * code does not depend on `@cloudflare/workers-types` and tests can stub it.
 */
export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string | undefined } | undefined;
  } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

export interface R2Config {
  bucket: R2BucketLike;
  /** Fixed timeout per binding call, covering body reads. */
  timeoutMs: number;
}

const LIST_PAGE = 1000;
const MAX_LIST_ROUNDS = 10_000;

/**
 * Private R2 storage. Objects are never given public URLs: reads go through the app after an
 * owner check (signed file tokens, short TTL). Binding errors are normalized and never echo keys.
 */
export function createR2ObjectStore(config: R2Config): ObjectStore {
  /** Runs one binding call with a timeout and maps every failure to a ProviderError. */
  async function call<T>(operation: () => Promise<T>): Promise<Result<T, ProviderError>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        resolve("timeout");
      }, config.timeoutMs);
    });
    try {
      const outcome = await Promise.race([operation(), timedOut]);
      if (outcome === "timeout") {
        return err(
          providerError("timeout", `object storage call exceeded ${String(config.timeoutMs)}ms`),
        );
      }
      return ok(outcome);
    } catch (cause) {
      const status = (cause as { status?: unknown } | null)?.status;
      return err(
        typeof status === "number"
          ? providerErrorFromStatus(status)
          : providerError("unavailable", "object storage failed"),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  const rejectedKey = (): ProviderError => providerError("rejected", "object key not allowed");

  return {
    async put(key, bytes, contentType) {
      if (bytes.byteLength > MAX_STORED_OBJECT_BYTES) {
        return err(providerError("rejected", "object too large"));
      }
      if (!isValidObjectKey(key)) return err(rejectedKey());
      const stored = await call(() =>
        config.bucket.put(key, bytes, { httpMetadata: { contentType } }),
      );
      return stored.ok ? ok(undefined) : stored;
    },

    async get(key): Promise<Result<StoredObject | null, ProviderError>> {
      if (!isValidObjectKey(key)) return err(rejectedKey());
      return call(async () => {
        const body = await config.bucket.get(key);
        if (!body) return null;
        return {
          bytes: new Uint8Array(await body.arrayBuffer()),
          contentType: body.httpMetadata?.contentType ?? "application/octet-stream",
        };
      });
    },

    async delete(key) {
      if (!isValidObjectKey(key)) return err(rejectedKey());
      const removed = await call(() => config.bucket.delete(key));
      return removed.ok ? ok(undefined) : removed;
    },

    async deleteByPrefix(prefix) {
      if (!isSafePrefix(prefix)) return err(providerError("rejected", "prefix not allowed"));
      let deleted = 0;
      // Delete each page and list again from the start: no cursor to invalidate, ends when empty.
      for (let round = 0; round < MAX_LIST_ROUNDS; round++) {
        const page = await call(() => config.bucket.list({ prefix, limit: LIST_PAGE }));
        if (!page.ok) return page;
        const keys = page.value.objects.map((o) => o.key);
        if (keys.length === 0) return ok({ deleted });
        const removed = await call(() => config.bucket.delete(keys));
        if (!removed.ok) return removed;
        deleted += keys.length;
      }
      return err(providerError("unavailable", "object storage prefix deletion did not finish"));
    },
  };
}
