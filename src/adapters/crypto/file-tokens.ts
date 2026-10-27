import { fromBase64Url, toBase64Url } from "./base64url";
import { hmacSha256Hex, verifyHmacSha256Hex } from "../../domain/calendar/hmac";
import { isOwnedBy, isValidObjectKey, isValidStorageId } from "../../domain/storage/object-key";
import { err, ok, type Result } from "../../domain/platform/result";
import type { Clock } from "../../ports/clock";

const MIN_SECRET_LENGTH = 32;
const MAX_TTL_SECONDS = 300;

export interface FileClaims {
  ownerId: string;
  objectKey: string;
}

export interface FileTokenService {
  /** Mint ONLY after the owner check succeeded. TTL is 1..300 seconds. */
  mint(claims: FileClaims, ttlSeconds: number): Promise<string>;
  verify(token: string): Promise<Result<FileClaims & { expiresAt: string }, "invalid" | "expired">>;
}

/**
 * Short-lived, HMAC-signed file tokens (`/api/files/:token`). The token names the owner and the
 * object key and expires within 5 minutes. A valid token is necessary but not sufficient: the
 * route must still require that the session's owner equals `ownerId`, and a deleted object is a
 * 404 whatever the token says.
 */
export function createFileTokenService(config: { secret: string; clock: Clock }): FileTokenService {
  if (config.secret.length < MIN_SECRET_LENGTH) {
    throw new Error("FILE_URL_SECRET must be at least 32 characters");
  }
  return {
    async mint(claims, ttlSeconds) {
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
        throw new Error("file token TTL must be 1 to 300 seconds");
      }
      if (
        !isValidStorageId(claims.ownerId) ||
        !isValidObjectKey(claims.objectKey) ||
        !isOwnedBy(claims.ownerId, claims.objectKey)
      ) {
        throw new Error("file token claims must name an object the owner owns");
      }
      const expiresAt = new Date(config.clock.now().getTime() + ttlSeconds * 1000).toISOString();
      const payload = toBase64Url(
        JSON.stringify({ o: claims.ownerId, k: claims.objectKey, e: expiresAt }),
      );
      return `${payload}.${await hmacSha256Hex(config.secret, payload)}`;
    },

    async verify(token) {
      const parts = token.split(".");
      const [payload, signature] = parts;
      if (parts.length !== 2 || !payload || !signature) return err("invalid");
      if (!(await verifyHmacSha256Hex(config.secret, payload, signature))) return err("invalid");

      const json = fromBase64Url(payload);
      if (json === null) return err("invalid");
      let claims: unknown;
      try {
        claims = JSON.parse(json);
      } catch {
        return err("invalid");
      }
      if (typeof claims !== "object" || claims === null) return err("invalid");
      const { o, k, e } = claims as Record<string, unknown>;
      if (typeof o !== "string" || typeof k !== "string" || typeof e !== "string")
        return err("invalid");
      if (!isValidStorageId(o) || !isValidObjectKey(k) || !isOwnedBy(o, k)) return err("invalid");
      const expires = Date.parse(e);
      if (Number.isNaN(expires)) return err("invalid");
      if (config.clock.now().getTime() >= expires) return err("expired");
      return ok({ ownerId: o, objectKey: k, expiresAt: e });
    },
  };
}
