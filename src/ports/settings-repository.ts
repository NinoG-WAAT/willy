export interface SettingsRepository {
  /** Hours raw audio is kept after transcription; 0 (the default) deletes it immediately. */
  rawAudioRetentionHours(ownerId: string): Promise<number>;
}
