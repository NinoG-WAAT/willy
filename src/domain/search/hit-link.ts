import type { MeetingStatus } from "../meetings/lifecycle";

const REVIEWED: readonly MeetingStatus[] = ["processing", "review", "published", "failed"];

const KIND_LABELS: Readonly<Record<string, string>> = {
  meeting: "Title, agenda or rough notes",
  note_section: "Summary section",
  decision: "Decision",
  action_item: "Action item",
};

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

export function hitKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Note";
}
