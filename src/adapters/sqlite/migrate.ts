import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

const FILE_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface MigrationResult {
  /** Names (`0001_init`) applied by this call, in order. */
  applied: string[];
}

interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

/**
 * Applies `migrations/NNNN_name.sql` files in order, each in its own transaction, and records a
 * checksum so an already-applied file can never be edited silently (forward-only rule).
 * Production D1 applies the same files with `wrangler d1 migrations apply`.
 */
export function runMigrations(db: DatabaseSync, dir: string): MigrationResult {
  const files = readMigrationFiles(dir);
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       checksum TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );
  const recorded = new Map<string, string>();
  for (const row of db.prepare("SELECT version, checksum FROM schema_migrations").all()) {
    recorded.set(String(row["version"]), String(row["checksum"]));
  }

  const applied: string[] = [];
  for (const file of files) {
    const previous = recorded.get(file.version);
    if (previous !== undefined) {
      if (previous !== file.checksum) {
        throw new Error(
          `Migration ${file.version}_${file.name} changed after it was applied (checksum mismatch). Add a new migration instead.`,
        );
      }
      continue;
    }
    db.exec("BEGIN");
    try {
      db.exec(file.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(file.version, file.name, file.checksum, new Date().toISOString());
      db.exec("COMMIT");
    } catch (cause) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${file.version}_${file.name} failed and was rolled back`, {
        cause,
      });
    }
    applied.push(`${file.version}_${file.name}`);
  }
  return { applied };
}

function readMigrationFiles(dir: string): MigrationFile[] {
  const seen = new Set<string>();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => {
      const match = FILE_NAME.exec(f);
      const version = match?.[1];
      const name = match?.[2];
      if (!version || !name) {
        throw new Error(`Invalid migration file name: ${f} (expected NNNN_snake_name.sql)`);
      }
      if (seen.has(version)) throw new Error(`Duplicate migration number ${version}`);
      seen.add(version);
      const sql = readFileSync(join(dir, f), "utf8");
      return { version, name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}
