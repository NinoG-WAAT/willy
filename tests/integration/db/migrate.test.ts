import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/adapters/sqlite/database";
import { runMigrations } from "../../../src/adapters/sqlite/migrate";

const realDir = join(process.cwd(), "migrations");

function tempMigrations(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "willy-migrations-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe("runMigrations", () => {
  it("applies every migration file in order and records it", () => {
    const db = openDatabase(":memory:");
    const { applied } = runMigrations(db, realDir);
    const files = readdirSync(realDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(applied).toEqual(files.map((f) => f.replace(/\.sql$/, "")));
    const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
    expect(rows.map((r) => r["version"])).toEqual(applied.map((a) => a.split("_")[0]));
  });

  it("is idempotent: a second run applies nothing", () => {
    const db = openDatabase(":memory:");
    runMigrations(db, realDir);
    expect(runMigrations(db, realDir).applied).toEqual([]);
  });

  it("enables foreign keys on every connection", () => {
    const db = openDatabase(":memory:");
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  it("rolls a failing migration back completely and stops", () => {
    const dir = tempMigrations({
      "0001_ok.sql": "CREATE TABLE a (id INTEGER PRIMARY KEY);",
      "0002_bad.sql": "CREATE TABLE b (id INTEGER PRIMARY KEY); INSERT INTO missing VALUES (1);",
      "0003_never.sql": "CREATE TABLE c (id INTEGER PRIMARY KEY);",
    });
    const db = openDatabase(":memory:");
    expect(() => runMigrations(db, dir)).toThrow(/0002_bad/);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r["name"]);
    expect(tables).toContain("a");
    expect(tables).not.toContain("b");
    expect(tables).not.toContain("c");
    expect(db.prepare("SELECT version FROM schema_migrations").all()).toEqual([
      { version: "0001" },
    ]);
  });

  it("refuses to run when an applied migration file was edited", () => {
    const dir = tempMigrations({ "0001_a.sql": "CREATE TABLE a (id INTEGER PRIMARY KEY);" });
    const db = openDatabase(":memory:");
    runMigrations(db, dir);
    writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (id INTEGER PRIMARY KEY, x TEXT);");
    expect(() => runMigrations(db, dir)).toThrow(/checksum/i);
  });

  it("rejects duplicate or malformed migration numbers", () => {
    const dup = tempMigrations({ "0001_a.sql": "SELECT 1;", "0001_b.sql": "SELECT 1;" });
    expect(() => runMigrations(openDatabase(":memory:"), dup)).toThrow(/duplicate/i);
    const bad = tempMigrations({ "1_a.sql": "SELECT 1;" });
    expect(() => runMigrations(openDatabase(":memory:"), bad)).toThrow(/name/i);
  });
});
