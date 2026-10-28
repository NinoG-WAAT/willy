import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteSettingsRepository } from "../../../src/adapters/sqlite/settings-repository";
import { FixedClock } from "../../../src/adapters/system/fakes";
import {
  loadRetention,
  saveRetention,
  type RetentionDeps,
} from "../../../src/app/settings/retention";
import { count, freshDb, owner } from "../../support/db-fixtures";

let db: DatabaseSync;
let deps: RetentionDeps;
let settings: SqliteSettingsRepository;

beforeEach(() => {
  db = freshDb();
  settings = new SqliteSettingsRepository(db);
  deps = { settings, clock: new FixedClock(new Date("2026-10-27T10:00:00.000Z")) };
  owner(db, "A");
  owner(db, "B");
});

const form = (over: Record<string, string | boolean | undefined> = {}) => ({
  rawAudioRetentionHours: "0" as string | undefined,
  noteRetentionDays: "off" as string | undefined,
  acknowledged: false,
  ...over,
});

describe("loadRetention", () => {
  it("defaults to deleting raw audio after transcription and keeping notes, with no stored row", async () => {
    expect(await loadRetention(deps, "A")).toEqual({
      rawAudioRetentionHours: 0,
      noteRetentionDays: null,
    });
    expect(count(db, "settings")).toBe(0);
  });
});

describe("saveRetention", () => {
  it("stores the owner's choice and reads it back", async () => {
    const result = await saveRetention(
      deps,
      "A",
      form({ rawAudioRetentionHours: "72", noteRetentionDays: "90", acknowledged: true }),
    );
    expect(result).toEqual({ ok: true, value: { rawAudioRetentionHours: 72, noteRetentionDays: 90 } });
    expect(await loadRetention(deps, "A")).toEqual({
      rawAudioRetentionHours: 72,
      noteRetentionDays: 90,
    });
    expect(
      db.prepare("SELECT updated_at FROM settings WHERE owner_id = 'A'").get()?.["updated_at"],
    ).toBe("2026-10-27T10:00:00.000Z");
  });

  it("changes only the signed-in owner's row", async () => {
    await saveRetention(deps, "B", form({ rawAudioRetentionHours: "24" }));
    await saveRetention(
      deps,
      "A",
      form({ rawAudioRetentionHours: "168", noteRetentionDays: "30", acknowledged: true }),
    );
    expect(await loadRetention(deps, "B")).toEqual({
      rawAudioRetentionHours: 24,
      noteRetentionDays: null,
    });
    expect(await settings.ownersWithNoteRetention()).toEqual(["A"]);
  });

  it("can switch note expiry off again and update in place", async () => {
    await saveRetention(deps, "A", form({ noteRetentionDays: "30", acknowledged: true }));
    await saveRetention(deps, "A", form());
    expect(await loadRetention(deps, "A")).toEqual({
      rawAudioRetentionHours: 0,
      noteRetentionDays: null,
    });
    expect(count(db, "settings", "owner_id = 'A'")).toBe(1);
    expect(await settings.ownersWithNoteRetention()).toEqual([]);
  });

  it("refuses invalid input and writes nothing", async () => {
    const result = await saveRetention(deps, "A", form({ rawAudioRetentionHours: "9999" }));
    expect(result).toMatchObject({ ok: false, error: [{ field: "raw_audio_retention_hours" }] });
    expect(count(db, "settings")).toBe(0);
  });

  it("refuses to start deleting old notes without the acknowledgement", async () => {
    const result = await saveRetention(deps, "A", form({ noteRetentionDays: "30" }));
    expect(result).toMatchObject({ ok: false, error: [{ field: "acknowledge_note_retention" }] });
    expect(await settings.ownersWithNoteRetention()).toEqual([]);
  });
});
