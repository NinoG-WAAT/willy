import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteFolderRepository } from "../../../src/adapters/sqlite/folder-repository";
import { SqliteTemplateRepository } from "../../../src/adapters/sqlite/template-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import type { NotesDeps } from "../../../src/app/notes/deps";
import { createFolder, deleteFolder } from "../../../src/app/notes/folders";
import { createTemplate } from "../../../src/app/notes/templates";
import { folder, freshDb, meeting, note, owner } from "../../support/db-fixtures";
import { inLocale } from "../../support/locale";

let db: DatabaseSync;
let deps: NotesDeps;

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  deps = {
    folders: new SqliteFolderRepository(db),
    templates: new SqliteTemplateRepository(db),
    clock: new FixedClock(new Date("2026-10-27T09:00:00.000Z")),
    ids: new SequentialIds("id"),
  };
});

describe("folder and template use cases speak the request's language", () => {
  it("blocks deleting a folder that holds notes, in French, with the count", async () => {
    folder(db, "A", "fa", { name: "Busy" });
    meeting(db, "A", "m1");
    note(db, "A", "m1", "n1", {
      status: "published",
      published_at: "2026-10-27T09:00:00.000Z",
      folder_id: "fa",
    });
    const result = await inLocale("fr", () => deleteFolder(deps, "A", "fa"));
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "blocked",
        message: "Ce dossier contient encore 1 note. Déplacez-la ou supprimez-la d’abord.",
      },
    });
  });

  it("reports a taken folder name in French, and in English for an English request", async () => {
    await createFolder(deps, "A", "Board");
    const fr = await inLocale("fr", () => createFolder(deps, "A", "BOARD"));
    const en = await inLocale("en", () => createFolder(deps, "A", "BOARD"));
    expect(fr).toMatchObject({
      ok: false,
      error: { errors: [{ field: "name", message: "Vous avez déjà un dossier portant ce nom." }] },
    });
    expect(en).toMatchObject({
      ok: false,
      error: { errors: [{ message: "You already have a folder with that name." }] },
    });
  });

  it("reports a taken template name in French", async () => {
    const raw = { name: "Hebdo", isDefault: false, sections: [{ heading: "Bilan", prompt: "" }] };
    await createTemplate(deps, "A", raw);
    const result = await inLocale("fr", () => createTemplate(deps, "A", raw));
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "invalid",
        errors: [{ field: "name", message: "Vous avez déjà un modèle portant ce nom." }],
      },
    });
  });

  it("stores the owner's folder name as typed, whatever the language of the request", async () => {
    const created = await inLocale("fr", () => createFolder(deps, "A", "  Réunions   clients "));
    expect(created).toMatchObject({ ok: true, value: { name: "Réunions clients" } });
  });
});
