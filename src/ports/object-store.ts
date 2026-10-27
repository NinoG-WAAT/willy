import type { ProviderError } from "../domain/platform/provider-error";
import type { Result } from "../domain/platform/result";

export interface StoredObject {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

/**
 * Private byte storage (R2 in production, the local filesystem in development and tests).
 * Keys must satisfy `isValidObjectKey` (always under `owner/<ownerId>/`); anything else is a
 * non-retryable `rejected` error and never touches storage. All operations are idempotent.
 * Callers store ciphertext: this layer knows nothing about encryption or owners.
 */
export interface ObjectStore {
  /** Overwrites. */
  put(
    key: string,
    bytes: Uint8Array<ArrayBuffer>,
    contentType: string,
  ): Promise<Result<void, ProviderError>>;
  /** A missing object is `ok(null)`, not an error. */
  get(key: string): Promise<Result<StoredObject | null, ProviderError>>;
  /** Deleting a missing object succeeds. */
  delete(key: string): Promise<Result<void, ProviderError>>;
  /** Prefix must pass `isSafePrefix`. Returns how many objects were removed (0 on replay). */
  deleteByPrefix(prefix: string): Promise<Result<{ deleted: number }, ProviderError>>;
}
