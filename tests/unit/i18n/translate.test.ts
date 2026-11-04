import { beforeEach, describe, expect, it, vi } from "vitest";

// The module keeps its registry in module state (one catalog set per process, like gettext), so
// every test loads a fresh copy instead of resetting a shared one.
type Translate = typeof import("../../../src/i18n/translate");
let i18n: Translate;

beforeEach(async () => {
  vi.resetModules();
  i18n = await import("../../../src/i18n/translate");
});

function useFrench(entries: Record<string, string> = {}): void {
  i18n.registerCatalog("fr", entries);
  i18n.setLocaleResolver(() => "fr");
}

describe("parseLocale", () => {
  it.each([
    ["en", "en"],
    ["fr", "fr"],
    [" FR ", "fr"],
    ["En", "en"],
  ])("accepts %j", (raw, expected) => {
    expect(i18n.parseLocale(raw)).toBe(expected);
  });

  it.each(["", "de", "fr-FR", "english", "f r", "constructor", "__proto__", null, undefined, 42])(
    "rejects %j",
    (raw) => {
      expect(i18n.parseLocale(raw)).toBeNull();
    },
  );

  it("lists exactly the supported locales", () => {
    expect([...i18n.LOCALES]).toEqual(["en", "fr"]);
  });
});

describe("t in English", () => {
  it("returns the source string unchanged", () => {
    expect(i18n.t("Sign in")).toBe("Sign in");
  });

  it("is English when no resolver is registered", () => {
    expect(i18n.currentLocale()).toBe("en");
  });

  it("is English when the resolver has nothing to say (outside a request)", () => {
    i18n.setLocaleResolver(() => undefined);
    expect(i18n.currentLocale()).toBe("en");
  });

  it("never consults a catalog", () => {
    i18n.registerCatalog("fr", { "Sign in": "Se connecter" });
    expect(i18n.t("Sign in")).toBe("Sign in");
  });

  it("fills {params}", () => {
    expect(i18n.t("Hello {name}, {count} new", { name: "Ada", count: 3 })).toBe("Hello Ada, 3 new");
  });

  it("leaves a missing param visible and does not throw", () => {
    expect(i18n.t("Hello {name}")).toBe("Hello {name}");
    expect(i18n.t("Hello {name}", {})).toBe("Hello {name}");
    expect(i18n.t("Hello {name}", { other: "x" })).toBe("Hello {name}");
  });

  it("does not read inherited object properties as params", () => {
    expect(i18n.t("Hello {constructor}", {})).toBe("Hello {constructor}");
  });

  it("inserts a value literally: no $ replacement patterns, no second pass over {braces}", () => {
    expect(i18n.t("Hello {name}", { name: "$& $1" })).toBe("Hello $& $1");
    expect(i18n.t("{a} and {b}", { a: "{b}", b: "B" })).toBe("{b} and B");
  });

  it("returns markup as plain text, byte for byte (rendering escapes it; see I18N.md)", () => {
    expect(i18n.t("Hi {name}", { name: "<script>alert(1)</script>" })).toBe(
      "Hi <script>alert(1)</script>",
    );
  });
});

describe("t in French", () => {
  it("returns the catalog entry", () => {
    useFrench({ "Sign in": "Se connecter" });
    expect(i18n.t("Sign in")).toBe("Se connecter");
  });

  it("fills {params} in the translation, in any order", () => {
    useFrench({ "{who} wrote {what}": "{what} a été écrit par {who}" });
    expect(i18n.t("{who} wrote {what}", { who: "Ada", what: "ceci" })).toBe(
      "ceci a été écrit par Ada",
    );
  });

  it("leaves a missing param visible in French too", () => {
    useFrench({ "Hello {name}": "Bonjour {name}" });
    expect(i18n.t("Hello {name}")).toBe("Bonjour {name}");
  });

  it("looks up keys that are also Object.prototype names without finding the prototype", () => {
    useFrench({});
    expect(i18n.t("constructor")).toBe("constructor");
    expect(i18n.t("toString")).toBe("toString");
  });

  it("follows the resolver on every call (a request-scoped locale, not a module global)", () => {
    i18n.registerCatalog("fr", { Hello: "Bonjour" });
    let locale: "en" | "fr" = "fr";
    i18n.setLocaleResolver(() => locale);
    expect(i18n.t("Hello")).toBe("Bonjour");
    locale = "en";
    expect(i18n.t("Hello")).toBe("Hello");
  });
});

describe("missing French entries", () => {
  it("falls back to the English source and reports each key once", () => {
    const seen: { locale: string; source: string }[] = [];
    useFrench({});
    i18n.configureI18n({ onMissing: (m) => seen.push(m) });
    expect(i18n.t("Unknown {x}", { x: 1 })).toBe("Unknown 1");
    expect(i18n.t("Unknown {x}", { x: 2 })).toBe("Unknown 2");
    expect(i18n.t("Another")).toBe("Another");
    expect(seen).toEqual([
      { locale: "fr", source: "Unknown {x}" },
      { locale: "fr", source: "Another" },
    ]);
  });

  it("does not report anything in English", () => {
    const onMissing = vi.fn();
    i18n.configureI18n({ onMissing });
    i18n.t("Never translated");
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("throws MissingTranslationError in strict mode, naming the locale and the key", () => {
    useFrench({});
    i18n.configureI18n({ strict: true });
    expect(() => i18n.t("Not there")).toThrow(i18n.MissingTranslationError);
    try {
      i18n.t("Not there");
    } catch (cause) {
      expect(cause).toBeInstanceOf(i18n.MissingTranslationError);
      expect((cause as Error).message).toContain('"Not there"');
      expect((cause as Error).message).toContain("fr");
    }
  });

  it("strict mode does not touch English, and does not throw for a translated key", () => {
    i18n.registerCatalog("fr", { Yes: "Oui" });
    i18n.configureI18n({ strict: true });
    expect(i18n.t("Anything")).toBe("Anything");
    i18n.setLocaleResolver(() => "fr");
    expect(i18n.t("Yes")).toBe("Oui");
  });
});

describe("tn", () => {
  const forms = { "{n} note": "{n} note", "{n} notes": "{n} notes" } as const;

  it("English: one for exactly 1, many for everything else including 0", () => {
    expect(i18n.tn("{n} note", "{n} notes", 0)).toBe("0 notes");
    expect(i18n.tn("{n} note", "{n} notes", 1)).toBe("1 note");
    expect(i18n.tn("{n} note", "{n} notes", 2)).toBe("2 notes");
  });

  it("French: 0 and 1 are singular, 2 and more plural", () => {
    useFrench({ "{n} decision": "{n} décision", "{n} decisions": "{n} décisions" });
    expect(i18n.tn("{n} decision", "{n} decisions", 0)).toBe("0 décision");
    expect(i18n.tn("{n} decision", "{n} decisions", 1)).toBe("1 décision");
    expect(i18n.tn("{n} decision", "{n} decisions", 2)).toBe("2 décisions");
    expect(i18n.tn("{n} decision", "{n} decisions", 21)).toBe("21 décisions");
  });

  it("adds {n} automatically and keeps the caller's other params; the caller cannot override n", () => {
    expect(i18n.tn("{n} of {total} note", "{n} of {total} notes", 3, { total: 9, n: 99 })).toBe(
      "3 of 9 notes",
    );
  });

  it("formats {n} for the locale (thousands separator)", () => {
    expect(i18n.tn("{n} note", "{n} notes", 1234)).toBe("1,234 notes");
    useFrench({ "{n} note": "{n} note", "{n} notes": "{n} notes" });
    // fr-FR groups with a narrow no-break space (U+202F).
    expect(i18n.tn("{n} note", "{n} notes", 1234)).toBe("1 234 notes");
  });

  it("looks both forms up as independent keys, so the catalog stays a flat string map", () => {
    i18n.registerCatalog("fr", { ...forms, "{n} note": "{n} fiche" });
    i18n.setLocaleResolver(() => "fr");
    expect(i18n.tn("{n} note", "{n} notes", 1)).toBe("1 fiche");
    expect(i18n.tn("{n} note", "{n} notes", 5)).toBe("5 notes");
  });

  it("is strict about a missing plural form like t is", () => {
    useFrench({ "{n} item": "{n} élément" });
    i18n.configureI18n({ strict: true });
    expect(i18n.tn("{n} item", "{n} items", 1)).toBe("1 élément");
    expect(() => i18n.tn("{n} item", "{n} items", 2)).toThrow(i18n.MissingTranslationError);
  });
});

describe("msg", () => {
  it("returns the source unchanged in every locale: it only marks a string for extraction", () => {
    useFrench({ Draft: "Brouillon" });
    expect(i18n.msg("Draft")).toBe("Draft");
    expect(i18n.t(i18n.msg("Draft"))).toBe("Brouillon");
  });
});

describe("intlLocale and formatNumber", () => {
  it("maps the locale to the Intl tag the date helpers use", () => {
    expect(i18n.intlLocale("en")).toBe("en-GB");
    expect(i18n.intlLocale("fr")).toBe("fr-FR");
  });

  it("defaults to the current locale", () => {
    expect(i18n.intlLocale()).toBe("en-GB");
    useFrench();
    expect(i18n.intlLocale()).toBe("fr-FR");
    expect(i18n.formatNumber(1234.5)).toBe("1 234,5");
  });
});

describe("registerCatalog", () => {
  it("refuses English: the source string is the English text", () => {
    expect(() => {
      i18n.registerCatalog("en" as never, {});
    }).toThrow(/English/);
  });

  it("replaces an earlier catalog for the same locale (a reload gives the same result)", () => {
    i18n.registerCatalog("fr", { A: "a1" });
    i18n.registerCatalog("fr", { A: "a2" });
    i18n.setLocaleResolver(() => "fr");
    expect(i18n.t("A")).toBe("a2");
  });
});
