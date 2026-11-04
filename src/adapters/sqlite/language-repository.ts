import type { DatabaseSync } from "node:sqlite";
import { parseLocale, type Locale } from "../../i18n/translate";
import type { LanguageRepository } from "../../ports/language-repository";

/** `settings.language`: NULL until the owner chooses. Same table as retention, its own columns. */
export class SqliteLanguageRepository implements LanguageRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(ownerId: string): Promise<Locale | null> {
    const row = this.db.prepare("SELECT language FROM settings WHERE owner_id = ?").get(ownerId);
    // The CHECK constraint keeps the column valid; an unknown value still reads as "not chosen".
    return Promise.resolve(parseLocale(row?.["language"]));
  }

  save(ownerId: string, language: Locale, now: Date): Promise<void> {
    // Only `language` and `updated_at` are named, so an existing row keeps its retention values and
    // a new row gets the column defaults (audio deleted right after transcription, notes kept).
    this.db
      .prepare(
        `INSERT INTO settings (owner_id, language, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (owner_id) DO UPDATE SET
           language = excluded.language,
           updated_at = excluded.updated_at`,
      )
      .run(ownerId, language, now.toISOString());
    return Promise.resolve();
  }
}
