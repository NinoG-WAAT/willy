import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../domain/platform/result";
import type { Folder, FolderRepository, FolderWithCount } from "../../ports/folder-repository";
import { isUniqueViolation } from "./transaction";

// published_count is what the owner can open: the same rule as SqliteFolderNotes. note_count is
// every note filed here, including ones whose meeting is hidden, because the delete guard must
// see them (the foreign key would refuse the delete anyway).
const SELECT_WITH_COUNT = `
  SELECT f.id, f.name, f.created_at, f.updated_at,
         (SELECT COUNT(*) FROM note n WHERE n.owner_id = f.owner_id AND n.folder_id = f.id) AS note_count,
         (SELECT COUNT(*) FROM note n JOIN meeting m ON m.owner_id = n.owner_id AND m.id = n.meeting_id
           WHERE n.owner_id = f.owner_id AND n.folder_id = f.id AND n.status = 'published'
             AND m.status NOT IN ('archived', 'deleting', 'deleted')) AS published_count
    FROM folder f`;

function toFolder(row: Record<string, unknown>): FolderWithCount {
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"]),
    noteCount: Number(row["note_count"]),
    publishedCount: Number(row["published_count"]),
  };
}

export class SqliteFolderRepository implements FolderRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(ownerId: string, limit?: number): Promise<FolderWithCount[]> {
    // -1 is SQLite's "no limit"; the bound value is always an integer, never built into the SQL.
    const cap = limit === undefined ? -1 : Math.max(0, Math.floor(limit));
    const rows = this.db
      .prepare(
        `${SELECT_WITH_COUNT} WHERE f.owner_id = ? ORDER BY f.name COLLATE NOCASE, f.id LIMIT ?`,
      )
      .all(ownerId, cap);
    return Promise.resolve(rows.map(toFolder));
  }

  find(ownerId: string, id: string): Promise<FolderWithCount | null> {
    const row = this.db
      .prepare(`${SELECT_WITH_COUNT} WHERE f.owner_id = ? AND f.id = ?`)
      .get(ownerId, id);
    return Promise.resolve(row ? toFolder(row) : null);
  }

  create(ownerId: string, folder: Folder): Promise<Result<void, "name_taken">> {
    try {
      this.db
        .prepare(
          "INSERT INTO folder (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(folder.id, ownerId, folder.name, folder.createdAt, folder.updatedAt);
      return Promise.resolve(ok(undefined));
    } catch (error) {
      if (isUniqueViolation(error)) return Promise.resolve(err("name_taken"));
      throw error;
    }
  }

  rename(
    ownerId: string,
    id: string,
    name: string,
    updatedAt: string,
  ): Promise<Result<void, "not_found" | "name_taken">> {
    try {
      const result = this.db
        .prepare("UPDATE folder SET name = ?, updated_at = ? WHERE owner_id = ? AND id = ?")
        .run(name, updatedAt, ownerId, id);
      return Promise.resolve(Number(result.changes) === 1 ? ok(undefined) : err("not_found"));
    } catch (error) {
      if (isUniqueViolation(error)) return Promise.resolve(err("name_taken"));
      throw error;
    }
  }

  delete(ownerId: string, id: string): Promise<Result<void, "not_found" | "not_empty">> {
    // One statement, so "empty" cannot change between the check and the delete.
    const result = this.db
      .prepare(
        `DELETE FROM folder
          WHERE owner_id = ? AND id = ?
            AND NOT EXISTS (SELECT 1 FROM note WHERE owner_id = ? AND folder_id = ?)`,
      )
      .run(ownerId, id, ownerId, id);
    if (Number(result.changes) === 1) return Promise.resolve(ok(undefined));
    const exists = this.db
      .prepare("SELECT 1 AS x FROM folder WHERE owner_id = ? AND id = ?")
      .get(ownerId, id);
    return Promise.resolve(err(exists ? "not_empty" : "not_found"));
  }
}
