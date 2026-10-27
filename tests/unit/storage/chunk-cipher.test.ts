import { describe, expect, it } from "vitest";
import { createChunkCipher } from "../../../src/adapters/crypto/chunk-cipher";
import { parseKeyring } from "../../../src/adapters/crypto/envelope-cipher";

const keyA = Buffer.alloc(32, 1).toString("base64");
const keyB = Buffer.alloc(32, 2).toString("base64");
const cipherWith = (spec: string, active: string) => createChunkCipher(parseKeyring(spec), active);

const audio = new TextEncoder().encode("RIFF-secret-audio-bytes-0123456789");

describe("chunk cipher (AES-256-GCM, per-object nonce, key id embedded)", () => {
  it("round-trips bytes and reports the key id used", async () => {
    const c = cipherWith(`k1:${keyA}`, "k1");
    const sealed = await c.seal(audio, "owner/o1/meeting/m1/chunk-0");
    expect(sealed.keyId).toBe("k1");
    expect(await c.open(sealed.bytes, "owner/o1/meeting/m1/chunk-0")).toEqual(audio);
  });

  it("round-trips an empty payload and a full 1 MiB chunk", async () => {
    const c = cipherWith(`k1:${keyA}`, "k1");
    const big = new Uint8Array(1_048_576).fill(7);
    expect(await c.open((await c.seal(new Uint8Array(0), "ctx")).bytes, "ctx")).toEqual(
      new Uint8Array(0),
    );
    expect(await c.open((await c.seal(big, "ctx")).bytes, "ctx")).toEqual(big);
  });

  it("never stores the plaintext and uses a fresh nonce every time", async () => {
    const c = cipherWith(`k1:${keyA}`, "k1");
    const a = await c.seal(audio, "ctx");
    const b = await c.seal(audio, "ctx");
    expect(Buffer.from(a.bytes).includes(Buffer.from(audio))).toBe(false);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(false);
    expect(a.bytes[0]).toBe(1);
  });

  it("detects tampering with any byte (header, nonce, ciphertext or tag)", async () => {
    const c = cipherWith(`k1:${keyA}`, "k1");
    const sealed = await c.seal(audio, "ctx");
    for (const index of [0, 1, 3, 8, 20, sealed.bytes.length - 1]) {
      const copy = new Uint8Array(sealed.bytes);
      copy[index] = (copy[index] ?? 0) ^ 0xff;
      await expect(c.open(copy, "ctx"), `byte ${String(index)}`).rejects.toThrow();
    }
  });

  it("refuses ciphertext moved to another object key (context is authenticated)", async () => {
    const c = cipherWith(`k1:${keyA}`, "k1");
    const sealed = await c.seal(audio, "owner/o1/meeting/m1/chunk-0");
    await expect(c.open(sealed.bytes, "owner/o2/meeting/m1/chunk-0")).rejects.toThrow();
  });

  it("opens old objects after rotation, encrypts new ones with the active key", async () => {
    const old = await cipherWith(`k1:${keyA}`, "k1").seal(audio, "ctx");
    const rotated = cipherWith(`k1:${keyA},k2:${keyB}`, "k2");
    expect(await rotated.open(old.bytes, "ctx")).toEqual(audio);
    expect((await rotated.seal(audio, "ctx")).keyId).toBe("k2");
  });

  it("fails when the key that sealed an object is no longer configured", async () => {
    const old = await cipherWith(`k1:${keyA}`, "k1").seal(audio, "ctx");
    await expect(cipherWith(`k2:${keyB}`, "k2").open(old.bytes, "ctx")).rejects.toThrow(/key/i);
  });

  it.each([
    [new Uint8Array(0)],
    [new Uint8Array([1])],
    [new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9])],
  ])("rejects malformed input %#", async (bytes) => {
    await expect(cipherWith(`k1:${keyA}`, "k1").open(bytes, "ctx")).rejects.toThrow();
  });

  it("rejects an active key id that is not in the keyring", () => {
    expect(() => cipherWith(`k1:${keyA}`, "k9")).toThrow();
  });
});
