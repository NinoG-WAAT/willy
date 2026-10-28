export interface SettingsRepository {
  /** Hours raw audio is kept after transcription; 0 (the default) deletes it immediately. */
  rawAudioRetentionHours(ownerId: string): Promise<number>;

  /** Owners who set a retention period for notes and transcripts (off by default). */
  ownersWithNoteRetention(): Promise<string[]>;
}
