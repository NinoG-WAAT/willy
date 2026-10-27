import type { OwnerSummary } from "../../ports/owner-repository";

/**
 * Owner-scoped routes are protected by the middleware (default deny), so a missing owner here is
 * a bug, not a user error. Always pass the returned id to repositories; never read an owner id
 * from the URL, form or body.
 */
export function requireOwner(locals: { owner?: OwnerSummary | undefined }): OwnerSummary {
  if (!locals.owner) throw new Error("requireOwner called on a route that is not owner-protected");
  return locals.owner;
}
