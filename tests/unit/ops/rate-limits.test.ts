import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../../../src/adapters/memory/in-memory-rate-limiter";
import { FixedClock } from "../../../src/adapters/system/fakes";
import { enforceRateLimit, rateLimitFor } from "../../../src/app/ops/rate-limits";

describe("rateLimitFor (abuse-prone endpoints)", () => {
  it.each([
    ["POST", "/meetings/import", "import", "owner"],
    ["GET", "/meetings/abc123/export.md", "export", "owner"],
    ["POST", "/meetings/abc123/delete", "delete", "owner"],
    ["POST", "/settings/deletions/abc123/retry", "delete", "owner"],
    ["POST", "/meetings/abc123/note/regenerate", "regenerate", "owner"],
    ["GET", "/search", "search", "owner"],
    ["POST", "/webhooks/calendar", "webhook", "client"],
  ] as const)("limits %s %s as %s per %s", (method, path, name, scope) => {
    expect(rateLimitFor(method, path)).toMatchObject({ name, scope });
  });

  it.each([
    ["GET", "/meetings/import"],
    ["POST", "/search"],
    ["GET", "/"],
    ["GET", "/meetings/abc/export.md/extra"],
    ["GET", "/meetings/abc/review"],
    ["POST", "/api/meetings/abc/chunks"],
    ["POST", "/sign-in"],
  ])("leaves %s %s to its own handling", (method, path) => {
    expect(rateLimitFor(method, path)).toBeNull();
  });

  it("matches the path exactly, so lookalikes are not accidentally limited or skipped", () => {
    expect(rateLimitFor("GET", "/meetings/a/b/export.md")).toBeNull();
    expect(rateLimitFor("POST", "/webhooks/")).toMatchObject({ name: "webhook" });
  });
});

describe("enforceRateLimit", () => {
  function build() {
    const clock = new FixedClock(new Date("2026-10-27T10:00:00.000Z"));
    return { clock, limiter: new InMemoryRateLimiter(clock) };
  }
  const exportReq = { method: "GET", pathname: "/meetings/m1/export.md" };

  it("allows requests up to the limit, then answers with a retry delay", async () => {
    const { limiter } = build();
    const who = { ownerId: "A", clientAddress: "1.1.1.1" };
    for (let i = 0; i < 30; i++) {
      expect(await enforceRateLimit(limiter, { ...exportReq, ...who })).toBeNull();
    }
    const blocked = await enforceRateLimit(limiter, { ...exportReq, ...who });
    expect(blocked?.limit).toBe("export");
    expect(blocked?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts per owner: one owner's burst does not block another", async () => {
    const { limiter } = build();
    for (let i = 0; i < 31; i++) {
      await enforceRateLimit(limiter, { ...exportReq, ownerId: "A", clientAddress: "1.1.1.1" });
    }
    expect(
      await enforceRateLimit(limiter, { ...exportReq, ownerId: "B", clientAddress: "1.1.1.1" }),
    ).toBeNull();
  });

  it("counts each class separately", async () => {
    const { limiter } = build();
    for (let i = 0; i < 31; i++) {
      await enforceRateLimit(limiter, { ...exportReq, ownerId: "A", clientAddress: "x" });
    }
    expect(
      await enforceRateLimit(limiter, {
        method: "GET",
        pathname: "/search",
        ownerId: "A",
        clientAddress: "x",
      }),
    ).toBeNull();
  });

  it("recovers when the window passes", async () => {
    const { clock, limiter } = build();
    for (let i = 0; i < 31; i++) {
      await enforceRateLimit(limiter, { ...exportReq, ownerId: "A", clientAddress: "x" });
    }
    clock.advance(10 * 60_000);
    expect(
      await enforceRateLimit(limiter, { ...exportReq, ownerId: "A", clientAddress: "x" }),
    ).toBeNull();
  });

  it("limits webhooks per client address, since they carry no session", async () => {
    const { limiter } = build();
    const hook = (clientAddress: string) =>
      enforceRateLimit(limiter, {
        method: "POST",
        pathname: "/webhooks/calendar",
        ownerId: undefined,
        clientAddress,
      });
    for (let i = 0; i < 300; i++) await hook("9.9.9.9");
    expect(await hook("9.9.9.9")).toMatchObject({ limit: "webhook" });
    expect(await hook("8.8.8.8")).toBeNull();
  });

  it("ignores routes without a policy", async () => {
    const { limiter } = build();
    for (let i = 0; i < 1000; i++) {
      expect(
        await enforceRateLimit(limiter, {
          method: "GET",
          pathname: "/",
          ownerId: "A",
          clientAddress: "x",
        }),
      ).toBeNull();
    }
  });
});
