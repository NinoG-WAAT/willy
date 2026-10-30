import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteFolderRepository } from "../../../src/adapters/sqlite/folder-repository";
import { SHELL_FOLDER_LIMIT, loadShellFolders } from "../../../src/app/notes/shell-folders";
import { consentedMeeting, folder, freshDb, note, owner, T0 } from "../../support/db-fixtures";

let db: DatabaseSync;
let deps: { folders: SqliteFolderRepository };

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  owner(db, "B");
  deps = { folders: new SqliteFolderRepository(db) };
});

function fileNote(ownerId: string, id: string, folderId: string, status: string): void {
  consentedMeeting(db, ownerId, id, {
    title: `Secret title ${id}`,
    ...(status === "archived" ? { status_before_archive: "published" } : {}),
    ...(status === "archived" ? { status: "archived" } : {}),
  });
  note(db, ownerId, id, `${id}-note`, {
    status: status === "draft" ? "draft" : "published",
    ...(status === "draft" ? {} : { published_at: T0 }),
    folder_id: folderId,
  });
}

describe("loadShellFolders (the sidebar's folder list)", () => {
  it("is empty for an owner without folders", async () => {
    expect(await loadShellFolders(deps, "A")).toEqual([]);
  });

  it("lists the owner's folders by name with the count the folder view shows", async () => {
    folder(db, "A", "f-b", { name: "Board updates" });
    folder(db, "A", "f-a", { name: "Customers" });
    folder(db, "A", "f-0", { name: "archive" });
    fileNote("A", "m1", "f-b", "published");
    fileNote("A", "m2", "f-b", "published");
    // Not visible in the folder, so not in its count: a draft and an archived meeting's note.
    fileNote("A", "m3", "f-b", "draft");
    fileNote("A", "m4", "f-b", "archived");
    const list = await loadShellFolders(deps, "A");
    expect(list.map((f) => [f.name, f.publishedCount])).toEqual([
      ["archive", 0],
      ["Board updates", 2],
      ["Customers", 0],
    ]);
  });

  it("carries only what the sidebar renders: no meeting titles, no note counts of hidden notes", async () => {
    folder(db, "A", "f1", { name: "Board" });
    fileNote("A", "m1", "f1", "published");
    const [first] = await loadShellFolders(deps, "A");
    expect(Object.keys(first ?? {}).sort()).toEqual(["id", "name", "publishedCount"]);
    expect(JSON.stringify(first)).not.toContain("Secret title");
  });

  it("never lists another owner's folders, and counts only the owner's notes", async () => {
    folder(db, "A", "fa", { name: "Mine" });
    folder(db, "B", "fb", { name: "Theirs" });
    fileNote("B", "mb", "fb", "published");
    expect((await loadShellFolders(deps, "A")).map((f) => f.name)).toEqual(["Mine"]);
    expect((await loadShellFolders(deps, "B")).map((f) => [f.name, f.publishedCount])).toEqual([
      ["Theirs", 1],
    ]);
    expect(await loadShellFolders(deps, "not-an-owner")).toEqual([]);
  });

  it("is capped, taking the first folders by name", async () => {
    for (let i = 0; i < SHELL_FOLDER_LIMIT + 3; i += 1) {
      folder(db, "A", `f${String(i)}`, { name: `Folder ${String(i).padStart(2, "0")}` });
    }
    const list = await loadShellFolders(deps, "A");
    expect(list).toHaveLength(SHELL_FOLDER_LIMIT);
    expect(list[0]?.name).toBe("Folder 00");
    expect(list.at(-1)?.name).toBe(`Folder ${String(SHELL_FOLDER_LIMIT - 1).padStart(2, "0")}`);
  });

  it("caps at eight", () => {
    expect(SHELL_FOLDER_LIMIT).toBe(8);
  });
});
