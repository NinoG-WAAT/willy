/**
 * Pure authorization predicates (single Owner role). `ownerId` always comes from the session,
 * never from request input. Use cases call these as a second check on top of `owner_id = ?`
 * in every query; a `false` becomes a 404, never a 403, so ids cannot be enumerated.
 */

export interface MeetingRef {
  ownerId: string;
  status: string;
}

export interface OwnedRef {
  ownerId: string;
}

const owns = (ownerId: string, resource: OwnedRef): boolean =>
  ownerId !== "" && ownerId === resource.ownerId;

/** Meetings being deleted behave as nonexistent on every surface, even for their owner. */
const isGone = (m: MeetingRef): boolean => m.status === "deleting" || m.status === "deleted";

export function canViewMeeting(ownerId: string, meeting: MeetingRef): boolean {
  return owns(ownerId, meeting) && !isGone(meeting);
}

export function canEditMeeting(ownerId: string, meeting: MeetingRef): boolean {
  return canViewMeeting(ownerId, meeting);
}

export function canExportMeeting(ownerId: string, meeting: MeetingRef): boolean {
  return canViewMeeting(ownerId, meeting);
}

/** Requesting permanent deletion: any visible meeting. Repeats are handled by idempotency. */
export function canDeleteMeeting(ownerId: string, meeting: MeetingRef): boolean {
  return canViewMeeting(ownerId, meeting);
}

export function canUseFolder(ownerId: string, folder: OwnedRef): boolean {
  return owns(ownerId, folder);
}

export function canUseTemplate(ownerId: string, template: OwnedRef): boolean {
  return owns(ownerId, template);
}
