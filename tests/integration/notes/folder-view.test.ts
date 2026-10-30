import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteFolderNotes } from "../../../src/adapters/sqlite/folder-notes";
import { SqliteFolderRepository } from "../../../src/adapters/sqlite/folder-repository";
import { loadFolderView, type FolderViewDeps } from "../../../src/app/notes/folder-view";
import { FOLDER_PAGE_SIZE } from "../../../src/domain/notes/folder-view";
import { attendee, folder, freshDb, meeting, note, owner, T0 } from "../../support/db-fixtures";

let db: DatabaseSync;
let deps: FolderViewDeps;

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  owner(db, "B");
  deps = { folders: new SqliteFolderRepository(db), notes: new SqliteFolderNotes(db) };
});

/** A meeting with a published note filed in `folderId`. */
function published(
  ownerId: string,
  id: string,
  folderId: string,
  extra: Record<string, string> = {},
): void {
  meeting(db, ownerId, id, { status: "published", title: `Title ${id}`, ...extra });
  note(db, ownerId, id, `${id}-note`, {
    status: "published",
    published_at: T0,
    folder_id: folderId,
  });
}

async function view(ownerId: string, folderId: string, page: string | null = null) {
  const result = await loadFolderView(deps, ownerId, folderId, page);
  if (!result.ok) throw new Error(`expected a folder view, got ${result.error.kind}`);
  return result.value;
}

describe("loadFolderView", () => {
  it("returns the folder, its published notes and the count", async () => {
    folder(db, "A", "f1", { name: "Board" });
    published("A", "m1", "f1");
    published("A", "m2", "f1");
    const { folder: found, items, page } = await view("A", "f1");
    expect(found).toMatchObject({ id: "f1", name: "Board", publishedCount: 2 });
    expect(items.map((i) => i.id).sort()).toEqual(["m1", "m2"]);
    expect(items[0]).toMatchObject({ folderName: "Board", noteStatus: "published" });
    expect(page).toMatchObject({ page: 1, pageCount: 1 });
  });

  it("orders by meeting date, newest first", async () => {
    folder(db, "A", "f1");
    published("A", "old", "f1", { scheduled_start_at: "2026-09-01T09:00:00.000Z" });
    published("A", "new", "f1", { scheduled_start_at: "2026-10-20T09:00:00.000Z" });
    published("A", "mid", "f1", { scheduled_start_at: "2026-10-01T09:00:00.000Z" });
    expect((await view("A", "f1")).items.map((i) => i.id)).toEqual(["new", "mid", "old"]);
  });

  it("returns an empty list for an empty folder", async () => {
    folder(db, "A", "f1");
    const { items, folder: found } = await view("A", "f1");
    expect(items).toEqual([]);
    expect(found.publishedCount).toBe(0);
  });

  it("only lists notes filed in this folder", async () => {
    folder(db, "A", "f1");
    folder(db, "A", "f2");
    published("A", "m1", "f1");
    published("A", "m2", "f2");
    expect((await view("A", "f1")).items.map((i) => i.id)).toEqual(["m1"]);
  });

  it("leaves out drafts and archived, deleting and deleted meetings, in the list and in the count", async () => {
    folder(db, "A", "f1");
    published("A", "visible", "f1");
    published("A", "archived", "f1", { status: "archived" });
    published("A", "deleting", "f1", { status: "deleting", title: "Secret being deleted" });
    published("A", "deleted", "f1", { status: "deleted" });
    // A reopened note is a draft again: it is not "published in the folder" until republished.
    meeting(db, "A", "reopened", { status: "review" });
    note(db, "A", "reopened", "reopened-note", { status: "draft", folder_id: "f1" });
    const { items, folder: found } = await view("A", "f1");
    expect(items.map((i) => i.id)).toEqual(["visible"]);
    expect(found.publishedCount).toBe(1);
    expect(JSON.stringify(items)).not.toContain("Secret being deleted");
  });

  it("carries only what the card needs: no notes, no emails", async () => {
    folder(db, "A", "f1");
    published("A", "m1", "f1", { rough_notes: "private rough notes" });
    attendee(db, "A", "m1", "att1", { name: "Grace", email: "grace@secret.test" });
    const { items } = await view("A", "f1");
    const serialised = JSON.stringify(items);
    expect(serialised).not.toContain("private rough notes");
    expect(serialised).not.toContain("grace@secret.test");
    expect(items[0]).toMatchObject({ attendeeCount: 1 });
  });

  it("paginates: a page is capped and the next page continues the order", async () => {
    folder(db, "A", "f1");
    const total = FOLDER_PAGE_SIZE + 3;
    for (let i = 0; i < total; i += 1) {
      const day = String(i + 1).padStart(2, "0");
      published("A", `m${day}`, "f1", { scheduled_start_at: `2026-08-${day}T09:00:00.000Z` });
    }
    const first = await view("A", "f1");
    expect(first.items).toHaveLength(FOLDER_PAGE_SIZE);
    expect(first.page).toMatchObject({ page: 1, pageCount: 2, hasNext: true, hasPrevious: false });
    expect(first.folder.publishedCount).toBe(total);
    const second = await view("A", "f1", "2");
    expect(second.items.map((i) => i.id)).toEqual(["m03", "m02", "m01"]);
    expect(second.page).toMatchObject({ page: 2, hasNext: false, hasPrevious: true });
    // Out of range and junk page numbers never error.
    expect((await view("A", "f1", "99")).page.page).toBe(2);
    expect((await view("A", "f1", "-1")).page.page).toBe(1);
    expect((await view("A", "f1", "abc")).page.page).toBe(1);
  });
});

describe("owner isolation", () => {
  it("another owner's folder and a guessed id are the same plain not_found", async () => {
    folder(db, "B", "fb", { name: "Bens" });
    published("B", "mb", "fb");
    expect(await loadFolderView(deps, "A", "fb", null)).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await loadFolderView(deps, "A", "does-not-exist", null)).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect((await view("B", "fb")).items.map((i) => i.id)).toEqual(["mb"]);
  });

  it("the query itself is scoped: asking it for another owner's folder returns nothing", async () => {
    folder(db, "B", "fb");
    published("B", "mb", "fb");
    expect(await new SqliteFolderNotes(db).list("A", "fb", { offset: 0, limit: 25 })).toEqual([]);
  });

  it("counts on the folder list are per owner and match the listed notes", async () => {
    folder(db, "A", "fa", { name: "Alpha" });
    folder(db, "B", "fb", { name: "Beta" });
    published("A", "ma", "fa");
    published("B", "mb1", "fb");
    published("B", "mb2", "fb");
    published("A", "gone", "fa", { status: "deleting" });
    const folders = new SqliteFolderRepository(db);
    expect((await folders.list("A")).map((f) => [f.name, f.publishedCount])).toEqual([
      ["Alpha", 1],
    ]);
    expect((await folders.list("B")).map((f) => [f.name, f.publishedCount])).toEqual([
      ["Beta", 2],
    ]);
  });

  it("keeps the delete guard on every note filed in the folder, shown or not", async () => {
    folder(db, "A", "fa");
    published("A", "gone", "fa", { status: "deleting" });
    const found = await new SqliteFolderRepository(db).find("A", "fa");
    expect(found).toMatchObject({ publishedCount: 0, noteCount: 1 });
  });
});
