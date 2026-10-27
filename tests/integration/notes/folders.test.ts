import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteFolderRepository } from "../../../src/adapters/sqlite/folder-repository";
import { SqliteTemplateRepository } from "../../../src/adapters/sqlite/template-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import {
  createFolder,
  deleteFolder,
  findFolderForDelete,
  listFolders,
  renameFolder,
} from "../../../src/app/notes/folders";
import type { NotesDeps } from "../../../src/app/notes/deps";
import { count, folder, freshDb, meeting, note, owner } from "../../support/db-fixtures";

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
    ids: new SequentialIds("id"),
  };
});

function names(result: Awaited<ReturnType<typeof listFolders>>): string[] {
  return result.map((f) => f.name);
}

describe("createFolder", () => {
  it("creates a normalized folder owned by the owner", async () => {
    const result = await createFolder(deps, "A", "  Board   updates ");
    expect(result).toMatchObject({ ok: true, value: { name: "Board updates" } });
    expect(names(await listFolders(deps, "A"))).toEqual(["Board updates"]);
  });

  it("rejects invalid names with a field error", async () => {
    expect(await createFolder(deps, "A", "  ")).toMatchObject({
      ok: false,
      error: { kind: "invalid", errors: [{ field: "name" }] },
    });
    expect(count(db, "folder")).toBe(0);
  });

  it("rejects a duplicate name case-insensitively, but only within the same owner", async () => {
    await createFolder(deps, "A", "Board");
    expect(await createFolder(deps, "A", "BOARD")).toMatchObject({
      ok: false,
      error: { kind: "invalid", errors: [{ field: "name" }] },
    });
    expect((await createFolder(deps, "B", "Board")).ok).toBe(true);
  });
});

describe("renameFolder", () => {
  it("renames and bumps updated_at", async () => {
    const created = await createFolder(deps, "A", "Old");
    if (!created.ok) throw new Error("setup failed");
    (deps.clock as FixedClock).advance(60_000);
    expect((await renameFolder(deps, "A", created.value.id, " New ")).ok).toBe(true);
    const [row] = await listFolders(deps, "A");
    expect(row).toMatchObject({ name: "New", updatedAt: "2026-10-27T09:01:00.000Z" });
  });

  it("rejects an invalid or taken name and keeps the old one", async () => {
    await createFolder(deps, "A", "One");
    const two = await createFolder(deps, "A", "Two");
    if (!two.ok) throw new Error("setup failed");
    expect(await renameFolder(deps, "A", two.value.id, "one")).toMatchObject({
      ok: false,
      error: { kind: "invalid" },
    });
    expect(await renameFolder(deps, "A", two.value.id, "")).toMatchObject({
      ok: false,
      error: { kind: "invalid" },
    });
    expect(names(await listFolders(deps, "A")).sort()).toEqual(["One", "Two"]);
  });

  it("returns not_found for another owner's folder and for a guessed id, changing nothing", async () => {
    folder(db, "B", "fb", { name: "Bens" });
    expect(await renameFolder(deps, "A", "fb", "Hijacked")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await renameFolder(deps, "A", "does-not-exist", "x")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(names(await listFolders(deps, "B"))).toEqual(["Bens"]);
  });
});

describe("deleteFolder", () => {
  it("deletes an empty folder", async () => {
    folder(db, "A", "fa", { name: "Empty" });
    expect((await deleteFolder(deps, "A", "fa")).ok).toBe(true);
    expect(count(db, "folder")).toBe(0);
  });

  it("is blocked, with a message naming the count, while the folder contains notes", async () => {
    folder(db, "A", "fa", { name: "Busy" });
    meeting(db, "A", "m1");
    note(db, "A", "m1", "n1", {
      status: "published",
      published_at: "2026-10-27T09:00:00.000Z",
      folder_id: "fa",
    });
    const result = await deleteFolder(deps, "A", "fa");
    expect(result).toMatchObject({ ok: false, error: { kind: "blocked" } });
    expect(JSON.stringify(result)).toContain("1 note");
    expect(count(db, "folder")).toBe(1);
    expect(count(db, "note")).toBe(1);
  });

  it("returns not_found for another owner's folder and a guessed id, deleting nothing", async () => {
    folder(db, "B", "fb");
    expect(await deleteFolder(deps, "A", "fb")).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(await deleteFolder(deps, "A", "nope")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(count(db, "folder")).toBe(1);
  });

  it("a repeated delete is a clean not_found rather than an error", async () => {
    folder(db, "A", "fa");
    await deleteFolder(deps, "A", "fa");
    expect(await deleteFolder(deps, "A", "fa")).toEqual({ ok: false, error: { kind: "not_found" } });
  });
});

describe("listing and lookup are owner scoped", () => {
  it("lists only the owner's folders with note counts, ordered by name", async () => {
    folder(db, "A", "f2", { name: "beta" });
    folder(db, "A", "f1", { name: "Alpha" });
    folder(db, "B", "fb", { name: "Bens" });
    meeting(db, "A", "m1");
    note(db, "A", "m1", "n1", {
      status: "published",
      published_at: "2026-10-27T09:00:00.000Z",
      folder_id: "f1",
    });
    const listed = await listFolders(deps, "A");
    expect(listed.map((f) => [f.name, f.noteCount])).toEqual([
      ["Alpha", 1],
      ["beta", 0],
    ]);
  });

  it("findFolderForDelete does not reveal other owners' folders", async () => {
    folder(db, "B", "fb");
    expect(await findFolderForDelete(deps, "A", "fb")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await findFolderForDelete(deps, "B", "fb")).toMatchObject({
      ok: true,
      value: { id: "fb", noteCount: 0 },
    });
  });
});
