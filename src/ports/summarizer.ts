import type { SummarizerInput, SummaryDraft } from "../domain/notes/summary";
import type { ProviderError } from "../domain/platform/provider-error";
import type { Result } from "../domain/platform/result";

/**
 * Turns a transcript into a grounded draft (sections, decisions, action items, each with a
 * transcript source range). The returned draft has already passed `verifySummary`: callers may
 * store it as a Draft but must still let a person review and publish it. Provider problems come
 * back as a normalized ProviderError; this never throws for them.
 */
export interface Summarizer {
  summarize(input: SummarizerInput): Promise<Result<SummaryDraft, ProviderError>>;
}
