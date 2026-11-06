import { describe, expect, it } from "vitest";
import { englishLeftovers } from "../../support/english-words";

describe("the English-leftover scanner of the French crawl", () => {
  it("finds English interface words and reports where", () => {
    expect(englishLeftovers(["Enregistrer", "Save changes"])).toEqual([
      { word: "Save", in: "Save changes" },
    ]);
    expect(englishLeftovers(["Vos notes ne sont pas Saved"]).map((h) => h.word)).toEqual(["Saved"]);
  });

  it("finds an English month or weekday that an English date formatter left", () => {
    expect(englishLeftovers(["Échéance : 14 November 2026"]).map((h) => h.word)).toEqual([
      "November",
    ]);
  });

  it("leaves French alone, including words that are spelled the same in both languages", () => {
    expect(
      englishLeftovers([
        "Réception",
        "Vous n’avez pas encore de note. Action : section, message, date, version, mode.",
        "Nouvelle note · 3 minutes · Participants",
      ]),
    ).toEqual([]);
  });

  it("ignores the app name, the typed confirmation word, the bilingual language label and codes", () => {
    expect(
      englishLeftovers([
        "Willycrumbs",
        "Saisissez DELETE pour confirmer",
        "Language / Langue",
        "English",
        "Échec (storage_unavailable)",
        "pour la référence e2e-del-n3no2tdr",
      ]),
    ).toEqual([]);
  });

  it("removes what the owner wrote, as a string or a pattern, and only that", () => {
    const texts = ["Save the date: Budget review for the board"];
    expect(englishLeftovers(texts, ["Budget review for the board"]).map((h) => h.word)).toEqual([
      "Save",
      "the",
    ]);
    expect(englishLeftovers(["Review of Q3 plan"], [/Review of Q\d plan/g])).toEqual([]);
  });
});
