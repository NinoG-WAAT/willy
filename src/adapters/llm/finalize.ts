import { verifySummary, type SummarizerInput, type SummaryDraft } from "../../domain/notes/summary";
import { providerError, type ProviderError } from "../../domain/platform/provider-error";
import { err, ok, type Result } from "../../domain/platform/result";
import { allowedHeadings } from "./prompt";
import { parseModelOutput } from "./summary-schema";

/** One summary call must fit in one model request; longer meetings need chunked summaries (out of scope). */
export const MAX_TRANSCRIPT_CHARS = 400_000;

/** Rejects input that must never reach a provider: nothing to summarize, or too much. */
export function checkInput(input: SummarizerInput): ProviderError | null {
  if (input.segments.length === 0) {
    return providerError("rejected", "there is no transcript to summarize");
  }
  const chars = input.segments.reduce((sum, s) => sum + s.text.length, 0);
  if (chars > MAX_TRANSCRIPT_CHARS) {
    return providerError("rejected", "transcript is too long to summarize in one request");
  }
  return null;
}

/**
 * Turns the model's raw answer into a grounded draft: strict schema, then the domain guardrails.
 * Model-quality problems are retryable `unavailable` errors (a retry may do better); messages are
 * fixed text so they never echo model or transcript content.
 */
export function finalizeModelOutput(
  input: SummarizerInput,
  rawOutput: unknown,
): Result<SummaryDraft, ProviderError> {
  const parsed = parseModelOutput(rawOutput);
  if (!parsed.ok) return err(providerError("unavailable", "model returned an invalid summary"));
  const verified = verifySummary(parsed.value, {
    segmentPositions: input.segments.map((s) => s.position),
    attendeeIds: input.attendees.map((a) => a.id),
    templateHeadings: allowedHeadings(input),
    only: input.only,
  });
  if (verified.ok) return ok(verified.value.summary);
  return err(
    providerError(
      "unavailable",
      verified.error.kind === "too_large"
        ? "model summary exceeded size limits"
        : "model summary was not grounded in the transcript",
    ),
  );
}
