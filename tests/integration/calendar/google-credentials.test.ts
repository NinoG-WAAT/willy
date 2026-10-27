import { describe, expect, it } from "vitest";
import { defined } from "../../support/assert";
import { createInMemoryCredentialStore } from "../../../src/adapters/calendar/in-memory-credential-store";
import { createGoogleCredentials } from "../../../src/adapters/calendar/google-credentials";
import { createAesGcmCipher } from "../../../src/adapters/crypto/aes-gcm-cipher";

const key = Buffer.alloc(32, 7).toString("base64");

interface Call {
  url: URL;
  body: URLSearchParams;
}

function setup(respond: (call: Call) => Response | Promise<Response> = defaultResponse) {
  let nowMs = Date.parse("2026-11-01T10:00:00Z");
  const calls: Call[] = [];
  const store = createInMemoryCredentialStore();
  const cipher = createAesGcmCipher({
    keys: { k1: key },
    activeKeyId: "k1",
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  });
  const fetchStub: typeof fetch = async (input, init) => {
    const call = {
      url: new URL(input instanceof Request ? input.url : input.toString()),
      body: new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
    };
    calls.push(call);
    return respond(call);
  };
  const credentials = createGoogleCredentials({
    store,
    cipher,
    fetch: fetchStub,
    clientId: "cid",
    clientSecret: "csecret",
    now: () => new Date(nowMs),
    timeoutMs: 50,
  });
  return { credentials, store, calls, advance: (ms: number) => void (nowMs += ms), cipher };
}

function defaultResponse(call: Call): Response {
  if (call.body.get("grant_type") === "authorization_code") {
    return Response.json({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
    });
  }
  return Response.json({ access_token: "access-2", expires_in: 3600 });
}

describe("google credentials", () => {
  it("exchanges the code over https to the Google token host and stores only ciphertext", async () => {
    const { credentials, store, calls } = setup();
    const result = await credentials.exchangeCode(
      "owner-a",
      "code-xyz",
      "https://willy.example.com/cb",
    );
    expect(result.ok).toBe(true);
    expect(defined(calls[0]).url.href).toBe("https://oauth2.googleapis.com/token");
    expect(defined(calls[0]).body.get("code")).toBe("code-xyz");
    expect(defined(calls[0]).body.get("client_secret")).toBe("csecret");
    const stored = await store.load("owner-a");
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("refresh-1");
    expect(stored).not.toContain("access-1");
  });

  it("returns a cached access token until shortly before expiry", async () => {
    const { credentials, calls, advance } = setup();
    await credentials.exchangeCode("owner-a", "c", "https://willy.example.com/cb");
    expect(await credentials.getAccessToken("owner-a")).toEqual({ ok: true, value: "access-1" });
    expect(calls).toHaveLength(1);
    advance(3600_000 - 30_000);
    expect(await credentials.getAccessToken("owner-a")).toEqual({ ok: true, value: "access-2" });
    expect(calls).toHaveLength(2);
  });

  it("persists the refreshed token (re-encrypted) and keeps the refresh token", async () => {
    const { credentials, store, calls, advance } = setup();
    await credentials.exchangeCode("owner-a", "c", "https://willy.example.com/cb");
    advance(2 * 3600_000);
    await credentials.getAccessToken("owner-a");
    expect(defined(calls[1]).body.get("refresh_token")).toBe("refresh-1");
    expect(defined(calls[1]).body.get("grant_type")).toBe("refresh_token");
    expect(await store.load("owner-a")).not.toContain("access-2");
    advance(5 * 60_000);
    expect(await credentials.getAccessToken("owner-a")).toEqual({ ok: true, value: "access-2" });
    expect(calls).toHaveLength(2);
  });

  it("reports not connected as a rejection without calling Google", async () => {
    const { credentials, calls } = setup();
    const result = await credentials.getAccessToken("owner-a");
    expect(!result.ok && result.error.kind).toBe("rejected");
    expect(calls).toHaveLength(0);
  });

  it("keeps owners separate: another owner never gets someone else's token", async () => {
    const { credentials, store } = setup();
    await credentials.exchangeCode("owner-a", "c", "https://willy.example.com/cb");
    const stolen = await store.load("owner-a");
    await store.save("owner-b", defined(stolen));
    const result = await credentials.getAccessToken("owner-b");
    expect(result.ok).toBe(false);
  });

  it.each([
    [400, "rejected"],
    [429, "rate_limited"],
    [503, "unavailable"],
  ] as const)("normalizes a %i from the token endpoint to %s", async (status, kind) => {
    const { credentials } = setup(
      () => new Response('{"error":"invalid_grant","secret":"leak"}', { status }),
    );
    const result = await credentials.exchangeCode("owner-a", "c", "https://willy.example.com/cb");
    expect(!result.ok && result.error.kind).toBe(kind);
    expect(JSON.stringify(result)).not.toContain("leak");
  });

  it("times out when the token endpoint hangs", async () => {
    const { credentials } = setup(() => new Promise<Response>(() => {}));
    const result = await credentials.exchangeCode("owner-a", "c", "https://willy.example.com/cb");
    expect(!result.ok && result.error.kind).toBe("timeout");
  });

  it("does not follow redirects from the token endpoint", async () => {
    const { credentials } = setup(
      () => new Response(null, { status: 307, headers: { location: "https://evil.test" } }),
    );
    const result = await credentials.exchangeCode("owner-a", "c", "https://willy.example.com/cb");
    expect(!result.ok && result.error.kind).toBe("rejected");
  });

  it("rejects a token response without a refresh token on first exchange", async () => {
    const { credentials } = setup(() => Response.json({ access_token: "a", expires_in: 60 }));
    const result = await credentials.exchangeCode("owner-a", "c", "https://willy.example.com/cb");
    expect(!result.ok && result.error.kind).toBe("rejected");
  });
});
