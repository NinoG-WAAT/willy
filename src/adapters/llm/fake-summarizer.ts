import type { SummarizerInput } from "../../domain/notes/summary";
import { providerError, type ProviderErrorKind } from "../../domain/platform/provider-error";
import { err } from "../../domain/platform/result";
import type { Summarizer } from "../../ports/summarizer";
import { checkInput, finalizeModelOutput } from "./finalize";

export interface FakeSummarizer extends Summarizer {
  /** Call shapes only: transcript text is never kept. */
  calls: { segments: number; attendees: number; only: string | null }[];
  script: {
    /** The "model" answers the next call with this raw wire-format output (snake_case JSON). */
    respondOnce(output: unknown): void;
    failOnce(kind: ProviderErrorKind): void;
  };
}

const DECISION = /\b(decided|agreed|decision made|we will)\b/i;
const ACTION = /\b(i will|will send|action item)\b/i;

/**
 * Deterministic "model": it never interprets what the transcript says as instructions, it only
 * picks out lines that look like decisions or tasks and cites them. Its output goes through the
 * same schema and grounding checks as a real model's (shared contract suite).
 */
function defaultOutput(input: SummarizerInput): unknown {
  const first = input.segments[0]?.position ?? 0;
  const last = input.segments[input.segments.length - 1]?.position ?? 0;
  const headings = input.only
    ? [input.only.heading]
    : input.template && input.template.sections.length > 0
      ? input.template.sections.map((s) => s.heading)
      : ["Summary"];

  const named = (text: string): string | null =>
    input.attendees.find((a) =>
      new RegExp(
        `\\b${(a.name.split(" ")[0] ?? a.name).replace(/[^\p{L}\p{N}]/gu, "")}\\b`,
        "i",
      ).test(text),
    )?.id ?? null;

  return {
    sections: headings.map((heading) => ({
      heading,
      body: `Covers ${String(input.segments.length)} transcript segments between positions ${String(first)} and ${String(last)}.`,
      source_from: first,
      source_to: last,
    })),
    decisions: input.only
      ? []
      : input.segments
          .filter((s) => DECISION.test(s.text))
          .map((s) => ({ text: s.text, source_from: s.position, source_to: s.position })),
    action_items: input.only
      ? []
      : input.segments
          .filter((s) => ACTION.test(s.text))
          .map((s) => ({
            text: s.text,
            assignee_id: named(s.text),
            due_date: null,
            source_from: s.position,
            source_to: s.position,
          })),
  };
}

export function createFakeSummarizer(): FakeSummarizer {
  const calls: FakeSummarizer["calls"] = [];
  const outputs: unknown[] = [];
  const failures: ProviderErrorKind[] = [];

  return {
    calls,
    script: {
      respondOnce: (output) => outputs.push(output),
      failOnce: (kind) => failures.push(kind),
    },
    summarize(input) {
      const rejected = checkInput(input);
      if (rejected) return Promise.resolve(err(rejected));
      calls.push({
        segments: input.segments.length,
        attendees: input.attendees.length,
        only: input.only?.heading ?? null,
      });
      const kind = failures.shift();
      if (kind !== undefined) {
        return Promise.resolve(err(providerError(kind, `fake provider ${kind}`)));
      }
      const output = outputs.length > 0 ? outputs.shift() : defaultOutput(input);
      return Promise.resolve(finalizeModelOutput(input, output));
    },
  };
}
