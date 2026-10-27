import type { Clock } from "../../ports/clock";
import type { IdGenerator, TokenGenerator } from "../../ports/id-generator";
import type { OwnerRepository } from "../../ports/owner-repository";
import type { PasswordHasher } from "../../ports/password-hasher";
import type { RateLimiter } from "../../ports/rate-limiter";
import type { SessionRepository } from "../../ports/session-repository";

export interface IdentityDeps {
  owners: OwnerRepository;
  sessions: SessionRepository;
  hasher: PasswordHasher;
  limiter: RateLimiter;
  clock: Clock;
  ids: IdGenerator;
  tokens: TokenGenerator;
  /** One-way hash for session tokens (SHA-256 hex). */
  hashToken(token: string): Promise<string>;
}
