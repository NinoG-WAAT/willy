import { describe, expect, it } from "vitest";
import { readCalendarConfig } from "../../../src/adapters/calendar/config";

const key = Buffer.alloc(32, 1).toString("base64");

const google = {
  CALENDAR_PROVIDER: "google",
  GOOGLE_OAUTH_CLIENT_ID: "cid",
  GOOGLE_OAUTH_CLIENT_SECRET: "csecret",
  GOOGLE_OAUTH_REDIRECT_URIS:
    "https://willy.example.com/oauth/calendar/callback, http://localhost:4321/oauth/calendar/callback",
  CALENDAR_WEBHOOK_SECRET: "whsec",
  OAUTH_STATE_SECRET: "state",
  TOKEN_ENCRYPTION_KEYS: `k1:${key},k2:${key}`,
  TOKEN_ENCRYPTION_ACTIVE_KEY_ID: "k2",
};

describe("readCalendarConfig", () => {
  it("defaults to the deterministic fake when nothing is configured", () => {
    expect(readCalendarConfig({})).toEqual({ ok: true, value: { mode: "fake" } });
  });

  it("parses a complete Google configuration", () => {
    const result = readCalendarConfig(google);
    expect(result.ok && result.value).toMatchObject({
      mode: "google",
      clientId: "cid",
      redirectAllowlist: [
        "https://willy.example.com/oauth/calendar/callback",
        "http://localhost:4321/oauth/calendar/callback",
      ],
      activeKeyId: "k2",
      encryptionKeys: { k1: key, k2: key },
    });
  });

  it("names every missing variable (never values) when Google is selected", () => {
    const result = readCalendarConfig({
      CALENDAR_PROVIDER: "google",
      GOOGLE_OAUTH_CLIENT_SECRET: "s3cret",
    });
    expect(result.ok).toBe(false);
    const message = JSON.stringify(result);
    expect(message).toContain("GOOGLE_OAUTH_CLIENT_ID");
    expect(message).toContain("TOKEN_ENCRYPTION_KEYS");
    expect(message).not.toContain("s3cret");
  });

  it("rejects an unknown provider and a malformed key list", () => {
    expect(readCalendarConfig({ CALENDAR_PROVIDER: "outlook" }).ok).toBe(false);
    expect(readCalendarConfig({ ...google, TOKEN_ENCRYPTION_KEYS: "no-colon" }).ok).toBe(false);
    expect(readCalendarConfig({ ...google, TOKEN_ENCRYPTION_ACTIVE_KEY_ID: "k9" }).ok).toBe(false);
  });
});
