import type { MeetingListItem } from "./list-item";

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
      return { label: "Not started", marker: "○", actionLabel: "Start note", href: live };
    case "capturing":
      return { label: "Recording", marker: "●", actionLabel: "Return to recording", href: live };
    case "paused":
      return { label: "Recording paused", marker: "❚❚", actionLabel: "Resume note", href: live };
    case "processing":
      return { label: "Transcribing", marker: "…", actionLabel: "View progress", href: review };
    case "review":
      return {
        label: "Draft ready for review",
        marker: "✎",
        actionLabel: "Review note",
        href: review,
      };
    case "published":
      return {
        label: item.folderName === null ? "Published" : `Published to ${item.folderName}`,
        marker: "✓",
        actionLabel: "Open note",
        href: review,
      };
    case "failed":
      return {
        label: "Needs attention: processing failed",
        marker: "!",
        actionLabel: "Open and retry",
        href: review,
      };
    case "archived":
      return { label: "Archived", marker: "▭", actionLabel: "Open note", href: live };
    case "deleting":
    case "deleted":
      // Never listed; handled for exhaustiveness without leaking anything.
      return { label: "Unavailable", marker: "-", actionLabel: "Back", href: "/" };
  }
}

/** Consent readiness in words. It only ever reports the Owner's own confirmation. */
export function consentLabel(item: MeetingListItem): string {
  return item.consentConfirmedAt === null
    ? "Your consent confirmation is still needed before capture"
    : "You confirmed consent";
}
