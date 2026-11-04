import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../domain/platform/result";
import { MAX_TERMS_PER_OWNER, termKey } from "../../domain/transcription/vocabulary";
import type { VocabularyRepository, VocabularyTerm } from "../../ports/vocabulary-repository";
import { inTransaction, settle } from "./transaction";

const toTerm = (row: Record<string, unknown>): VocabularyTerm => ({
  id: String(row["id"]),
  term: String(row["term"]),
  createdAt: String(row["created_at"]),
});

export class SqliteVocabularyRepository implements VocabularyRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(ownerId: string): Promise<VocabularyTerm[]> {
    // rowid is insertion order, so terms of one batch keep the order they were typed in.
    return settle(() =>
      this.db
        .prepare(
          "SELECT id, term, created_at FROM vocabulary_term WHERE owner_id = ? ORDER BY created_at, rowid",
        )
        .all(ownerId)
        .map(toTerm),
    );
  }

  addMany(
    ownerId: string,
    terms: readonly VocabularyTerm[],
  ): Promise<Result<{ added: number }, "limit_reached">> {
    return settle(() => {
      try {
        return inTransaction(this.db, () => this.insertNew(ownerId, terms));
      } catch (error) {
        // The trigger is the backstop for a writer that raced past the count below.
        if (error instanceof Error && /vocabulary_term_limit/.test(error.message)) {
          return err("limit_reached");
        }
        throw error;
      }
    });
  }

  private insertNew(
    ownerId: string,
    terms: readonly VocabularyTerm[],
  ): Result<{ added: number }, "limit_reached"> {
    const rows = this.db
      .prepare("SELECT term FROM vocabulary_term WHERE owner_id = ?")
      .all(ownerId);
    // The table's UNIQUE folds ASCII case only; folding here makes "Élan" and "élan" one word too.
    const known = new Set(rows.map((r) => termKey(String(r["term"]))));
    const fresh: VocabularyTerm[] = [];
    for (const candidate of terms) {
      const key = termKey(candidate.term);
      if (known.has(key)) continue;
      known.add(key);
      fresh.push(candidate);
    }
    if (rows.length + fresh.length > MAX_TERMS_PER_OWNER) return err("limit_reached");
    const insert = this.db.prepare(
      "INSERT INTO vocabulary_term (id, owner_id, term, created_at) VALUES (?, ?, ?, ?)",
    );
    for (const t of fresh) insert.run(t.id, ownerId, t.term, t.createdAt);
    return ok({ added: fresh.length });
  }

  remove(ownerId: string, id: string): Promise<Result<void, "not_found">> {
    return settle(() => {
      const result = this.db
        .prepare("DELETE FROM vocabulary_term WHERE owner_id = ? AND id = ?")
        .run(ownerId, id);
      return Number(result.changes) === 1 ? ok(undefined) : err("not_found");
    });
  }
}
