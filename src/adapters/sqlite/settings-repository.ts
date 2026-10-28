import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_RETENTION, type RetentionSettings } from "../../domain/settings/retention";
import type { SettingsRepository } from "../../ports/settings-repository";

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  rawAudioRetentionHours(ownerId: string): Promise<number> {
    const row = this.db
      .prepare("SELECT raw_audio_retention_hours AS hours FROM settings WHERE owner_id = ?")
      .get(ownerId);
    return Promise.resolve(row ? Number(row["hours"]) : 0);
  }

  ownersWithNoteRetention(): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT owner_id FROM settings WHERE note_retention_days IS NOT NULL")
      .all();
    return Promise.resolve(rows.map((r) => String(r["owner_id"])));
  }

  get(ownerId: string): Promise<RetentionSettings> {
    const row = this.db
      .prepare(
        "SELECT raw_audio_retention_hours AS hours, note_retention_days AS days FROM settings WHERE owner_id = ?",
      )
      .get(ownerId);
    if (!row) return Promise.resolve({ ...DEFAULT_RETENTION });
    return Promise.resolve({
      rawAudioRetentionHours: Number(row["hours"]),
      noteRetentionDays: row["days"] === null ? null : Number(row["days"]),
    });
  }

  save(ownerId: string, settings: RetentionSettings, now: Date): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO settings (owner_id, raw_audio_retention_hours, note_retention_days, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (owner_id) DO UPDATE SET
           raw_audio_retention_hours = excluded.raw_audio_retention_hours,
           note_retention_days = excluded.note_retention_days,
           updated_at = excluded.updated_at`,
      )
      .run(ownerId, settings.rawAudioRetentionHours, settings.noteRetentionDays, now.toISOString());
    return Promise.resolve();
  }
}
