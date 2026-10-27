import {
  buildAuthorizationUrl,
  createOAuthState,
  isAllowedRedirectUri,
  verifyOAuthState,
} from "../../domain/calendar/oauth";
import type { ProviderError } from "../../domain/platform/provider-error";
import { err, ok, type Result } from "../../domain/platform/result";

export interface ConnectDeps {
  clientId: string;
  stateSecret: string;
  redirectAllowlist: readonly string[];
  now: () => Date;
  newNonce: () => string;
  credentials: {
    exchangeCode(
      ownerId: string,
      code: string,
      redirectUri: string,
    ): Promise<Result<void, ProviderError>>;
  };
}

export type ConnectError =
  | { reason: "redirect_not_allowed" }
  | { reason: "invalid_state" }
  | { reason: "exchange_failed"; cause: ProviderError };

const nowSec = (deps: ConnectDeps) => Math.floor(deps.now().getTime() / 1000);

/** Step 1: build the provider URL. The state is bound to the signed-in Owner. */
export async function beginCalendarConnect(
  deps: ConnectDeps,
  ownerId: string,
  redirectUri: string,
): Promise<Result<{ authorizationUrl: string }, ConnectError>> {
  if (!isAllowedRedirectUri(redirectUri, deps.redirectAllowlist))
    return err({ reason: "redirect_not_allowed" });
  const state = await createOAuthState({
    secret: deps.stateSecret,
    ownerId,
    nonce: deps.newNonce(),
    nowSec: nowSec(deps),
  });
  return ok({
    authorizationUrl: buildAuthorizationUrl({ clientId: deps.clientId, redirectUri, state }),
  });
}

/** Step 2: callback. Verifies redirect allowlist and state before the code is ever sent to the provider. */
export async function completeCalendarConnect(
  deps: ConnectDeps,
  ownerId: string,
  input: { code: string; state: string; redirectUri: string },
): Promise<Result<void, ConnectError>> {
  if (!isAllowedRedirectUri(input.redirectUri, deps.redirectAllowlist))
    return err({ reason: "redirect_not_allowed" });
  const state = await verifyOAuthState({
    secret: deps.stateSecret,
    ownerId,
    nowSec: nowSec(deps),
    state: input.state,
  });
  if (!state.ok) return err({ reason: "invalid_state" });
  const exchanged = await deps.credentials.exchangeCode(ownerId, input.code, input.redirectUri);
  if (!exchanged.ok) return err({ reason: "exchange_failed", cause: exchanged.error });
  return ok(undefined);
}
