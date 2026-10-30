import type { MeetingListItem } from "./list-item";
import { statusLabel } from "./stage";

export interface MeetingDescription {
  /** Status in words: state is never conveyed by colour alone. */
  label: string;
  /** A short symbol that accompanies the label (decorative; the label carries the meaning). */
  marker: string;
  actionLabel: string;
  href: string;
}

/** What to show and where to go for a meeting, by lifecycle status (docs/PLAN.md section 3.1). */
export function describeMeeting(
  item: Pick<MeetingListItem, "id" | "status" | "folderName">,
): MeetingDescription {
  const live = `/meetings/${item.id}`;
  const review = `/meetings/${item.id}/review`;
  switch (item.status) {
    case "scheduled":
      return {
        label: statusLabel("scheduled"),
        marker: "○",
        actionLabel: "Start note",
        href: live,
      };
    case "capturing":
      return {
        label: statusLabel("capturing"),
        marker: "●",
        actionLabel: "Return to recording",
        href: live,
      };
    case "paused":
      return { label: statusLabel("paused"), marker: "❚❚", actionLabel: "Resume note", href: live };
    case "processing":
      return {
        label: statusLabel("processing"),
        marker: "…",
        actionLabel: "View progress",
        href: review,
      };
    case "review":
      return {
        label: statusLabel("review"),
        marker: "✎",
        actionLabel: "Review note",
        href: review,
      };
    case "published":
      return {
        label:
          item.folderName === null
            ? statusLabel("published")
            : `${statusLabel("published")} to ${item.folderName}`,
        marker: "✓",
        actionLabel: "Open note",
        href: review,
      };
    case "failed":
      return {
        label: statusLabel("failed"),
        marker: "!",
        actionLabel: "Open and retry",
        href: review,
      };
    case "archived":
      return { label: statusLabel("archived"), marker: "▭", actionLabel: "Open note", href: live };
    case "deleting":
    case "deleted":
      // Never listed; handled for exhaustiveness without leaking anything.
      return { label: statusLabel(item.status), marker: "-", actionLabel: "Back", href: "/" };
  }
}

/** Consent readiness in words. It only ever reports the Owner's own confirmation. */
export function consentLabel(item: MeetingListItem): string {
  return item.consentConfirmedAt === null
    ? "Your consent confirmation is still needed before capture"
    : "You confirmed consent";
}
