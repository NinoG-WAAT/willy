import { err, ok, type Result } from "../../domain/platform/result";
import { MAX_TERMS_PER_OWNER, termKey } from "../../domain/transcription/vocabulary";
import type { VocabularyRepository, VocabularyTerm } from "../../ports/vocabulary-repository";

/** Deterministic stand-in for tests and local development; same contract as the SQLite adapter. */
export function createInMemoryVocabularyRepository(): VocabularyRepository {
  const byOwner = new Map<string, VocabularyTerm[]>();
  const termsOf = (ownerId: string): VocabularyTerm[] => byOwner.get(ownerId) ?? [];

  return {
    list: (ownerId) => Promise.resolve(termsOf(ownerId).map((t) => ({ ...t }))),

    addMany(ownerId, terms): Promise<Result<{ added: number }, "limit_reached">> {
      const current = termsOf(ownerId);
      const known = new Set(current.map((t) => termKey(t.term)));
      const fresh: VocabularyTerm[] = [];
      for (const candidate of terms) {
        const key = termKey(candidate.term);
        if (known.has(key)) continue;
        known.add(key);
        fresh.push({ ...candidate });
      }
      if (current.length + fresh.length > MAX_TERMS_PER_OWNER) {
        return Promise.resolve(err("limit_reached"));
      }
      byOwner.set(ownerId, [...current, ...fresh]);
      return Promise.resolve(ok({ added: fresh.length }));
    },

    remove(ownerId, id): Promise<Result<void, "not_found">> {
      const current = termsOf(ownerId);
      const index = current.findIndex((t) => t.id === id);
      if (index === -1) return Promise.resolve(err("not_found"));
      byOwner.set(
        ownerId,
        current.filter((_, i) => i !== index),
      );
      return Promise.resolve(ok(undefined));
    },
  };
}
