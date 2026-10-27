import type { DatabaseSync } from "node:sqlite";
import type { TemplateSection } from "../../domain/notes/template";
import { err, ok, type Result } from "../../domain/platform/result";
import type {
  Template,
  TemplateRepository,
  TemplateWithUsage,
} from "../../ports/template-repository";
import { inTransaction, isUniqueViolation } from "./transaction";

const SELECT_WITH_USAGE = `
  SELECT t.id, t.name, t.sections_json, t.is_default, t.created_at, t.updated_at,
         (SELECT COUNT(*) FROM meeting m WHERE m.owner_id = t.owner_id AND m.template_id = t.id) AS meeting_count
    FROM template t`;

function parseSections(json: string): TemplateSection[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  return parsed.map((item: { heading?: unknown; prompt?: unknown }) => ({
    heading: text(item.heading),
    prompt: text(item.prompt),
  }));
}

function toTemplate(row: Record<string, unknown>): TemplateWithUsage {
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    sections: parseSections(String(row["sections_json"])),
    isDefault: Number(row["is_default"]) === 1,
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"]),
    meetingCount: Number(row["meeting_count"]),
  };
}

export class SqliteTemplateRepository implements TemplateRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(ownerId: string): Promise<TemplateWithUsage[]> {
    const rows = this.db
      .prepare(`${SELECT_WITH_USAGE} WHERE t.owner_id = ? ORDER BY t.name COLLATE NOCASE, t.id`)
      .all(ownerId);
    return Promise.resolve(rows.map(toTemplate));
  }

  find(ownerId: string, id: string): Promise<TemplateWithUsage | null> {
    const row = this.db
      .prepare(`${SELECT_WITH_USAGE} WHERE t.owner_id = ? AND t.id = ?`)
      .get(ownerId, id);
    return Promise.resolve(row ? toTemplate(row) : null);
  }

  findDefault(ownerId: string): Promise<Template | null> {
    const row = this.db
      .prepare(`${SELECT_WITH_USAGE} WHERE t.owner_id = ? AND t.is_default = 1`)
      .get(ownerId);
    return Promise.resolve(row ? toTemplate(row) : null);
  }

  create(ownerId: string, template: Template): Promise<Result<void, "name_taken">> {
    try {
      inTransaction(this.db, () => {
        if (template.isDefault) this.demoteDefault(ownerId);
        this.db
          .prepare(
            `INSERT INTO template (id, owner_id, name, sections_json, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            template.id,
            ownerId,
            template.name,
            JSON.stringify(template.sections),
            template.isDefault ? 1 : 0,
            template.createdAt,
            template.updatedAt,
          );
      });
      return Promise.resolve(ok(undefined));
    } catch (error) {
      if (isUniqueViolation(error)) return Promise.resolve(err("name_taken"));
      throw error;
    }
  }

  update(ownerId: string, template: Template): Promise<Result<void, "not_found" | "name_taken">> {
    try {
      const changed = inTransaction(this.db, () => {
        const exists = this.db
          .prepare("SELECT 1 AS x FROM template WHERE owner_id = ? AND id = ?")
          .get(ownerId, template.id);
        if (!exists) return false;
        if (template.isDefault) this.demoteDefault(ownerId);
        this.db
          .prepare(
            `UPDATE template SET name = ?, sections_json = ?, is_default = ?, updated_at = ?
              WHERE owner_id = ? AND id = ?`,
          )
          .run(
            template.name,
            JSON.stringify(template.sections),
            template.isDefault ? 1 : 0,
            template.updatedAt,
            ownerId,
            template.id,
          );
        return true;
      });
      return Promise.resolve(changed ? ok(undefined) : err("not_found"));
    } catch (error) {
      if (isUniqueViolation(error)) return Promise.resolve(err("name_taken"));
      throw error;
    }
  }

  setDefault(ownerId: string, id: string, updatedAt: string): Promise<Result<void, "not_found">> {
    const found = inTransaction(this.db, () => {
      const exists = this.db
        .prepare("SELECT 1 AS x FROM template WHERE owner_id = ? AND id = ?")
        .get(ownerId, id);
      if (!exists) return false;
      this.demoteDefault(ownerId);
      this.db
        .prepare("UPDATE template SET is_default = 1, updated_at = ? WHERE owner_id = ? AND id = ?")
        .run(updatedAt, ownerId, id);
      return true;
    });
    return Promise.resolve(found ? ok(undefined) : err("not_found"));
  }

  delete(ownerId: string, id: string): Promise<Result<{ detachedMeetings: number }, "not_found">> {
    const outcome = inTransaction(this.db, () => {
      const exists = this.db
        .prepare("SELECT 1 AS x FROM template WHERE owner_id = ? AND id = ?")
        .get(ownerId, id);
      if (!exists) return null;
      // A meeting only remembers its template to pick summary sections; without it the owner's
      // default applies, so detaching is safe and keeps old templates deletable.
      const detached = this.db
        .prepare("UPDATE meeting SET template_id = NULL WHERE owner_id = ? AND template_id = ?")
        .run(ownerId, id);
      this.db.prepare("DELETE FROM template WHERE owner_id = ? AND id = ?").run(ownerId, id);
      return Number(detached.changes);
    });
    return Promise.resolve(outcome === null ? err("not_found") : ok({ detachedMeetings: outcome }));
  }

  private demoteDefault(ownerId: string): void {
    this.db
      .prepare("UPDATE template SET is_default = 0 WHERE owner_id = ? AND is_default = 1")
      .run(ownerId);
  }
}
