import { describe, expect, it } from "vitest";
import { createEnvelopeCipher, parseKeyring } from "../../src/adapters/crypto/envelope-cipher";

const keyA = Buffer.alloc(32, 1).toString("base64");
const keyB = Buffer.alloc(32, 2).toString("base64");

function cipherWith(spec: string, activeKeyId: string) {
  return createEnvelopeCipher(parseKeyring(spec), activeKeyId);
}

describe("parseKeyring", () => {
  it("parses id:base64 pairs", () => {
    const ring = parseKeyring(`k1:${keyA},k2:${keyB}`);
    expect([...ring.keys()]).toEqual(["k1", "k2"]);
  });

  it.each([
    ["", "empty"],
    ["k1", "missing key"],
    [`k1:${Buffer.alloc(16).toString("base64")}`, "key shorter than 32 bytes"],
    [`k1:${keyA},k1:${keyB}`, "duplicate id"],
    [`bad id:${keyA}`, "invalid id characters"],
  ])("rejects %s (%s)", (spec) => {
    expect(() => parseKeyring(spec)).toThrow();
  });
});

describe("envelope cipher", () => {
  it("round-trips text and reports the key id used", async () => {
    const cipher = cipherWith(`k1:${keyA}`, "k1");
    const sealed = await cipher.encrypt("We agreed to ship on Friday.", "segment:s1");
    expect(sealed.keyId).toBe("k1");
    expect(sealed.ciphertext).not.toContain("ship");
    expect(await cipher.decrypt(sealed.ciphertext, "segment:s1")).toBe(
      "We agreed to ship on Friday.",
    );
  });

  it("produces different ciphertext for the same plaintext (fresh record key and iv)", async () => {
    const cipher = cipherWith(`k1:${keyA}`, "k1");
    const a = await cipher.encrypt("same", "ctx");
    const b = await cipher.encrypt("same", "ctx");
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses ciphertext moved to another row (AAD mismatch)", async () => {
    const cipher = cipherWith(`k1:${keyA}`, "k1");
    const sealed = await cipher.encrypt("secret", "segment:s1");
    await expect(cipher.decrypt(sealed.ciphertext, "segment:s2")).rejects.toThrow();
  });

  it("detects tampering", async () => {
    const cipher = cipherWith(`k1:${keyA}`, "k1");
    const sealed = await cipher.encrypt("secret", "ctx");
    const parts = sealed.ciphertext.split(".");
    const last = parts[parts.length - 1] ?? "";
    parts[parts.length - 1] = (last.startsWith("A") ? "B" : "A") + last.slice(1);
    await expect(cipher.decrypt(parts.join("."), "ctx")).rejects.toThrow();
  });

  it("decrypts old records after rotation and encrypts new ones with the active key", async () => {
    const old = await cipherWith(`k1:${keyA}`, "k1").encrypt("legacy", "ctx");
    const rotated = cipherWith(`k1:${keyA},k2:${keyB}`, "k2");
    expect(await rotated.decrypt(old.ciphertext, "ctx")).toBe("legacy");
    expect((await rotated.encrypt("fresh", "ctx")).keyId).toBe("k2");
  });

  it("fails when the key that wrapped the record is no longer configured", async () => {
    const old = await cipherWith(`k1:${keyA}`, "k1").encrypt("legacy", "ctx");
    await expect(cipherWith(`k2:${keyB}`, "k2").decrypt(old.ciphertext, "ctx")).rejects.toThrow(
      /key/i,
    );
  });

  it("rejects an active key id that is not in the keyring", () => {
    expect(() => cipherWith(`k1:${keyA}`, "k9")).toThrow();
  });

  it("rejects malformed ciphertext without leaking content", async () => {
    const cipher = cipherWith(`k1:${keyA}`, "k1");
    await expect(cipher.decrypt("not-a-ciphertext", "ctx")).rejects.toThrow();
  });
});
