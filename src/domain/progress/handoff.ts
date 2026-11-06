import { t, tn } from "../../i18n/translate";
import {
  describeJob,
  reviewLinkLabel,
  type ChunkCounts,
  type JobProgress,
  type ProcessingPayload,
} from "./text";

/**
 * The hand-off after Stop (issue #66): what the live note says while the transcript and the draft
 * are prepared, and whether the page may open the draft by itself. Pure, like text.ts: the server
 * render and the polling script use the same functions, so a reload and a live update agree.
 * Inputs are codes and counters from the status endpoint, never titles, notes or transcript text.
 */

export type HandoffStage = "transcribing" | "writing" | "ready" | "failed" | "moved";

export interface HandoffView {
  stage: HandoffStage;
  /**
   * Text by field name: headline, transcribe, draft, note, outcome, link, announce. Empty text
   * means "nothing to say here" (optional fields are hidden while empty).
   */
  fields: Record<string, string>;
  /** Parts done out of all parts, while a count is known and transcription is running. */
  bar: { value: number; max: number } | null;
  settled: boolean;
}

/**
 * Said in the live region just before the page navigates to the draft. A function, not a
 * constant: the words depend on the page's language, which is only known per request.
 */
export const openingAnnouncement = (): string => t("Draft ready, opening it.");
/** Said instead when the page stays: the button is the way on. */
export const stayingAnnouncement = (): string => t("Draft ready. Use the Open the draft button.");

/** Time for the announcement to be heard before the page changes. */
export const AUTO_OPEN_DELAY_MS = 1_500;

function headline(stage: HandoffStage): string {
  switch (stage) {
    case "ready":
      return t("Recording finished. A draft is ready for review.");
    case "failed":
      return t("Recording finished, but processing needs attention.");
    default:
      return t("Recording finished. Preparing the transcript.");
  }
}

export function handoffStage(payload: ProcessingPayload): HandoffStage {
  switch (payload.meetingStatus) {
    case "processing":
      return payload.job?.status === "succeeded" ? "writing" : "transcribing";
    case "review":
      return "ready";
    case "failed":
      return "failed";
    default:
      return "moved";
  }
}

/** Parts whose text exists: transcribed, or transcribed and then purged of their raw audio. */
const done = (chunks: ChunkCounts): number => chunks.transcribed + chunks.purged;

function transcribeLine(payload: ProcessingPayload, stage: HandoffStage): string {
  const { chunks } = payload;
  if (stage === "transcribing" && chunks !== null && chunks.total > 0) {
    return tn(
      "Transcribing: {done} of {n} part",
      "Transcribing: {done} of {n} parts",
      chunks.total,
      { done: done(chunks) },
    );
  }
  if (stage === "writing" && chunks !== null && chunks.total > 0) {
    return tn("Transcribing: Done, {n} part", "Transcribing: Done, {n} parts", chunks.total);
  }
  return t("Transcribing: {status}", { status: describeJob(payload.job) });
}

function draftLine(payload: ProcessingPayload, stage: HandoffStage): string {
  if (stage === "transcribing") return t("Writing the draft: Waiting for the transcript");
  if (stage === "ready") return t("Writing the draft: Done");
  const summary: JobProgress | null = payload.summary;
  if (summary !== null) return t("Writing the draft: {status}", { status: describeJob(summary) });
  return t("Writing the draft: {status}", {
    status: stage === "writing" ? t("Waiting to start") : t("Not started"),
  });
}

function noteLine(payload: ProcessingPayload, stage: HandoffStage): string {
  const { chunks, job } = payload;
  const sentences: string[] = [];
  if (stage === "transcribing") {
    if (chunks !== null && chunks.failed > 0) {
      sentences.push(
        tn(
          "{n} part could not be transcribed yet.",
          "{n} parts could not be transcribed yet.",
          chunks.failed,
        ),
      );
    }
    if (job?.status === "retrying") {
      sentences.push(
        t("Retrying automatically (attempt {attempt} of {max}). Parts already done are kept.", {
          attempt: job.attempts,
          max: job.maxAttempts,
        }),
      );
    }
  } else if (stage === "failed" && chunks !== null) {
    if (chunks.failed > 0) {
      sentences.push(
        tn(
          "{n} part could not be transcribed.",
          "{n} parts could not be transcribed.",
          chunks.failed,
        ),
      );
    }
    if (done(chunks) > 0) {
      sentences.push(tn("{n} part is kept.", "{n} parts are kept.", done(chunks)));
    }
  }
  return sentences.join(" ");
}

/**
 * The words of the hand-off block for a status answer. `autoOpening` says that the page is about
 * to navigate to the draft, which changes what is announced (and only that).
 */
export function handoffProgress(
  payload: ProcessingPayload,
  options: { autoOpening?: boolean } = {},
): HandoffView {
  const stage = handoffStage(payload);
  const link = reviewLinkLabel(payload.meetingStatus) ?? "";
  const fields: Record<string, string> = {
    headline: headline(stage),
    transcribe: transcribeLine(payload, stage),
    draft: draftLine(payload, stage),
    note: noteLine(payload, stage),
    outcome: "",
    link,
    announce: "",
  };

  switch (stage) {
    case "transcribing":
      break;
    case "writing":
      fields["announce"] = t("Transcript done. Writing the draft.");
      break;
    case "ready":
      fields["transcribe"] = t("Transcribing: Done");
      fields["outcome"] = t("Your draft is ready.");
      fields["announce"] = options.autoOpening ? openingAnnouncement() : stayingAnnouncement();
      break;
    case "failed":
      fields["outcome"] = t("Processing did not finish. Your rough notes are kept.");
      fields["announce"] = t(
        "Processing needs attention. Your rough notes are kept. " +
          "Use the See what happened and retry button.",
      );
      break;
    case "moved":
      fields["outcome"] = t("This note has moved on. Use Check again to see where it is now.");
      break;
  }

  const { chunks } = payload;
  const bar =
    stage === "transcribing" && chunks !== null && chunks.total > 0
      ? { value: Math.min(done(chunks), chunks.total), max: chunks.total }
      : null;
  return { stage, fields, bar, settled: stage !== "transcribing" && stage !== "writing" };
}

/** What an element a person can type into looks like to the page. */
export interface FocusTarget {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}

/** Input types where a key press does not enter text: focus there is not "typing". */
const NON_TEXT_INPUT_TYPES: readonly string[] = [
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "image",
];

/**
 * True when the focused element is somewhere the owner is (or may be about to be) entering text:
 * an input that takes text, a textarea, a select, or a contenteditable region. A select is
 * included on purpose: typing a letter changes its value.
 */
export function isTypingTarget(target: FocusTarget | null): boolean {
  if (target === null) return false;
  if (target.isContentEditable === true) return true;
  switch (target.tagName.toUpperCase()) {
    case "TEXTAREA":
    case "SELECT":
      return true;
    case "INPUT":
      return !NON_TEXT_INPUT_TYPES.includes((target.type ?? "").toLowerCase());
    default:
      return false;
  }
}

export interface AutoOpenInput {
  stage: HandoffStage;
  /** Focus is in a text field (see isTypingTarget). */
  focusInTextField: boolean;
  /** The rough notes hold changes the server may not have yet. */
  unsavedNotes: boolean;
  reducedMotion: boolean;
}

export type AutoOpenDecision =
  | { open: true; delayMs: number; animate: boolean }
  | { open: false; reason: "not_ready" | "typing" | "unsaved_notes" };

/**
 * Whether the live note may navigate to the draft by itself (decision Q1 of the UX redesign,
 * which bends the #63 "link, not redirect" rule). Only a ready draft opens, and only when the
 * owner is not typing: a page change under someone writing would eat their words or their
 * place. Failure never opens (the retry is the owner's call). Reduced motion does not stop the
 * navigation (a page change is not an animation) but turns the page's own animation off.
 */
export function decideAutoOpen(input: AutoOpenInput): AutoOpenDecision {
  if (input.stage !== "ready") return { open: false, reason: "not_ready" };
  if (input.focusInTextField) return { open: false, reason: "typing" };
  if (input.unsavedNotes) return { open: false, reason: "unsaved_notes" };
  return { open: true, delayMs: AUTO_OPEN_DELAY_MS, animate: !input.reducedMotion };
}
