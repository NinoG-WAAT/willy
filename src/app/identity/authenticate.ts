import { sessionState, touchedTimes } from "../../domain/identity/session-policy";
import type { OwnerSummary } from "../../ports/owner-repository";
import type { IdentityDeps } from "./deps";

export type AuthResult =
  | { status: "anonymous" }
  | { status: "expired" }
  | {
      status: "authenticated";
      owner: OwnerSummary;
      session: { id: string; csrfSecret: string };
    };

/**
 * Resolves the session cookie to an Owner. Unknown, revoked or ownerless sessions are
 * "anonymous" (signed out); idle or absolute expiry is "expired" so the UI can say so.
 */
export async function authenticateSession(
  deps: IdentityDeps,
  token: string | undefined,
): Promise<AuthResult> {
  if (!token) return { status: "anonymous" };
  const session = await deps.sessions.findByTokenHash(await deps.hashToken(token));
  if (!session) return { status: "anonymous" };

  const now = deps.clock.now();
  const state = sessionState(session, now);
  if (state === "revoked") return { status: "anonymous" };
  if (state !== "active") return { status: "expired" };

  const owner = await deps.owners.findById(session.ownerId);
  if (!owner) return { status: "anonymous" };

  const touched = touchedTimes(session, now);
  if (touched) await deps.sessions.touch(session.id, touched.lastSeenAt, touched.idleExpiresAt);

  return {
    status: "authenticated",
    owner,
    session: { id: session.id, csrfSecret: session.csrfSecret },
  };
}
