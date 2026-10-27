import { describe, expect, it } from "vitest";
import { createAesGcmCipher } from "../../../src/adapters/crypto/aes-gcm-cipher";

const keyOf = (byte: number) => Buffer.alloc(32, byte).toString("base64");
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function cipher(activeKeyId = "k1", keys: Record<string, string> = { k1: keyOf(1), k2: keyOf(2) }) {
  return createAesGcmCipher({ keys, activeKeyId, randomBytes });
}

describe("AES-GCM token cipher", () => {
  it("round-trips and never stores plaintext", async () => {
    const c = cipher();
    const sealed = await c.seal("refresh-token-123", "calendar:owner-a");
    expect(sealed).not.toContain("refresh-token-123");
    expect(await c.open(sealed, "calendar:owner-a")).toEqual({ ok: true, value: "refresh-token-123" });
  });

  it("uses a fresh nonce per seal", async () => {
    const c = cipher();
    expect(await c.seal("x", "ctx")).not.toBe(await c.seal("x", "ctx"));
  });

  it("detects tampering", async () => {
    const c = cipher();
    const sealed = await c.seal("secret", "ctx");
    const parts = sealed.split(".");
    const ct = Buffer.from(parts[2]!, "base64");
    ct[0] = ct[0]! ^ 1;
    parts[2] = ct.toString("base64");
    expect(await c.open(parts.join("."), "ctx")).toEqual({ ok: false, error: "tampered" });
  });

  it("binds ciphertext to its context so it cannot be moved to another owner", async () => {
    const c = cipher();
    const sealed = await c.seal("secret", "calendar:owner-a");
    expect(await c.open(sealed, "calendar:owner-b")).toEqual({ ok: false, error: "tampered" });
  });

  it("opens old records after rotation via the stored key id, and seals with the active key", async () => {
    const before = cipher("k1");
    const sealedOld = await before.seal("secret", "ctx");
    const after = cipher("k2");
    expect(await after.open(sealedOld, "ctx")).toEqual({ ok: true, value: "secret" });
    expect((await after.seal("secret", "ctx")).startsWith("k2.")).toBe(true);
  });

  it("reports an unknown key id and malformed input without throwing", async () => {
    const c = cipher();
    expect(await c.open("k9.AAAA.AAAA", "ctx")).toEqual({ ok: false, error: "unknown_key" });
    expect(await c.open("garbage", "ctx")).toEqual({ ok: false, error: "malformed" });
  });

  it("rejects keys that are not 32 bytes at construction", () => {
    expect(() => createAesGcmCipher({ keys: { k1: "c2hvcnQ=" }, activeKeyId: "k1", randomBytes })).toThrow(/32 bytes/);
    expect(() => createAesGcmCipher({ keys: { k1: keyOf(1) }, activeKeyId: "nope", randomBytes })).toThrow(/active key/);
  });
});
