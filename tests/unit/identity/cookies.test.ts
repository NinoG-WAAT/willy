import { describe, expect, it } from "vitest";
import {
  LOGIN_CSRF_COOKIE,
  SESSION_COOKIE,
  clearCookieOptions,
  sessionCookieOptions,
} from "../../../src/app/identity/cookies";

describe("cookie policy (OWASP A07)", () => {
  const expires = new Date("2026-11-03T09:00:00.000Z");

  it("uses __Host- prefixed names so cookies cannot be set by sibling domains", () => {
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    expect(LOGIN_CSRF_COOKIE.startsWith("__Host-")).toBe(true);
  });

  it("makes the session cookie HttpOnly, Secure, SameSite=Lax, path / and expiring", () => {
    expect(sessionCookieOptions(expires)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires,
    });
  });

  it("clears cookies with the same attributes so the browser matches them", () => {
    const o = clearCookieOptions();
    expect(o).toMatchObject({ httpOnly: true, secure: true, path: "/" });
    expect(o.expires.getTime()).toBe(0);
  });
});
