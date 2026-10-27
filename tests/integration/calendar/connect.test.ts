import { describe, expect, it } from "vitest";
import { defined } from "../../support/assert";
import { beginCalendarConnect, completeCalendarConnect } from "../../../src/app/calendar/connect";
import { ok, type Result } from "../../../src/domain/platform/result";
import { providerError, type ProviderError } from "../../../src/domain/platform/provider-error";

function stateOf(begin: Result<{ authorizationUrl: string }, unknown>): string {
  return defined(
    new URL(begin.ok ? begin.value.authorizationUrl : "https://invalid.test").searchParams.get(
      "state",
    ),
    "state",
  );
}

const redirectUri = "https://willy.example.com/oauth/calendar/callback";
const NOW = new Date("2026-11-01T10:00:00Z");

function setup(exchange: () => Result<void, ProviderError> = () => ok(undefined)) {
  const exchanged: string[] = [];
  const deps = {
    clientId: "cid",
    stateSecret: "state-secret",
    redirectAllowlist: [redirectUri],
    now: () => NOW,
    newNonce: () => "nonce-1",
    credentials: {
      exchangeCode: (ownerId: string, code: string) => {
        exchanged.push(`${ownerId}:${code}`);
        return Promise.resolve(exchange());
      },
    },
  };
  return { deps, exchanged };
}

describe("calendar connect (OAuth)", () => {
  it("begins with an owner-bound state and an allowlisted redirect", async () => {
    const { deps } = setup();
    const result = await beginCalendarConnect(deps, "owner-a", redirectUri);
    expect(result.ok).toBe(true);
    const url = new URL(result.ok ? result.value.authorizationUrl : "");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("refuses a redirect URI outside the allowlist", async () => {
    const { deps } = setup();
    const result = await beginCalendarConnect(deps, "owner-a", "https://evil.test/cb");
    expect(result).toEqual({ ok: false, error: { reason: "redirect_not_allowed" } });
  });

  it("completes with a valid state and exchanges the code for the session owner", async () => {
    const { deps, exchanged } = setup();
    const begin = await beginCalendarConnect(deps, "owner-a", redirectUri);
    const state = stateOf(begin);
    const done = await completeCalendarConnect(deps, "owner-a", { code: "c1", state, redirectUri });
    expect(done).toEqual({ ok: true, value: undefined });
    expect(exchanged).toEqual(["owner-a:c1"]);
  });

  it("rejects a callback whose state was minted for another owner (CSRF / login-swap)", async () => {
    const { deps, exchanged } = setup();
    const begin = await beginCalendarConnect(deps, "owner-a", redirectUri);
    const state = stateOf(begin);
    const done = await completeCalendarConnect(deps, "owner-b", { code: "c1", state, redirectUri });
    expect(done).toEqual({ ok: false, error: { reason: "invalid_state" } });
    expect(exchanged).toEqual([]);
  });

  it("rejects missing, forged and expired state", async () => {
    const { deps, exchanged } = setup();
    const missing = await completeCalendarConnect(deps, "owner-a", {
      code: "c",
      state: "",
      redirectUri,
    });
    expect(missing).toEqual({ ok: false, error: { reason: "invalid_state" } });
    const begin = await beginCalendarConnect(deps, "owner-a", redirectUri);
    const state = stateOf(begin);
    const late = { ...deps, now: () => new Date(NOW.getTime() + 11 * 60_000) };
    expect(
      await completeCalendarConnect(late, "owner-a", { code: "c", state, redirectUri }),
    ).toEqual({
      ok: false,
      error: { reason: "invalid_state" },
    });
    expect(exchanged).toEqual([]);
  });

  it("rejects a callback redirect URI outside the allowlist before exchanging", async () => {
    const { deps, exchanged } = setup();
    const done = await completeCalendarConnect(deps, "owner-a", {
      code: "c",
      state: "x",
      redirectUri: "https://evil.test/cb",
    });
    expect(done).toEqual({ ok: false, error: { reason: "redirect_not_allowed" } });
    expect(exchanged).toEqual([]);
  });

  it("surfaces a provider failure from the exchange", async () => {
    const failing = setup(() => ({ ok: false, error: providerError("rejected", "bad code") }));
    const begin = await beginCalendarConnect(failing.deps, "owner-a", redirectUri);
    const state = stateOf(begin);
    const done = await completeCalendarConnect(failing.deps, "owner-a", {
      code: "c",
      state,
      redirectUri,
    });
    expect(!done.ok && done.error.reason).toBe("exchange_failed");
  });
});
