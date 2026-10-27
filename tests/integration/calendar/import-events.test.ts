import { describe, expect, it } from "vitest";
import { createFakeCalendarSource } from "../../../src/adapters/calendar/fake-calendar-source";
import { createInMemoryCalendarImportRepository } from "../../../src/adapters/calendar/in-memory-import-repository";
import { importCalendarEvents } from "../../../src/app/calendar/import-events";
import { RANGE, makeEvent } from "../../support/calendar-fixtures";

function setup() {
  const calendar = createFakeCalendarSource();
  let n = 0;
  const repo = createInMemoryCalendarImportRepository(() => `meeting-${String(++n)}`);
  const sleeps: number[] = [];
  const deps = {
    calendar,
    repo,
    retry: {
      policy: { maxAttempts: 3, baseMs: 10, capMs: 100 },
      sleep: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0,
    },
  };
  return { calendar, repo, deps, sleeps };
}

describe("importCalendarEvents", () => {
  it("creates one meeting per event", async () => {
    const { calendar, repo, deps } = setup();
    calendar.seed("owner-a", [makeEvent("e1"), makeEvent("e2")]);
    const result = await importCalendarEvents(deps, "owner-a", RANGE);
    expect(result).toEqual({ ok: true, value: { created: 2, existing: 0 } });
    expect(repo.meetingsOf("owner-a")).toHaveLength(2);
  });

  it("importing the same event twice yields exactly one meeting", async () => {
    const { calendar, repo, deps } = setup();
    calendar.seed("owner-a", [makeEvent("e1")]);
    await importCalendarEvents(deps, "owner-a", RANGE);
    const second = await importCalendarEvents(deps, "owner-a", RANGE);
    expect(second).toEqual({ ok: true, value: { created: 0, existing: 1 } });
    expect(repo.meetingsOf("owner-a")).toHaveLength(1);
  });

  it("concurrent double submit still yields one meeting", async () => {
    const { calendar, repo, deps } = setup();
    calendar.seed("owner-a", [makeEvent("e1")]);
    await Promise.all([
      importCalendarEvents(deps, "owner-a", RANGE),
      importCalendarEvents(deps, "owner-a", RANGE),
    ]);
    expect(repo.meetingsOf("owner-a")).toHaveLength(1);
  });

  it("keeps owners isolated even when provider event ids collide", async () => {
    const { calendar, repo, deps } = setup();
    calendar.seed("owner-a", [makeEvent("same-id", { title: "A's meeting" })]);
    calendar.seed("owner-b", [makeEvent("same-id", { title: "B's meeting" })]);
    await importCalendarEvents(deps, "owner-a", RANGE);
    await importCalendarEvents(deps, "owner-b", RANGE);
    expect(repo.meetingsOf("owner-a").map((m) => m.title)).toEqual(["A's meeting"]);
    expect(repo.meetingsOf("owner-b").map((m) => m.title)).toEqual(["B's meeting"]);
  });

  it("does not touch rough notes or consent when re-importing an updated event", async () => {
    const { calendar, repo, deps } = setup();
    calendar.seed("owner-a", [makeEvent("e1", { title: "Old title" })]);
    await importCalendarEvents(deps, "owner-a", RANGE);
    calendar.seed("owner-a", [makeEvent("e1", { title: "New title" })]);
    await importCalendarEvents(deps, "owner-a", RANGE);
    const [meeting] = repo.meetingsOf("owner-a");
    expect(meeting?.title).toBe("New title");
    expect(Object.keys(meeting ?? {}).sort()).toEqual(
      [
        "attendees",
        "endsAt",
        "id",
        "provider",
        "providerEventId",
        "startsAt",
        "timezone",
        "title",
      ].sort(),
    );
  });

  it("retries transient provider failures then succeeds", async () => {
    const { calendar, repo, deps, sleeps } = setup();
    calendar.seed("owner-a", [makeEvent("e1")]);
    calendar.failNext("unavailable", 2);
    const result = await importCalendarEvents(deps, "owner-a", RANGE);
    expect(result.ok).toBe(true);
    expect(sleeps).toHaveLength(2);
    expect(repo.meetingsOf("owner-a")).toHaveLength(1);
  });

  it("surfaces a provider rejection immediately and imports nothing", async () => {
    const { calendar, repo, deps, sleeps } = setup();
    calendar.seed("owner-a", [makeEvent("e1")]);
    calendar.failNext("rejected");
    const result = await importCalendarEvents(deps, "owner-a", RANGE);
    expect(!result.ok && result.error.kind).toBe("rejected");
    expect(sleeps).toEqual([]);
    expect(repo.meetingsOf("owner-a")).toHaveLength(0);
  });

  it("surfaces exhausted retries as the last provider error", async () => {
    const { calendar, deps } = setup();
    calendar.failNext("timeout", 10);
    const result = await importCalendarEvents(deps, "owner-a", RANGE);
    expect(!result.ok && result.error.kind).toBe("timeout");
  });
});
