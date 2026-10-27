export const SESSION_COOKIE = "__Host-willy_session";
/** Pre-session CSRF token for the sign-in form (double-submit; there is no session yet). */
export const LOGIN_CSRF_COOKIE = "__Host-willy_login_csrf";

export interface CookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  expires?: Date;
}

/**
 * `__Host-` cookies must be Secure, path=/ and have no Domain. Browsers treat loopback
 * (localhost / 127.0.0.1) as secure, so this also works for local development.
 */
export function sessionCookieOptions(expires: Date): CookieOptions & { expires: Date } {
  return { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires };
}

export function loginCsrfCookieOptions(): CookieOptions {
  return { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
}

export function clearCookieOptions(): CookieOptions & { expires: Date } {
  return { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: new Date(0) };
}
