import { describe, expect, it } from "vitest";
import type { ProviderErrorKind } from "../../../src/domain/platform/provider-error";
import type { ObjectStore } from "../../../src/ports/object-store";

export interface ObjectStoreHarness {
  store: ObjectStore;
  /** Make the next call fail the way the backend would for `kind`. */
  failNext(kind: ProviderErrorKind): void;
}

const bytes = (...values: number[]) => new Uint8Array(values);

/**
 * Shared contract (CLAUDE.md section 5, Liskov): the local filesystem fake and the R2 adapter
 * must behave the same, including idempotent deletes, prefix safety and failures.
 */
export function objectStoreContract(name: string, create: () => ObjectStoreHarness): void {
  describe(`ObjectStore contract: ${name}`, () => {
    it("round-trips bytes and content type", async () => {
      const { store } = create();
      expect(await store.put("owner/o1/meeting/m1/chunk-0", bytes(1, 2, 3), "audio/webm")).toEqual({
        ok: true,
        value: undefined,
      });
      expect(await store.get("owner/o1/meeting/m1/chunk-0")).toEqual({
        ok: true,
        value: { bytes: bytes(1, 2, 3), contentType: "audio/webm" },
      });
    });

    it("returns null (not an error) for a missing object", async () => {
      const { store } = create();
      expect(await store.get("owner/o1/meeting/m1/nope")).toEqual({ ok: true, value: null });
    });

    it("overwrites on repeated put (replay safe)", async () => {
      const { store } = create();
      await store.put("owner/o1/a", bytes(1), "audio/webm");
      await store.put("owner/o1/a", bytes(2, 2), "audio/ogg");
      const got = await store.get("owner/o1/a");
      expect(got).toEqual({ ok: true, value: { bytes: bytes(2, 2), contentType: "audio/ogg" } });
    });

    it("delete is idempotent: deleting twice or deleting nothing succeeds", async () => {
      const { store } = create();
      await store.put("owner/o1/a", bytes(1), "audio/webm");
      expect((await store.delete("owner/o1/a")).ok).toBe(true);
      expect((await store.delete("owner/o1/a")).ok).toBe(true);
      expect((await store.delete("owner/o1/never-existed")).ok).toBe(true);
      expect(await store.get("owner/o1/a")).toEqual({ ok: true, value: null });
    });

    it("deleteByPrefix removes exactly that prefix, reports the count and is idempotent", async () => {
      const { store } = create();
      await store.put("owner/o1/meeting/m1/chunk-0", bytes(1), "audio/webm");
      await store.put("owner/o1/meeting/m1/chunk-1", bytes(2), "audio/webm");
      await store.put("owner/o1/meeting/m10/chunk-0", bytes(3), "audio/webm");
      await store.put("owner/o10/meeting/m1/chunk-0", bytes(4), "audio/webm");
      await store.put("owner/o2/meeting/m1/chunk-0", bytes(5), "audio/webm");

      expect(await store.deleteByPrefix("owner/o1/meeting/m1/")).toEqual({
        ok: true,
        value: { deleted: 2 },
      });
      expect(await store.deleteByPrefix("owner/o1/meeting/m1/")).toEqual({
        ok: true,
        value: { deleted: 0 },
      });
      for (const key of [
        "owner/o1/meeting/m10/chunk-0",
        "owner/o10/meeting/m1/chunk-0",
        "owner/o2/meeting/m1/chunk-0",
      ]) {
        const kept = await store.get(key);
        expect(kept.ok && kept.value !== null).toBe(true);
      }
      const gone = await store.get("owner/o1/meeting/m1/chunk-0");
      expect(gone).toEqual({ ok: true, value: null });
    });

    it("deleteByPrefix handles more objects than one listing page", async () => {
      const { store } = create();
      for (let i = 0; i < 25; i++)
        await store.put(`owner/o1/bulk/chunk-${String(i)}`, bytes(i), "audio/webm");
      expect(await store.deleteByPrefix("owner/o1/bulk/")).toEqual({
        ok: true,
        value: { deleted: 25 },
      });
    });

    it.each([
      "",
      "/owner/o1/x",
      "owner/o1/../o2/x",
      "owner//o1/x",
      "owner/o1/x\\y",
      "owner/o1/x\u0000",
      "owner/o1/file.__meta",
      "owner/o1/",
    ])("rejects the unsafe key %j without touching storage", async (key) => {
      const { store } = create();
      for (const result of [
        await store.put(key, bytes(1), "audio/webm"),
        await store.get(key),
        await store.delete(key),
      ]) {
        expect(result).toMatchObject({ ok: false, error: { kind: "rejected", retryable: false } });
      }
    });

    it.each(["", "/", "owner/", "owner/o1", "../", "owner/../", "owner/o1/meeting"])(
      "refuses to delete by the too-broad or malformed prefix %j",
      async (prefix) => {
        const { store } = create();
        await store.put("owner/o1/a", bytes(1), "audio/webm");
        expect(await store.deleteByPrefix(prefix)).toMatchObject({
          ok: false,
          error: { kind: "rejected" },
        });
        const kept = await store.get("owner/o1/a");
        expect(kept.ok && kept.value !== null).toBe(true);
      },
    );

    it("rejects objects larger than any encrypted chunk can be", async () => {
      const { store } = create();
      const result = await store.put(
        "owner/o1/big",
        new Uint8Array(1_048_576 + 4097),
        "audio/webm",
      );
      expect(result).toMatchObject({ ok: false, error: { kind: "rejected", retryable: false } });
    });

    it.each([
      ["timeout", true],
      ["rate_limited", true],
      ["unavailable", true],
      ["rejected", false],
    ] as const)("reports %s as a normalized error (retryable: %s)", async (kind, retryable) => {
      for (const op of ["put", "get", "delete", "deleteByPrefix"] as const) {
        const h = create();
        h.failNext(kind);
        const result =
          op === "put"
            ? await h.store.put("owner/o1/a", bytes(1), "audio/webm")
            : op === "get"
              ? await h.store.get("owner/o1/a")
              : op === "delete"
                ? await h.store.delete("owner/o1/a")
                : await h.store.deleteByPrefix("owner/o1/");
        expect(result.ok, op).toBe(false);
        if (!result.ok) {
          expect(result.error.kind, op).toBe(kind);
          expect(result.error.retryable, op).toBe(retryable);
          expect(result.error.message).not.toMatch(/owner\/o1/);
        }
      }
    });

    it("recovers on the next call after a failure", async () => {
      const h = create();
      h.failNext("unavailable");
      await h.store.put("owner/o1/a", bytes(1), "audio/webm");
      expect((await h.store.put("owner/o1/a", bytes(1), "audio/webm")).ok).toBe(true);
    });
  });
}
