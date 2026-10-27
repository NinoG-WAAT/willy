import type { Result } from "../platform/result";
import { err, ok } from "../platform/result";
import { hmacSha256Hex, verifyHmacSha256Hex } from "./hmac";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
export const OAUTH_STATE_TTL_SEC = 600;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Exact-match allowlist (A10, open-redirect protection). Entries are also sanity-checked so a
 * misconfigured allowlist cannot permit plain http for real hosts, credentials in the URL, or fragments.
 */
export function isAllowedRedirectUri(candidate: string, allowlist: readonly string[]): boolean {
  if (!allowlist.includes(candidate)) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "" || url.search !== "")
    return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CALENDAR_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export type OAuthStateError = "malformed" | "mismatch" | "expired";

interface StateInput {
  secret: string;
  ownerId: string;
  nonce: string;
  nowSec: number;
}

const macInput = (ownerId: string, nonce: string, expiresAt: number) =>
  `${ownerId}|${nonce}|${String(expiresAt)}`;

/** Stateless, owner-bound OAuth `state`: `<nonce>.<expiry>.<mac>`. The nonce must not contain ".". */
export async function createOAuthState(input: StateInput): Promise<string> {
  const expiresAt = input.nowSec + OAUTH_STATE_TTL_SEC;
  const mac = await hmacSha256Hex(input.secret, macInput(input.ownerId, input.nonce, expiresAt));
  return `${input.nonce}.${String(expiresAt)}.${mac}`;
}

export async function verifyOAuthState(input: {
  secret: string;
  ownerId: string;
  nowSec: number;
  state: string;
}): Promise<Result<void, OAuthStateError>> {
  const parts = input.state.split(".");
  if (parts.length !== 3) return err("malformed");
  const [nonce, expiry, mac] = parts as [string, string, string];
  if (nonce === "" || !/^\d{1,12}$/.test(expiry) || mac === "") return err("malformed");
  const expiresAt = Number(expiry);
  const valid = await verifyHmacSha256Hex(
    input.secret,
    macInput(input.ownerId, nonce, expiresAt),
    mac,
  );
  if (!valid) return err("mismatch");
  if (input.nowSec > expiresAt) return err("expired");
  return ok(undefined);
}
