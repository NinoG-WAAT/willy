import type { SessionTimes } from "../domain/identity/session-policy";

export interface StoredSession extends SessionTimes {
  id: string;
  ownerId: string;
  /** SHA-256 of the cookie token; the token itself is never stored. */
  tokenHash: string;
  /** Synchronizer token for CSRF; only ever sent to the session's own browser. */
  csrfSecret: string;
}

export interface SessionRepository {
  create(session: StoredSession): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  touch(id: string, lastSeenAt: string, idleExpiresAt: string): Promise<void>;
  revoke(id: string, revokedAt: string): Promise<void>;
}
