import { t } from "../../i18n/translate";
import type { MeetingStatus } from "./lifecycle";

/**
 * How a Meeting's lifecycle status is shown to the Owner: one word per status (cards, header,
 * progress text), the five steps of the stepper, and the one action the header offers per stage.
 * Pure presentation rules, no I/O. The status names stay the lifecycle's (`review` is a status);
 * the person sees "Draft".
 */

/**
 * The label of every status. The header, the cards and the progress text all read this. A switch
 * with one literal per case, so the words are looked up for the request's language when shown.
 */
export function statusLabel(status: MeetingStatus): string {
  switch (status) {
    case "scheduled":
      return t("Scheduled");
    case "capturing":
      return t("Recording");
    case "paused":
      return t("Recording paused");
    case "processing":
      return t("Processing");
    case "review":
      return t("Draft");
    case "published":
      return t("Published");
    case "failed":
      return t("Needs attention");
    case "archived":
      return t("Archived");
    // Never shown (such a meeting is a 404); present so the switch is exhaustive.
    case "deleting":
    case "deleted":
      return t("Unavailable");
  }
}

export type StageKey = "scheduled" | "capturing" | "processing" | "draft" | "published";

/** The five steps of the stepper, in order. Their words come from `stepLabel`. */
export const STAGE_STEP_KEYS: readonly StageKey[] = [
  "scheduled",
  "capturing",
  "processing",
  "draft",
  "published",
];

function stepLabel(key: StageKey): string {
  switch (key) {
    case "scheduled":
      return t("Scheduled");
    case "capturing":
      return t("Capturing");
    case "processing":
      return t("Processing");
    case "draft":
      return t("Draft");
    case "published":
      return t("Published");
  }
}

export type StepState = "done" | "current" | "upcoming" | "attention";

export interface Step {
  key: StageKey;
  label: string;
  state: StepState;
  current: boolean;
  /** The state in words: it is never carried by colour alone. */
  stateText: string;
  /** What the step's marker shows: a tick when done, "!" when it needs attention, else its number. */
  mark: string;
}

export type Stage =
  | {
      kind: "flow";
      steps: Step[];
      /** Index of the current step. */
      current: number;
      /** "Step 4 of 5" */
      position: string;
      /** "Step 4 of 5: Draft", with ", paused" or ", needs attention" where it applies. */
      summary: string;
      /** Failed: the Processing step carries an explicit "Needs attention". */
      attention: boolean;
    }
  | { kind: "archived"; label: string }
  | { kind: "gone" };

function stateText(state: StepState): string {
  switch (state) {
    case "done":
      return t("Done");
    case "current":
      return t("Current step");
    case "upcoming":
      return t("Upcoming");
    case "attention":
      return t("Needs attention");
  }
}

/** The step a status sits on. Paused is still Capturing; failed is Processing that needs attention. */
const CURRENT_STEP: Partial<Record<MeetingStatus, StageKey>> = {
  scheduled: "scheduled",
  capturing: "capturing",
  paused: "capturing",
  processing: "processing",
  failed: "processing",
  review: "draft",
  published: "published",
};

/** Where a meeting is in its life. Archived is its own state, and a deleted one has no stage. */
export function stageFor(status: MeetingStatus): Stage {
  if (status === "archived") return { kind: "archived", label: statusLabel("archived") };
  const currentKey = CURRENT_STEP[status];
  if (currentKey === undefined) return { kind: "gone" };
  const current = STAGE_STEP_KEYS.indexOf(currentKey);
  const attention = status === "failed";
  const steps = STAGE_STEP_KEYS.map((key, index): Step => {
    const state: StepState =
      index < current ? "done" : index > current ? "upcoming" : attention ? "attention" : "current";
    return {
      key,
      label: stepLabel(key),
      state,
      current: index === current,
      stateText: stateText(state),
      mark: state === "done" ? "✓" : state === "attention" ? "!" : String(index + 1),
    };
  });
  const total = STAGE_STEP_KEYS.length;
  const params = { current: current + 1, total, step: stepLabel(currentKey) };
  // One sentence per variant: the words after the colon change with the state, and French orders
  // them differently, so the pieces are never joined here.
  const summary = attention
    ? t("Step {current} of {total}: {step}, needs attention", params)
    : status === "paused"
      ? t("Step {current} of {total}: {step}, paused", params)
      : t("Step {current} of {total}: {step}", params);
  return {
    kind: "flow",
    steps,
    current,
    position: t("Step {current} of {total}", { current: current + 1, total }),
    summary,
    attention,
  };
}

export type HeaderPage = "live" | "review";

export interface HeaderAction {
  label: string;
  /** A path, or an in-page anchor to where the action lives. */
  href: string;
  /** Primary is the view's one acid-lime action; secondary is a plain link. */
  emphasis: "primary" | "secondary";
}

export const openDraftLabel = (): string => t("Open the draft");
export const retryLinkLabel = (): string => t("See what happened and retry");

interface HeaderContext {
  meetingId: string;
  noteStatus: "draft" | "published" | null;
  consentConfirmed: boolean;
}

/**
 * The action the header offers at a stage, as a link to where the action lives: the forms keep
 * their own buttons (and their consent and confirmation fields), so nothing is reimplemented.
 * Null where recording is the state (not an invitation), where progress is the page's content, or
 * where the page already has its own one action (the retry on the review of a failed meeting).
 */
export function headerAction(
  page: HeaderPage,
  status: MeetingStatus,
  ctx: HeaderContext,
): HeaderAction | null {
  const reviewHref = `/meetings/${ctx.meetingId}/review`;
  if (page === "live") {
    switch (status) {
      case "scheduled":
        return {
          label: t("Start capture"),
          href: ctx.consentConfirmed ? "#start-button" : "#consent",
          emphasis: "primary",
        };
      case "review":
        return { label: openDraftLabel(), href: reviewHref, emphasis: "primary" };
      case "failed":
        return { label: retryLinkLabel(), href: reviewHref, emphasis: "primary" };
      case "published":
        return { label: t("Open the published note"), href: reviewHref, emphasis: "secondary" };
      default:
        return null;
    }
  }
  if (status === "review" && ctx.noteStatus === "draft") {
    return { label: t("Publish to folder"), href: "#publish", emphasis: "primary" };
  }
  if (status === "published" && ctx.noteStatus === "published") {
    return { label: t("Reopen for editing"), href: "#publish", emphasis: "secondary" };
  }
  return null;
}

export interface HeaderChip {
  kind: "folder" | "template";
  label: string;
  href: string;
}

/** The folder once the note is published into it, then the template when one is set. */
export function headerChips(input: {
  noteStatus: "draft" | "published" | null;
  folder: { id: string; name: string } | null;
  template: { id: string; name: string } | null;
}): HeaderChip[] {
  const chips: HeaderChip[] = [];
  if (input.noteStatus === "published" && input.folder !== null) {
    chips.push({
      kind: "folder",
      label: t("Folder: {name}", { name: input.folder.name }),
      href: `/folders/${input.folder.id}`,
    });
  }
  if (input.template !== null) {
    chips.push({
      kind: "template",
      label: t("Template: {name}", { name: input.template.name }),
      href: `/settings/templates/${input.template.id}`,
    });
  }
  return chips;
}
