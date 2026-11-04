import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** src/scripts/i18n.ts: the browser's side of the translation core, driven by <html lang>. */

const page = { documentElement: { lang: "en" } };

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("document", page);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client i18n bootstrap", () => {
  it("reads the locale from <html lang> on every call", async () => {
    const client = await import("../../../src/scripts/i18n");
    page.documentElement.lang = "fr";
    expect(client.currentLocale()).toBe("fr");
    expect(client.t("unknown time")).toBe("heure inconnue");
    page.documentElement.lang = "en";
    expect(client.currentLocale()).toBe("en");
    expect(client.t("unknown time")).toBe("unknown time");
  });

  it("falls back to English for a language it does not know or an empty lang", async () => {
    const client = await import("../../../src/scripts/i18n");
    page.documentElement.lang = "de";
    expect(client.currentLocale()).toBe("en");
    page.documentElement.lang = "";
    expect(client.currentLocale()).toBe("en");
  });

  it("ships only the client catalog: a server-only string is not translated in the browser", async () => {
    const client = await import("../../../src/scripts/i18n");
    page.documentElement.lang = "fr";
    // Translated on the server (src/i18n/fr/auth.ts) but not reachable from any script.
    expect(client.t("Password")).toBe("Password");
  });

  it("shares the core with the domain modules scripts import (one resolver, one catalog)", async () => {
    const client = await import("../../../src/scripts/i18n");
    const core = await import("../../../src/i18n/translate");
    page.documentElement.lang = "fr";
    expect(core.t("unknown time")).toBe("heure inconnue");
    expect(client.tn("{n} a", "{n} b", 1)).toBe("1 a");
  });
});
