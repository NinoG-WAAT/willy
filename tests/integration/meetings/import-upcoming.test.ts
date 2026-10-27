import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createFixtureCalendarSource } from "../../../src/adapters/calendar/fixture-calendar-source";
import { SqliteMeetingCatalog } from "../../../src/adapters/sqlite/meeting-catalog";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { importUpcomingEvents } from "../../../src/app/calendar/import-upcoming";
import type { ImportDeps } from "../../../src/app/calendar/import-events";
import { count, freshDb, owner } from "../../support/db-fixtures";

const NOW = new Date("2026-11-03T10:15:00.000Z");

let db: DatabaseSync;
let sleeps: number[];
let ids: SequentialIds;

function depsFor(downOwners: string[] = []): ImportDeps {
  return {
    calendar: createFixtureCalendarSource({ now: () => NOW, downOwners }),
    repo: new SqliteMeetingCatalog(db, ids, new FixedClock(NOW)),
    retry: {
      policy: { maxAttempts: 3, baseMs: 10, capMs: 50 },
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0,
    },
  };
}

beforeEach(() => {
  db = freshDb();
  sleeps = [];
  ids = new SequentialIds("id");
  owner(db, "A");
  owner(db, "B");
});

describe("importUpcomingEvents", () => {
  it("imports the calendar's upcoming events as scheduled meetings", async () => {
    const result = await importUpcomingEvents(depsFor(), "A", NOW);
    expect(result).toEqual({ ok: true, value: { created: 2, existing: 0 } });
    expect(count(db, "meeting", "owner_id = 'A' AND status = 'scheduled'")).toBe(2);
    expect(count(db, "meeting", "owner_id = 'B'")).toBe(0);
  });

  it("repeating the import (double click, refresh) never duplicates a meeting", async () => {
    const deps = depsFor();
    await importUpcomingEvents(deps, "A", NOW);
    const again = await importUpcomingEvents(deps, "A", NOW);
    expect(again).toEqual({ ok: true, value: { created: 0, existing: 2 } });
    expect(count(db, "meeting")).toBe(2);
  });

  it("two owners importing the same demo events each get their own meetings", async () => {
    await importUpcomingEvents(depsFor(), "A", NOW);
    await importUpcomingEvents(depsFor(), "B", NOW);
    expect(count(db, "meeting", "owner_id = 'A'")).toBe(2);
    expect(count(db, "meeting", "owner_id = 'B'")).toBe(2);
  });

  it("reports a provider outage after retrying, and imports nothing", async () => {
    const result = await importUpcomingEvents(depsFor(["A"]), "A", NOW);
    expect(result).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    expect(sleeps).toHaveLength(2);
    expect(count(db, "meeting")).toBe(0);
  });
});
