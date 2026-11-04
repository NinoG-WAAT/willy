import { describe, expect, it } from "vitest";
import { MAX_TERMS_PER_OWNER } from "../../../src/domain/transcription/vocabulary";
import type {
  VocabularyRepository,
  VocabularyTerm,
} from "../../../src/ports/vocabulary-repository";

const T = "2026-10-27T09:00:00.000Z";
let next = 0;
export const term = (text: string, id = `term-${String(next++)}`): VocabularyTerm => ({
  id,
  term: text,
  createdAt: T,
});

const texts = async (repo: VocabularyRepository, ownerId: string): Promise<string[]> =>
  (await repo.list(ownerId)).map((t) => t.term);

/**
 * Shared contract (CLAUDE.md section 5, Liskov): the in-memory fake and the SQLite adapter must
 * behave the same, including owner isolation and the limits. `create` returns a repository whose
 * owners "A" and "B" exist.
 */
export function vocabularyRepositoryContract(
  name: string,
  create: () => VocabularyRepository,
): void {
  describe(`VocabularyRepository contract: ${name}`, () => {
    it("starts empty", async () => {
      expect(await create().list("A")).toEqual([]);
    });

    it("lists terms in the order they were added, also within one batch", async () => {
      const repo = create();
      await repo.addMany("A", [term("Zulu"), term("alpha"), term("Mike")]);
      await repo.addMany("A", [term("Bravo")]);
      expect(await texts(repo, "A")).toEqual(["Zulu", "alpha", "Mike", "Bravo"]);
    });

    it("returns id, term and creation time", async () => {
      const repo = create();
      await repo.addMany("A", [term("SALSA", "t-salsa")]);
      expect(await repo.list("A")).toEqual([{ id: "t-salsa", term: "SALSA", createdAt: T }]);
    });

    it("reports how many terms it really added", async () => {
      const repo = create();
      expect(await repo.addMany("A", [term("one"), term("two")])).toEqual({
        ok: true,
        value: { added: 2 },
      });
    });

    it("skips a term the owner already has, ignoring case, and keeps the first spelling and id", async () => {
      const repo = create();
      await repo.addMany("A", [term("SALSA", "first")]);
      const again = await repo.addMany("A", [term("salsa"), term("Sitetracker")]);
      expect(again).toEqual({ ok: true, value: { added: 1 } });
      expect(await repo.list("A")).toEqual([
        { id: "first", term: "SALSA", createdAt: T },
        expect.objectContaining({ term: "Sitetracker" }),
      ]);
    });

    it("folds letters beyond ASCII too, and Unicode composition", async () => {
      const repo = create();
      await repo.addMany("A", [term("Élan")]);
      const again = await repo.addMany("A", [term("élan"), term("élan")]);
      expect(again).toEqual({ ok: true, value: { added: 0 } });
    });

    it("is a no-op when replayed: same request twice, same list", async () => {
      const repo = create();
      const batch = [term("one", "x1"), term("two", "x2")];
      await repo.addMany("A", batch);
      const replay = await repo.addMany("A", batch);
      expect(replay).toEqual({ ok: true, value: { added: 0 } });
      expect(await texts(repo, "A")).toEqual(["one", "two"]);
    });

    it("skips repeats inside one batch", async () => {
      const repo = create();
      const result = await repo.addMany("A", [term("Dup"), term("dup")]);
      expect(result).toEqual({ ok: true, value: { added: 1 } });
      expect(await texts(repo, "A")).toEqual(["Dup"]);
    });

    it("never shows owner A's terms to owner B, and the same term can live in both lists", async () => {
      const repo = create();
      await repo.addMany("A", [term("Secret project"), term("shared")]);
      expect(await texts(repo, "B")).toEqual([]);
      expect(await repo.addMany("B", [term("Shared")])).toEqual({ ok: true, value: { added: 1 } });
      expect(await texts(repo, "A")).toEqual(["Secret project", "shared"]);
      expect(await texts(repo, "B")).toEqual(["Shared"]);
    });

    it("removes a term of the owner", async () => {
      const repo = create();
      await repo.addMany("A", [term("one", "x1"), term("two", "x2")]);
      expect(await repo.remove("A", "x1")).toEqual({ ok: true, value: undefined });
      expect(await texts(repo, "A")).toEqual(["two"]);
    });

    it("answers not_found for a second removal, an unknown id and another owner's id", async () => {
      const repo = create();
      await repo.addMany("A", [term("mine", "a1")]);
      expect(await repo.remove("B", "a1")).toEqual({ ok: false, error: "not_found" });
      expect(await repo.remove("A", "never-existed")).toEqual({ ok: false, error: "not_found" });
      expect(await texts(repo, "A")).toEqual(["mine"]);
      await repo.remove("A", "a1");
      expect(await repo.remove("A", "a1")).toEqual({ ok: false, error: "not_found" });
    });

    it("lets a removed term be added again", async () => {
      const repo = create();
      await repo.addMany("A", [term("again", "x1")]);
      await repo.remove("A", "x1");
      expect(await repo.addMany("A", [term("Again", "x2")])).toEqual({
        ok: true,
        value: { added: 1 },
      });
    });

    it("accepts exactly the limit and refuses more, adding none of the batch", async () => {
      const repo = create();
      const fill = Array.from({ length: MAX_TERMS_PER_OWNER - 1 }, (_, i) =>
        term(`fill${String(i)}`),
      );
      expect((await repo.addMany("A", fill)).ok).toBe(true);
      const over = await repo.addMany("A", [term("last fits"), term("one too many")]);
      expect(over).toEqual({ ok: false, error: "limit_reached" });
      expect(await repo.list("A")).toHaveLength(MAX_TERMS_PER_OWNER - 1);
      expect((await repo.addMany("A", [term("last fits")])).ok).toBe(true);
      expect(await repo.list("A")).toHaveLength(MAX_TERMS_PER_OWNER);
      // Skipped duplicates do not count against the limit, and the other owner is unaffected.
      expect(await repo.addMany("A", [term("FILL0")])).toEqual({ ok: true, value: { added: 0 } });
      expect((await repo.addMany("B", [term("room")])).ok).toBe(true);
    });
  });
}
