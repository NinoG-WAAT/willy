import { describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  createOAuthState,
  isAllowedRedirectUri,
  verifyOAuthState,
} from "../../../src/domain/calendar/oauth";

const allowlist = [
  "https://willy.example.com/oauth/calendar/callback",
  "http://localhost:4321/oauth/calendar/callback",
];

describe("isAllowedRedirectUri", () => {
  it("accepts exact allowlist matches only", () => {
    expect(isAllowedRedirectUri(allowlist[0]!, allowlist)).toBe(true);
    expect(isAllowedRedirectUri(allowlist[1]!, allowlist)).toBe(true);
  });

  it.each([
    "https://willy.example.com/oauth/calendar/callback/",
    "https://willy.example.com/oauth/calendar/callback?next=https://evil.test",
    "https://willy.example.com/oauth/calendar/callback#x",
    "https://willy.example.com.evil.test/oauth/calendar/callback",
    "https://user@willy.example.com/oauth/calendar/callback",
    "http://willy.example.com/oauth/calendar/callback",
    "https://evil.test/oauth/calendar/callback",
    "javascript:alert(1)",
    "not a url",
    "",
  ])("rejects %s", (uri) => {
    expect(isAllowedRedirectUri(uri, allowlist)).toBe(false);
  });

  it("refuses a plain-http allowlist entry for a non-local host", () => {
    expect(isAllowedRedirectUri("http://willy.example.com/cb", ["http://willy.example.com/cb"])).toBe(false);
  });
});

describe("OAuth state", () => {
  const secret = "state-secret";
  const base = { secret, ownerId: "owner-a", nonce: "abc123", nowSec: 1_000 };

  it("round-trips for the same owner within the ttl", async () => {
    const state = await createOAuthState(base);
    expect(await verifyOAuthState({ ...base, state, nowSec: 1_300 })).toEqual({ ok: true, value: undefined });
  });

  it("rejects a state minted for another owner", async () => {
    const state = await createOAuthState(base);
    expect(await verifyOAuthState({ ...base, ownerId: "owner-b", state })).toEqual({ ok: false, error: "mismatch" });
  });

  it("rejects an expired state", async () => {
    const state = await createOAuthState(base);
    expect(await verifyOAuthState({ ...base, state, nowSec: 1_000 + 601 })).toEqual({ ok: false, error: "expired" });
  });

  it("rejects tampered or malformed state", async () => {
    const state = await createOAuthState(base);
    expect(await verifyOAuthState({ ...base, state: state.replace("abc123", "zzz999") })).toEqual({
      ok: false,
      error: "mismatch",
    });
    expect(await verifyOAuthState({ ...base, state: "garbage" })).toEqual({ ok: false, error: "malformed" });
    expect(await verifyOAuthState({ ...base, state: "" })).toEqual({ ok: false, error: "malformed" });
  });

  it("rejects a state signed with another secret", async () => {
    const state = await createOAuthState({ ...base, secret: "other" });
    expect(await verifyOAuthState({ ...base, state })).toEqual({ ok: false, error: "mismatch" });
  });
});

describe("buildAuthorizationUrl", () => {
  it("requests read-only calendar access offline with state and redirect", () => {
    const url = new URL(buildAuthorizationUrl({ clientId: "cid", redirectUri: allowlist[0]!, state: "s1" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(allowlist[0]);
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.events.readonly");
  });
});
