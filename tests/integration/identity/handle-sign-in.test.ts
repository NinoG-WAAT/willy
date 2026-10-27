import { beforeEach, describe, expect, it } from "vitest";
import { createPbkdf2Hasher } from "../../../src/adapters/crypto/pbkdf2-password-hasher";
import { sha256Hex } from "../../../src/adapters/crypto/sha256";
import { InMemoryRateLimiter } from "../../../src/adapters/memory/in-memory-rate-limiter";
import { SqliteOwnerRepository } from "../../../src/adapters/sqlite/owner-repository";
import { SqliteSessionRepository } from "../../../src/adapters/sqlite/session-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import type { IdentityDeps } from "../../../src/app/identity/deps";
import { handleSignIn, type SignInRequest } from "../../../src/app/identity/handle-sign-in";
import { freshDb, owner } from "../../support/db-fixtures";

const hasher = createPbkdf2Hasher({ iterations: 1000 });
const ORIGIN = "https://app.example";

let deps: IdentityDeps;

beforeEach(async () => {
  const db = freshDb();
  const clock = new FixedClock(new Date("2026-10-27T09:00:00.000Z"));
  deps = {
    owners: new SqliteOwnerRepository(db),
    sessions: new SqliteSessionRepository(db),
    hasher,
    limiter: new InMemoryRateLimiter(clock),
    clock,
    ids: new SequentialIds("id"),
    tokens: new SequentialIds("token"),
    hashToken: sha256Hex,
  };
  owner(db, "A", { display_name: "Ada", password_hash: await hasher.hash("ada-password") });
});

function request(fields: Record<string, string>, overrides: Partial<SignInRequest> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ csrf_token: "login-csrf", ...fields })) form.set(k, v);
  return {
    form,
    origin: ORIGIN,
    expectedOrigin: ORIGIN,
    loginCsrfCookie: "login-csrf",
    clientKey: "1.2.3.4",
    currentSessionToken: undefined,
    ...overrides,
  } satisfies SignInRequest;
}

describe("handleSignIn", () => {
  it("signs in and returns a safe next path", async () => {
    const out = await handleSignIn(
      deps,
      request({ email: "a@example.test", password: "ada-password", next: "/search?q=x" }),
    );
    expect(out.kind).toBe("signed_in");
    if (out.kind === "signed_in") {
      expect(out.next).toBe("/search?q=x");
      expect(out.token.length).toBeGreaterThan(0);
    }
  });

  it("ignores an external next target", async () => {
    const out = await handleSignIn(
      deps,
      request({ email: "a@example.test", password: "ada-password", next: "https://evil.example" }),
    );
    expect(out.kind === "signed_in" && out.next).toBe("/");
  });

  it("refuses a missing, wrong or cross-site CSRF proof before touching credentials", async () => {
    const good = { email: "a@example.test", password: "ada-password" };
    const wrongToken = await handleSignIn(deps, request({ ...good, csrf_token: "forged" }));
    const noCookie = await handleSignIn(deps, request(good, { loginCsrfCookie: undefined }));
    const badOrigin = await handleSignIn(deps, request(good, { origin: "https://evil.example" }));
    const noOrigin = await handleSignIn(deps, request(good, { origin: null }));
    for (const out of [wrongToken, noCookie, badOrigin, noOrigin]) {
      expect(out).toMatchObject({ kind: "rejected", status: 403 });
    }
  });

  it("does not count CSRF failures against the email limit", async () => {
    for (let i = 0; i < 10; i++) {
      await handleSignIn(
        deps,
        request({ email: "a@example.test", password: "x", csrf_token: "forged" }),
      );
    }
    const out = await handleSignIn(
      deps,
      request({ email: "a@example.test", password: "ada-password" }),
    );
    expect(out.kind).toBe("signed_in");
  });

  it("rejects malformed or unexpected fields with 400, without echoing input", async () => {
    const missing = await handleSignIn(deps, request({ email: "a@example.test" }));
    const extra = await handleSignIn(
      deps,
      request({ email: "a@example.test", password: "p", admin: "1" }),
    );
    const huge = await handleSignIn(
      deps,
      request({ email: "a@example.test", password: "p".repeat(5000) }),
    );
    for (const out of [missing, extra, huge]) {
      expect(out).toMatchObject({ kind: "rejected", status: 400 });
      expect(JSON.stringify(out)).not.toContain("admin");
    }
  });

  it("answers wrong credentials with a generic 401", async () => {
    const out = await handleSignIn(deps, request({ email: "a@example.test", password: "nope" }));
    expect(out).toEqual({
      kind: "rejected",
      status: 401,
      message: "Email or password is incorrect.",
    });
  });

  it("answers rate limiting with 429 and a retry hint", async () => {
    for (let i = 0; i < 5; i++) {
      await handleSignIn(
        deps,
        request({ email: "a@example.test", password: "nope" }, { clientKey: `c${String(i)}` }),
      );
    }
    const out = await handleSignIn(
      deps,
      request({ email: "a@example.test", password: "ada-password" }, { clientKey: "c9" }),
    );
    expect(out).toMatchObject({ kind: "rejected", status: 429 });
    if (out.kind === "rejected") {
      expect(out.retryAfterSeconds).toBeGreaterThan(0);
      expect(out.message).toContain("Too many attempts");
    }
  });
});
