import { describe, expect, it } from "vitest";
import { createR2ObjectStore, type R2BucketLike } from "../../../src/adapters/r2/r2-object-store";
import type { ProviderErrorKind } from "../../../src/domain/platform/provider-error";
import { objectStoreContract } from "./object-store.contract";

/** In-memory stand-in for an R2 bucket binding: pages of 10 keys, scriptable failures. */
function createStubBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string | undefined }>();
  let failure: ProviderErrorKind | null = null;
  const calls: string[] = [];

  const maybeFail = async (): Promise<void> => {
    if (failure === null) return;
    const kind = failure;
    failure = null;
    if (kind === "timeout") return new Promise<void>(() => undefined); // never settles
    const status = { rate_limited: 429, unavailable: 503, rejected: 403 }[kind];
    throw Object.assign(new Error("R2 failed"), { status });
  };

  const bucket: R2BucketLike = {
    async put(key, value, options) {
      calls.push(`put ${key}`);
      await maybeFail();
      const copy = new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value));
      objects.set(key, { bytes: copy, contentType: options?.httpMetadata?.contentType });
      return Promise.resolve({});
    },
    async get(key) {
      calls.push(`get ${key}`);
      await maybeFail();
      const found = objects.get(key);
      if (!found) return null;
      return {
        arrayBuffer: () => Promise.resolve(found.bytes.slice().buffer),
        httpMetadata: { contentType: found.contentType },
      };
    },
    async delete(keys) {
      calls.push(`delete ${Array.isArray(keys) ? keys.join(",") : keys}`);
      await maybeFail();
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    async list(options) {
      calls.push(`list ${options.prefix ?? ""}`);
      await maybeFail();
      const all = [...objects.keys()].filter((k) => k.startsWith(options.prefix ?? "")).sort();
      const start = options.cursor ? Number(options.cursor) : 0;
      const page = all.slice(start, start + 10);
      const next = start + 10;
      return next < all.length
        ? { objects: page.map((key) => ({ key })), truncated: true, cursor: String(next) }
        : { objects: page.map((key) => ({ key })), truncated: false };
    },
  };
  return {
    bucket,
    calls,
    objects,
    failNext: (kind: ProviderErrorKind) => {
      failure = kind;
    },
  };
}

objectStoreContract("R2 adapter against a stub bucket", () => {
  const stub = createStubBucket();
  return {
    store: createR2ObjectStore({ bucket: stub.bucket, timeoutMs: 30 }),
    failNext: stub.failNext,
  };
});

describe("R2 adapter specifics", () => {
  it("passes the content type as HTTP metadata and never makes objects public", async () => {
    const stub = createStubBucket();
    const store = createR2ObjectStore({ bucket: stub.bucket, timeoutMs: 30 });
    await store.put("owner/o1/a", new Uint8Array([1]), "audio/webm");
    expect(stub.objects.get("owner/o1/a")?.contentType).toBe("audio/webm");
    expect(Object.keys(store)).not.toContain("publicUrl");
  });

  it("deletes by prefix in batches (list then delete), never the whole bucket", async () => {
    const stub = createStubBucket();
    const store = createR2ObjectStore({ bucket: stub.bucket, timeoutMs: 30 });
    for (let i = 0; i < 25; i++)
      await store.put(`owner/o1/b/${String(i)}`, new Uint8Array([i]), "audio/webm");
    await store.put("owner/o2/keep", new Uint8Array([1]), "audio/webm");
    await store.deleteByPrefix("owner/o1/b/");
    expect([...stub.objects.keys()]).toEqual(["owner/o2/keep"]);
    expect(stub.calls.filter((c) => c.startsWith("list")).length).toBeGreaterThanOrEqual(3);
    expect(
      stub.calls.filter((c) => c.startsWith("list")).every((c) => c === "list owner/o1/b/"),
    ).toBe(true);
  });

  it("does not leak keys or backend messages in errors", async () => {
    const stub = createStubBucket();
    const store = createR2ObjectStore({ bucket: stub.bucket, timeoutMs: 30 });
    stub.failNext("unavailable");
    const result = await store.get("owner/o1/secret-name");
    expect(JSON.stringify(result)).not.toMatch(/secret-name|R2 failed/);
  });
});
