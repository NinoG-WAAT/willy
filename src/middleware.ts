import { defineMiddleware, sequence } from "astro:middleware";
import { authenticateSession } from "./app/identity/authenticate";
import { clearCookieOptions, SESSION_COOKIE } from "./app/identity/cookies";
import {
  classifyRoute,
  forbiddenResponse,
  unauthenticatedResponse,
} from "./app/identity/route-access";
import { securityHeaders } from "./app/ops/security-headers";
import { isSameOrigin, requiresCsrf, tokensMatch } from "./domain/identity/csrf";
import { getIdentityDeps } from "./composition";

// The strict CSP is production-only: Astro's dev toolbar injects inline scripts.
const security = defineMiddleware(async (_context, next) => {
  const response = await next();
  if (import.meta.env.PROD) {
    for (const [name, value] of Object.entries(securityHeaders())) {
      response.headers.set(name, value);
    }
  }
  return response;
});

/** Reads the CSRF token from the header (fetch/upload) or the `csrf_token` form field. */
async function submittedCsrfToken(request: Request): Promise<string | null> {
  const header = request.headers.get("x-csrf-token");
  if (header) return header;
  const type = request.headers.get("content-type") ?? "";
  if (
    !type.startsWith("application/x-www-form-urlencoded") &&
    !type.startsWith("multipart/form-data")
  ) {
    return null;
  }
  try {
    const value = (await request.clone().formData()).get("csrf_token");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Default-deny authentication and CSRF for every route except the public and webhook lists in
 * `classifyRoute`. Owner routes get `locals.owner`; everything that changes state needs the
 * session's CSRF token and a same-origin `Origin` header.
 */
const auth = defineMiddleware(async (context, next) => {
  const { request, url, cookies, locals } = context;
  const access = classifyRoute(url.pathname);
  if (access === "signature") return next();

  const token = cookies.get(SESSION_COOKIE)?.value;
  if (access === "public" && !token) return next();

  const result = await authenticateSession(getIdentityDeps(), token);
  locals.sessionState = result.status;
  if (result.status === "authenticated") {
    locals.owner = result.owner;
    locals.csrfToken = result.session.csrfSecret;
  }
  if (access === "public") return next();

  if (result.status !== "authenticated") {
    if (token) cookies.set(SESSION_COOKIE, "", clearCookieOptions());
    return unauthenticatedResponse(result.status, request.method, url);
  }

  if (requiresCsrf(request.method)) {
    const proven =
      isSameOrigin(request.headers.get("origin"), url.origin) &&
      tokensMatch(result.session.csrfSecret, await submittedCsrfToken(request));
    if (!proven) return forbiddenResponse(url);
  }
  return next();
});

export const onRequest = sequence(security, auth);
