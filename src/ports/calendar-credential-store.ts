/** Stores the sealed (encrypted) OAuth credentials of one owner. Plaintext tokens never cross this port. */
export interface CalendarCredentialStore {
  load(ownerId: string): Promise<string | null>;
  save(ownerId: string, sealed: string): Promise<void>;
}
