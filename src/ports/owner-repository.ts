export interface OwnerSummary {
  id: string;
  displayName: string;
}

export interface OwnerCredentials extends OwnerSummary {
  /** Null until the owner has a password (seeded but not enabled). */
  passwordHash: string | null;
}

/** Lookups on the owner table itself; every other repository takes the owner id explicitly. */
export interface OwnerRepository {
  findByEmail(normalizedEmail: string): Promise<OwnerCredentials | null>;
  findById(id: string): Promise<OwnerSummary | null>;
}
