import { describe, expect, it } from "vitest";
import { createFixtureCalendarSource } from "../../../src/adapters/calendar/fixture-calendar-source";
import { normalizeCalendarEvent } from "../../../src/domain/calendar/event";

const NOW = new Date("2026-11-03T10:15:00.000Z");
const range = { from: "2026-11-02T00:00:00.000Z", to: "2026-11-30T00:00:00.000Z" };

describe("fixture calendar source (development stand-in)", () => {
  it("offers the same deterministic demo events to every owner, with stable ids", async () => {
    const source = createFixtureCalendarSource({ now: () => NOW, downOwners: [] });
    const a = await source.listEvents("owner-a", range);
    const b = await source.listEvents("owner-b", range);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.length).toBeGreaterThanOrEqual(2);
    expect(a.value.map((e) => e.providerEventId)).toEqual(b.value.map((e) => e.providerEventId));
    expect(a.value.every((e) => e.providerEventId.startsWith("fake-"))).toBe(true);
  });

  it("only returns events that are valid calendar events inside the requested range, in the future", async () => {
    const source = createFixtureCalendarSource({ now: () => NOW, downOwners: [] });
    const result = await source.listEvents("owner-a", range);
    if (!result.ok) throw new Error("unexpected failure");
    for (const event of result.value) {
      expect(normalizeCalendarEvent(event).ok).toBe(true);
      expect(Date.parse(event.startsAt)).toBeGreaterThan(NOW.getTime());
    }
    const none = await source.listEvents("owner-a", {
      from: "2020-01-01T00:00:00.000Z",
      to: "2020-02-01T00:00:00.000Z",
    });
    expect(none).toEqual({ ok: true, value: [] });
  });

  it("is labelled as a demo calendar so it cannot be mistaken for real data", async () => {
    const source = createFixtureCalendarSource({ now: () => NOW, downOwners: [] });
    const result = await source.listEvents("owner-a", range);
    expect(result.ok && result.value.every((e) => e.title.includes("(demo)"))).toBe(true);
  });

  it("simulates a provider outage for configured owners only", async () => {
    const source = createFixtureCalendarSource({ now: () => NOW, downOwners: ["owner-b"] });
    const down = await source.listEvents("owner-b", range);
    expect(down).toMatchObject({ ok: false, error: { kind: "unavailable", retryable: true } });
    expect((await source.listEvents("owner-a", range)).ok).toBe(true);
  });
});
