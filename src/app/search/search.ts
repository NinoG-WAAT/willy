import { buildMatchExpression, parseSearchQuery } from "../../domain/search/query";
import { err, ok, type Result } from "../../domain/platform/result";
import type { FieldError } from "../../domain/platform/text";
import type { SearchHit, SearchIndex } from "../../ports/search-index";

export const MAX_HITS = 50;

export interface SearchDeps {
  index: SearchIndex;
}

export interface SearchInput {
  /** What the owner typed. */
  q: unknown;
  folderId: string | null;
  includeArchived: boolean;
}

export interface SearchResult {
  hits: SearchHit[];
  /** The normalized words searched for, for display. */
  terms: string[];
}

/** Owner-scoped search. The raw text is reduced to plain words before it can reach the index. */
export async function searchNotes(
  deps: SearchDeps,
  ownerId: string,
  input: SearchInput,
): Promise<Result<SearchResult, FieldError>> {
  const terms = parseSearchQuery(input.q);
  if (!terms.ok) return err(terms.error);
  const hits = await deps.index.search(ownerId, {
    match: buildMatchExpression(terms.value),
    folderId: input.folderId,
    includeArchived: input.includeArchived,
    limit: MAX_HITS,
  });
  return ok({ hits, terms: terms.value });
}
