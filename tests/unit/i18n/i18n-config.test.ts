import { describe, expect, it } from "vitest";
import { readI18nConfig } from "../../../src/adapters/i18n/config";

describe("readI18nConfig", () => {
  it("defaults to English and non-strict so a fresh checkout and every existing test are unchanged", () => {
    expect(readI18nConfig({})).toEqual({ ok: true, value: { defaultLocale: "en", strict: false } });
    expect(readI18nConfig({ WILLY_DEFAULT_LOCALE: "", WILLY_I18N_STRICT: "" })).toEqual({
      ok: true,
      value: { defaultLocale: "en", strict: false },
    });
  });

  it("reads the default locale and strict mode", () => {
    expect(readI18nConfig({ WILLY_DEFAULT_LOCALE: "fr", WILLY_I18N_STRICT: "1" })).toEqual({
      ok: true,
      value: { defaultLocale: "fr", strict: true },
    });
    expect(readI18nConfig({ WILLY_DEFAULT_LOCALE: " FR ", WILLY_I18N_STRICT: "0" })).toEqual({
      ok: true,
      value: { defaultLocale: "fr", strict: false },
    });
  });

  it("rejects an unknown locale, naming the variable but not echoing the value", () => {
    const result = readI18nConfig({ WILLY_DEFAULT_LOCALE: "klingon" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("WILLY_DEFAULT_LOCALE");
      expect(result.error).toContain("en, fr");
      expect(result.error).not.toContain("klingon");
    }
  });

  it("rejects a strict flag that is not 1 or 0", () => {
    const result = readI18nConfig({ WILLY_I18N_STRICT: "yes" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("WILLY_I18N_STRICT");
  });
});
