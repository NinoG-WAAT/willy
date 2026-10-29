import { defineMiddleware, sequence } from "astro:middleware";
import { authenticateSession } from "./app/identity/authenticate";
import { clearCookieOptions, SESSION_COOKIE } from "./app/identity/cookies";
import {
  classifyRoute,
  forbiddenResponse,
  unauthenticatedResponse,
} from "./app/identity/route-access";
import { bodyTooLargeResponse, checkBodyLength, maxBodyBytesFor } from "./app/ops/body-limits";
import { enforceRateLimit, rateLimitedResponse } from "./app/ops/rate-limits";
import { observeRequest } from "./app/ops/request-observer";
import { securityHeaders } from "./app/ops/security-headers";
import { isSameOrigin, requiresCsrf, tokensMatch } from "./domain/identity/csrf";
import { ensureJobRunner, getIdentityDeps, getObserveDeps } from "./composition";

/**
 * Outermost: every request gets a correlation id (`X-Request-Id`, on `locals.log` lines too) and
 * one structured log line; an unexpected exception becomes a logged 500 quoting only that id.
 */
const observe = defineMiddleware((context, next) =>
  observeRequest(
    getObserveDeps(),
    {
      method: context.request.method,
      pathname: context.url.pathname,
      inboundRequestId: context.request.headers.get("x-request-id"),
      ownerId: () => context.locals.owner?.id,
    },
    ({ requestId, log }) => {
      context.locals.requestId = requestId;
      context.locals.log = log;
      return next();
    },
  ),
);

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
  // Lazily start the in-process job runner (Node only; a no-op after the first request).
  ensureJobRunner();
  const access = classifyRoute(url.pathname);
  if (access === "signature") {
    const limited = await enforceRateLimit(getIdentityDeps().limiter, {
      method: request.method,
      pathname: url.pathname,
      ownerId: undefined,
      clientAddress: context.clientAddress,
    });
    return limited ? rateLimitedResponse(limited.retryAfterSeconds, url.pathname) : next();
  }

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

  const limited = await enforceRateLimit(getIdentityDeps().limiter, {
    method: request.method,
    pathname: url.pathname,
    ownerId: result.owner.id,
    clientAddress: context.clientAddress,
  });
  if (limited) return rateLimitedResponse(limited.retryAfterSeconds, url.pathname);

  // Before anything reads the body: the CSRF check below buffers form posts.
  const bodyLimit = maxBodyBytesFor(request.method, url.pathname);
  if (bodyLimit !== null) {
    const refused = checkBodyLength(request.headers.get("content-length"), bodyLimit);
    if (refused !== null) return bodyTooLargeResponse(refused);
  }

  if (requiresCsrf(request.method)) {
    const proven =
      isSameOrigin(request.headers.get("origin"), url.origin) &&
      tokensMatch(result.session.csrfSecret, await submittedCsrfToken(request));
    if (!proven) return forbiddenResponse(url);
  }
  return next();
});

export const onRequest = sequence(observe, security, auth);
