import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  providerError,
  type ProviderError,
  type ProviderErrorKind,
} from "../../domain/platform/provider-error";
import { err, ok, type Result } from "../../domain/platform/result";
import { isSafePrefix, isValidObjectKey } from "../../domain/storage/object-key";
import { MAX_STORED_OBJECT_BYTES } from "../../domain/transcription/audio";
import type { ObjectStore, StoredObject } from "../../ports/object-store";

export interface LocalObjectStore extends ObjectStore {
  script: {
    /** The next operation fails the way the real backend would for `kind`. */
    failOnce(kind: ProviderErrorKind): void;
  };
}

const META_SUFFIX = ".__meta";
const NOT_FOUND = "ENOENT";

const isNotFound = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === NOT_FOUND;

/**
 * Local-disk ObjectStore for development, tests and single-server deployments. Same contract as
 * the R2 adapter: validated keys only (never outside `rootDir`), idempotent deletes, safe-prefix
 * bulk delete, normalized errors without paths. Writes are atomic (temp file + rename).
 */
export function createLocalObjectStore(rootDir: string): LocalObjectStore {
  const failures: ProviderErrorKind[] = [];
  const pathFor = (key: string): string => join(rootDir, ...key.split("/"));
  const unavailable = (): ProviderError =>
    providerError("unavailable", "local object storage failed");
  const rejectedKey = (): ProviderError => providerError("rejected", "object key not allowed");

  /** Consumes a scripted failure, if any. */
  const scripted = (): ProviderError | null => {
    const kind = failures.shift();
    return kind === undefined ? null : providerError(kind, `local object storage ${kind}`);
  };

  return {
    script: {
      failOnce: (kind) => {
        failures.push(kind);
      },
    },

    async put(key, bytes, contentType): Promise<Result<void, ProviderError>> {
      if (!isValidObjectKey(key) || bytes.byteLength > MAX_STORED_OBJECT_BYTES) {
        return err(
          bytes.byteLength > MAX_STORED_OBJECT_BYTES
            ? providerError("rejected", "object too large")
            : rejectedKey(),
        );
      }
      const failure = scripted();
      if (failure) return err(failure);
      try {
        const target = pathFor(key);
        await mkdir(dirname(target), { recursive: true });
        const temp = `${target}.tmp-${randomUUID()}`;
        await writeFile(temp, bytes);
        await rename(temp, target);
        await writeFile(target + META_SUFFIX, JSON.stringify({ contentType }));
        return ok(undefined);
      } catch {
        return err(unavailable());
      }
    },

    async get(key): Promise<Result<StoredObject | null, ProviderError>> {
      if (!isValidObjectKey(key)) return err(rejectedKey());
      const failure = scripted();
      if (failure) return err(failure);
      try {
        const target = pathFor(key);
        const bytes = new Uint8Array(await readFile(target));
        let contentType = "application/octet-stream";
        try {
          const meta: unknown = JSON.parse(await readFile(target + META_SUFFIX, "utf8"));
          const stored = (meta as { contentType?: unknown }).contentType;
          if (typeof stored === "string") contentType = stored;
        } catch {
          // Missing or unreadable metadata only costs the content type.
        }
        return ok({ bytes, contentType });
      } catch (cause) {
        return isNotFound(cause) ? ok(null) : err(unavailable());
      }
    },

    async delete(key): Promise<Result<void, ProviderError>> {
      if (!isValidObjectKey(key)) return err(rejectedKey());
      const failure = scripted();
      if (failure) return err(failure);
      try {
        const target = pathFor(key);
        await rm(target, { force: true });
        await rm(target + META_SUFFIX, { force: true });
        return ok(undefined);
      } catch {
        return err(unavailable());
      }
    },

    async deleteByPrefix(prefix): Promise<Result<{ deleted: number }, ProviderError>> {
      if (!isSafePrefix(prefix)) return err(providerError("rejected", "prefix not allowed"));
      const failure = scripted();
      if (failure) return err(failure);
      try {
        const directory = pathFor(prefix.slice(0, -1));
        const deleted = await countObjects(directory);
        await rm(directory, { recursive: true, force: true });
        return ok({ deleted });
      } catch {
        return err(unavailable());
      }
    },
  };
}

/** Number of stored objects (not metadata files) below a directory; 0 if it does not exist. */
async function countObjects(directory: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (cause) {
    if (isNotFound(cause)) return 0;
    throw cause;
  }
  let count = 0;
  for (const name of entries) {
    const full = join(directory, name);
    if ((await stat(full)).isDirectory()) count += await countObjects(full);
    else if (!name.endsWith(META_SUFFIX) && !name.includes(".tmp-")) count += 1;
  }
  return count;
}
