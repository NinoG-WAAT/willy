import type { Locale } from "../i18n/translate";

/** The owner's interface language. Every method is scoped to one owner. */
export interface LanguageRepository {
  /** The owner's choice; null when they have not chosen (or have no settings row yet). */
  get(ownerId: string): Promise<Locale | null>;

  /** Creates or updates only this owner's settings row, leaving its other columns as they are. */
  save(ownerId: string, language: Locale, now: Date): Promise<void>;
}
