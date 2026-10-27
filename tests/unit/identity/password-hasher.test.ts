import { describe, expect, it } from "vitest";
import { createPbkdf2Hasher } from "../../../src/adapters/crypto/pbkdf2-password-hasher";

const hasher = createPbkdf2Hasher({ iterations: 1000 });

describe("PBKDF2 password hasher", () => {
  it("verifies the right password and rejects wrong ones", async () => {
    const stored = await hasher.hash("correct horse");
    expect(await hasher.verify("correct horse", stored)).toBe(true);
    expect(await hasher.verify("correct horsf", stored)).toBe(false);
    expect(await hasher.verify("", stored)).toBe(false);
  });

  it("salts every hash and never contains the password", async () => {
    const a = await hasher.hash("same");
    const b = await hasher.hash("same");
    expect(a).not.toBe(b);
    expect(a).not.toContain("same");
    expect(a.startsWith("pbkdf2-sha256$1000$")).toBe(true);
  });

  it("verifies hashes made with other iteration counts (upgradable cost)", async () => {
    const old = await createPbkdf2Hasher({ iterations: 2000 }).hash("pw");
    expect(await hasher.verify("pw", old)).toBe(true);
  });

  it("fails closed on unknown owners and malformed hashes, doing comparable work", async () => {
    expect(await hasher.verify("pw", null)).toBe(false);
    expect(await hasher.verify("pw", "garbage")).toBe(false);
    expect(await hasher.verify("pw", "pbkdf2-sha256$abc$x$y")).toBe(false);
    expect(await hasher.verify("pw", "bcrypt$10$x$y")).toBe(false);
  });

  it("refuses insane iteration counts", () => {
    expect(() => createPbkdf2Hasher({ iterations: 10 })).toThrow();
  });
});
