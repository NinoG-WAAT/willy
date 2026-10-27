import type { DatabaseSync } from "node:sqlite";
import type { SessionRepository, StoredSession } from "../../ports/session-repository";

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(s: StoredSession): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO session (id, owner_id, token_hash, csrf_secret, created_at, last_seen_at,
                              idle_expires_at, absolute_expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.id,
        s.ownerId,
        s.tokenHash,
        s.csrfSecret,
        s.createdAt,
        s.lastSeenAt,
        s.idleExpiresAt,
        s.absoluteExpiresAt,
        s.revokedAt,
      );
    return Promise.resolve();
  }

  findByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const r = this.db.prepare("SELECT * FROM session WHERE token_hash = ?").get(tokenHash);
    if (!r) return Promise.resolve(null);
    const revoked = r["revoked_at"];
    return Promise.resolve({
      id: String(r["id"]),
      ownerId: String(r["owner_id"]),
      tokenHash: String(r["token_hash"]),
      csrfSecret: String(r["csrf_secret"]),
      createdAt: String(r["created_at"]),
      lastSeenAt: String(r["last_seen_at"]),
      idleExpiresAt: String(r["idle_expires_at"]),
      absoluteExpiresAt: String(r["absolute_expires_at"]),
      revokedAt: typeof revoked === "string" ? revoked : null,
    });
  }

  touch(id: string, lastSeenAt: string, idleExpiresAt: string): Promise<void> {
    this.db
      .prepare("UPDATE session SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?")
      .run(lastSeenAt, idleExpiresAt, id);
    return Promise.resolve();
  }

  revoke(id: string, revokedAt: string): Promise<void> {
    this.db
      .prepare("UPDATE session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(revokedAt, id);
    return Promise.resolve();
  }
}
