import type { MeetingStatus } from "./lifecycle";

/**
 * How a Meeting's lifecycle status is shown to the Owner: one word per status (cards, header,
 * progress text), the five steps of the stepper, and the one action the header offers per stage.
 * Pure presentation rules, no I/O. The status names stay the lifecycle's (`review` is a status);
 * the person sees "Draft".
 */

/** The label of every status. The header, the cards and the progress text all read this table. */
export const STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: "Scheduled",
  capturing: "Recording",
  paused: "Recording paused",
  processing: "Processing",
  review: "Draft",
  published: "Published",
  failed: "Needs attention",
  archived: "Archived",
  // Never shown (such a meeting is a 404); present so the table is exhaustive.
  deleting: "Unavailable",
  deleted: "Unavailable",
};

export const statusLabel = (status: MeetingStatus): string => STATUS_LABELS[status];

export type StageKey = "scheduled" | "capturing" | "processing" | "draft" | "published";

export const STAGE_STEPS: readonly { key: StageKey; label: string }[] = [
  { key: "scheduled", label: "Scheduled" },
  { key: "capturing", label: "Capturing" },
  { key: "processing", label: "Processing" },
  { key: "draft", label: "Draft" },
  { key: "published", label: "Published" },
];

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

const STATE_TEXT: Record<StepState, string> = {
  done: "Done",
  current: "Current step",
  upcoming: "Upcoming",
  attention: "Needs attention",
};

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
  if (status === "archived") return { kind: "archived", label: STATUS_LABELS.archived };
  const currentKey = CURRENT_STEP[status];
  if (currentKey === undefined) return { kind: "gone" };
  const current = STAGE_STEPS.findIndex((s) => s.key === currentKey);
  const attention = status === "failed";
  const steps = STAGE_STEPS.map((s, index): Step => {
    const state: StepState =
      index < current ? "done" : index > current ? "upcoming" : attention ? "attention" : "current";
    return {
      key: s.key,
      label: s.label,
      state,
      current: index === current,
      stateText: STATE_TEXT[state],
      mark: state === "done" ? "✓" : state === "attention" ? "!" : String(index + 1),
    };
  });
  const position = `Step ${String(current + 1)} of ${String(STAGE_STEPS.length)}`;
  const note = attention ? ", needs attention" : status === "paused" ? ", paused" : "";
  return {
    kind: "flow",
    steps,
    current,
    position,
    summary: `${position}: ${STAGE_STEPS[current]?.label ?? ""}${note}`,
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

export const OPEN_DRAFT_LABEL = "Open the draft";
export const RETRY_LINK_LABEL = "See what happened and retry";

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
          label: "Start capture",
          href: ctx.consentConfirmed ? "#start-button" : "#consent",
          emphasis: "primary",
        };
      case "review":
        return { label: OPEN_DRAFT_LABEL, href: reviewHref, emphasis: "primary" };
      case "failed":
        return { label: RETRY_LINK_LABEL, href: reviewHref, emphasis: "primary" };
      case "published":
        return { label: "Open the published note", href: reviewHref, emphasis: "secondary" };
      default:
        return null;
    }
  }
  if (status === "review" && ctx.noteStatus === "draft") {
    return { label: "Publish to folder", href: "#publish", emphasis: "primary" };
  }
  if (status === "published" && ctx.noteStatus === "published") {
    return { label: "Reopen for editing", href: "#publish", emphasis: "secondary" };
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
      label: `Folder: ${input.folder.name}`,
      href: `/folders/${input.folder.id}`,
    });
  }
  if (input.template !== null) {
    chips.push({
      kind: "template",
      label: `Template: ${input.template.name}`,
      href: `/settings/templates/${input.template.id}`,
    });
  }
  return chips;
}
