import type { Result } from "../domain/platform/result";

export interface VocabularyTerm {
  id: string;
  /** Already normalised by the domain (`normalizeTerm`). */
  term: string;
  createdAt: string;
}

/**
 * Every method is scoped by `ownerId` (taken from the session, never from the request); another
 * owner's term behaves exactly like a missing one.
 */
export interface VocabularyRepository {
  /** The owner's terms in the order they were added: the order the speech recogniser reads them. */
  list(ownerId: string): Promise<VocabularyTerm[]>;
  /**
   * Adds terms in order, all or nothing. A term the owner already has (same letters ignoring
   * case) is skipped, not an error, so a repeated request changes nothing. Returns how many were
   * really added; `limit_reached` when the owner would go over `MAX_TERMS_PER_OWNER`.
   */
  addMany(
    ownerId: string,
    terms: readonly VocabularyTerm[],
  ): Promise<Result<{ added: number }, "limit_reached">>;
  remove(ownerId: string, id: string): Promise<Result<void, "not_found">>;
}
