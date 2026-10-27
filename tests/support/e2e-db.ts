import { join } from "node:path";
import { createHash } from "node:crypto";
import { openDatabase } from "../../src/adapters/sqlite/database";

/** Inserts a session straight into the e2e server's database (to test expiry without waiting). */
export function insertSession(input: { ownerId: string; token: string; ageMs: number }): void {
  const dir = process.env["E2E_DATA_DIR"];
  if (!dir) throw new Error("E2E_DATA_DIR is not set (set by playwright.config.ts)");
  const db = openDatabase(join(dir, "willy.db"));
  try {
    const created = new Date(Date.now() - input.ageMs);
    const iso = (d: Date) => d.toISOString();
    db.prepare(
      `INSERT INTO session (id, owner_id, token_hash, csrf_secret, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `e2e-${input.token}`,
      input.ownerId,
      createHash("sha256").update(input.token).digest("hex"),
      "csrf",
      iso(created),
      iso(created),
      iso(new Date(created.getTime() + 3600_000)),
      iso(new Date(created.getTime() + 7 * 24 * 3600_000)),
    );
  } finally {
    db.close();
  }
}
