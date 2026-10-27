import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createEnvelopeCipher, parseKeyring } from "../src/adapters/crypto/envelope-cipher";
import { openDatabase } from "../src/adapters/sqlite/database";
import { runMigrations } from "../src/adapters/sqlite/migrate";
import { DEV_KEYRING, seedDatabase } from "../seeds/seed";

// Usage: tsx scripts/db.ts migrate | seed   (local SQLite under WILLY_DATA_DIR)
const command = process.argv[2];
const dataDir = process.env["WILLY_DATA_DIR"] ?? "./data";
mkdirSync(dataDir, { recursive: true });
const db = openDatabase(join(dataDir, "willy.db"));

if (command === "migrate") {
  const { applied } = runMigrations(db, join(process.cwd(), "migrations"));
  console.log(applied.length > 0 ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} else if (command === "seed") {
  runMigrations(db, join(process.cwd(), "migrations"));
  const existing = db.prepare("SELECT COUNT(*) AS n FROM owner").get();
  if (Number(existing?.["n"]) > 0) {
    console.error("Refusing to seed: the database already has owners. Delete the file first.");
    process.exit(1);
  }
  const spec = process.env["ENCRYPTION_KEYS"];
  const activeKeyId = process.env["ENCRYPTION_ACTIVE_KEY_ID"];
  const usingEnvKeys = spec !== undefined && spec !== "" && activeKeyId !== undefined;
  if (!usingEnvKeys)
    console.warn("ENCRYPTION_KEYS not set: seeding with the fake development key.");
  const cipher = usingEnvKeys
    ? createEnvelopeCipher(parseKeyring(spec), activeKeyId)
    : createEnvelopeCipher(parseKeyring(DEV_KEYRING.spec), DEV_KEYRING.activeKeyId);
  const ids = await seedDatabase(db, cipher);
  console.log(`Seeded owners ${ids.ownerA} and ${ids.ownerB}.`);
} else {
  console.error("Usage: tsx scripts/db.ts migrate | seed");
  process.exit(1);
}
