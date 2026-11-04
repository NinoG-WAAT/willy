import { err, ok, type Result } from "../../domain/platform/result";
import type { FieldError } from "../../domain/platform/text";
import {
  MAX_TERMS_PER_OWNER,
  buildTranscriptionPrompt,
  limitMessage,
  planAddition,
} from "../../domain/transcription/vocabulary";
import type { Clock } from "../../ports/clock";
import type { IdGenerator } from "../../ports/id-generator";
import type { VocabularyRepository, VocabularyTerm } from "../../ports/vocabulary-repository";

export interface VocabularyDeps {
  vocabulary: VocabularyRepository;
  clock: Clock;
  ids: IdGenerator;
}

/** `not_found` also covers another owner's id (never a 403). */
export type VocabularyError = { kind: "invalid"; errors: FieldError[] } | { kind: "not_found" };

export interface VocabularyView {
  terms: VocabularyTerm[];
  /** How many of the first terms the speech recogniser reads (the prompt has a size budget). */
  usedCount: number;
  /** The terms after those: kept, but not sent to the speech recogniser. */
  leftOut: VocabularyTerm[];
  maxTerms: number;
}

export async function listVocabulary(
  deps: VocabularyDeps,
  ownerId: string,
): Promise<VocabularyView> {
  const terms = await deps.vocabulary.list(ownerId);
  const prompt = buildTranscriptionPrompt(terms.map((t) => t.term));
  return {
    terms,
    usedCount: prompt.used.length,
    leftOut: terms.slice(prompt.used.length),
    maxTerms: MAX_TERMS_PER_OWNER,
  };
}

/**
 * Adds every term of a paste (new lines or commas). Terms the owner already has are skipped, so
 * repeating a request changes nothing. Over the limit is a validation error: nothing is added.
 */
export async function addVocabularyTerms(
  deps: VocabularyDeps,
  ownerId: string,
  raw: unknown,
): Promise<Result<{ added: number; alreadyThere: number }, VocabularyError>> {
  const existing = await deps.vocabulary.list(ownerId);
  const plan = planAddition(
    existing.map((t) => t.term),
    raw,
  );
  if (!plan.ok) return err({ kind: "invalid", errors: plan.error });

  const createdAt = deps.clock.now().toISOString();
  const added = await deps.vocabulary.addMany(
    ownerId,
    plan.value.toAdd.map((term) => ({ id: deps.ids.newId(), term, createdAt })),
  );
  if (!added.ok) {
    // Another request filled the list between our read and the write.
    const have = (await deps.vocabulary.list(ownerId)).length;
    return err({
      kind: "invalid",
      errors: [{ field: "term", message: limitMessage(have, plan.value.toAdd.length) }],
    });
  }
  return ok({ added: added.value.added, alreadyThere: plan.value.alreadyThere });
}

export async function removeVocabularyTerm(
  deps: VocabularyDeps,
  ownerId: string,
  id: string,
): Promise<Result<void, VocabularyError>> {
  const removed = await deps.vocabulary.remove(ownerId, id);
  return removed.ok ? ok(undefined) : err({ kind: "not_found" });
}
