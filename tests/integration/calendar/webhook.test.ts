import { describe, expect, it } from "vitest";
import {
  createInMemoryCalendarConnections,
  createInMemoryProviderEventStore,
} from "../../../src/adapters/calendar/in-memory-webhook-stores";
import { createInMemoryCalendarImportRepository } from "../../../src/adapters/calendar/in-memory-import-repository";
import { handleCalendarWebhook } from "../../../src/app/calendar/handle-webhook";
import { signWebhook } from "../../../src/domain/calendar/webhook-signature";

const secret = "whsec_test";
const NOW = new Date("2026-11-01T10:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);

const payload = {
  id: "delivery-1",
  type: "event.upserted",
  channelId: "chan-a",
  event: {
    providerEventId: "evt-1",
    title: "Board prep",
    startsAt: "2026-11-03T09:00:00+01:00",
    endsAt: "2026-11-03T10:00:00+01:00",
    timezone: "Europe/Paris",
    attendees: [{ name: "Ada", email: "ada@example.com" }],
  },
};

function setup() {
  let n = 0;
  const repo = createInMemoryCalendarImportRepository(() => `meeting-${++n}`);
  const events = createInMemoryProviderEventStore();
  const connections = createInMemoryCalendarConnections({ "chan-a": "owner-a", "chan-b": "owner-b" });
  const deps = { secret, now: () => NOW, events, connections, repo };
  const send = async (body: unknown, header?: string | null) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const signature = header === undefined ? await signWebhook(secret, nowSec, raw) : header;
    return handleCalendarWebhook(deps, { signatureHeader: signature, rawBody: raw });
  };
  return { repo, events, deps, send };
}

describe("handleCalendarWebhook", () => {
  it("imports the event for the owner resolved from the stored connection", async () => {
    const { repo, send } = setup();
    expect(await send(payload)).toEqual({ status: "processed", meetingId: "meeting-1", created: true });
    expect(repo.meetingsOf("owner-a").map((m) => m.title)).toEqual(["Board prep"]);
    expect(repo.meetingsOf("owner-b")).toEqual([]);
  });

  it("rejects a bad signature without touching anything", async () => {
    const { repo, send } = setup();
    const result = await send(payload, `t=${nowSec},v1=${"0".repeat(64)}`);
    expect(result).toEqual({ status: "rejected", reason: "bad_signature" });
    expect(repo.meetingsOf("owner-a")).toEqual([]);
  });

  it("rejects a missing signature and a stale one", async () => {
    const { send } = setup();
    expect(await send(payload, null)).toEqual({ status: "rejected", reason: "bad_signature" });
    const stale = await signWebhook(secret, nowSec - 3600, JSON.stringify(payload));
    expect(await send(payload, stale)).toEqual({ status: "rejected", reason: "bad_signature" });
  });

  it("deduplicates a redelivered provider event id", async () => {
    const { repo, send } = setup();
    await send(payload);
    expect(await send(payload)).toEqual({ status: "duplicate" });
    expect(repo.meetingsOf("owner-a")).toHaveLength(1);
  });

  it("treats a new delivery of the same calendar event as one meeting", async () => {
    const { repo, send } = setup();
    await send(payload);
    const updated = { ...payload, id: "delivery-2", event: { ...payload.event, title: "Board prep v2" } };
    expect(await send(updated)).toEqual({ status: "processed", meetingId: "meeting-1", created: false });
    expect(repo.meetingsOf("owner-a")).toHaveLength(1);
    expect(repo.meetingsOf("owner-a")[0]?.title).toBe("Board prep v2");
  });

  it("ignores event types it does not act on, still deduplicating them", async () => {
    const { repo, send } = setup();
    expect(await send({ ...payload, type: "event.cancelled" })).toEqual({ status: "ignored" });
    expect(repo.meetingsOf("owner-a")).toEqual([]);
  });

  it.each([
    ["not json", "{nope"],
    ["unknown top-level field", { ...payload, ownerId: "owner-b" }],
    ["missing id", { ...payload, id: undefined }],
    ["invalid event", { ...payload, event: { ...payload.event, timezone: "Mars/Base" } }],
  ])("rejects a malformed payload: %s", async (_label, body) => {
    const { repo, send } = setup();
    expect(await send(body)).toEqual({ status: "rejected", reason: "malformed" });
    expect(repo.meetingsOf("owner-a")).toEqual([]);
  });

  it("rejects an unknown channel and never trusts an owner claimed in the payload", async () => {
    const { repo, send } = setup();
    expect(await send({ ...payload, channelId: "nobody" })).toEqual({ status: "rejected", reason: "unknown_channel" });
    expect(repo.meetingsOf("owner-a")).toEqual([]);
  });

  it("releases the dedupe claim when processing fails so the provider retry succeeds", async () => {
    const { deps, events } = setup();
    const raw = JSON.stringify(payload);
    const header = await signWebhook(secret, nowSec, raw);
    const failing = {
      ...deps,
      repo: {
        upsertFromCalendar: () => Promise.reject(new Error("db down")),
      },
    };
    await expect(handleCalendarWebhook(failing, { signatureHeader: header, rawBody: raw })).rejects.toThrow("db down");
    expect(await events.hasSeen("google", "delivery-1")).toBe(false);
    const retry = await handleCalendarWebhook(deps, { signatureHeader: header, rawBody: raw });
    expect(retry.status).toBe("processed");
  });
});
