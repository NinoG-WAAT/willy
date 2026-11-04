import { describe, expect, it } from "vitest";
import { createInMemoryVocabularyRepository } from "../../../src/adapters/memory/in-memory-vocabulary-repository";
import { SqliteVocabularyRepository } from "../../../src/adapters/sqlite/vocabulary-repository";
import { freshDb, owner } from "../../support/db-fixtures";
import { term, vocabularyRepositoryContract } from "./vocabulary-repository.contract";

vocabularyRepositoryContract("in-memory fake", () => createInMemoryVocabularyRepository());

vocabularyRepositoryContract("SQLite", () => {
  const db = freshDb();
  owner(db, "A");
  owner(db, "B");
  return new SqliteVocabularyRepository(db);
});

describe("SQLite adapter specifics", () => {
  it("stores nothing of a batch that goes over the limit, even when the first terms fit", async () => {
    const db = freshDb();
    owner(db, "A");
    const repo = new SqliteVocabularyRepository(db);
    await repo.addMany(
      "A",
      Array.from({ length: 199 }, (_, i) => term(`t${String(i)}`)),
    );
    await repo.addMany("A", [term("x"), term("y")]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM vocabulary_term").get()).toEqual({ n: 199 });
  });

  it("binds every value: a hostile term is stored as text and nothing else happens", async () => {
    const db = freshDb();
    owner(db, "A");
    const repo = new SqliteVocabularyRepository(db);
    const hostile = "x'); DROP TABLE vocabulary_term; --";
    await repo.addMany("A", [term(hostile)]);
    expect((await repo.list("A")).map((t) => t.term)).toEqual([hostile]);
  });

  it("surfaces a term the CHECK constraints refuse as an error, never as a silent skip", async () => {
    const db = freshDb();
    owner(db, "A");
    const repo = new SqliteVocabularyRepository(db);
    await expect(repo.addMany("A", [term("-flag")])).rejects.toThrow(/CHECK/);
    expect(await repo.list("A")).toEqual([]);
  });
});
