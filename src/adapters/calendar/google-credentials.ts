import { providerError, type ProviderError } from "../../domain/platform/provider-error";
import { err, ok, type Result } from "../../domain/platform/result";
import type { CalendarCredentialStore } from "../../ports/calendar-credential-store";
import type { TokenCipher } from "../../ports/token-cipher";
import { guardedFetchJson } from "../http/guarded-fetch";

export const GOOGLE_TOKEN_HOST = "oauth2.googleapis.com";
const TOKEN_URL = `https://${GOOGLE_TOKEN_HOST}/token`;
/** Refresh slightly early so a token never expires mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export interface GoogleCredentialsConfig {
  store: CalendarCredentialStore;
  cipher: TokenCipher;
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  now: () => Date;
  timeoutMs: number;
}

interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
}

export interface GoogleCredentials {
  exchangeCode(
    ownerId: string,
    code: string,
    redirectUri: string,
  ): Promise<Result<void, ProviderError>>;
  getAccessToken(ownerId: string): Promise<Result<string, ProviderError>>;
}

const contextOf = (ownerId: string) => `calendar-credentials:${ownerId}`;

function parseCredentials(json: string): Credentials | null {
  try {
    const v = JSON.parse(json) as Partial<Credentials>;
    if (
      typeof v.accessToken === "string" &&
      typeof v.refreshToken === "string" &&
      typeof v.expiresAtMs === "number"
    ) {
      return {
        accessToken: v.accessToken,
        refreshToken: v.refreshToken,
        expiresAtMs: v.expiresAtMs,
      };
    }
  } catch {
    // fall through: unreadable credentials are handled by the caller
  }
  return null;
}

/** Long-lived Google tokens: server-side only, sealed with AES-GCM before they reach the store. */
export function createGoogleCredentials(config: GoogleCredentialsConfig): GoogleCredentials {
  async function requestTokens(params: Record<string, string>) {
    const body = new URLSearchParams({
      ...params,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    const result = await guardedFetchJson(
      config.fetch,
      TOKEN_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      },
      { timeoutMs: config.timeoutMs, allowedHosts: [GOOGLE_TOKEN_HOST] },
    );
    if (!result.ok) return result;
    const v = result.value as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (typeof v?.access_token !== "string" || typeof v.expires_in !== "number") {
      return err(providerError("unavailable", "token endpoint returned an unexpected payload"));
    }
    return ok({
      accessToken: v.access_token,
      refreshToken: typeof v.refresh_token === "string" ? v.refresh_token : null,
      expiresAtMs: config.now().getTime() + v.expires_in * 1000,
    });
  }

  async function persist(ownerId: string, credentials: Credentials): Promise<void> {
    await config.store.save(
      ownerId,
      await config.cipher.seal(JSON.stringify(credentials), contextOf(ownerId)),
    );
  }

  return {
    async exchangeCode(ownerId, code, redirectUri) {
      const tokens = await requestTokens({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      });
      if (!tokens.ok) return tokens;
      if (tokens.value.refreshToken === null) {
        return err(providerError("rejected", "provider did not grant offline access"));
      }
      await persist(ownerId, { ...tokens.value, refreshToken: tokens.value.refreshToken });
      return ok(undefined);
    },

    async getAccessToken(ownerId) {
      const sealed = await config.store.load(ownerId);
      if (sealed === null) return err(providerError("rejected", "calendar is not connected"));
      const opened = await config.cipher.open(sealed, contextOf(ownerId));
      const current = opened.ok ? parseCredentials(opened.value) : null;
      if (!current)
        return err(providerError("rejected", "stored calendar credentials are unreadable"));

      if (current.expiresAtMs - config.now().getTime() > EXPIRY_MARGIN_MS)
        return ok(current.accessToken);

      const refreshed = await requestTokens({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      });
      if (!refreshed.ok) return refreshed;
      await persist(ownerId, {
        accessToken: refreshed.value.accessToken,
        refreshToken: refreshed.value.refreshToken ?? current.refreshToken,
        expiresAtMs: refreshed.value.expiresAtMs,
      });
      return ok(refreshed.value.accessToken);
    },
  };
}
