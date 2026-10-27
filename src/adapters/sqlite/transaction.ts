import type { DatabaseSync } from "node:sqlite";

/** Runs `work` atomically: commits on return, rolls back and rethrows on any error. */
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** True for a UNIQUE or PRIMARY KEY violation (the DB-level backstop for name uniqueness). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
