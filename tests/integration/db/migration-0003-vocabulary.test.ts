import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { count, freshDb, insert, owner, T0 } from "../../support/db-fixtures";

let db: DatabaseSync;

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  owner(db, "B");
});

function term(ownerId: string, id: string, text: string, extra: Record<string, string> = {}) {
  insert(db, "vocabulary_term", {
    id,
    owner_id: ownerId,
    term: text,
    created_at: T0,
    ...extra,
  });
}

describe("vocabulary_term (migration 0003)", () => {
  it("stores a term for an owner", () => {
    term("A", "t1", "SALSA");
    expect(count(db, "vocabulary_term")).toBe(1);
  });

  it("refuses a term for an owner that does not exist", () => {
    expect(() => term("nobody", "t1", "SALSA")).toThrow(/FOREIGN KEY/);
  });

  it("refuses the same term twice for one owner, whatever its case", () => {
    term("A", "t1", "SALSA");
    expect(() => term("A", "t2", "salsa")).toThrow(/UNIQUE/);
    expect(() => term("A", "t3", "Salsa")).toThrow(/UNIQUE/);
  });

  it("lets two owners have the same term", () => {
    term("A", "t1", "SALSA");
    term("B", "t2", "SALSA");
    expect(count(db, "vocabulary_term")).toBe(2);
  });

  it("refuses an empty or too long term", () => {
    expect(() => term("A", "t1", "")).toThrow(/CHECK/);
    expect(() => term("A", "t2", "x".repeat(81))).toThrow(/CHECK/);
    term("A", "t3", "x".repeat(80));
  });

  it("refuses control characters, in any position", () => {
    for (const [i, bad] of ["a\u0001b", "a\tb", "a\nb", "a\u001fb", "a\u007fb"].entries()) {
      expect(() => term("A", `c${String(i)}`, bad), JSON.stringify(bad)).toThrow(/CHECK/);
    }
  });

  it("refuses a term that starts with a dash", () => {
    expect(() => term("A", "t1", "-model")).toThrow(/CHECK/);
    term("A", "t2", "e-mail");
  });

  it("refuses untrimmed text and doubled spaces (the domain normalises first)", () => {
    expect(() => term("A", "t1", " SALSA")).toThrow(/CHECK/);
    expect(() => term("A", "t2", "SALSA ")).toThrow(/CHECK/);
    expect(() => term("A", "t3", "Site  tracker")).toThrow(/CHECK/);
  });

  it("refuses a created_at that is not UTC ISO-8601", () => {
    expect(() => term("A", "t1", "SALSA", { created_at: "2026-10-27 09:00:00" })).toThrow(/CHECK/);
  });

  it("refuses the 201st term of an owner, and only of that owner", () => {
    for (let i = 0; i < 200; i++) term("A", `a${String(i)}`, `term${String(i)}`);
    expect(() => term("A", "a200", "one too many")).toThrow(/vocabulary_term_limit/);
    term("B", "b0", "fine for B");
    db.prepare("DELETE FROM vocabulary_term WHERE id = 'a0'").run();
    term("A", "a201", "room again");
  });
});
