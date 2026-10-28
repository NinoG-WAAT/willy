import type { RetentionSettings } from "../domain/settings/retention";

export interface SettingsRepository {
  /** Hours raw audio is kept after transcription; 0 (the default) deletes it immediately. */
  rawAudioRetentionHours(ownerId: string): Promise<number>;

  /** Owners who set a retention period for notes and transcripts (off by default). */
  ownersWithNoteRetention(): Promise<string[]>;

  /** The owner's retention settings; the defaults when nothing has been saved. */
  get(ownerId: string): Promise<RetentionSettings>;

  /** Creates or updates only this owner's row. */
  save(ownerId: string, settings: RetentionSettings, now: Date): Promise<void>;
}
