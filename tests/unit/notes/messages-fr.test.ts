import { describe, expect, it } from "vitest";
import { noticeMessage, problemMessage } from "../../../src/app/meetings/messages";
import { nameTaken } from "../../../src/app/notes/errors";
import { noticeText } from "../../../src/app/notes/notices";
import { normalizeFolderName } from "../../../src/domain/notes/folder";
import { normalizeTemplate } from "../../../src/domain/notes/template";
import { inLocale } from "../../support/locale";

const NBSP = " ";

describe("folder and template validation in French", () => {
  it("explains an empty or too long folder name", () => {
    expect(inLocale("fr", () => normalizeFolderName("  "))).toEqual({
      ok: false,
      error: { field: "name", message: "Saisissez un nom de dossier." },
    });
    expect(inLocale("fr", () => normalizeFolderName("x".repeat(101)))).toEqual({
      ok: false,
      error: { field: "name", message: "Un nom de dossier ne peut pas dépasser 100 caractères." },
    });
  });

  it("reports every problem of a template together, in French, with the same field paths", () => {
    const result = inLocale("fr", () =>
      normalizeTemplate({
        name: "",
        isDefault: false,
        sections: [
          { heading: "", prompt: "Un texte" },
          { heading: "Bilan", prompt: "" },
          { heading: "bilan", prompt: "" },
        ],
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: [
        { field: "name", message: "Saisissez un nom de modèle." },
        { field: "sections.0.heading", message: "Donnez un titre à cette section." },
        { field: "sections.2.heading", message: "Chaque section doit avoir un titre différent." },
      ],
    });
  });

  it("asks for at least one section", () => {
    const result = inLocale("fr", () =>
      normalizeTemplate({ name: "Hebdo", isDefault: false, sections: [] }),
    );
    expect(result).toEqual({
      ok: false,
      error: [{ field: "sections", message: "Ajoutez au moins une section." }],
    });
  });

  it("names which kind of thing is taken, with its own sentence", () => {
    const folder = inLocale("fr", () => nameTaken("folder"));
    const template = inLocale("fr", () => nameTaken("template"));
    expect(folder).toEqual({
      kind: "invalid",
      errors: [{ field: "name", message: "Vous avez déjà un dossier portant ce nom." }],
    });
    expect(template).toEqual({
      kind: "invalid",
      errors: [{ field: "name", message: "Vous avez déjà un modèle portant ce nom." }],
    });
  });

  it("keeps English as the source text in an English request", () => {
    expect(inLocale("en", () => normalizeFolderName(""))).toEqual({
      ok: false,
      error: { field: "name", message: "Enter a folder name." },
    });
  });
});

describe("notices in French", () => {
  it.each([
    ["folder_created", "Dossier créé."],
    ["folder_renamed", "Dossier renommé."],
    ["folder_deleted", "Dossier supprimé."],
    ["template_created", "Modèle créé."],
    ["template_saved", "Modèle enregistré."],
    ["template_default", "Modèle par défaut mis à jour."],
    ["template_deleted", "Modèle supprimé."],
  ])("%s reads %s", (code, text) => {
    expect(inLocale("fr", () => noticeText(code))).toBe(text);
  });

  it("shows nothing for an unknown code, a missing code or a prototype name", () => {
    for (const code of [null, "", "nope", "constructor", "__proto__", "toString"]) {
      expect(inLocale("fr", () => noticeText(code))).toBeNull();
      expect(
        inLocale("fr", () => noticeMessage(new URLSearchParams({ notice: code ?? "" }))),
      ).toBeNull();
    }
    expect(inLocale("fr", () => problemMessage("constructor"))).toBeNull();
  });
});

describe("calendar import feedback in French", () => {
  const imported = (query: Record<string, string>) =>
    inLocale("fr", () => noticeMessage(new URLSearchParams(query)));

  it("gives each count its own plural", () => {
    expect(imported({ notice: "imported", new: "1", existing: "1" })).toBe(
      "1 nouvelle réunion importée. 1 événement figurait déjà dans votre liste.",
    );
    expect(imported({ notice: "imported", new: "3", existing: "2" })).toBe(
      "3 nouvelles réunions importées. 2 événements figuraient déjà dans votre liste.",
    );
  });

  it("treats zero as singular, as French does", () => {
    expect(imported({ notice: "imported", new: "0", existing: "4" })).toBe(
      "0 nouvelle réunion importée. 4 événements figuraient déjà dans votre liste.",
    );
  });

  it("says when there is nothing to import, or when the figures are missing", () => {
    expect(imported({ notice: "imported", new: "0", existing: "0" })).toBe(
      "Votre calendrier n’a aucun événement à venir à importer.",
    );
    expect(imported({ notice: "imported" })).toBe("Import du calendrier terminé.");
    expect(imported({ notice: "ics_imported" })).toBe("Import du fichier de calendrier terminé.");
  });

  it("covers the calendar file and the fixed created notice", () => {
    expect(imported({ notice: "ics_imported", new: "2", existing: "0" })).toBe(
      "2 nouvelles réunions importées depuis le fichier de calendrier. 0 événement figurait déjà dans votre liste.",
    );
    expect(imported({ notice: "created" })).toBe(
      `Note créée. Elle apparaît sous «${NBSP}À venir${NBSP}».`,
    );
  });

  it("has a French sentence for each calendar problem and stays English otherwise", () => {
    expect(inLocale("fr", () => problemMessage("calendar_busy"))).toBe(
      "Le service de calendrier nous a demandé de ralentir. Patientez une minute et réessayez.",
    );
    expect(inLocale("fr", () => problemMessage("calendar_unavailable"))).toMatch(
      /^Votre calendrier n’a pas pu être joint/,
    );
    expect(inLocale("fr", () => problemMessage("calendar_not_connected"))).toMatch(
      /n’est pas connecté/,
    );
    expect(inLocale("en", () => problemMessage("calendar_busy"))).toBe(
      "The calendar service asked us to slow down. Wait a minute and try again.",
    );
  });
});
