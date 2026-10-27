import { describe, expect, it } from "vitest";
import { createGoogleCalendarSource } from "../../../src/adapters/calendar/google-calendar-source";
import type { CalendarEvent } from "../../../src/domain/calendar/event";
import { providerError } from "../../../src/domain/platform/provider-error";
import { ok } from "../../../src/domain/platform/result";
import { RANGE, makeEvent } from "../../support/calendar-fixtures";
import { calendarSourceContract } from "./calendar-source.contract";

type FetchLike = typeof fetch;

interface Call {
  url: URL;
  init: RequestInit | undefined;
}

/** Stub Google Calendar API. Never touches the network. */
function createStubGoogle() {
  const calendars = new Map<string, CalendarEvent[]>();
  const calls: Call[] = [];
  let failure: "timeout" | "rate_limited" | "unavailable" | "rejected" | null = null;
  let override: ((url: URL) => Response) | null = null;

  const toGoogle = (e: CalendarEvent) => ({
    id: e.providerEventId,
    status: "confirmed",
    summary: e.title,
    start: { dateTime: e.startsAt, timeZone: e.timezone },
    end: { dateTime: e.endsAt, timeZone: e.timezone },
    attendees: e.attendees.map((a) => ({ displayName: a.name, ...(a.email ? { email: a.email } : {}) })),
  });

  const fetchStub: FetchLike = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, init });
    if (failure === "timeout") {
      failure = null;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }
    if (failure) {
      const status = { rate_limited: 429, unavailable: 503, rejected: 403 }[failure];
      failure = null;
      return Promise.resolve(new Response('{"error":{"message":"secret-detail"}}', { status }));
    }
    if (override) return Promise.resolve(override(url));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const owner = auth.replace("Bearer token-", "");
    const timeMin = Date.parse(url.searchParams.get("timeMin") ?? "");
    const timeMax = Date.parse(url.searchParams.get("timeMax") ?? "");
    const items = (calendars.get(owner) ?? [])
      .filter((e) => Date.parse(e.startsAt) >= timeMin && Date.parse(e.startsAt) < timeMax)
      .map(toGoogle);
    return Promise.resolve(Response.json({ items, timeZone: "Europe/Paris" }));
  };

  return {
    fetch: fetchStub,
    calls,
    seed: (owner: string, events: CalendarEvent[]) => void calendars.set(owner, events),
    failNext: (kind: NonNullable<typeof failure>) => void (failure = kind),
    respondWith: (fn: (url: URL) => Response) => void (override = fn),
  };
}

function build(timeoutMs = 50) {
  const stub = createStubGoogle();
  const source = createGoogleCalendarSource({
    fetch: stub.fetch,
    credentials: { getAccessToken: (ownerId) => Promise.resolve(ok(`token-${ownerId}`)) },
    timeoutMs,
  });
  return { stub, source };
}

calendarSourceContract("google adapter against stubbed API", () => {
  const { stub, source } = build();
  return { source, seed: stub.seed, failNext: stub.failNext };
});

describe("google calendar source specifics", () => {
  it("only calls the Google API host over https, with the bearer token and no redirect following", async () => {
    const { stub, source } = build();
    stub.seed("owner-a", [makeEvent("x")]);
    await source.listEvents("owner-a", RANGE);
    const call = stub.calls[0]!;
    expect(call.url.protocol).toBe("https:");
    expect(call.url.hostname).toBe("www.googleapis.com");
    expect(call.url.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(call.url.searchParams.get("singleEvents")).toBe("true");
    expect(call.init?.redirect).toBe("manual");
    expect(new Headers(call.init?.headers).get("authorization")).toBe("Bearer token-owner-a");
  });

  it("treats a redirect response as a rejection instead of following it", async () => {
    const { stub, source } = build();
    stub.respondWith(() => new Response(null, { status: 302, headers: { location: "https://evil.test/" } }));
    const result = await source.listEvents("owner-a", RANGE);
    expect(!result.ok && result.error.kind).toBe("rejected");
  });

  it("skips cancelled and all-day events and falls back to the calendar time zone", async () => {
    const { stub, source } = build();
    stub.respondWith(() =>
      Response.json({
        timeZone: "America/New_York",
        items: [
          { id: "cancelled", status: "cancelled" },
          { id: "all-day", status: "confirmed", summary: "Holiday", start: { date: "2026-11-11" }, end: { date: "2026-11-12" } },
          {
            id: "ok",
            status: "confirmed",
            summary: "Real one",
            start: { dateTime: "2026-11-03T09:00:00-05:00" },
            end: { dateTime: "2026-11-03T10:00:00-05:00" },
            attendees: [
              { email: "room@resource.example.com", resource: true },
              { email: "ada@example.com", displayName: "Ada" },
            ],
          },
        ],
      }),
    );
    const result = await source.listEvents("owner-a", RANGE);
    expect(result.ok && result.value).toEqual([
      {
        provider: "google",
        providerEventId: "ok",
        title: "Real one",
        startsAt: "2026-11-03T14:00:00.000Z",
        endsAt: "2026-11-03T15:00:00.000Z",
        timezone: "America/New_York",
        attendees: [{ name: "Ada", email: "ada@example.com" }],
      },
    ]);
  });

  it("follows pagination with a bounded number of pages", async () => {
    const { stub, source } = build();
    stub.respondWith((url) => {
      const page = Number(url.searchParams.get("pageToken") ?? "0");
      return Response.json({
        timeZone: "UTC",
        items: [
          {
            id: `e${page}`,
            status: "confirmed",
            summary: `E${page}`,
            start: { dateTime: "2026-11-03T09:00:00Z" },
            end: { dateTime: "2026-11-03T10:00:00Z" },
          },
        ],
        nextPageToken: String(page + 1),
      });
    });
    const result = await source.listEvents("owner-a", RANGE);
    expect(result.ok && result.value.length).toBe(5);
    expect(stub.calls).toHaveLength(5);
  });

  it("reports malformed provider payloads as unavailable and malformed events as dropped", async () => {
    const { stub, source } = build();
    stub.respondWith(() => new Response("<html>oops</html>", { status: 200 }));
    const bad = await source.listEvents("owner-a", RANGE);
    expect(!bad.ok && bad.error.kind).toBe("unavailable");

    stub.respondWith(() =>
      Response.json({
        items: [
          { id: "bad-tz", status: "confirmed", summary: "x", start: { dateTime: "2026-11-03T09:00:00Z", timeZone: "Nope/Zone" }, end: { dateTime: "2026-11-03T10:00:00Z" } },
          { id: "good", status: "confirmed", summary: "y", start: { dateTime: "2026-11-03T09:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-11-03T10:00:00Z" } },
        ],
      }),
    );
    const mixed = await source.listEvents("owner-a", RANGE);
    expect(mixed.ok && mixed.value.map((e) => e.providerEventId)).toEqual(["good"]);
  });

  it("times out when the provider hangs", async () => {
    const { stub, source } = build(20);
    stub.failNext("timeout");
    const started = Date.now();
    const result = await source.listEvents("owner-a", RANGE);
    expect(!result.ok && result.error.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("passes credential failures through without calling the API", async () => {
    const stub = createStubGoogle();
    const source = createGoogleCalendarSource({
      fetch: stub.fetch,
      credentials: { getAccessToken: () => Promise.resolve({ ok: false, error: providerError("rejected", "not connected") }) },
      timeoutMs: 50,
    });
    const result = await source.listEvents("owner-a", RANGE);
    expect(!result.ok && result.error.message).toBe("not connected");
    expect(stub.calls).toHaveLength(0);
  });

  it("never leaks the token or response body into error messages", async () => {
    const { stub, source } = build();
    stub.failNext("rejected");
    const result = await source.listEvents("owner-a", RANGE);
    const message = JSON.stringify(result);
    expect(message).not.toContain("token-owner-a");
    expect(message).not.toContain("secret-detail");
  });
});
