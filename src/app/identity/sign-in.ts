import { normalizeEmail } from "../../domain/identity/credentials";
import { startSession } from "../../domain/identity/session-policy";
import { err, ok, type Result } from "../../domain/platform/result";
import type { RateLimitPolicy } from "../../domain/platform/rate-limit";
import type { OwnerSummary } from "../../ports/owner-repository";
import type { IdentityDeps } from "./deps";
import { signOut } from "./sign-out";

const WINDOW_MS = 15 * 60 * 1000;

export interface SignInLimits {
  perEmail: RateLimitPolicy;
  perClient: RateLimitPolicy;
}

export const DEFAULT_SIGN_IN_LIMITS: SignInLimits = {
  perEmail: { limit: 5, windowMs: WINDOW_MS },
  perClient: { limit: 20, windowMs: WINDOW_MS },
};

export interface SignInInput {
  email: string;
  password: string;
  /** Client address (or other caller identity) used for the per-client limit. */
  clientKey: string;
  /** Session cookie presented with the request, revoked on success (rotation). */
  currentSessionToken?: string | undefined;
  limits?: SignInLimits;
}

export interface SignedIn {
  /** Raw session token: set it as a cookie and never store or log it. */
  token: string;
  csrfSecret: string;
  expiresAt: Date;
  owner: OwnerSummary;
}

export type SignInError =
  { kind: "invalid_credentials" } | { kind: "rate_limited"; retryAfterSeconds: number };

export async function signIn(
  deps: IdentityDeps,
  input: SignInInput,
): Promise<Result<SignedIn, SignInError>> {
  const limits = input.limits ?? DEFAULT_SIGN_IN_LIMITS;
  const email = normalizeEmail(input.email);
  const emailKey = `signin:email:${email}`;

  const client = await deps.limiter.consume(`signin:client:${input.clientKey}`, limits.perClient);
  const perEmail = await deps.limiter.consume(emailKey, limits.perEmail);
  if (!client.allowed || !perEmail.allowed) {
    return err({
      kind: "rate_limited",
      retryAfterSeconds: Math.max(client.retryAfterSeconds, perEmail.retryAfterSeconds),
    });
  }

  const owner = await deps.owners.findByEmail(email);
  // Always verify (against nothing for unknown emails) so both failures cost the same.
  const valid = await deps.hasher.verify(input.password, owner?.passwordHash ?? null);
  if (!owner || !valid) return err({ kind: "invalid_credentials" });

  await deps.limiter.reset(emailKey);
  // Rotation: a new session id on every login; the presented session cannot be fixated.
  await signOut(deps, input.currentSessionToken);

  const token = deps.tokens.newToken();
  const csrfSecret = deps.tokens.newToken();
  const times = startSession(deps.clock.now());
  await deps.sessions.create({
    ...times,
    id: deps.ids.newId(),
    ownerId: owner.id,
    tokenHash: await deps.hashToken(token),
    csrfSecret,
  });
  return ok({
    token,
    csrfSecret,
    expiresAt: new Date(times.absoluteExpiresAt),
    owner: { id: owner.id, displayName: owner.displayName },
  });
}
