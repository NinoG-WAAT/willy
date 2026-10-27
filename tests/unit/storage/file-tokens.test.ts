import { describe, expect, it } from "vitest";
import { createFileTokenService } from "../../../src/adapters/crypto/file-tokens";
import { FixedClock } from "../../../src/adapters/system/fakes";

const SECRET = "a-long-random-secret-for-tests-only";
const start = new Date("2026-10-27T10:00:00.000Z");
const claims = { ownerId: "o1", objectKey: "owner/o1/meeting/m1/chunk-0" };

function build(secret = SECRET) {
  const clock = new FixedClock(start);
  return { clock, tokens: createFileTokenService({ secret, clock }) };
}

describe("file tokens (short-lived authorized URLs)", () => {
  it("mints a token that verifies and carries owner, key and expiry", async () => {
    const { tokens } = build();
    const token = await tokens.mint(claims, 60);
    expect(await tokens.verify(token)).toEqual({
      ok: true,
      value: { ...claims, expiresAt: "2026-10-27T10:01:00.000Z" },
    });
  });

  it("is URL-safe and does not reveal the object key in clear text", async () => {
    const { tokens } = build();
    const token = await tokens.mint(claims, 60);
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(token.length).toBeLessThan(600);
  });

  it("expires exactly at the TTL", async () => {
    const { clock, tokens } = build();
    const token = await tokens.mint(claims, 60);
    clock.advance(59_999);
    expect((await tokens.verify(token)).ok).toBe(true);
    clock.advance(1);
    expect(await tokens.verify(token)).toEqual({ ok: false, error: "expired" });
  });

  it("allows at most 5 minutes and at least 1 second", async () => {
    const { tokens } = build();
    await expect(tokens.mint(claims, 301)).rejects.toThrow();
    await expect(tokens.mint(claims, 0)).rejects.toThrow();
    await expect(tokens.mint(claims, 1.5)).rejects.toThrow();
    await expect(tokens.mint(claims, 300)).resolves.toBeTypeOf("string");
  });

  it("rejects tampered payloads, tampered signatures and other secrets", async () => {
    const { tokens } = build();
    const token = await tokens.mint(claims, 60);
    const [payload = "", signature = ""] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ o: "o2", k: "owner/o2/meeting/m9/chunk-0", e: "2099-01-01T00:00:00.000Z" }),
    ).toString("base64url");
    expect(await tokens.verify(`${forgedPayload}.${signature}`)).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await tokens.verify(`${payload}.${signature.slice(0, -2)}AA`)).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await build("another-long-random-secret-0123456789").tokens.verify(token)).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it.each(["", "garbage", "a.b.c", ".", "a.", ".b", "%%%.%%%"])(
    "rejects malformed token %j",
    async (token) => {
      expect(await build().tokens.verify(token)).toEqual({ ok: false, error: "invalid" });
    },
  );

  it("refuses a weak secret", () => {
    expect(() =>
      createFileTokenService({ secret: "short", clock: new FixedClock(start) }),
    ).toThrow();
  });
});
