import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteLanguageRepository } from "../../../src/adapters/sqlite/language-repository";
import { SqliteSettingsRepository } from "../../../src/adapters/sqlite/settings-repository";
import { FixedClock } from "../../../src/adapters/system/fakes";
import {
  loadLanguage,
  resolveRequestLocale,
  saveLanguage,
  type LanguageDeps,
} from "../../../src/app/settings/language";
import { loadRetention, saveRetention } from "../../../src/app/settings/retention";
import { count, freshDb, owner } from "../../support/db-fixtures";
import { inLocale } from "../../support/locale";

let db: DatabaseSync;
let deps: LanguageDeps;

beforeEach(() => {
  db = freshDb();
  deps = {
    languages: new SqliteLanguageRepository(db),
    clock: new FixedClock(new Date("2026-11-04T09:00:00.000Z")),
  };
  owner(db, "A");
  owner(db, "B");
});

describe("loadLanguage", () => {
  it("is null when the owner never chose, and does not create a settings row by reading", async () => {
    expect(await loadLanguage(deps, "A")).toBeNull();
    expect(count(db, "settings")).toBe(0);
  });

  it("is null for an owner that does not exist (a guessed id learns nothing)", async () => {
    expect(await loadLanguage(deps, "guessed-owner")).toBeNull();
  });
});

describe("saveLanguage", () => {
  it("creates the settings row when the owner has none, with the retention defaults intact", async () => {
    const result = await saveLanguage(deps, "A", "fr");
    expect(result).toEqual({ ok: true, value: "fr" });
    expect(await loadLanguage(deps, "A")).toBe("fr");
    expect(db.prepare("SELECT * FROM settings WHERE owner_id = 'A'").get()).toMatchObject({
      raw_audio_retention_hours: 0,
      note_retention_days: null,
      language: "fr",
      updated_at: "2026-11-04T09:00:00.000Z",
    });
    const retention = { settings: new SqliteSettingsRepository(db), clock: deps.clock };
    expect(await loadRetention(retention, "A")).toEqual({
      rawAudioRetentionHours: 0,
      noteRetentionDays: null,
    });
  });

  it("changes only the language of an existing row: retention is untouched", async () => {
    const retention = { settings: new SqliteSettingsRepository(db), clock: deps.clock };
    await saveRetention(retention, "A", {
      rawAudioRetentionHours: "72",
      noteRetentionDays: "90",
      acknowledged: true,
    });
    await saveLanguage(deps, "A", "fr");
    expect(await loadRetention(retention, "A")).toEqual({
      rawAudioRetentionHours: 72,
      noteRetentionDays: 90,
    });
    await saveLanguage(deps, "A", "en");
    expect(await loadLanguage(deps, "A")).toBe("en");
  });

  it("saving retention afterwards keeps the language", async () => {
    await saveLanguage(deps, "A", "fr");
    const retention = { settings: new SqliteSettingsRepository(db), clock: deps.clock };
    await saveRetention(retention, "A", {
      rawAudioRetentionHours: "24",
      noteRetentionDays: "off",
      acknowledged: false,
    });
    expect(await loadLanguage(deps, "A")).toBe("fr");
  });

  it("owner A cannot change owner B's language: every statement carries the owner id", async () => {
    await saveLanguage(deps, "B", "fr");
    await saveLanguage(deps, "A", "en");
    expect(await loadLanguage(deps, "B")).toBe("fr");
    expect(await loadLanguage(deps, "A")).toBe("en");
    expect(count(db, "settings")).toBe(2);
  });

  it("rejects a value that is not a language and writes nothing", async () => {
    for (const bad of ["de", "", "fr-FR", undefined, 7, "fr' OR 1=1 --"]) {
      const result = await saveLanguage(deps, "A", bad);
      expect(result.ok, String(bad)).toBe(false);
    }
    expect(count(db, "settings")).toBe(0);
  });

  it("the database refuses a language the domain would not (CHECK backstop)", () => {
    expect(() =>
      db
        .prepare("INSERT INTO settings (owner_id, language, updated_at) VALUES ('A', 'de', ?)")
        .run("2026-11-04T09:00:00.000Z"),
    ).toThrow(/CHECK/);
  });

  it("does not create a row for an owner that does not exist", async () => {
    await expect(saveLanguage(deps, "guessed-owner", "fr")).rejects.toThrow(/FOREIGN KEY/);
    expect(count(db, "settings")).toBe(0);
  });
});

describe("resolveRequestLocale: the owner's choice, else the server default", () => {
  it("the owner's setting wins over the default, both ways", async () => {
    await saveLanguage(deps, "A", "fr");
    await saveLanguage(deps, "B", "en");
    expect(await resolveRequestLocale(deps, "A", "en")).toBe("fr");
    expect(await resolveRequestLocale(deps, "B", "fr")).toBe("en");
  });

  it("an owner who never chose gets the default", async () => {
    expect(await resolveRequestLocale(deps, "A", "fr")).toBe("fr");
    expect(await resolveRequestLocale(deps, "A", "en")).toBe("en");
  });

  it("a signed-out request (no owner) gets the default and reads nothing", async () => {
    expect(await resolveRequestLocale(deps, undefined, "fr")).toBe("fr");
  });

  it("another owner's choice never leaks to a request of an owner without one", async () => {
    await saveLanguage(deps, "B", "fr");
    expect(await resolveRequestLocale(deps, "A", "en")).toBe("en");
  });

  it("a failing read never blocks the page: the default is used and the failure is reported", async () => {
    const broken: LanguageDeps = {
      ...deps,
      languages: {
        get: () => Promise.reject(new Error("no such column: language")),
        save: () => Promise.resolve(),
      },
    };
    const failures: unknown[] = [];
    const locale = await resolveRequestLocale(broken, "A", "fr", (cause) => failures.push(cause));
    expect(locale).toBe("fr");
    expect(failures).toHaveLength(1);
  });

  it("a stored value outside the supported list (an operator edit) falls back to the default", async () => {
    // The CHECK blocks this today; the reader must still not trust the column blindly.
    db.exec("PRAGMA ignore_check_constraints = ON");
    db.prepare("INSERT INTO settings (owner_id, language, updated_at) VALUES ('A', 'de', ?)").run(
      "2026-11-04T09:00:00.000Z",
    );
    db.exec("PRAGMA ignore_check_constraints = OFF");
    expect(await resolveRequestLocale(deps, "A", "fr")).toBe("fr");
  });
});

describe("saveLanguage messages", () => {
  it("are worded in the owner's current locale", async () => {
    const result = await inLocale("fr", () => saveLanguage(deps, "A", "klingon"));
    expect(result).toEqual({
      ok: false,
      error: [{ field: "language", message: "Choisissez une langue dans la liste." }],
    });
  });
});

describe("migration 0004 rollback note", () => {
  it("the documented rollback removes the column and leaves retention rows as they were", () => {
    db.prepare(
      "INSERT INTO settings (owner_id, raw_audio_retention_hours, language, updated_at) VALUES ('A', 72, 'fr', ?)",
    ).run("2026-11-04T09:00:00.000Z");
    const doc = readFileSync(join(process.cwd(), "docs", "DATA_MODEL.md"), "utf8");
    expect(doc).toContain("ALTER TABLE settings DROP COLUMN language;");
    db.exec("ALTER TABLE settings DROP COLUMN language;");
    db.exec("DELETE FROM schema_migrations WHERE version = '0004';");
    const row = db.prepare("SELECT * FROM settings WHERE owner_id = 'A'").get();
    expect(row).toMatchObject({ raw_audio_retention_hours: 72 });
    expect(row).not.toHaveProperty("language");
  });
});
