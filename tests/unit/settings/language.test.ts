import { describe, expect, it } from "vitest";
import { inLocale } from "../../support/locale";
import { LANGUAGE_CHOICES, parseLanguageChoice } from "../../../src/domain/settings/language";

describe("LANGUAGE_CHOICES", () => {
  it("lists every locale, each labelled in its own language", () => {
    expect(LANGUAGE_CHOICES).toEqual([
      { locale: "en", label: "English" },
      { locale: "fr", label: "Français" },
    ]);
  });

  it("is the same in every locale: a lost owner can always find their own language", () => {
    const inFrench = inLocale("fr", () => LANGUAGE_CHOICES.map((c) => c.label));
    expect(inFrench).toEqual(["English", "Français"]);
  });
});

describe("parseLanguageChoice", () => {
  it.each(["en", "fr"])("accepts %s", (raw) => {
    expect(parseLanguageChoice(raw)).toEqual({ ok: true, value: raw });
  });

  it.each([undefined, "", "de", "fr-FR", "english", "EN ", 3, null, ["fr"]])(
    "rejects %j with a message on the language field",
    (raw) => {
      const result = parseLanguageChoice(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual([
          { field: "language", message: "Choose a language from the list." },
        ]);
      }
    },
  );

  it("words the rejection in the current locale", () => {
    const result = inLocale("fr", () => parseLanguageChoice("klingon"));
    expect(result).toEqual({
      ok: false,
      error: [{ field: "language", message: "Choisissez une langue dans la liste." }],
    });
  });
});
