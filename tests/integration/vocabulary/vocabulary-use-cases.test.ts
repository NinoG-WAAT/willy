import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteVocabularyRepository } from "../../../src/adapters/sqlite/vocabulary-repository";
import { FixedClock, SequentialIds } from "../../../src/adapters/system/fakes";
import {
  addVocabularyTerms,
  listVocabulary,
  removeVocabularyTerm,
  type VocabularyDeps,
} from "../../../src/app/transcription/vocabulary";
import { MAX_TERMS_PER_OWNER } from "../../../src/domain/transcription/vocabulary";
import { count, freshDb, owner } from "../../support/db-fixtures";

let db: DatabaseSync;
let deps: VocabularyDeps;

beforeEach(() => {
  db = freshDb();
  owner(db, "A");
  owner(db, "B");
  deps = {
    vocabulary: new SqliteVocabularyRepository(db),
    clock: new FixedClock(new Date("2026-10-27T09:00:00.000Z")),
    ids: new SequentialIds("voc"),
  };
});

const terms = async (ownerId: string): Promise<string[]> =>
  (await listVocabulary(deps, ownerId)).terms.map((t) => t.term);

describe("addVocabularyTerms", () => {
  it("adds one term, normalised, with an id and the clock's time", async () => {
    const result = await addVocabularyTerms(deps, "A", "  Site   tracker ");
    expect(result).toEqual({ ok: true, value: { added: 1, alreadyThere: 0 } });
    expect((await listVocabulary(deps, "A")).terms).toEqual([
      { id: "voc-1", term: "Site tracker", createdAt: "2026-10-27T09:00:00.000Z" },
    ]);
  });

  it("adds several terms pasted on separate lines or separated by commas, in order", async () => {
    const result = await addVocabularyTerms(deps, "A", "SALSA, Sitetracker\nAcme\r\nZed");
    expect(result).toEqual({ ok: true, value: { added: 4, alreadyThere: 0 } });
    expect(await terms("A")).toEqual(["SALSA", "Sitetracker", "Acme", "Zed"]);
  });

  it("is an idempotent no-op for a term the owner already has, whatever its case", async () => {
    await addVocabularyTerms(deps, "A", "SALSA");
    const again = await addVocabularyTerms(deps, "A", "salsa");
    expect(again).toEqual({ ok: true, value: { added: 0, alreadyThere: 1 } });
    expect(await terms("A")).toEqual(["SALSA"]);
    expect(count(db, "vocabulary_term")).toBe(1);
  });

  it("adds the new ones of a mixed paste and says how many were already there", async () => {
    await addVocabularyTerms(deps, "A", "SALSA");
    const result = await addVocabularyTerms(deps, "A", "salsa, Acme");
    expect(result).toEqual({ ok: true, value: { added: 1, alreadyThere: 1 } });
  });

  it("refuses invalid input as a validation error and adds nothing of it", async () => {
    const result = await addVocabularyTerms(deps, "A", "fine, --model x");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid");
    expect(await terms("A")).toEqual([]);
    for (const empty of ["", "  ", ",", undefined, 42]) {
      expect((await addVocabularyTerms(deps, "A", empty)).ok).toBe(false);
    }
  });

  it("stops at the limit with a validation error and never truncates", async () => {
    const full = Array.from({ length: MAX_TERMS_PER_OWNER - 1 }, (_, i) => `term${String(i)}`);
    expect((await addVocabularyTerms(deps, "A", full.join("\n"))).ok).toBe(true);
    const over = await addVocabularyTerms(deps, "A", "fits, does not fit");
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error.kind).toBe("invalid");
    expect(await terms("A")).toHaveLength(MAX_TERMS_PER_OWNER - 1);
    expect((await addVocabularyTerms(deps, "A", "fits")).ok).toBe(true);
    // Owner B has their own allowance.
    expect((await addVocabularyTerms(deps, "B", "anything")).ok).toBe(true);
  });

  it("turns a limit hit by a concurrent writer into the same validation error", async () => {
    const racing: VocabularyDeps = {
      ...deps,
      vocabulary: {
        list: () => Promise.resolve([]),
        addMany: () => Promise.resolve({ ok: false, error: "limit_reached" }),
        remove: () => Promise.resolve({ ok: false, error: "not_found" }),
      },
    };
    const result = await addVocabularyTerms(racing, "A", "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid");
  });

  it("keeps an owner's terms away from the other owner", async () => {
    await addVocabularyTerms(deps, "A", "Secret project");
    expect(await terms("B")).toEqual([]);
    expect(await addVocabularyTerms(deps, "B", "secret project")).toEqual({
      ok: true,
      value: { added: 1, alreadyThere: 0 },
    });
    expect(await terms("A")).toEqual(["Secret project"]);
    expect(await terms("B")).toEqual(["secret project"]);
  });
});

describe("removeVocabularyTerm", () => {
  it("removes the owner's term", async () => {
    await addVocabularyTerms(deps, "A", "one, two");
    const [first] = (await listVocabulary(deps, "A")).terms;
    expect(await removeVocabularyTerm(deps, "A", first?.id ?? "")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await terms("A")).toEqual(["two"]);
  });

  it("answers not_found for an unknown id and for another owner's id, changing nothing", async () => {
    await addVocabularyTerms(deps, "A", "mine");
    const [mine] = (await listVocabulary(deps, "A")).terms;
    const foreign = await removeVocabularyTerm(deps, "B", mine?.id ?? "");
    const guessed = await removeVocabularyTerm(deps, "B", "voc-999");
    expect(foreign).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(guessed).toEqual(foreign);
    expect(await terms("A")).toEqual(["mine"]);
  });
});

describe("listVocabulary", () => {
  it("is empty for a new owner", async () => {
    expect(await listVocabulary(deps, "A")).toEqual({
      terms: [],
      usedCount: 0,
      leftOut: [],
      maxTerms: MAX_TERMS_PER_OWNER,
    });
  });

  it("says how many terms the speech recogniser reads and which ones do not fit", async () => {
    const many = Array.from({ length: 120 }, (_, i) => `Project${String(i).padStart(3, "0")}`);
    await addVocabularyTerms(deps, "A", many.join("\n"));
    const view = await listVocabulary(deps, "A");
    expect(view.terms).toHaveLength(120);
    expect(view.usedCount).toBeGreaterThan(30);
    expect(view.usedCount).toBeLessThan(120);
    expect(view.leftOut.map((t) => t.term)).toEqual(many.slice(view.usedCount));
  });

  it("lists only the owner's terms in the view", async () => {
    await addVocabularyTerms(deps, "A", "a-word");
    await addVocabularyTerms(deps, "B", "b-word");
    expect((await listVocabulary(deps, "B")).terms.map((t) => t.term)).toEqual(["b-word"]);
  });
});
