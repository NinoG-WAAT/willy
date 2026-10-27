import { createHash } from "node:crypto";
import { join } from "node:path";
import { openDatabase } from "../../src/adapters/sqlite/database";

/** Moves one session's idle expiry into the past in the e2e server's database (no waiting). */
export function expireSession(token: string): void {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const db = openDatabase(join(dir, "willy.db"));
  try {
    const hash = createHash("sha256").update(token).digest("hex");
    const past = new Date(Date.now() - 60_000).toISOString();
    const result = db
      .prepare("UPDATE session SET idle_expires_at = ? WHERE token_hash = ?")
      .run(past, hash);
    if (result.changes !== 1) throw new Error("session to expire was not found");
  } finally {
    db.close();
  }
}
