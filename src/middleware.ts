import type { APIContext } from "astro";
import { defineMiddleware, sequence } from "astro:middleware";
import { authenticateSession } from "./app/identity/authenticate";
import { clearCookieOptions, SESSION_COOKIE } from "./app/identity/cookies";
import {
  classifyRoute,
  forbiddenResponse,
  unauthenticatedResponse,
} from "./app/identity/route-access";
import { runWithLocale } from "./adapters/i18n/request-locale";
import { resolveRequestLocale } from "./app/settings/language";
import { bodyTooLargeResponse, checkBodyLength, maxBodyBytesFor } from "./app/ops/body-limits";
import { enforceRateLimit, rateLimitedResponse } from "./app/ops/rate-limits";
import { observeRequest } from "./app/ops/request-observer";
import { securityHeaders } from "./app/ops/security-headers";
import { isSameOrigin, requiresCsrf, tokensMatch } from "./domain/identity/csrf";
import type { Locale } from "./i18n/translate";
import {
  ensureJobRunner,
  getDefaultLocale,
  getIdentityDeps,
  getLanguageDeps,
  getObserveDeps,
} from "./composition";

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
      // The language middleware has been left by then, so the 500 page re-enters the language it
      // resolved (or the server default when the failure came before that).
      inRequestLocale: (fn) => runWithLocale(context.locals.locale ?? getDefaultLocale(), fn),
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

/** The language of this request: the signed-in owner's choice, else the server default. */
function resolveLocale(context: APIContext): Promise<Locale> {
  return resolveRequestLocale(
    getLanguageDeps(),
    context.locals.owner?.id,
    getDefaultLocale(),
    (cause) => {
      context.locals.log?.warn("i18n.locale_unavailable", {
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
    },
  );
}

/**
 * Builds a response `auth` answers itself (403, 429, 411/413) in the request's language. Those
 * run before the `language` middleware, so they open the same per-request language here.
 */
async function answerInLocale(context: APIContext, build: () => Response): Promise<Response> {
  const locale = await resolveLocale(context);
  context.locals.locale = locale;
  return runWithLocale(locale, build);
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
    return limited
      ? answerInLocale(context, () => rateLimitedResponse(limited.retryAfterSeconds, url.pathname))
      : next();
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
  if (limited) {
    return answerInLocale(context, () =>
      rateLimitedResponse(limited.retryAfterSeconds, url.pathname),
    );
  }

  // Before anything reads the body: the CSRF check below buffers form posts.
  const bodyLimit = maxBodyBytesFor(request.method, url.pathname);
  if (bodyLimit !== null) {
    const refused = checkBodyLength(request.headers.get("content-length"), bodyLimit);
    if (refused !== null) return answerInLocale(context, () => bodyTooLargeResponse(refused));
  }

  if (requiresCsrf(request.method)) {
    const proven =
      isSameOrigin(request.headers.get("origin"), url.origin) &&
      tokensMatch(result.session.csrfSecret, await submittedCsrfToken(request));
    if (!proven) return answerInLocale(context, () => forbiddenResponse(url));
  }
  return next();
});

/**
 * Sets the interface language for everything below: the signed-in owner's choice, else
 * WILLY_DEFAULT_LOCALE. Runs after `auth`, so `locals.owner` is known. A request that `auth`
 * answers itself speaks the same language (`answerInLocale`); a redirect to sign-in has no text.
 * Every `t()` call in pages, components, use cases and the domain reads the locale from the
 * storage this opens.
 */
const language = defineMiddleware(async (context, next) => {
  const locale = await resolveLocale(context);
  context.locals.locale = locale;
  return runWithLocale(locale, next);
});

export const onRequest = sequence(observe, security, auth, language);
