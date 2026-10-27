import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createPbkdf2Hasher } from "../../../src/adapters/crypto/pbkdf2-password-hasher";
import { sha256Hex } from "../../../src/adapters/crypto/sha256";
import { InMemoryRateLimiter } from "../../../src/adapters/memory/in-memory-rate-limiter";
import { SqliteOwnerRepository } from "../../../src/adapters/sqlite/owner-repository";
import { SqliteSessionRepository } from "../../../src/adapters/sqlite/session-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import type { IdentityDeps } from "../../../src/app/identity/deps";
import { signIn } from "../../../src/app/identity/sign-in";
import { signOut } from "../../../src/app/identity/sign-out";
import { authenticateSession } from "../../../src/app/identity/authenticate";
import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  TOUCH_INTERVAL_MS,
} from "../../../src/domain/identity/session-policy";
import { T0, count, freshDb, insert, owner } from "../../support/db-fixtures";

const hasher = createPbkdf2Hasher({ iterations: 1000 });

let db: DatabaseSync;
let clock: FixedClock;
let deps: IdentityDeps;
let hashCalls: number;

beforeEach(async () => {
  db = freshDb();
  clock = new FixedClock(new Date("2026-10-27T09:00:00.000Z"));
  hashCalls = 0;
  const countingHasher = {
    hash: (pw: string) => hasher.hash(pw),
    verify: (pw: string, stored: string | null) => {
      hashCalls += 1;
      return hasher.verify(pw, stored);
    },
  };
  deps = {
    owners: new SqliteOwnerRepository(db),
    sessions: new SqliteSessionRepository(db),
    hasher: countingHasher,
    limiter: new InMemoryRateLimiter(clock),
    clock,
    ids: new SequentialIds("id"),
    tokens: new SequentialIds("token"),
    hashToken: sha256Hex,
  };
  owner(db, "A", { display_name: "Ada", password_hash: await hasher.hash("ada-password") });
  owner(db, "B", { display_name: "Ben", password_hash: await hasher.hash("ben-password") });
});

const attempt = (email: string, password: string, clientKey = "1.2.3.4", current?: string) =>
  signIn(deps, { email, password, clientKey, currentSessionToken: current });

describe("signIn", () => {
  it("creates a session and returns the raw token once; only its hash is stored", async () => {
    const result = await attempt("a@example.test", "ada-password");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.owner).toEqual({ id: "A", displayName: "Ada" });
    expect(result.value.token.length).toBeGreaterThan(5);
    const stored = db.prepare("SELECT token_hash, owner_id, csrf_secret FROM session").all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.["token_hash"]).toBe(await sha256Hex(result.value.token));
    expect(stored[0]?.["token_hash"]).not.toBe(result.value.token);
    expect(stored[0]?.["owner_id"]).toBe("A");
    expect(result.value.csrfSecret).toBe(stored[0]?.["csrf_secret"]);
  });

  it("normalizes the email before lookup", async () => {
    expect((await attempt("  A@Example.TEST ", "ada-password")).ok).toBe(true);
  });

  it("gives the same answer for a wrong password and an unknown email, doing the same work", async () => {
    const wrong = await attempt("a@example.test", "nope");
    const unknown = await attempt("ghost@example.test", "nope");
    expect(wrong).toEqual({ ok: false, error: { kind: "invalid_credentials" } });
    expect(unknown).toEqual(wrong);
    expect(hashCalls).toBe(2);
    expect(count(db, "session")).toBe(0);
  });

  it("rejects an owner without a password hash (seeded but not enabled)", async () => {
    owner(db, "C");
    expect((await attempt("c@example.test", "anything")).ok).toBe(false);
  });

  it("rotates: signing in again revokes the session that was presented", async () => {
    const first = await attempt("a@example.test", "ada-password");
    if (!first.ok) throw new Error("setup");
    const second = await attempt("a@example.test", "ada-password", "1.2.3.4", first.value.token);
    if (!second.ok) throw new Error("setup");
    expect(second.value.token).not.toBe(first.value.token);
    expect((await authenticateSession(deps, first.value.token)).status).toBe("anonymous");
    expect((await authenticateSession(deps, second.value.token)).status).toBe("authenticated");
  });

  it("rate limits repeated failures per email, even when the right password arrives", async () => {
    for (let i = 0; i < 5; i++) await attempt("a@example.test", "bad", `10.0.0.${String(i)}`);
    const blocked = await attempt("a@example.test", "ada-password", "10.0.0.99");
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.kind).toBe("rate_limited");
    if (blocked.error.kind === "rate_limited") {
      expect(blocked.error.retryAfterSeconds).toBeGreaterThan(0);
    }
    clock.advance(15 * 60 * 1000);
    expect((await attempt("a@example.test", "ada-password", "10.0.0.99")).ok).toBe(true);
  });

  it("rate limits one client address across many emails", async () => {
    for (let i = 0; i < 20; i++) await attempt(`ghost${String(i)}@example.test`, "bad", "6.6.6.6");
    const blocked = await attempt("a@example.test", "ada-password", "6.6.6.6");
    expect(blocked.ok).toBe(false);
    expect((await attempt("a@example.test", "ada-password", "7.7.7.7")).ok).toBe(true);
  });

  it("a successful sign-in resets that email's failure counter", async () => {
    for (let i = 0; i < 4; i++) await attempt("a@example.test", "bad", `10.0.1.${String(i)}`);
    expect((await attempt("a@example.test", "ada-password", "10.0.1.9")).ok).toBe(true);
    for (let i = 0; i < 4; i++) {
      expect((await attempt("a@example.test", "bad", `10.0.2.${String(i)}`)).ok).toBe(false);
    }
    expect((await attempt("a@example.test", "ada-password", "10.0.2.9")).ok).toBe(true);
  });
});

describe("authenticateSession", () => {
  async function signedIn(email: string, password: string): Promise<string> {
    const r = await attempt(email, password);
    if (!r.ok) throw new Error("setup");
    return r.value.token;
  }

  it("is anonymous without a token or with a guessed token", async () => {
    expect(await authenticateSession(deps, undefined)).toEqual({ status: "anonymous" });
    expect(await authenticateSession(deps, "")).toEqual({ status: "anonymous" });
    await signedIn("a@example.test", "ada-password");
    expect(await authenticateSession(deps, "token-guess")).toEqual({ status: "anonymous" });
  });

  it("resolves the owner and csrf secret of the session, never another owner's", async () => {
    const tokenA = await signedIn("a@example.test", "ada-password");
    const tokenB = await signedIn("b@example.test", "ben-password");
    const a = await authenticateSession(deps, tokenA);
    const b = await authenticateSession(deps, tokenB);
    expect(a.status === "authenticated" && a.owner.id).toBe("A");
    expect(b.status === "authenticated" && b.owner.id).toBe("B");
    expect(
      a.status === "authenticated" && b.status === "authenticated" && a.session.csrfSecret,
    ).not.toBe(b.status === "authenticated" && b.session.csrfSecret);
  });

  it("expires after the idle timeout", async () => {
    const token = await signedIn("a@example.test", "ada-password");
    clock.advance(IDLE_TIMEOUT_MS);
    expect(await authenticateSession(deps, token)).toEqual({ status: "expired" });
  });

  it("slides the idle window on activity but never past the absolute timeout", async () => {
    const token = await signedIn("a@example.test", "ada-password");
    const step = IDLE_TIMEOUT_MS - 1000;
    let elapsed = 0;
    while (elapsed + step < ABSOLUTE_TIMEOUT_MS) {
      clock.advance(step);
      elapsed += step;
      expect((await authenticateSession(deps, token)).status).toBe("authenticated");
    }
    clock.advance(ABSOLUTE_TIMEOUT_MS - elapsed);
    expect(await authenticateSession(deps, token)).toEqual({ status: "expired" });
  });

  it("writes last_seen at most once per touch interval", async () => {
    const token = await signedIn("a@example.test", "ada-password");
    const seen = () => db.prepare("SELECT last_seen_at AS t FROM session").get()?.["t"];
    const initial = seen();
    clock.advance(TOUCH_INTERVAL_MS - 1);
    await authenticateSession(deps, token);
    expect(seen()).toBe(initial);
    clock.advance(1);
    await authenticateSession(deps, token);
    expect(seen()).not.toBe(initial);
  });

  it("is anonymous after sign-out, and sign-out is repeatable", async () => {
    const token = await signedIn("a@example.test", "ada-password");
    await signOut(deps, token);
    expect(await authenticateSession(deps, token)).toEqual({ status: "anonymous" });
    await expect(signOut(deps, token)).resolves.toBeUndefined();
    await expect(signOut(deps, "never-existed")).resolves.toBeUndefined();
    expect(count(db, "session", "revoked_at IS NOT NULL")).toBe(1);
  });

  it("signing out one owner leaves another owner's session intact", async () => {
    const tokenA = await signedIn("a@example.test", "ada-password");
    const tokenB = await signedIn("b@example.test", "ben-password");
    await signOut(deps, tokenA);
    expect((await authenticateSession(deps, tokenB)).status).toBe("authenticated");
  });

  it("treats a session whose owner vanished as anonymous", async () => {
    const token = await signedIn("a@example.test", "ada-password");
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("DELETE FROM owner WHERE id = 'A'").run();
    db.exec("PRAGMA foreign_keys = ON");
    expect((await authenticateSession(deps, token)).status).toBe("anonymous");
  });
});

describe("session storage constraints", () => {
  it("cannot store two sessions with the same token hash", () => {
    const row = {
      owner_id: "A",
      token_hash: "dup",
      csrf_secret: "c",
      created_at: T0,
      last_seen_at: T0,
      idle_expires_at: T0,
      absolute_expires_at: T0,
    };
    insert(db, "session", { ...row, id: "s1" });
    expect(() => insert(db, "session", { ...row, id: "s2" })).toThrow(/UNIQUE/);
  });
});
