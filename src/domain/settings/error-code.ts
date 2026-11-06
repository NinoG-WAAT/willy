/** The plain, lowercase codes jobs record; anything else is never shown. */
export const PLAIN_CODE = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * A job's error code as it may be shown: the code itself when it is plain, otherwise
 * "unrecognized" (a provider message, a URL or a token is never echoed). Kept apart from the
 * sentences of `provider-status.ts` so the deletion progress script, which only needs the code,
 * does not carry them.
 */
export function displayableErrorCode(code: string): string {
  return PLAIN_CODE.test(code) ? code : "unrecognized";
}
