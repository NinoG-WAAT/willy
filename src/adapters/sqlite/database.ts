import { DatabaseSync } from "node:sqlite";

/**
 * Opens a local SQLite database (Node dev, tests, CI). Production uses D1, which runs the same
 * migration files; foreign keys are always on there, so we turn them on here too.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  return db;
}
