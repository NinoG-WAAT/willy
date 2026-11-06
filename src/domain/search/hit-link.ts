import { t } from "../../i18n/translate";
import type { MeetingStatus } from "../meetings/lifecycle";

const REVIEWED: readonly MeetingStatus[] = ["processing", "review", "published", "failed"];

/** Where a hit opens: the review screen once there is a summary, otherwise the live note. */
export function hitHref(
  hit: { meetingId: string; status: MeetingStatus; kind: string; refId: string },
  query: string,
): string {
  const base = REVIEWED.includes(hit.status)
    ? `/meetings/${hit.meetingId}/review`
    : `/meetings/${hit.meetingId}`;
  const params = new URLSearchParams({ q: query, hit: `${hit.kind}:${hit.refId}` });
  return `${base}?${params.toString()}`;
}

/** What part of a meeting matched, in the page language. */
export function hitKindLabel(kind: string): string {
  switch (kind) {
    case "meeting":
      return t("Title, agenda or rough notes");
    case "note_section":
      return t("Summary section");
    case "decision":
      return t("Decision");
    case "action_item":
      return t("Action item");
    default:
      return t("Note");
  }
}
