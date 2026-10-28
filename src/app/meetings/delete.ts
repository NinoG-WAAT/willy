import { requestDeletion } from "../../domain/meetings/lifecycle";
import { runTransition, type MeetingDeps } from "./capture";

/**
 * Step one of permanent deletion: marks the meeting `deleting` and queues exactly one deletion
 * job in the same transaction (audit event included). From this moment the meeting is a 404 on
 * every surface (status, upload, export, search, guessed URLs), even for its owner; search hits
 * vanish in the same transaction. Repeating the request is a 404 too, so it cannot queue a second
 * job. `retention` is used by the retention sweeper and recorded as the system acting.
 */
export const requestMeetingDeletion = (
  deps: MeetingDeps,
  ownerId: string,
  meetingId: string,
  trigger: "owner" | "retention" = "owner",
) => runTransition(deps, ownerId, meetingId, (m, now) => requestDeletion(m, now, trigger));
