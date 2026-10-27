import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteFolderRepository } from "../../../src/adapters/sqlite/folder-repository";
import { SqliteMeetingCatalog } from "../../../src/adapters/sqlite/meeting-catalog";
import { SqliteTemplateRepository } from "../../../src/adapters/sqlite/template-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import { createMeeting, type CreateMeetingDeps } from "../../../src/app/meetings/create-meeting";
import { loadMeetingsHome } from "../../../src/app/meetings/home";
import { count, freshDb, insert, owner, T0 } from "../../support/db-fixtures";

let db: DatabaseSync;
let deps: CreateMeetingDeps;
let catalog: SqliteMeetingCatalog;

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  owner(db, "B");
  const clock = new FixedClock(new Date("2026-10-27T09:00:00.000Z"));
  const ids = new SequentialIds("id");
  catalog = new SqliteMeetingCatalog(db, ids, clock);
  deps = {
    creation: catalog,
    notes: {
      folders: new SqliteFolderRepository(db),
      templates: new SqliteTemplateRepository(db),
      clock,
      ids,
    },
  };
});

const form = (overrides: Record<string, unknown> = {}) => ({
  title: "Customer call",
  date: "2026-11-03",
  time: "09:00",
  timezone: "Europe/Paris",
  durationMinutes: "30",
  agenda: "",
  attendees: "Grace <grace@example.com>",
  templateId: "",
  submissionId: "11111111-2222-3333-4444-555555555555",
  ...overrides,
});

function seedTemplate(ownerId: string, id: string, isDefault = 0): void {
  insert(db, "template", {
    id,
    owner_id: ownerId,
    name: `T ${id}`,
    sections_json: "[]",
    is_default: isDefault,
    created_at: T0,
    updated_at: T0,
  });
}

describe("createMeeting", () => {
  it("creates a scheduled meeting with the owner's default template applied", async () => {
    seedTemplate("A", "t-default", 1);
    const result = await createMeeting(deps, "A", form());
    expect(result).toMatchObject({ ok: true, value: { created: true } });
    expect(db.prepare("SELECT template_id, status FROM meeting").get()).toMatchObject({
      template_id: "t-default",
      status: "scheduled",
    });
  });

  it("stores no template when the owner has none (the built-in layout applies at summary time)", async () => {
    await createMeeting(deps, "A", form());
    expect(db.prepare("SELECT template_id FROM meeting").get()).toMatchObject({
      template_id: null,
    });
  });

  it("applies an explicitly chosen template", async () => {
    seedTemplate("A", "t1");
    await createMeeting(deps, "A", form({ templateId: "t1" }));
    expect(db.prepare("SELECT template_id FROM meeting").get()).toMatchObject({
      template_id: "t1",
    });
  });

  it("rejects another owner's template as a field error and stores nothing", async () => {
    seedTemplate("B", "tb");
    const result = await createMeeting(deps, "A", form({ templateId: "tb" }));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "invalid", errors: [{ field: "template_id" }] },
    });
    expect(count(db, "meeting")).toBe(0);
  });

  it("returns field errors for invalid input", async () => {
    const result = await createMeeting(deps, "A", form({ title: " ", attendees: "x <nope>" }));
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid" } });
    expect(count(db, "meeting")).toBe(0);
  });

  it("a repeated submission with the same token yields one meeting and says it already existed", async () => {
    const first = await createMeeting(deps, "A", form());
    const second = await createMeeting(deps, "A", form());
    expect(first.ok && second.ok && second.value.meetingId === first.value.meetingId).toBe(true);
    expect(second).toMatchObject({ ok: true, value: { created: false } });
    expect(count(db, "meeting")).toBe(1);
  });

  it.each(["", "short", "has spaces in it", "x".repeat(101)])(
    "rejects a malformed submission token %j",
    async (submissionId) => {
      const result = await createMeeting(deps, "A", form({ submissionId }));
      expect(result.ok).toBe(false);
      expect(count(db, "meeting")).toBe(0);
    },
  );
});

describe("loadMeetingsHome", () => {
  it("returns grouped meetings and the owner's folders for the filter", async () => {
    await createMeeting(deps, "A", form());
    await createMeeting(
      deps,
      "B",
      form({ title: "Bens call", submissionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }),
    );
    insert(db, "folder", {
      id: "f1",
      owner_id: "A",
      name: "Board",
      created_at: T0,
      updated_at: T0,
    });
    const home = await loadMeetingsHome(
      {
        list: catalog,
        folders: deps.notes.folders,
        clock: new FixedClock(new Date("2026-10-27T09:00:00.000Z")),
      },
      "A",
      { folderId: null, includeArchived: false },
    );
    expect(home.groups.upcoming.map((m) => m.title)).toEqual(["Customer call"]);
    expect(home.folders.map((f) => f.name)).toEqual(["Board"]);
    expect(JSON.stringify(home)).not.toContain("Bens call");
  });
});
