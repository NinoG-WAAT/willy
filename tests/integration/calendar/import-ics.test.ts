import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryCalendarImportRepository } from "../../../src/adapters/calendar/in-memory-import-repository";
import { SqliteMeetingCatalog } from "../../../src/adapters/sqlite/meeting-catalog";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { confirmIcsImport, previewIcs } from "../../../src/app/calendar/import-ics";
import { ICS_LIMITS } from "../../../src/domain/calendar/ics";
import { count, freshDb, owner } from "../../support/db-fixtures";

const FIXTURE = readFileSync(join(__dirname, "../../fixtures/ics/outlook-week.ics"), "utf8");
const ZONE = "Europe/Paris";

function setup() {
  let n = 0;
  const repo = createInMemoryCalendarImportRepository(() => `meeting-${String(++n)}`);
  return { repo, deps: { repo } };
}

function preview(text = FIXTURE) {
  const result = previewIcs({ text, floatingZone: ZONE });
  if (!result.ok) throw new Error(`rejected: ${result.error.code}`);
  return result.value;
}

const importable = (text = FIXTURE) =>
  preview(text)
    .events.filter((e) => !e.cancelled)
    .map((e) => e.event.providerEventId);

describe("previewIcs", () => {
  it("lists what the file holds, and marks cancelled events as not importable", () => {
    const view = preview();
    expect(view.events).toHaveLength(6);
    expect(view.events.filter((e) => e.cancelled).map((e) => e.event.title)).toEqual([
      "Canceled: Budget review",
    ]);
    expect(view.series).toEqual([{ title: "Team standup" }]);
  });

  it("reports a rejected file with a code and no file content", () => {
    const result = previewIcs({ text: "BEGIN:VCALENDAR\nsecret-ish text", floatingZone: ZONE });
    expect(result).toEqual({ ok: false, error: { code: "malformed" } });
  });
});

describe("confirmIcsImport", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  const run = (ownerId: string, selectedIds: string[], text = FIXTURE) =>
    confirmIcsImport(ctx.deps, ownerId, { text, floatingZone: ZONE, selectedIds });

  it("creates one Meeting per selected event under provider ics and nothing else", async () => {
    const ids = importable();
    const result = await run("owner-a", ids.slice(0, 2));
    expect(result).toEqual({ ok: true, value: { created: 2, existing: 0 } });
    const meetings = ctx.repo.meetingsOf("owner-a");
    expect(meetings).toHaveLength(2);
    expect(meetings.every((m) => m.provider === "ics")).toBe(true);
    expect(meetings.map((m) => m.providerEventId).sort()).toEqual(ids.slice(0, 2).sort());
  });

  it("never invents attendees: the stored people are exactly the file's", async () => {
    await run("owner-a", importable());
    const sync = ctx.repo.meetingsOf("owner-a").find((m) => m.title === "Product sync");
    expect(sync?.attendees).toEqual([
      { name: "Camille Martin", email: "camille.martin@example.com" },
      { name: "Noah Bernard", email: "noah.bernard@example.com" },
    ]);
    const offsite = ctx.repo.meetingsOf("owner-a").find((m) => m.title === "Company offsite");
    expect(offsite?.attendees).toEqual([]);
  });

  it("replaying the same file creates no duplicates", async () => {
    const ids = importable();
    await run("owner-a", ids);
    const again = await run("owner-a", ids);
    expect(again).toEqual({ ok: true, value: { created: 0, existing: ids.length } });
    expect(ctx.repo.meetingsOf("owner-a")).toHaveLength(ids.length);
  });

  it("a concurrent double submit still yields one Meeting per event", async () => {
    const ids = importable();
    await Promise.all([run("owner-a", ids), run("owner-a", ids)]);
    expect(ctx.repo.meetingsOf("owner-a")).toHaveLength(ids.length);
  });

  it("updates an event that changed in a newer export instead of adding one", async () => {
    await run("owner-a", importable());
    const changed = FIXTURE.replace(
      "SUMMARY;LANGUAGE=en-us:Product sync",
      "SUMMARY;LANGUAGE=en-us:Product sync (renamed)",
    ).replace(
      "DTSTART;TZID=W. Europe Standard Time:20261103T100000",
      "DTSTART;TZID=W. Europe Standard Time:20261103T110000",
    );
    const second = await run("owner-a", importable(changed), changed);
    expect(second.ok && second.value.created).toBe(0);
    const meetings = ctx.repo.meetingsOf("owner-a");
    expect(meetings.filter((m) => m.title.startsWith("Product sync"))).toEqual([
      expect.objectContaining({
        title: "Product sync (renamed)",
        startsAt: "2026-11-03T10:00:00.000Z",
        timezone: "Europe/Berlin",
      }),
    ]);
  });

  it("imports only the selected events", async () => {
    const ids = importable();
    await run("owner-a", [ids[0] ?? ""]);
    expect(ctx.repo.meetingsOf("owner-a")).toHaveLength(1);
  });

  it("refuses an empty selection", async () => {
    expect(await run("owner-a", [])).toEqual({ ok: false, error: { code: "none_selected" } });
    expect(ctx.repo.meetingsOf("owner-a")).toEqual([]);
  });

  it("refuses a selection naming an event the file does not hold, and writes nothing", async () => {
    const ids = importable();
    const result = await run("owner-a", [ids[0] ?? "", "forged-event-id"]);
    expect(result).toEqual({ ok: false, error: { code: "unknown_selection" } });
    expect(ctx.repo.meetingsOf("owner-a")).toEqual([]);
  });

  it("refuses to import a cancelled event even if the form names it", async () => {
    const cancelled = preview().events.find((e) => e.cancelled)?.event.providerEventId ?? "";
    expect(await run("owner-a", [cancelled])).toEqual({
      ok: false,
      error: { code: "unknown_selection" },
    });
    expect(ctx.repo.meetingsOf("owner-a")).toEqual([]);
  });

  it("does not import the recurring series master, even when its UID is named", async () => {
    const master = "040000008200E00074C5B7101A82E00800000000CAFEBABE0123456789ABCDEF01234567";
    expect(await run("owner-a", [master])).toEqual({
      ok: false,
      error: { code: "unknown_selection" },
    });
  });

  it("refuses more selected ids than a file may hold", async () => {
    const ids = Array.from({ length: ICS_LIMITS.maxEvents + 1 }, (_, i) => `id-${String(i)}`);
    expect(await run("owner-a", ids)).toEqual({ ok: false, error: { code: "too_many_selected" } });
  });

  it("collapses a repeated id in the selection", async () => {
    const id = importable()[0] ?? "";
    expect(await run("owner-a", [id, id, id])).toEqual({
      ok: true,
      value: { created: 1, existing: 0 },
    });
  });

  it("rejects a bad file at confirm time exactly as at preview time", async () => {
    const result = await run("owner-a", ["x"], "not a calendar");
    expect(result).toEqual({ ok: false, error: { code: "not_ics" } });
  });

  describe("owner scoping", () => {
    it("owner B importing the same file gets their own Meetings and never touches owner A's", async () => {
      const ids = importable();
      await run("owner-a", ids);
      const b = await run("owner-b", ids);
      expect(b).toEqual({ ok: true, value: { created: ids.length, existing: 0 } });
      const aIds = ctx.repo.meetingsOf("owner-a").map((m) => m.id);
      const bIds = ctx.repo.meetingsOf("owner-b").map((m) => m.id);
      expect(bIds.filter((id) => aIds.includes(id))).toEqual([]);
    });

    it("a meeting id of another owner is just an unknown selection (guessed id)", async () => {
      await run("owner-a", importable());
      const aMeeting = ctx.repo.meetingsOf("owner-a")[0]?.id ?? "";
      const result = await run("owner-b", [aMeeting]);
      expect(result).toEqual({ ok: false, error: { code: "unknown_selection" } });
      expect(ctx.repo.meetingsOf("owner-b")).toEqual([]);
    });

    it("owner B re-importing an edited copy does not change owner A's Meeting", async () => {
      await run("owner-a", importable());
      const edited = FIXTURE.replace(
        "SUMMARY;LANGUAGE=en-us:Product sync",
        "SUMMARY;LANGUAGE=en-us:Hijacked",
      );
      await run("owner-b", importable(edited), edited);
      expect(ctx.repo.meetingsOf("owner-a").map((m) => m.title)).toContain("Product sync");
      expect(ctx.repo.meetingsOf("owner-a").map((m) => m.title)).not.toContain("Hijacked");
    });
  });
});

describe("confirmIcsImport against the SQLite catalog (D1 semantics)", () => {
  let db: DatabaseSync;
  let catalog: SqliteMeetingCatalog;

  beforeEach(() => {
    db = freshDb();
    owner(db, "A");
    owner(db, "B");
    catalog = new SqliteMeetingCatalog(
      db,
      new SequentialIds("id"),
      new FixedClock(new Date("2026-10-29T09:00:00.000Z")),
    );
  });

  const run = (ownerId: string, text = FIXTURE) =>
    confirmIcsImport({ repo: catalog }, ownerId, {
      text,
      floatingZone: ZONE,
      selectedIds: importable(text),
    });

  it("stores provider ics with the stable event id and the IANA zone next to the instant", async () => {
    await run("A");
    const row = db
      .prepare(
        "SELECT calendar_provider, provider_event_id, timezone, scheduled_start_at, status FROM meeting WHERE title = 'Product sync'",
      )
      .get();
    expect(row?.["provider_event_id"]).toMatch(
      /^040000008200E00074C5B7101A82E00800000000A1B2C3D4E5F6A7B8/,
    );
    expect(row).toMatchObject({
      calendar_provider: "ics",
      provider_event_id: preview().events.find((e) => e.event.title === "Product sync")?.event
        .providerEventId,
      timezone: "Europe/Berlin",
      scheduled_start_at: "2026-11-03T09:00:00.000Z",
      status: "scheduled",
    });
  });

  it("replay creates no duplicate rows, and the unique index holds per owner", async () => {
    await run("A");
    const first = count(db, "meeting", "owner_id = 'A'");
    await run("A");
    await run("B");
    expect(count(db, "meeting", "owner_id = 'A'")).toBe(first);
    expect(count(db, "meeting", "owner_id = 'B'")).toBe(first);
  });

  it("an update refreshes calendar-owned fields but keeps the owner's rough notes", async () => {
    await run("A");
    db.prepare("UPDATE meeting SET rough_notes = 'my notes' WHERE title = 'Product sync'").run();
    const changed = FIXTURE.replace(
      "SUMMARY;LANGUAGE=en-us:Product sync",
      "SUMMARY;LANGUAGE=en-us:Product sync v2",
    );
    await run("A", changed);
    expect(
      db.prepare("SELECT title, rough_notes FROM meeting WHERE rough_notes IS NOT NULL").get(),
    ).toMatchObject({
      title: "Product sync v2",
      rough_notes: "my notes",
    });
    expect(count(db, "meeting", "owner_id = 'A'")).toBe(importable().length);
  });
});
