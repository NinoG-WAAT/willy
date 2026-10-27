import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteFolderRepository } from "../../../src/adapters/sqlite/folder-repository";
import { SqliteTemplateRepository } from "../../../src/adapters/sqlite/template-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import type { NotesDeps } from "../../../src/app/notes/deps";
import {
  createTemplate,
  deleteTemplate,
  findTemplate,
  listTemplates,
  resolveTemplateForNewMeeting,
  setDefaultTemplate,
  updateTemplate,
} from "../../../src/app/notes/templates";
import { DEFAULT_TEMPLATE } from "../../../src/domain/notes/template";
import { count, freshDb, insert, meeting, owner, T0 } from "../../support/db-fixtures";

let db: DatabaseSync;
let deps: NotesDeps;

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  owner(db, "B");
  deps = {
    folders: new SqliteFolderRepository(db),
    templates: new SqliteTemplateRepository(db),
    clock: new FixedClock(new Date("2026-10-27T09:00:00.000Z")),
    ids: new SequentialIds("tpl"),
  };
});

const input = (name: string, isDefault = false) => ({
  name,
  isDefault,
  sections: [{ heading: "Summary", prompt: "Summarize." }],
});

function seedTemplate(ownerId: string, id: string, name: string, isDefault = 0): void {
  insert(db, "template", {
    id,
    owner_id: ownerId,
    name,
    sections_json: JSON.stringify([{ heading: "Summary", prompt: "" }]),
    is_default: isDefault,
    created_at: T0,
    updated_at: T0,
  });
}

describe("createTemplate", () => {
  it("stores a normalized template with its sections", async () => {
    const result = await createTemplate(deps, "A", {
      name: " Weekly  sync ",
      isDefault: false,
      sections: [{ heading: " Summary ", prompt: "Summarize" }],
    });
    expect(result).toMatchObject({ ok: true, value: { name: "Weekly sync" } });
    const [row] = await listTemplates(deps, "A");
    expect(row).toMatchObject({
      name: "Weekly sync",
      isDefault: false,
      sections: [{ heading: "Summary", prompt: "Summarize" }],
    });
  });

  it("returns field errors and stores nothing for invalid input", async () => {
    const result = await createTemplate(deps, "A", { name: "", isDefault: false, sections: [] });
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid" } });
    expect(count(db, "template")).toBe(0);
  });

  it("rejects a duplicate name within an owner but allows it across owners", async () => {
    await createTemplate(deps, "A", input("Weekly"));
    expect(await createTemplate(deps, "A", input("weekly"))).toMatchObject({
      ok: false,
      error: { kind: "invalid", errors: [{ field: "name" }] },
    });
    expect((await createTemplate(deps, "B", input("Weekly"))).ok).toBe(true);
  });

  it("making a new template the default demotes the previous default atomically", async () => {
    await createTemplate(deps, "A", input("One", true));
    await createTemplate(deps, "A", input("Two", true));
    const defaults = (await listTemplates(deps, "A")).filter((t) => t.isDefault);
    expect(defaults.map((t) => t.name)).toEqual(["Two"]);
  });

  it("does not demote another owner's default", async () => {
    await createTemplate(deps, "B", input("Bens", true));
    await createTemplate(deps, "A", input("Mine", true));
    expect((await listTemplates(deps, "B")).filter((t) => t.isDefault)).toHaveLength(1);
  });
});

describe("updateTemplate", () => {
  it("replaces name and sections and keeps the created time", async () => {
    const created = await createTemplate(deps, "A", input("Old"));
    if (!created.ok) throw new Error("setup failed");
    (deps.clock as FixedClock).advance(60_000);
    const result = await updateTemplate(deps, "A", created.value.id, {
      name: "New",
      isDefault: true,
      sections: [
        { heading: "A", prompt: "" },
        { heading: "B", prompt: "b" },
      ],
    });
    expect(result.ok).toBe(true);
    const found = await findTemplate(deps, "A", created.value.id);
    expect(found).toMatchObject({
      ok: true,
      value: {
        name: "New",
        isDefault: true,
        createdAt: "2026-10-27T09:00:00.000Z",
        updatedAt: "2026-10-27T09:01:00.000Z",
      },
    });
    expect(found.ok && found.value.sections).toHaveLength(2);
  });

  it("returns not_found for another owner's template and a guessed id, changing nothing", async () => {
    seedTemplate("B", "tb", "Bens");
    expect(await updateTemplate(deps, "A", "tb", input("Hijacked"))).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await updateTemplate(deps, "A", "nope", input("x"))).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    const [row] = await listTemplates(deps, "B");
    expect(row?.name).toBe("Bens");
  });

  it("rejects renaming onto an existing name", async () => {
    await createTemplate(deps, "A", input("One"));
    const two = await createTemplate(deps, "A", input("Two"));
    if (!two.ok) throw new Error("setup failed");
    expect(await updateTemplate(deps, "A", two.value.id, input("one"))).toMatchObject({
      ok: false,
      error: { kind: "invalid" },
    });
  });
});

describe("setDefaultTemplate", () => {
  it("switches the default and is idempotent", async () => {
    seedTemplate("A", "t1", "One", 1);
    seedTemplate("A", "t2", "Two");
    expect((await setDefaultTemplate(deps, "A", "t2")).ok).toBe(true);
    expect((await setDefaultTemplate(deps, "A", "t2")).ok).toBe(true);
    const defaults = (await listTemplates(deps, "A")).filter((t) => t.isDefault);
    expect(defaults.map((t) => t.id)).toEqual(["t2"]);
  });

  it("cannot make another owner's template the default, and leaves the current default alone", async () => {
    seedTemplate("A", "t1", "One", 1);
    seedTemplate("B", "tb", "Bens");
    expect(await setDefaultTemplate(deps, "A", "tb")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect((await listTemplates(deps, "A")).find((t) => t.isDefault)?.id).toBe("t1");
    expect((await listTemplates(deps, "B")).some((t) => t.isDefault)).toBe(false);
  });
});

describe("deleteTemplate", () => {
  it("deletes an unused template", async () => {
    seedTemplate("A", "t1", "One");
    expect((await deleteTemplate(deps, "A", "t1")).ok).toBe(true);
    expect(count(db, "template")).toBe(0);
  });

  it("detaches meetings that used it instead of failing, and reports how many", async () => {
    seedTemplate("A", "t1", "One");
    meeting(db, "A", "m1", { template_id: "t1" });
    meeting(db, "A", "m2", { template_id: "t1" });
    const before = await findTemplate(deps, "A", "t1");
    expect(before).toMatchObject({ ok: true, value: { meetingCount: 2 } });
    expect(await deleteTemplate(deps, "A", "t1")).toEqual({
      ok: true,
      value: { detachedMeetings: 2 },
    });
    expect(count(db, "meeting", "template_id IS NULL")).toBe(2);
    expect(count(db, "meeting")).toBe(2);
  });

  it("returns not_found for another owner's template and never touches their meetings", async () => {
    seedTemplate("B", "tb", "Bens");
    meeting(db, "B", "mb", { template_id: "tb" });
    expect(await deleteTemplate(deps, "A", "tb")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(count(db, "template")).toBe(1);
    expect(count(db, "meeting", "template_id = 'tb'")).toBe(1);
  });

  it("repeating a delete is a clean not_found", async () => {
    seedTemplate("A", "t1", "One");
    await deleteTemplate(deps, "A", "t1");
    expect(await deleteTemplate(deps, "A", "t1")).toEqual({ ok: false, error: { kind: "not_found" } });
  });
});

describe("resolveTemplateForNewMeeting", () => {
  it("uses the chosen template when it belongs to the owner", async () => {
    seedTemplate("A", "t1", "One");
    expect(await resolveTemplateForNewMeeting(deps, "A", "t1")).toMatchObject({
      ok: true,
      value: { source: "chosen", id: "t1", name: "One" },
    });
  });

  it("refuses another owner's template id (indistinguishable from unknown)", async () => {
    seedTemplate("B", "tb", "Bens");
    expect(await resolveTemplateForNewMeeting(deps, "A", "tb")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });

  it("falls back to the owner's default, then to the built-in default template", async () => {
    expect(await resolveTemplateForNewMeeting(deps, "A", null)).toMatchObject({
      ok: true,
      value: { source: "builtin", id: null, sections: DEFAULT_TEMPLATE.sections },
    });
    seedTemplate("A", "t1", "One", 1);
    expect(await resolveTemplateForNewMeeting(deps, "A", null)).toMatchObject({
      ok: true,
      value: { source: "default", id: "t1" },
    });
  });

  it("an owner without a default never inherits another owner's default", async () => {
    seedTemplate("B", "tb", "Bens", 1);
    expect(await resolveTemplateForNewMeeting(deps, "A", null)).toMatchObject({
      ok: true,
      value: { source: "builtin" },
    });
  });
});
