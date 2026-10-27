import type { IdentityDeps } from "./deps";

/** Revokes the session behind the token. Safe to repeat; unknown tokens are ignored. */
export async function signOut(deps: IdentityDeps, token: string | undefined): Promise<void> {
  if (!token) return;
  const session = await deps.sessions.findByTokenHash(await deps.hashToken(token));
  if (session) await deps.sessions.revoke(session.id, deps.clock.now().toISOString());
}
