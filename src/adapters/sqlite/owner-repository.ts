import type { DatabaseSync } from "node:sqlite";
import type { OwnerCredentials, OwnerRepository, OwnerSummary } from "../../ports/owner-repository";

export class SqliteOwnerRepository implements OwnerRepository {
  constructor(private readonly db: DatabaseSync) {}

  findByEmail(normalizedEmail: string): Promise<OwnerCredentials | null> {
    const row = this.db
      .prepare("SELECT id, display_name, password_hash FROM owner WHERE email = ?")
      .get(normalizedEmail);
    if (!row) return Promise.resolve(null);
    const hash = row["password_hash"];
    return Promise.resolve({
      id: String(row["id"]),
      displayName: String(row["display_name"]),
      passwordHash: typeof hash === "string" ? hash : null,
    });
  }

  findById(id: string): Promise<OwnerSummary | null> {
    const row = this.db.prepare("SELECT id, display_name FROM owner WHERE id = ?").get(id);
    return Promise.resolve(
      row ? { id: String(row["id"]), displayName: String(row["display_name"]) } : null,
    );
  }
}
