import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteMeetingCatalog } from "../../../src/adapters/sqlite/meeting-catalog";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import type { NewMeetingRecord } from "../../../src/ports/meeting-creation";
import { makeEvent } from "../../support/calendar-fixtures";
import {
  attendee,
  count,
  folder,
  freshDb,
  insert,
  meeting,
  note,
  owner,
  T0,
} from "../../support/db-fixtures";

let db: DatabaseSync;
let catalog: SqliteMeetingCatalog;

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  owner(db, "B");
  catalog = new SqliteMeetingCatalog(
    db,
    new SequentialIds("id"),
    new FixedClock(new Date("2026-10-27T09:00:00.000Z")),
  );
});

const record = (overrides: Partial<NewMeetingRecord> = {}): NewMeetingRecord => ({
  title: "Weekly sync",
  startsAt: "2026-11-03T08:00:00.000Z",
  endsAt: "2026-11-03T08:30:00.000Z",
  timezone: "Europe/Paris",
  agenda: "Roadmap",
  templateId: null,
  attendees: [
    { name: "Ada", email: "ada@example.com" },
    { name: "Alan", email: null },
  ],
  ...overrides,
});

describe("create", () => {
  it("stores the meeting as scheduled with attendees, an audit event and no consent", async () => {
    const created = await catalog.create("A", record(), "key-1");
    expect(created).toEqual({ meetingId: "id-1", created: true });
    const row = db.prepare("SELECT * FROM meeting WHERE id = ?").get("id-1");
    expect(row).toMatchObject({
      owner_id: "A",
      status: "scheduled",
      title: "Weekly sync",
      timezone: "Europe/Paris",
      scheduled_start_at: "2026-11-03T08:00:00.000Z",
      consent_confirmed_at: null,
      calendar_provider: null,
    });
    expect(count(db, "attendee", "meeting_id = 'id-1' AND owner_id = 'A'")).toBe(2);
    expect(count(db, "audit_event", "meeting_id = 'id-1' AND kind = 'meeting.created'")).toBe(1);
  });

  it("is idempotent per submission key: a double submit yields one meeting", async () => {
    const first = await catalog.create("A", record(), "key-1");
    const second = await catalog.create("A", record({ title: "Different" }), "key-1");
    expect(second).toEqual({ meetingId: first.meetingId, created: false });
    expect(count(db, "meeting")).toBe(1);
    expect(count(db, "attendee")).toBe(2);
  });

  it("scopes submission keys per owner", async () => {
    await catalog.create("A", record(), "same-key");
    const other = await catalog.create("B", record(), "same-key");
    expect(other.created).toBe(true);
    expect(count(db, "meeting")).toBe(2);
  });

  it("stores a template the owner owns and refuses another owner's template", async () => {
    insert(db, "template", {
      id: "tb",
      owner_id: "B",
      name: "Bens",
      sections_json: "[]",
      created_at: T0,
      updated_at: T0,
    });
    await expect(catalog.create("A", record({ templateId: "tb" }), "k")).rejects.toThrow();
    expect(count(db, "meeting")).toBe(0);
    expect(count(db, "idempotency_key")).toBe(0);
  });
});

describe("list", () => {
  it("returns only the owner's meetings with counts, consent and note context", async () => {
    folder(db, "A", "f1", { name: "Board" });
    meeting(db, "A", "m1", {
      title: "Published one",
      status: "published",
      consent_confirmed_at: T0,
      consent_statement_version: 1,
    });
    attendee(db, "A", "m1", "a1");
    attendee(db, "A", "m1", "a2");
    note(db, "A", "m1", "n1", { status: "published", published_at: T0, folder_id: "f1" });
    meeting(db, "B", "mb", { title: "Bens secret" });

    const items = await catalog.list("A", { folderId: null, includeArchived: false });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "m1",
      title: "Published one",
      status: "published",
      attendeeCount: 2,
      folderName: "Board",
      noteStatus: "published",
      consentConfirmedAt: T0,
    });
    expect(JSON.stringify(items)).not.toContain("Bens secret");
  });

  it("hides meetings being deleted or deleted, and archived ones unless asked", async () => {
    meeting(db, "A", "live");
    meeting(db, "A", "gone", { status: "deleting" });
    meeting(db, "A", "arch", { status: "archived", status_before_archive: "scheduled" });
    const ids = async (includeArchived: boolean) =>
      (await catalog.list("A", { folderId: null, includeArchived })).map((m) => m.id).sort();
    expect(await ids(false)).toEqual(["live"]);
    expect(await ids(true)).toEqual(["arch", "live"]);
  });

  it("filters by folder, and another owner's folder id yields nothing", async () => {
    folder(db, "A", "f1");
    folder(db, "B", "fb");
    meeting(db, "A", "m1", {
      status: "published",
      consent_confirmed_at: T0,
      consent_statement_version: 1,
    });
    note(db, "A", "m1", "n1", { status: "published", published_at: T0, folder_id: "f1" });
    meeting(db, "A", "m2");
    expect(
      (await catalog.list("A", { folderId: "f1", includeArchived: false })).map((m) => m.id),
    ).toEqual(["m1"]);
    expect(await catalog.list("A", { folderId: "fb", includeArchived: false })).toEqual([]);
  });

  it("orders newest start first", async () => {
    meeting(db, "A", "old", { scheduled_start_at: "2026-10-01T09:00:00.000Z" });
    meeting(db, "A", "new", { scheduled_start_at: "2026-12-01T09:00:00.000Z" });
    const ids = (await catalog.list("A", { folderId: null, includeArchived: false })).map(
      (m) => m.id,
    );
    expect(ids).toEqual(["new", "old"]);
  });
});

describe("upsertFromCalendar", () => {
  it("creates a meeting from a calendar event with its attendees", async () => {
    const outcome = await catalog.upsertFromCalendar("A", makeEvent("e1"));
    expect(outcome).toEqual({ meetingId: "id-1", created: true });
    expect(db.prepare("SELECT * FROM meeting WHERE id = 'id-1'").get()).toMatchObject({
      owner_id: "A",
      status: "scheduled",
      calendar_provider: "google",
      provider_event_id: "e1",
      title: "Meeting e1",
      consent_confirmed_at: null,
    });
    expect(count(db, "attendee", "meeting_id = 'id-1'")).toBe(1);
  });

  it("importing the same event twice is one meeting; an update refreshes calendar-owned fields only", async () => {
    await catalog.upsertFromCalendar("A", makeEvent("e1"));
    db.prepare(
      "UPDATE meeting SET rough_notes = 'my notes', agenda = 'my agenda' WHERE id = 'id-1'",
    ).run();
    const again = await catalog.upsertFromCalendar(
      "A",
      makeEvent("e1", {
        title: "Renamed",
        startsAt: "2026-11-05T08:00:00.000Z",
        endsAt: "2026-11-05T09:00:00.000Z",
      }),
    );
    expect(again).toEqual({ meetingId: "id-1", created: false });
    expect(count(db, "meeting")).toBe(1);
    expect(db.prepare("SELECT * FROM meeting WHERE id = 'id-1'").get()).toMatchObject({
      title: "Renamed",
      scheduled_start_at: "2026-11-05T08:00:00.000Z",
      rough_notes: "my notes",
      agenda: "my agenda",
    });
  });

  it("adds new attendees but never removes or duplicates existing ones", async () => {
    await catalog.upsertFromCalendar("A", makeEvent("e1"));
    await catalog.upsertFromCalendar(
      "A",
      makeEvent("e1", {
        attendees: [
          { name: "Ada Lovelace", email: "ada@example.com" },
          { name: "Grace", email: "grace@example.com" },
          { name: "Alan", email: null },
        ],
      }),
    );
    await catalog.upsertFromCalendar(
      "A",
      makeEvent("e1", { attendees: [{ name: "Alan", email: null }] }),
    );
    const names = db
      .prepare("SELECT name FROM attendee WHERE meeting_id = 'id-1' ORDER BY name")
      .all()
      .map((r) => r["name"]);
    expect(names).toEqual(["Ada Lovelace", "Alan", "Grace"]);
  });

  it("keeps owners separate even when provider event ids collide", async () => {
    await catalog.upsertFromCalendar("A", makeEvent("same", { title: "A's" }));
    const b = await catalog.upsertFromCalendar("B", makeEvent("same", { title: "B's" }));
    expect(b.created).toBe(true);
    expect(count(db, "meeting", "owner_id = 'A' AND title = 'A''s'")).toBe(1);
    expect(count(db, "meeting", "owner_id = 'B' AND title = 'B''s'")).toBe(1);
  });

  it("never changes a meeting that is being deleted", async () => {
    await catalog.upsertFromCalendar("A", makeEvent("e1"));
    db.prepare("UPDATE meeting SET status = 'deleting' WHERE id = 'id-1'").run();
    const again = await catalog.upsertFromCalendar("A", makeEvent("e1", { title: "Renamed" }));
    expect(again).toEqual({ meetingId: "id-1", created: false });
    expect(db.prepare("SELECT title FROM meeting WHERE id = 'id-1'").get()).toMatchObject({
      title: "Meeting e1",
    });
  });
});
