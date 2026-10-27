import type { DatabaseSync } from "node:sqlite";
import type { SettingsRepository } from "../../ports/settings-repository";

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  rawAudioRetentionHours(ownerId: string): Promise<number> {
    const row = this.db
      .prepare("SELECT raw_audio_retention_hours AS hours FROM settings WHERE owner_id = ?")
      .get(ownerId);
    return Promise.resolve(row ? Number(row["hours"]) : 0);
  }
}
